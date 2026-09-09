import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {loginFindmypast} from '../src/findmypast/browser-login.js';
import {loadProviderSession, saveBrowserConfig} from '../src/shared/browser-config.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';

const website = 'https://www.findmypast.com', uk = 'https://www.findmypast.co.uk', auth = 'https://auth.findmypast.com';
type Tab = {tabId: string; url: string; listItemId: string; liveUrl?: string; closed?: boolean};

test('Findmypast reuses a live login tab and saves only a verified account', async t => {
  let tabs: Tab[] = [], signedIn = true;
  const requests: {path: string; body: any}[] = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {}, path = req.url!;
    requests.push({path, body});
    let result: unknown;
    if (path === '/health') result = {ok: true};
    else if (path === '/fam/capabilities') result = {version: 1, autofill: true};
    else if (path.startsWith('/tabs?')) result = {tabs};
    else if (path === '/tabs') {
      tabs.push({tabId: 'created', url: body.url, listItemId: 'fam'});
      result = {tabId: 'created'};
    } else if (path.endsWith('/evaluate')) {
      const tab = tabs.find(tab => path === `/tabs/${tab.tabId}/evaluate`);
      if (!tab || tab.closed) {res.statusCode = 500; result = {error: 'Internal server error'};}
      else {
        const url = tab.liveUrl ?? tab.url, origin = new URL(url).origin;
        result = {result: body.expression === 'location.href' ? url : body.expression === 'location.origin' ? origin
          : {origin, document: 1, email: !signedIn, password: !signedIn, text: signedIn ? 'Signed in' : 'Sign in'}};
      }
    } else if (path === '/fam/request') {
      assert.equal(body.method, 'POST');
      assert.equal(new URL(body.url).pathname, '/titan/marshal/graphql');
      assert.equal(JSON.parse(Buffer.from(body.bodyBase64, 'base64').toString()).operationName, 'GetCurrentUserProfile');
      result = {status: 200, headers: {'content-type': 'application/json'},
        bodyBase64: Buffer.from(JSON.stringify({data: {currentUserProfile: signedIn ? {id: 'fixture-account'} : null}})).toString('base64')};
    } else if (path === '/fam/storage') result = {state: {cookies: [
      {name: '', value: 'fixture', domain: 'www.findmypast.com', path: '/titan/marshal', expires: -1, httpOnly: false, secure: true},
      {name: 'session', value: 'fixture-cookie', domain: '.findmypast.com', path: '/', expires: -1, httpOnly: true, secure: true},
    ], origins: []}};
    else if (path === '/fam/autofill') result = {ready: true, filled: true, submitted: false};
    else {res.statusCode = 400; result = {error: 'unexpected-browser-operation'};}
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await saveBrowserConfig({version: 1, mode: 'remote', remote: {url: `http://127.0.0.1:${(server.address() as {port: number}).port}`,
    vncUrl: 'https://viewer.example.test'}, timeout: 0, transport: 'auto', session: 'test', open: false});
  const blockedUntil = new Date(Date.now() + 86400000).toISOString();
  await writePrivateJson('findmypast/browser-login-block.json', {blockedUntil});

  await t.test('skips foreign, transport, stale, and closed tabs and adopts the rendered account', async () => {
    tabs = [
      {tabId: 'other-owner', url: `${website}/home`, listItemId: 'another-client'},
      {tabId: 'foreign', url: `${website}.attacker.example/home`, listItemId: 'fam'},
      {tabId: 'credentials', url: 'https://user:password@www.findmypast.com/home', listItemId: 'fam'},
      {tabId: 'transport', url: `${website}/.fam-browser-fixture`, listItemId: 'fam'},
      {tabId: 'other-region', url: `${uk}/home`, listItemId: 'fam'},
      {tabId: 'closed', url: `${website}/home`, listItemId: 'fam', closed: true},
      {tabId: 'moved', url: `${website}/home`, listItemId: 'fam', liveUrl: 'https://foreign.example/home'},
      {tabId: 'login', url: `${website}/sign-in`, listItemId: 'fam'},
      {tabId: 'working', url: `${website}/home`, listItemId: 'fam'},
    ];
    const session = await loginFindmypast();
    assert.equal(session.apiBase, `${website}/titan/marshal`);
    assert.equal(session.cookies.cookies.length, 2);
    assert.deepEqual(await loadProviderSession('findmypast'), session);
    assert.equal((await readPrivateJson<any>('findmypast/browser-login-block.json')).blockedUntil, blockedUntil);
    assert.equal(requests.find(r => r.path === '/fam/request')?.body.tabId, 'working');
    assert.deepEqual(requests.filter(r => r.path.endsWith('/evaluate')).map(r => r.path).filter((v, i, a) => a.indexOf(v) === i),
      ['/tabs/closed/evaluate', '/tabs/moved/evaluate', '/tabs/working/evaluate']);
    assert.equal(requests.some(r => r.path === '/tabs' || r.path.endsWith('/navigate') || r.path === '/fam/input'), false);
  });
  await t.test('repeated login reuses the same tab without navigation or password submission', async () => {
    requests.length = 0;
    await loginFindmypast();
    assert.equal(requests.find(r => r.path === '/fam/request')?.body.tabId, 'working');
    assert.equal(requests.some(r => r.path === '/tabs' || r.path.endsWith('/navigate') || r.path === '/fam/input'), false);
  });
  await t.test('the requested UK region is reused and saved', async () => {
    requests.length = 0;
    const session = await loginFindmypast({region: 'co.uk'});
    assert.equal(session.apiBase, `${uk}/titan/marshal`);
    assert.equal(requests.find(r => r.path === '/fam/request')?.body.tabId, 'other-region');
  });
  await t.test('creates one sign-in tab when only dead or transport tabs remain', async () => {
    requests.length = 0;
    tabs = tabs.filter(tab => ['closed', 'transport'].includes(tab.tabId));
    await loginFindmypast();
    assert.deepEqual(requests.filter(r => r.path === '/tabs').map(r => r.body),
      [{userId: 'fam-test-findmypast', sessionKey: 'fam', url: `${website}/sign-in`}]);
  });
  await t.test('interactive auth completion preserves its tab and never overwrites a session before validation', async () => {
    requests.length = 0; signedIn = false;
    tabs = [{tabId: 'auth', url: `${auth}/login`, listItemId: 'fam'}];
    await writePrivateJson('findmypast/login.json', {username: 'fixture@example.test', password: 'fixture-password'});
    const previous = await loadProviderSession('findmypast');
    await assert.rejects(loginFindmypast({interactive: true}), (e: any) => e.code === 'BROWSER_INTERACTION_REQUIRED');
    assert.equal(requests.filter(r => r.path === '/fam/autofill').length, 1);
    assert.equal(requests.find(r => r.path === '/fam/autofill')?.body.origin, auth);
    assert.equal(requests.some(r => r.path === '/tabs' || r.path.endsWith('/navigate') || r.path === '/fam/input' || r.path === '/fam/request'), false);
    assert.deepEqual(await loadProviderSession('findmypast'), previous);
    requests.length = 0;
    await assert.rejects(loginFindmypast({interactive: true, autofill: false}), (e: any) => e.code === 'BROWSER_INTERACTION_REQUIRED');
    assert.equal(requests.some(r => r.path === '/fam/autofill' || r.path === '/fam/input'), false);
    tabs[0].url = `${website}/home`; signedIn = true;
    await loginFindmypast();
    assert.equal(requests.find(r => r.path === '/fam/request')?.body.tabId, 'auth');
    assert.equal(requests.some(r => r.path === '/tabs' || r.path === '/fam/input'), false);
  });
  await t.test('an anonymous website profile does not replace the saved session', async () => {
    requests.length = 0; signedIn = false;
    tabs = [{tabId: 'anonymous', url: `${website}/sign-in`, listItemId: 'fam'}];
    const previous = await loadProviderSession('findmypast');
    await assert.rejects(loginFindmypast({autofill: false}), (e: any) => e.code === 'BROWSER_INTERACTION_REQUIRED');
    assert.equal(requests.filter(r => r.path === '/fam/request').length, 1);
    assert.deepEqual(await loadProviderSession('findmypast'), previous);
  });
  await t.test('invalid regions fail before contacting the browser', async () => {
    requests.length = 0;
    await assert.rejects(loginFindmypast({region: 'attacker.example'}), /--region must be/);
    assert.equal(requests.length, 0);
  });
});
