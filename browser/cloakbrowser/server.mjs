import express from 'express';
import {chromium} from 'playwright';
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir, readFile, writeFile, rename, rm, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {register} from '../camofox-plugin/index.js';

const validOwner = id => typeof id === 'string' && /^fam-[A-Za-z0-9._-]{1,128}$/.test(id);
const ownerHash = id => createHash('sha256').update(id).digest('hex').slice(0, 32);
async function atomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {await writeFile(temporary, JSON.stringify(value), {mode: 0o600}); await rename(temporary, path);}
  finally {await rm(temporary, {force: true});}
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
async function terminate(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  let timer;
  try {await Promise.race([ended, new Promise(resolve => {timer = setTimeout(() => {child.kill('SIGKILL'); resolve();}, 15000);})]);}
  finally {clearTimeout(timer);}
}

export async function clearStaleProcessLocks(directory, processRoot = '/proc') {
  // Chromium's lock contains the container hostname. After replacement it can
  // mistake a dead process in the old container for a live browser elsewhere.
  // This service exclusively owns its profile mount. Never clear a lock while
  // a process in this container is actually using that profile.
  for (const pid of (await readdir(processRoot)).filter(value => /^\d+$/.test(value))) {
    let args;
    try {args = (await readFile(join(processRoot, pid, 'cmdline'), 'utf8')).split('\0');}
    catch (error) {if (['ENOENT', 'ESRCH'].includes(error.code)) continue; throw error;}
    if (args.includes(`--user-data-dir=${directory}`)) throw new Error('Chromium profile is already in use.');
  }
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) await rm(join(directory, name), {force: true});
}

/** Implements the existing fam browser protocol with persistent Chromium profiles. */
export async function createService({apiKey, profileDir, launch, launchContext, alternatives = {}}) {
  if (typeof apiKey !== 'string' || apiKey.length < 16 || /[\r\n]/.test(apiKey)) throw new Error('FAM_BROWSER_API_KEY must contain at least 16 characters.');
  await mkdir(profileDir, {recursive: true, mode: 0o700});
  const app = express(), sessions = new Map(), creating = new Map(), closing = new Map(), events = new EventEmitter();
  const saves = new Map();
  let shuttingDown = false;
  const emit = async (name, value) => {for (const listener of events.listeners(name)) await listener(value);};
  const auth = () => (req, res, next) => {
    const provided = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${apiKey}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return res.status(403).json({ok: false, error: 'unauthorized'});
    next();
  };
  app.disable('x-powered-by');
  app.use(auth());
  app.use(express.json({limit: '72mb'}));
  async function checkpoint(id, session) {
    const before = saves.get(id) ?? Promise.resolve();
    const saving = before.catch(() => {}).then(async () => {
      const state = await session.context.storageState({indexedDB: true});
      const directory = join(profileDir, ownerHash(id));
      await mkdir(directory, {recursive: true, mode: 0o700});
      await atomic(join(directory, 'storage-state.json'), state);
      await atomic(join(directory, 'fam-session.json'), {userId: id});
    });
    saves.set(id, saving);
    try {await saving;} finally {if (saves.get(id) === saving) saves.delete(id);}
  }
  async function closeSession(id, session) {
    if (closing.has(id)) return closing.get(id);
    const pending = (async () => {
      session._closing = true;
      // A dead browser must not replace its last durable state with an empty one.
      await checkpoint(id, session).catch(() => {});
      await session.stop();
      if (sessions.get(id) === session) sessions.delete(id);
      await emit('session:destroyed', {userId: id});
    })();
    closing.set(id, pending);
    try {await pending;} finally {closing.delete(id);}
  }
  async function startContext(id, directory, state) {
    if (launchContext) return launchContext({id, directory, state}); // Synthetic browser integration tests.
    await clearStaleProcessLocks(join(directory, 'chromium'));
    const port = await freePort();
    const seed = String(parseInt(ownerHash(id).slice(0, 8), 16));
    const args = launch.args.filter(arg => !/^--(?:headless|fingerprint|remote-debugging-port|remote-debugging-address|user-data-dir)(?:=|$)/.test(arg));
    const child = spawn(launch.binary, [...args, `--fingerprint=${seed}`, `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1', `--user-data-dir=${join(directory, 'chromium')}`], {stdio: 'ignore'});
    let spawnError;
    child.once('error', error => {spawnError = error;});
    let browser;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (spawnError || child.exitCode !== null) throw new Error('Chromium failed to start.');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(300)});
          if (response.ok) {browser = await chromium.connectOverCDP((await response.json()).webSocketDebuggerUrl, {timeout: 15000}); break;}
        } catch {}
        await delay(200);
      }
      if (!browser) throw new Error('Chromium did not become ready.');
      // Private browsing is opt-in for general web browsing only. MyHeritage
      // and all other providers use the ordinary on-disk Chromium profile.
      const context = id.endsWith('-web-private') ? await browser.newContext({viewport: null, storageState: state}) : browser.contexts()[0];
      if (!id.endsWith('-web-private') && state) await context.setStorageState(state);
      return {context, browser, child, stop: async () => {
        if (id.endsWith('-web-private')) await context.close().catch(() => {});
        // Closing a CDP connection only disconnects Playwright. Ask Chromium to
        // exit normally so it flushes its profile and removes process locks.
        const cdp = await browser.newBrowserCDPSession().catch(() => undefined);
        if (cdp) await Promise.race([cdp.send('Browser.close').catch(() => {}), delay(3000)]);
        await terminate(child); await browser.close().catch(() => {});
      }};
    } catch (error) {await terminate(child); await browser?.close().catch(() => {}); throw error;}
  }
  async function getSession(id) {
    if (!validOwner(id)) throw new Error('Invalid browser session.');
    if (shuttingDown) throw new Error('Browser is stopping.');
    if (closing.has(id)) await closing.get(id);
    if (sessions.has(id) && !sessions.get(id)._closing) return sessions.get(id);
    if (creating.has(id)) return creating.get(id);
    const pending = (async () => {
      const directory = join(profileDir, ownerHash(id));
      await mkdir(directory, {recursive: true, mode: 0o700});
      let state;
      try {state = JSON.parse(await readFile(join(directory, 'storage-state.json'), 'utf8'));}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      const contextOptions = {storageState: state};
      await emit('session:creating', {userId: id, contextOptions});
      const running = await startContext(id, directory, contextOptions.storageState);
      const session = {...running, tabGroups: new Map([['fam', new Map()]]), lastAccess: Date.now()};
      try {
      sessions.set(id, session);
      await atomic(join(directory, 'fam-session.json'), {userId: id});
      await emit('session:created', {userId: id, context: session.context});
      session.context.on('page', page => trackPage(id, session, page));
      for (const page of session.context.pages()) trackPage(id, session, page, true);
      running.browser?.on('disconnected', () => {
        if (!session._closing && sessions.get(id) === session) {
          session._closing = true;
          const pending = (async () => {
            await terminate(running.child);
            if (sessions.get(id) === session) sessions.delete(id);
            await emit('session:destroyed', {userId: id});
          })();
          closing.set(id, pending);
          void pending.finally(() => {if (closing.get(id) === pending) closing.delete(id);});
        }
      });
      return session;
      } catch (error) {
        session._closing = true;
        await running.stop().catch(() => {});
        if (sessions.get(id) === session) sessions.delete(id);
        await emit('session:destroyed', {userId: id});
        throw error;
      }
    })();
    creating.set(id, pending);
    try {return await pending;} finally {creating.delete(id);}
  }
  function trackPage(id, session, page, initial = false) {
    let group = session.tabGroups.get('fam');
    if (!group) {group = new Map(); session.tabGroups.set('fam', group);}
    if ([...group.values()].some(state => state.page === page)) return;
    const tabId = randomUUID();
    group.set(tabId, {page, toolCalls: 0, initial});
    events.emit('tab:created', {userId: id, tabId});
    page.on('close', () => group.delete(tabId));
    page.setDefaultTimeout(15000);
  }
  const ctx = {engine: 'cloakbrowser', privateBrowsing: true, sessions, events, getSession, closeSession,
    config: {profileDir, browserAlternatives: alternatives}, auth};
  const plugin = register(app, ctx);
  const route = (method, path, action) => app[method](path, async (req, res) => {
    try {
      const id = req.body?.userId ?? req.query.userId ?? (path === '/start' ? 'fam-default-web' : undefined);
      const result = id === undefined ? await action(req) : await plugin.withSessionOperation(id, () => action(req));
      res.json({ok: true, ...result});
    }
    catch {res.status(400).json({ok: false, error: 'browser-operation-failed'});}
  });
  route('get', '/health', async () => ({engine: 'cloakbrowser', browserRunning: sessions.size > 0, activeBrowsers: sessions.size}));
  route('post', '/start', async req => {await getSession(req.body?.userId ?? 'fam-default-web'); return {};});
  route('get', '/tabs', async req => {
    const id = req.query.userId;
    if (!validOwner(id)) throw new Error();
    return {tabs: [...(sessions.get(id)?.tabGroups.get('fam') ?? [])].filter(([, state]) => !state.page.isClosed())
      .map(([tabId, state]) => ({tabId, listItemId: 'fam', url: state.page.url()}))};
  });
  route('post', '/tabs', async req => {
    const id = req.body.userId;
    if (req.body.sessionKey !== 'fam') throw new Error();
    const session = await getSession(id);
    // Reuse the initial empty window; every other command gets its own tab.
    let entry = [...(session.tabGroups.get('fam') ?? [])].find(([, state]) => state.initial && !state.claimed && (state.page.url() === 'about:blank' || state.page.url().startsWith('chrome://new')));
    if (!entry) {const page = await session.context.newPage(); trackPage(id, session, page); entry = [...session.tabGroups.get('fam')].find(([, state]) => state.page === page);}
    entry[1].claimed = true; entry[1].toolCalls++;
    await entry[1].page.bringToFront();
    return {tabId: entry[0]};
  });
  function tab(req) {
    if (!validOwner(req.body.userId)) throw new Error();
    const state = sessions.get(req.body.userId)?.tabGroups.get('fam')?.get(req.params.id);
    if (!state || state.page.isClosed()) throw new Error();
    state.toolCalls++; return state.page;
  }
  route('post', '/tabs/:id/navigate', async req => {
    const url = new URL(req.body.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    const page = tab(req); await page.goto(url.href, {waitUntil: 'domcontentloaded', timeout: 60000}); return {url: page.url()};
  });
  route('post', '/tabs/:id/evaluate', async req => ({result: await tab(req).evaluate(req.body.expression)}));
  // Preserve manually completed logins even before a CLI asks for a checkpoint.
  const checkpointTimer = setInterval(() => {
    for (const [id, session] of sessions) if (!session._closing) void checkpoint(id, session).catch(() => {});
  }, 30000);
  checkpointTimer.unref();
  async function close() {
    shuttingDown = true; clearInterval(checkpointTimer);
    await Promise.allSettled([...creating.values()]);
    await Promise.allSettled([...sessions].map(([id, session]) => closeSession(id, session)));
    await emit('server:shutdown', {});
  }
  return {app, sessions, getSession, close, checkpoint, plugin};
}
