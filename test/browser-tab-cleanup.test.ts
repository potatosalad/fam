import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import express from 'express';
// @ts-ignore The plugin is shipped as JavaScript for the Camofox host.
import {register} from '../browser/camofox-plugin/index.js';
import {Camofox} from '../src/shared/browser-runtime.js';
import {waitForLogin} from '../src/shared/browser-login.js';
import {BrowserError} from '../src/shared/browser-config.js';

const idleMs = 15 * 60 * 1000;
async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'fam-tab-cleanup-'));
  const events = new EventEmitter(), sessions = new Map<string, any>(), closed: string[] = [];
  const app = express();
  const ctx = {sessions, events, config: {profileDir: directory}, auth: () => (_req: any, _res: any, next: any) => next(),
    closeSession: async (id: string, session: any) => {
      // Upstream persistence runs before context.close. Simulate Firefox
      // clearing private cookies when the last window closes.
      assert.ok((await session.context.storageState()).cookies.length);
      for (const page of session.context.pages()) await page.close();
      sessions.delete(id); closed.push(id); events.emit('session:destroyed', {userId: id});
    }};
  const plugin = register(app, ctx);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  t.after(async () => {events.emit('server:shutdown'); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, {recursive: true, force: true});});
  const call = async (path: string, body: unknown) => {
    const response = await fetch(`${base}/fam/${path}`, {method: 'POST', headers: {'content-type': 'application/vnd.fam+json'}, body: JSON.stringify(body)});
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  };
  function session(id: string, groups: Record<string, string[]>) {
    const pages: any[] = [], tabGroups = new Map<string, Map<string, any>>();
    const saved = {cookies: [{name: 'synthetic', value: 'saved-login', domain: 'example.test', path: '/'}], origins: []};
    for (const [group, ids] of Object.entries(groups)) {
      const tabs = new Map(); tabGroups.set(group, tabs);
      for (const tab of ids) {
        let isClosed = false;
        const page = {isClosed: () => isClosed, close: async () => {isClosed = true;}};
        pages.push(page); tabs.set(tab, {page, toolCalls: 0});
      }
    }
    const result = {tabGroups, lastAccess: 0, context: {pages: () => pages.filter(p => !p.isClosed()),
      storageState: async () => pages.some(p => !p.isClosed()) ? saved : {cookies: [], origins: []}}};
    sessions.set(id, result); return result;
  }
  const state = (id: string) => readFile(join(directory, createHash('sha256').update(id).digest('hex').slice(0, 32), 'storage-state.json'), 'utf8').then(JSON.parse);
  return {plugin, session, sessions, events, closed, call, state, ctx};
}

test('idle cleanup expires only fam tabs, checkpoints storage and frees the final context', async t => {
  const f = await fixture(t);
  const abandoned = f.session('fam-test-web', {fam: ['abandoned']});
  const shared = f.session('fam-test-findmypast', {fam: ['stale', 'active'], unrelated: ['keep']});
  const foreign = f.session('another-user', {fam: ['keep']});
  await f.plugin.reapIdleTabs(0);
  await f.plugin.reapIdleTabs(idleMs - 1);
  assert.equal(f.closed.length, 0);
  shared.tabGroups.get('fam')!.get('active').toolCalls++;
  await f.plugin.reapIdleTabs(idleMs);
  assert.equal(abandoned.context.pages().length, 0);
  assert.deepEqual(f.closed, ['fam-test-web']);
  assert.equal((await f.state('fam-test-web')).cookies[0].value, 'saved-login');
  assert.equal(shared.tabGroups.get('fam')!.has('stale'), false);
  assert.equal(shared.tabGroups.get('fam')!.has('active'), true);
  assert.equal(shared.tabGroups.get('unrelated')!.get('keep').page.isClosed(), false);
  assert.equal(foreign.context.pages().length, 1);
  await f.plugin.reapIdleTabs(idleMs * 2);
  assert.equal(shared.tabGroups.has('fam'), false);
  assert.ok(f.sessions.has('fam-test-findmypast'));
});

test('explicit tab cleanup is scoped, idempotent and checkpoints before closing the last private window', async t => {
  const f = await fixture(t);
  const session = f.session('fam-test-myheritage', {fam: ['owned'], other: ['keep']});
  await f.call('close-tab', {userId: 'fam-test-myheritage', tabId: 'keep'});
  assert.equal(session.context.pages().length, 2);
  await f.call('close-tab', {userId: 'fam-test-myheritage', tabId: 'owned'});
  await f.call('close-tab', {userId: 'fam-test-myheritage', tabId: 'owned'});
  assert.equal(session.context.pages().length, 1);
  f.session('fam-test-web-private', {fam: ['last']});
  await f.call('close-tab', {userId: 'fam-test-web-private', tabId: 'last'});
  await f.call('close-tab', {userId: 'fam-test-web-private', tabId: 'last'});
  assert.deepEqual(f.closed, ['fam-test-web-private']);
  assert.equal((await f.state('fam-test-web-private')).cookies[0].value, 'saved-login');
});

test('an API operation in flight and activity during checkpoint both prevent idle cleanup', async t => {
  const f = await fixture(t), id = 'fam-test-web';
  const session = f.session(id, {fam: ['active']});
  const snapshot = session.context.storageState;
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => {started = resolve;});
  session.context.storageState = async () => {started(); await new Promise<void>(resolve => {release = resolve;}); return snapshot();};
  await f.plugin.reapIdleTabs(0);
  const request = f.call('storage', {userId: id});
  await entered;
  await f.plugin.reapIdleTabs(idleMs);
  assert.ok(f.sessions.has(id));
  release(); await request;
  session.context.storageState = async () => {session.tabGroups.get('fam')!.get('active').toolCalls++; return snapshot();};
  await f.plugin.reapIdleTabs(idleMs * 2);
  assert.ok(f.sessions.has(id));
  assert.equal(f.closed.length, 0);
});

test('concurrent completion in one provider context preserves the final checkpoint', async t => {
  const f = await fixture(t), id = 'fam-test-myheritage';
  f.session(id, {fam: ['first', 'last']});
  await Promise.all(['first', 'last'].map(tabId => f.call('close-tab', {userId: id, tabId})));
  assert.deepEqual(f.closed, [id]);
  assert.equal((await f.state(id)).cookies[0].value, 'saved-login');
});

test('new session creation waits for final checkpoint and context teardown', async t => {
  const f = await fixture(t), id = 'fam-test-web';
  f.session(id, {fam: ['last']});
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => {started = resolve;});
  const close = f.ctx.closeSession;
  f.ctx.closeSession = async (...args) => {started(); await new Promise<void>(resolve => {release = resolve;}); await close(...args);};
  const request = f.call('close-tab', {userId: id, tabId: 'last'});
  await entered;
  const contextOptions: any = {storageState: {cookies: []}};
  let completed = false;
  const creation = Promise.all(f.events.listeners('session:creating').map(listener => listener({userId: id, contextOptions}))).then(() => {completed = true;});
  await Promise.resolve(); assert.equal(completed, false);
  release(); await request; await creation;
  assert.equal(contextOptions.storageState.cookies[0].value, 'saved-login');
});

test('a failed checkpoint leaves the tab intact and idle cleanup retries later', async t => {
  const f = await fixture(t), id = 'fam-test-web';
  const session = f.session(id, {fam: ['last']});
  const snapshot = session.context.storageState;
  await f.plugin.reapIdleTabs(0);
  session.context.storageState = async () => {throw new Error('temporary checkpoint failure');};
  await f.plugin.reapIdleTabs(idleMs);
  assert.equal(session.context.pages().length, 1);
  assert.equal(f.closed.length, 0);
  session.context.storageState = snapshot;
  await f.plugin.reapIdleTabs(idleMs + 60000);
  assert.deepEqual(f.closed, [id]);
});

test('tab creation knows its ID before navigation, and cleans up failed navigation', async () => {
  const browser = new Camofox({version: 1, mode: 'remote', remote: {url: 'https://browser.example.test', vncUrl: 'https://viewer.example.test'}, session: 'test', timeout: 0, open: false, transport: 'auto'});
  const calls: string[] = [];
  browser.api = async (path: string, body?: any): Promise<any> => {
    calls.push(path);
    if (path === '/tabs') {assert.equal(body.url, undefined); return {tabId: 'new'};}
    if (path.endsWith('/navigate')) throw new Error('navigation failed');
    return {};
  };
  await assert.rejects(browser.tab('web', 'https://example.test'), /navigation failed/);
  assert.deepEqual(calls, ['/tabs', '/tabs/new/navigate', '/fam/close-tab']);
});

test('completed and failed logins close tabs, while unfinished human interaction stays available', async () => {
  const calls: string[] = [];
  const tab: any = {provider: 'cleanup-test', close: async () => {calls.push('close');},
    evaluate: async () => ({origin: 'https://example.test', email: false, password: false, text: 'Ready'}),
    browser: {config: {timeout: 0}, endpoint: {vncUrl: 'https://viewer.example.test'}, state: async () => {calls.push('checkpoint');}, notify: async () => {}}};
  assert.equal(await waitForLogin(tab, [], async () => 'signed-in'), 'signed-in');
  assert.deepEqual(calls, ['checkpoint', 'close']);
  calls.length = 0;
  await assert.rejects(waitForLogin(tab, [], async () => {throw new Error('verification failed');}), /verification failed/);
  assert.deepEqual(calls, ['close']);
  for (const code of ['BROWSER_INTERACTION_REQUIRED', 'BROWSER_LOGIN_BLOCKED']) {
    calls.length = 0;
    await assert.rejects(waitForLogin(tab, [], async () => {throw new BrowserError('Complete sign-in', code);}), {code});
    assert.deepEqual(calls, []);
  }
});
