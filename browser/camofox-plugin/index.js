import express from 'express';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';

// A small Camofox extension: real browser response metadata, durable checkpoints,
// and OAuth redirects which never become a document URL (native app callbacks).
export function register(app, ctx) {
  const watches = new Map(), queues = new Map();
  app.use('/fam', express.json({type: 'application/vnd.fam+json', limit: '72mb'}));
  app.use('/fam', ctx.auth());
  const route = (method, path, action) => app[method](`/fam/${path}`, async (req, res) => {
    try {res.json({ok: true, ...await action(req.body ?? {}, req)});}
    catch (error) {res.status(error.status ?? 400).json({ok: false, error: error.famCode ?? 'browser-operation-failed'});}
  });
  const fail = code => {throw Object.assign(new Error(code), {famCode: code});};
  const owner = userId => typeof userId === 'string' && /^fam-[a-zA-Z0-9._-]+$/.test(userId) ? userId : fail('invalid-fam-session');
  function tab(userId, tabId) {
    const session = ctx.sessions.get(owner(userId));
    for (const group of session?.tabGroups?.values() ?? []) {
      const state = group.get(tabId);
      if (state && !state.page.isClosed()) {session.lastAccess = Date.now(); return {session, page: state.page};}
    }
    fail('tab-not-found');
  }
  async function checkpoint(userId) {return serial(`checkpoint:${owner(userId)}`, async () => {
    const session = ctx.sessions.get(owner(userId));
    if (!session) return {cookies: [], origins: []};
    const state = await session.context.storageState({indexedDB: true});
    // Write the upstream persistence format ourselves as well: old Camofox
    // versions do not await/export checkpoints. Never rely on eventual shutdown.
    const root = ctx.config.profileDir;
    if (root) {
      const directory = join(root, createHash('sha256').update(userId).digest('hex').slice(0, 32));
      await mkdir(directory, {recursive: true, mode: 0o700});
      const path = join(directory, 'storage-state.json'), temporary = `${path}.${randomUUID()}.tmp`;
      try {await writeFile(temporary, JSON.stringify(state), {mode: 0o600}); await rename(temporary, path);}
      finally {await rm(temporary, {force: true});}
    }
    return state;
  });}
  async function serial(key, action) {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(key, next);
    try {return await next;} finally {if (queues.get(key) === next) queues.delete(key);}
  }
  route('get', 'capabilities', async () => ({version: 1, response: true, callbacks: true, checkpoint: true}));
  route('post', 'storage', async ({userId}) => ({state: await checkpoint(userId)}));
  route('post', 'cookies', async ({userId, cookies}) => {
    const session = await ctx.getSession(owner(userId));
    if (!Array.isArray(cookies)) fail('invalid-cookies');
    await session.context.addCookies(cookies);
    await checkpoint(userId); return {};
  });
  route('post', 'close-tab', async ({userId, tabId}) => {
    const {session, page} = tab(userId, tabId);
    await checkpoint(userId); await page.close();
    for (const group of session.tabGroups.values()) group.delete(tabId);
    return {};
  });
  route('post', 'prepare', async ({userId, tabId, origin}) => {
    const {page} = tab(userId, tabId), target = new URL(origin);
    if (!['https:', 'http:'].includes(target.protocol) || target.origin !== origin) fail('wrong-browser-origin');
    // A transport-only document avoids an API root's redirects or restrictive
    // homepage CSP. Actual fetches still travel through Firefox with its cookies.
    const url = `${origin}/.fam-browser-${randomUUID()}`;
    const handler = route => route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>fam browser transport</title>'});
    await page.route(url, handler);
    try {await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 15000});}
    finally {await page.unroute(url, handler);}
    return {};
  });
  route('post', 'request', async body => serial(body.tabId, async () => {
    const {userId, tabId, url, method = 'GET', headers = {}, bodyBase64} = body;
    const {page} = tab(userId, tabId), target = new URL(url);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || new URL(page.url()).origin !== target.origin) fail('wrong-browser-origin');
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) fail('invalid-method');
    const requestId = randomUUID(), outgoing = {};
    for (const [key, value] of Object.entries(headers)) if (!/^(cookie|host|user-agent|content-length|connection|accept-encoding|origin|referer|sec-.*|proxy-.*)$/i.test(key)) outgoing[key] = String(value);
    outgoing['x-fam-request-id'] = requestId;
    let resolveResponse;
    const observed = new Promise(resolve => {resolveResponse = resolve;});
    const listener = response => {
      if (response.url() === target.href && response.request().headers()['x-fam-request-id'] === requestId) resolveResponse(response);
    };
    page.on('response', listener);
    let timer;
    try {
      // The browser sends the request. Playwright observes its response, including
      // headers hidden from page JavaScript and manual 3xx responses. Never replay
      // a request merely because page fetch reports a CORS/network error.
      const sent = page.evaluate(async ({url, method, headers, bodyBase64}) => {
        try {
          const bytes = bodyBase64 === undefined ? undefined : Uint8Array.from(atob(bodyBase64), c => c.charCodeAt(0));
          const response = await fetch(url, {method, headers, body: bytes, credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(45000)});
          await response.arrayBuffer();
        } catch {}
      }, {url: target.href, method, headers: outgoing, bodyBase64});
      void sent.catch(() => {});
      const response = await Promise.race([observed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('timeout')), 47000);})]);
      const responseHeaders = await response.allHeaders(), status = response.status();
      if (Number(responseHeaders['content-length']) > 64 * 1024 * 1024) fail('response-too-large');
      const bytes = method === 'HEAD' || [204, 205, 304].includes(status) || status >= 300 && status < 400 ? Buffer.alloc(0) : await response.body();
      if (bytes.length > 64 * 1024 * 1024) fail('response-too-large');
      await checkpoint(userId);
      return {status, headers: (await response.headersArray()).map(({name, value}) => [name, value]), bodyBase64: bytes.toString('base64')};
    } finally {clearTimeout(timer); page.off('response', listener);}
  }));
  route('post', 'input', async ({userId, tabId, origin, username, password}) => {
    const {page} = tab(userId, tabId);
    if (new URL(page.url()).origin !== origin) fail('wrong-login-origin');
    const email = page.locator('input[type=email]:visible, input[autocomplete=username]:visible, input[name*="email" i]:visible, input[name=username]:visible, input[id=email-login]:visible').first();
    const secret = page.locator('input[type=password]:visible').first();
    const hasEmail = await email.count() > 0;
    const passwordSubmitted = await secret.count() > 0;
    if (!hasEmail && !passwordSubmitted) return {submitted: false};
    if (hasEmail) await email.fill(username);
    if (passwordSubmitted) await secret.fill(password);
    const form = (hasEmail ? email : secret).locator('xpath=ancestor::form[1]');
    const scope = await form.count() ? form : page;
    const button = scope.getByRole('button', {name: /^(sign in|log in|login|continue|next)$/i}).filter({visible: true}).first();
    if (!passwordSubmitted && !await button.count()) return {submitted: false};
    // Keyboard submission also works when a cookie notice overlaps the button.
    // It avoids changing the user's optional cookie-consent preferences.
    if (passwordSubmitted) await secret.press('Enter', {timeout: 10000});
    else await button.press('Enter', {timeout: 10000});
    return {submitted: true, passwordSubmitted};
  });
  route('post', 'callback', async ({userId, origin, redirectUri, state, timeoutMs = 600000}) => {
    owner(userId);
    const session = await ctx.getSession(userId), id = randomUUID();
    const expected = new URL(redirectUri);
    if (new URL(origin).protocol !== 'https:' || typeof state !== 'string' || !state || expected.username || expected.password) fail('invalid-callback');
    const watch = {userId, listener: undefined, timer: undefined, callback: undefined};
    const listener = async response => {
      if (new URL(response.url()).origin !== origin || response.status() < 300 || response.status() >= 400) return;
      let location;
      try {location = (await response.allHeaders()).location;} catch {return;}
      if (!location) return;
      try {
        const actual = new URL(location);
        if (actual.protocol === expected.protocol && actual.host === expected.host && actual.pathname === expected.pathname && actual.searchParams.getAll('state').length === 1 && actual.searchParams.get('state') === state) watch.callback = actual.href;
      } catch {}
    };
    watch.listener = listener;
    session.context.on('response', listener);
    watch.timer = setTimeout(() => discard(id), Math.min(3600000, Math.max(60000, timeoutMs)));
    watches.set(id, watch); return {id};
  });
  function discard(id) {
    const watch = watches.get(id); if (!watch) return;
    ctx.sessions.get(watch.userId)?.context.off('response', watch.listener);
    clearTimeout(watch.timer); watches.delete(id);
  }
  route('post', 'callback-result', async ({userId, id, cancel}) => {
    const watch = watches.get(id);
    if (!watch || watch.userId !== owner(userId)) return {expired: true};
    const callback = watch.callback;
    if (callback || cancel) discard(id);
    return callback ? {callback} : {pending: !cancel};
  });
  route('post', 'close', async ({userIds}) => {
    if (!Array.isArray(userIds)) fail('invalid-sessions');
    let closed = 0;
    for (const userId of userIds) {
      const session = ctx.sessions.get(owner(userId));
      if (!session) continue;
      await checkpoint(userId);
      for (const [groupId, group] of session.tabGroups) {
        if (groupId !== 'fam') continue;
        for (const [id, state] of group) {await state.page.close(); group.delete(id); closed++;}
        session.tabGroups.delete(groupId);
      }
    }
    return {closed};
  });
  ctx.events.on('session:destroyed', ({userId}) => {for (const [id, watch] of watches) if (watch.userId === userId) discard(id);});
  ctx.events.on('server:shutdown', () => {for (const id of watches.keys()) discard(id);});
}
