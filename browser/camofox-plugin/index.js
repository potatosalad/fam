import express from 'express';
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, writeFile, readFile, readdir, rename, rm, cp, access} from 'node:fs/promises';
import {join} from 'node:path';

// A small Camofox extension: real browser response metadata, durable checkpoints,
// and OAuth redirects which never become a document URL (native app callbacks).
export function register(app, ctx) {
  const watches = new Map(), queues = new Map(), resetting = new Set(), operations = new Map(), privateStates = new Map(), pages = new Map();
  let resettingAll = false;
  app.use('/fam', express.json({type: 'application/vnd.fam+json', limit: '72mb'}));
  app.use('/fam', ctx.auth());
  const route = (method, path, action) => app[method](`/fam/${path}`, async (req, res) => {
    const ids = [req.body?.userId, ...(Array.isArray(req.body?.userIds) ? req.body.userIds : [])].filter(isOwner);
    let pending;
    try {
      if (path !== 'reset' && ids.some(id => resetting.has(id) || resettingAll)) fail('session-reset-in-progress');
      pending = Promise.resolve().then(() => action(req.body ?? {}, req));
      if (path !== 'reset') for (const id of ids) {
        if (!operations.has(id)) operations.set(id, new Set());
        operations.get(id).add(pending);
      }
      res.json({ok: true, ...await pending});
    }
    catch (error) {res.status(error.status ?? 400).json({ok: false, error: error.famCode ?? 'browser-operation-failed'});}
    finally {if (path !== 'reset') for (const id of ids) {const active = operations.get(id); active?.delete(pending); if (!active?.size) operations.delete(id);}}
  });
  const fail = code => {throw Object.assign(new Error(code), {famCode: code});};
  const isOwner = userId => typeof userId === 'string' && /^fam-[a-zA-Z0-9._-]+$/.test(userId);
  const isPrivate = userId => isOwner(userId) && /-(?:myheritage|web-private)$/.test(userId) && process.env.FAM_PRIVATE_CONTEXTS === '1';
  const owner = userId => isOwner(userId) ? userId : fail('invalid-fam-session');
  const profile = userId => join(ctx.config.profileDir, createHash('sha256').update(owner(userId)).digest('hex').slice(0, 32));
  async function wasReset(userId) {
    if (!ctx.config.profileDir) return false;
    return await exists(join(profile(userId), 'fam-reset.json')) || await exists(join(ctx.config.profileDir, 'fam-reset-all.json'));
  }
  async function exists(path) {try {await access(path); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}}
  async function atomicJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {await writeFile(temporary, JSON.stringify(value), {mode: 0o600}); await rename(temporary, path);}
    finally {await rm(temporary, {force: true});}
  }
  function tab(userId, tabId) {
    const session = ctx.sessions.get(owner(userId));
    for (const group of session?.tabGroups?.values() ?? []) {
      const state = group.get(tabId);
      if (state && !state.page.isClosed()) {session.lastAccess = Date.now(); state.toolCalls = (state.toolCalls ?? 0) + 1; return {session, page: state.page};}
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
      await atomicJson(join(directory, 'fam-session.json'), {userId});
    }
    return state;
  });}
  async function serial(key, action) {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(action);
    queues.set(key, next);
    try {return await next;} finally {if (queues.get(key) === next) queues.delete(key);}
  }
  route('get', 'capabilities', async () => ({version: 1, response: true, callbacks: true, checkpoint: true, autofill: true, fetch: true,
    privateBrowsing: process.env.FAM_PRIVATE_CONTEXTS === '1', privateFetch: process.env.FAM_PRIVATE_CONTEXTS === '1',
    reset: !!ctx.config.profileDir && typeof ctx.closeSession === 'function'}));
  async function ownedSessions() {
    const ids = new Set([...ctx.sessions.keys()].filter(isOwner));
    const entries = await readdir(ctx.config.profileDir, {withFileTypes: true}).catch(error => {if (error.code === 'ENOENT') return []; throw error;});
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
      for (const name of ['meta.json', 'fam-session.json', 'fam-reset.json']) {
        let meta;
        try {meta = JSON.parse(await readFile(join(ctx.config.profileDir, entry.name, name), 'utf8'));}
        catch (error) {if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error;}
        if (isOwner(meta?.userId) && profile(meta.userId) === join(ctx.config.profileDir, entry.name)) ids.add(meta.userId);
      }
    }
    return ids;
  }
  function checkOwnership(userId) {
    if ([...(ctx.sessions.get(userId)?.tabGroups ?? [])].some(([group, tabs]) => group !== 'fam' && tabs.size)) fail('session-has-unrelated-tabs');
  }
  route('post', 'reset', async ({userId, userIds, all = false}) => {
    if (!ctx.config.profileDir || typeof ctx.closeSession !== 'function') fail('session-reset-unsupported');
    if (typeof all !== 'boolean' || userId !== undefined && userIds !== undefined || userIds !== undefined && !Array.isArray(userIds)) fail('invalid-sessions');
    const ids = new Set((userIds ?? (userId === undefined ? [] : [userId])).map(owner));
    if (!all && !ids.size) fail('invalid-sessions');
    if (resettingAll || all && resetting.size || [...ids].some(id => resetting.has(id))) fail('session-reset-in-progress');
    if (all) resettingAll = true;
    try {
      if (all) for (const id of await ownedSessions()) ids.add(id);
      // Preflight the complete selection before changing any provider.
      for (const id of ids) checkOwnership(id);
      for (const id of ids) resetting.add(id);
      const results = [];
      for (const id of ids) results.push({userId: id, ...await resetSession(id)});
      if (all) {
        await mkdir(ctx.config.profileDir, {recursive: true, mode: 0o700});
        await atomicJson(join(ctx.config.profileDir, 'fam-reset-all.json'), {at: new Date().toISOString()});
      }
      return {all, sessions: results, browserStopped: false, ...(userId === undefined ? {} : results[0])};
    } finally {for (const id of ids) resetting.delete(id); if (all) resettingAll = false;}
  });
  async function resetSession(userId) {
    // Finish even cookie imports which began before the reset lock. Otherwise an
    // older client could seed the fresh context after reset had already finished.
    await Promise.allSettled([...(operations.get(userId) ?? [])]);
    const session = ctx.sessions.get(userId);
    const resetId = randomUUID(), directory = profile(userId);
    const backup = join(ctx.config.profileDir, 'fam-reset-backups', `${createHash('sha256').update(userId).digest('hex').slice(0,32)}-${resetId}`);
    const staging = join(ctx.config.profileDir, `.fam-reset-${resetId}`);
    let archived = false, replaced = false;
    try {
      // Drain requests already using this context before closing/checkpointing it.
      const pending = [...(session?.tabGroups.values() ?? [])].flatMap(group => [...group.keys()].map(id => queues.get(id)));
      await Promise.allSettled([...pending, queues.get(`checkpoint:${userId}`)].filter(Boolean));
      await mkdir(backup, {recursive: true, mode: 0o700});
      try {await cp(directory, join(backup, 'before-close'), {recursive: true});}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      if (session) {
        try {await writeFile(join(backup, 'live-storage-state.json'), JSON.stringify(await session.context.storageState({indexedDB: true})), {mode: 0o600});}
        catch { /* The on-disk backup still permits resetting a dead context. */ }
      }
      await mkdir(staging, {mode: 0o700});
      // A present but empty state also prevents upstream bootstrap-cookie import.
      await writeFile(join(staging, 'storage-state.json'), JSON.stringify({cookies: [], origins: []}), {mode: 0o600});
      await writeFile(join(staging, 'fam-reset.json'), JSON.stringify({userId, resetId, at: new Date().toISOString()}), {mode: 0o600});
      checkOwnership(userId);
      const closedTabs = [...(session?.tabGroups.values() ?? [])].reduce((n, group) => n + group.size, 0);
      if (session) await ctx.closeSession(userId, session, {reason: 'fam_reset', clearDownloads: true, clearLocks: true});
      try {await rename(directory, join(backup, 'closed-profile')); archived = true;}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      await rename(staging, directory); replaced = true;
      return {resetId, backupDirectory: backup, closedTabs, browserStopped: false};
    } catch (error) {
      if (archived && !replaced) await rename(join(backup, 'closed-profile'), directory);
      throw error;
    } finally {await rm(staging, {recursive: true, force: true});}
  }
  ctx.events.on('session:creating', async ({userId, contextOptions}) => {
    if (!isOwner(userId)) return;
    if (resettingAll || resetting.has(userId)) fail('session-reset-in-progress');
    // Firefox containers are not private windows. Keep the general private
    // browsing context separate from MyHeritage and ordinary web cookies.
    if (isPrivate(userId)) {
      contextOptions.extraHTTPHeaders = {...contextOptions.extraHTTPHeaders, 'x-fam-private-context': '1'};
      // Upstream persistence hooks run concurrently. Capture even a later
      // storageState assignment, and restore only after a private page exists.
      privateStates.set(userId, contextOptions.storageState);
      Object.defineProperty(contextOptions, 'storageState', {enumerable: true, configurable: true,
        get: () => undefined, set: state => privateStates.set(userId, state)});
    }
    // A previously unseen fam session must not reload bootstrap cookies after
    // --all, including a session requested by an older client on another host.
    if (ctx.config.profileDir && await exists(join(ctx.config.profileDir, 'fam-reset-all.json')) && !await exists(join(profile(userId), 'storage-state.json'))) {
      const state = {cookies: [], origins: []};
      await mkdir(profile(userId), {recursive: true, mode: 0o700});
      await atomicJson(join(profile(userId), 'storage-state.json'), state);
      await atomicJson(join(profile(userId), 'fam-session.json'), {userId});
      contextOptions.storageState = state;
    }
  });
  ctx.events.on('session:created', async ({userId, context}) => {
    if (!isPrivate(userId)) return;
    // Firefox clears private storage when its last private window closes.
    // Keep this page alive through Playwright's temporary restore pages, then
    // hand it to Camofox's first tab request without leaving an extra window.
    const initial = await context.newPage();
    const state = privateStates.get(userId); privateStates.delete(userId);
    if (state) {
      if (typeof context.setStorageState !== 'function') fail('private-storage-restore-unsupported');
      await context.setStorageState(state);
    }
    const newPage = context.newPage.bind(context);
    context.newPage = async (...args) => {
      context.newPage = newPage;
      return initial.isClosed() ? newPage(...args) : initial;
    };
  });
  route('post', 'storage', async ({userId}) => ({state: await checkpoint(userId)}));
  route('post', 'cookies', async ({userId, cookies, explicit = false}) => {
    // Other CLI hosts may still have pre-reset HTTP cookie snapshots. Only an
    // explicit HAR/cookie import may seed a context after the user reset it.
    if (explicit !== true && await wasReset(userId)) return {imported: 0, skipped: 'session-reset'};
    const session = await ctx.getSession(owner(userId));
    if (!Array.isArray(cookies)) fail('invalid-cookies');
    await session.context.addCookies(cookies);
    await checkpoint(userId); return {imported: cookies.length};
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
  function fetchHeaders(headers) {
    const result = Object.fromEntries(new Headers(headers));
    // These are controlled by the engine. Never silently claim an override.
    for (const name of Object.keys(result)) if (/^(cookie|host|origin|content-length|connection|accept-encoding|transfer-encoding|upgrade|trailer|te|keep-alive|sec-.*|proxy-.*)$/i.test(name)) fail('unsupported-fetch-header');
    return result;
  }
  const request = generic => async body => serial(body.tabId, async () => {
    const {userId, tabId, url, method = 'GET', headers = {}, bodyBase64} = body;
    const timeoutMs = generic ? body.timeoutMs ?? 60000 : 45000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) fail('invalid-timeout');
    const {page} = tab(userId, tabId), target = new URL(url);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password || new URL(page.url()).origin !== target.origin) fail('wrong-browser-origin');
    if (generic ? !/^[A-Z!#$%&'*+.^_`|~-]+$/.test(method) || ['CONNECT','TRACE','TRACK'].includes(method) : !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) fail('invalid-method');
    const requestId = randomUUID(), outgoing = {};
    for (const [key, value] of Object.entries(headers)) if (!/^(cookie|host|user-agent|content-length|connection|accept-encoding|origin|referer|sec-.*|proxy-.*)$/i.test(key)) outgoing[key] = String(value);
    if (!generic) outgoing['x-fam-request-id'] = requestId;
    const custom = generic ? fetchHeaders(headers) : {};
    // This page is a blank same-origin transport document. Extra headers apply
    // only for this request; redirects are manual and cannot carry them onward.
    // Routing overrides lose manual redirect responses in Chromium and some
    // headers are regenerated by the engine after route.continue().
    if (generic) await page.setExtraHTTPHeaders(custom);
    let resolveResponse;
    const observed = new Promise(resolve => {resolveResponse = resolve;});
    const listener = response => {
      if (response.url() === target.href && (generic || response.request().headers()['x-fam-request-id'] === requestId)) resolveResponse(response);
    };
    page.on('response', listener);
    let timer;
    try {
      // The browser sends the request. Playwright observes its response, including
      // headers hidden from page JavaScript and manual 3xx responses. Never replay
      // a request merely because page fetch reports a CORS/network error.
      const sent = page.evaluate(async ({url, method, headers, bodyBase64, timeoutMs}) => {
        try {
          const bytes = bodyBase64 === undefined ? undefined : Uint8Array.from(atob(bodyBase64), c => c.charCodeAt(0));
          const response = await fetch(url, {method, headers, body: bytes, credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs)});
          await response.arrayBuffer();
        } catch {}
      }, {url: target.href, method, headers: outgoing, bodyBase64, timeoutMs});
      void sent.catch(() => {});
      const response = await Promise.race([observed, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('timeout')), timeoutMs + 2000);})]);
      const responseHeaders = await response.allHeaders(), status = response.status();
      if (Number(responseHeaders['content-length']) > 64 * 1024 * 1024) fail('response-too-large');
      const bytes = method === 'HEAD' || [204, 205, 304].includes(status) || status >= 300 && status < 400 ? Buffer.alloc(0) : await response.body();
      if (bytes.length > 64 * 1024 * 1024) fail('response-too-large');
      await checkpoint(userId);
      return {url: response.url(), status, statusText: response.statusText(), headers: (await response.headersArray()).map(({name, value}) => [name, value]), bodyBase64: bytes.toString('base64')};
    } finally {clearTimeout(timer); page.off('response', listener); if (generic) await page.setExtraHTTPHeaders({});}
  });
  route('post', 'request', request(false));
  route('post', 'fetch-request', request(true));
  async function releasePage(tabId) {
    const state = pages.get(tabId); if (!state) return;
    pages.delete(tabId); clearTimeout(state.timer);
    state.page.off('response', state.listener);
    if (state.routed) await state.page.unroute('**/*', state.override).catch(() => {});
  }
  route('post', 'page-start', async ({userId, tabId, url, headers = {}, timeoutMs = 60000}) => serial(tabId, async () => {
    const {page} = tab(userId, tabId), target = new URL(url), custom = fetchHeaders(headers);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) fail('wrong-browser-origin');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) fail('invalid-timeout');
    await releasePage(tabId);
    const state = {page, response: undefined, capture: undefined, error: undefined, routed: Object.keys(custom).length > 0};
    state.override = async route => {
      const req = route.request();
      if (!Object.keys(custom).length || !req.isNavigationRequest() || req.frame() !== page.mainFrame() || new URL(req.url()).origin !== target.origin) return route.fallback();
      await route.continue({headers: {...req.headers(), ...custom}});
    };
    state.listener = response => {
      if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame() || response.status() >= 300 && response.status() < 400) return;
      state.response = response;
      state.capture = (async () => {
        const headers = await response.headersArray();
        if (Number((await response.allHeaders())['content-length']) > 64 * 1024 * 1024) fail('response-too-large');
        const bytes = [204,205,304].includes(response.status()) ? Buffer.alloc(0) : await response.body();
        if (bytes.length > 64 * 1024 * 1024) fail('response-too-large');
        return {url: response.url(), status: response.status(), statusText: response.statusText(), headers: headers.map(({name,value}) => [name,value]), bodyBase64: bytes.toString('base64')};
      })();
      void state.capture.catch(() => {});
    };
    pages.set(tabId, state);
    state.timer = setTimeout(() => void releasePage(tabId), 3700000); state.timer.unref();
    page.once('close', () => void releasePage(tabId));
    // Even a pass-through route disables normal browser caching. A plain
    // navigation must leave the browser's network behavior untouched.
    if (state.routed) await page.route('**/*', state.override);
    page.on('response', state.listener);
    // Return promptly so the CLI can report interactive verification and poll.
    void page.goto(target.href, {waitUntil: 'domcontentloaded', timeout: timeoutMs, ...(custom.referer ? {referer: custom.referer} : {})})
      .catch(error => {state.error = error.name === 'TimeoutError' ? 'page-timeout' : 'page-navigation-failed';});
    return {};
  }));
  route('post', 'page-result', async ({userId, tabId, selector}) => {
    const {page} = tab(userId, tabId), state = pages.get(tabId);
    if (!state) fail('page-not-started');
    if (!state.response) {if (state.error) fail(state.error); return {pending: true};}
    const capture = state.capture;
    let response;
    try {response = await capture;} catch (error) {if (capture !== state.capture) return {pending: true}; throw error;}
    const snapshot = await page.evaluate(selector => {
      const element = selector ? document.querySelector(selector) : document.body;
      const visible = element && !!(element.getClientRects().length) && getComputedStyle(element).visibility !== 'hidden';
      const copy = element?.cloneNode(true);
      if (copy) {
        const original = [...element.querySelectorAll('*')], clones = [...copy.querySelectorAll('*')];
        for (let i = original.length - 1; i >= 0; i--) {
          const style = getComputedStyle(original[i]);
          if (style.display === 'none' || style.visibility === 'hidden' || ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(original[i].tagName)) clones[i].remove();
        }
      }
      return {url: location.href, title: document.title, html: (document.doctype ? new XMLSerializer().serializeToString(document.doctype) + '\n' : '') + document.documentElement.outerHTML,
        contentHtml: copy?.outerHTML ?? '', text: element?.innerText ?? element?.textContent ?? '',
        ready: document.readyState !== 'loading', selected: !!visible};
    }, selector).catch(error => {
      if (/execution context|context.*destroyed|navigation|cannot find context/i.test(error.message)) return undefined;
      throw error;
    });
    if (!snapshot || capture !== state.capture) return {pending: true};
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024 * 1024) fail('response-too-large');
    return {...response, ...snapshot, url: /^https?:/.test(snapshot.url) ? snapshot.url : response.url, pending: false};
  });
  route('post', 'page-end', async ({userId, tabId}) => {tab(userId, tabId); await releasePage(tabId); await checkpoint(userId); return {};});
  // A separate route makes fill-only requests safe against older plugins: an
  // unsupported endpoint fails instead of silently falling back to submission.
  route('post', 'autofill', async ({userId, tabId, origin, username, password}) => {
    const {page} = tab(userId, tabId);
    const checkOrigin = () => {if (!['http:', 'https:'].includes(new URL(page.url()).protocol) || new URL(page.url()).origin !== origin) fail('wrong-login-origin');};
    checkOrigin();
    if (typeof username !== 'string' || typeof password !== 'string') fail('invalid-login-input');
    const email = page.locator('input[type=email]:visible:enabled:not([readonly]), input[autocomplete=username]:visible:enabled:not([readonly]), input[name*="email" i]:visible:enabled:not([readonly]), input[name=username]:visible:enabled:not([readonly]), input[id=email-login]:visible:enabled:not([readonly])').first();
    const secret = page.locator('input[type=password]:visible:enabled:not([readonly])').first();
    let ready = false, filled = false;
    for (const [field, value] of [[email, username], [secret, password]]) {
      if (!await field.count()) continue;
      ready = true;
      if (await field.inputValue()) continue;
      checkOrigin();
      await field.fill(value); filled = true;
    }
    return {ready, filled, submitted: false};
  });
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
