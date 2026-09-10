import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {loginFindmypast} from '../src/findmypast/browser-login.js';
import {loadProviderSession, saveBrowserConfig} from '../src/shared/browser-config.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';

const website = 'https://www.findmypast.com', uk = 'https://www.findmypast.co.uk', auth = 'https://auth.findmypast.com';
type Tab = {tabId: string; url: string; listItemId: string; liveUrl?: string; closed?: boolean};

test('Findmypast reuses a live login tab and saves only a verified account', async t => {
  let tabs: Tab[] = [], signedIn = true, completeOnNavigate = false, document = 1, status = 200;
  let payload: unknown, signedOutPayload: unknown;
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
      tabs.push({tabId: 'created', url: body.url ?? 'about:blank', listItemId: 'fam'});
      result = {tabId: 'created'};
    } else if (path.endsWith('/evaluate')) {
      const tab = tabs.find(tab => path === `/tabs/${tab.tabId}/evaluate`);
      if (!tab || tab.closed) {res.statusCode = 500; result = {error: 'Internal server error'};}
      else {
        const url = tab.liveUrl ?? tab.url, origin = new URL(url).origin;
        const form = !signedIn && (new URL(url).pathname === '/sign-in' || origin === auth);
        result = {result: body.expression === 'location.href' ? url : body.expression === 'location.origin' ? origin
          : {origin, url, document, email: form, password: form, text: signedIn ? 'Signed in' : 'Sign in'}};
      }
    } else if (path.endsWith('/navigate')) {
      const tab = tabs.find(tab => path === `/tabs/${tab.tabId}/navigate`)!;
      assert.equal(new URL(body.url).pathname, '/sign-in');
      tab.url = completeOnNavigate ? `${new URL(body.url).origin}/home` : body.url;
      if (completeOnNavigate) signedIn = true;
      document++; result = {ok:true};
    } else if (path === '/fam/request') {
      assert.equal(body.method, 'POST');
      assert.equal(new URL(body.url).pathname, '/titan/marshal/graphql');
      assert.equal(JSON.parse(Buffer.from(body.bodyBase64, 'base64').toString()).operationName, 'GetCurrentUserProfile');
      result = {status, headers: {'content-type': 'application/json'},
        bodyBase64: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload ?? (!signedIn && signedOutPayload ? signedOutPayload : {data: {currentUserProfile: signedIn ? {id: 'fixture-account'} : null}}))).toString('base64')};
    } else if (path === '/fam/storage') result = {state: {cookies: [
      {name: '', value: 'fixture', domain: 'www.findmypast.com', path: '/titan/marshal', expires: -1, httpOnly: false, secure: true},
      {name: 'session', value: 'fixture-cookie', domain: '.findmypast.com', path: '/', expires: -1, httpOnly: true, secure: true},
    ], origins: []}};
    else if (path === '/fam/close-tab') result = {};
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
      [{userId: 'fam-test-findmypast', sessionKey: 'fam'}]);
    assert.equal(requests.find(r => r.path === '/tabs/created/navigate')?.body.url, `${website}/sign-in`);
    assert.equal(requests.find(r => r.path === '/fam/close-tab')?.body.tabId, 'created');
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
  await t.test('an expired home tab opens sign-in once and captures completion in the same tab', async () => {
    requests.length = 0; signedIn = false; completeOnNavigate = true;
    tabs = [{tabId:'expired-home',url:`${website}/home`,listItemId:'fam'}];
    const session = await loginFindmypast({autofill:false});
    assert.equal(session.apiBase,`${website}/titan/marshal`);
    assert.equal(requests.filter(r=>r.path.endsWith('/navigate')).length,1);
    assert.equal(requests.filter(r=>r.path==='/fam/request').length,2);
    assert.equal(requests.some(r=>r.path==='/tabs' || r.path==='/fam/input'),false);
    completeOnNavigate=false;
  });
  await t.test('an expired page cannot loop navigation or replace the previous session without authentication', async () => {
    requests.length=0; signedIn=false;
    tabs=[{tabId:'expired-home',url:`${website}/home`,listItemId:'fam'}];
    const previous=await loadProviderSession('findmypast');
    await assert.rejects(loginFindmypast({autofill:false}), (e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
    assert.equal(requests.filter(r=>r.path.endsWith('/navigate')).length,1);
    assert.deepEqual(await loadProviderSession('findmypast'),previous);
  });
  await t.test('the website BAD_USER_INPUT logged-out response starts sign-in and then validates the account', async () => {
    requests.length=0;signedIn=false;completeOnNavigate=true;
    tabs=[{tabId:'expired-home',url:`${website}/home`,listItemId:'fam'}];
    signedOutPayload={data:{currentUserProfile:null},errors:[{extensions:{code:'BAD_USER_INPUT'},message:'Global member id is not authenticated. User must be logged in to make a request'}]};
    await loginFindmypast({autofill:false});
    assert.equal(requests.filter(r=>r.path.endsWith('/navigate')).length,1);
    assert.equal(requests.filter(r=>r.path==='/fam/request').length,2);
    signedOutPayload=undefined;completeOnNavigate=false;
  });
  await t.test('verification failures report the API error without prompting for passwords or overwriting the session', async () => {
    const previous=await loadProviderSession('findmypast');
    for (const failure of [{status:403}, {status:429}, {status:500}, {status:200,payload:'not JSON'},
      {status:200,payload:{data:{currentUserProfile:null},errors:[{extensions:{code:'INTERNAL_SERVER_ERROR'}}]}}]) {
      requests.length=0; status=failure.status; payload='payload' in failure?failure.payload:undefined;
      tabs=[{tabId:'failed-verification',url:`${website}/home`,listItemId:'fam'}];
      await assert.rejects(loginFindmypast(), (e:any)=>e.code==='BROWSER_LOGIN_VERIFICATION_FAILED');
      assert.equal(requests.filter(r=>r.path==='/fam/request').length,1);
      assert.equal(requests.some(r=>r.path.endsWith('/navigate') || r.path==='/fam/input' || r.path==='/fam/autofill'),false);
      assert.deepEqual(await loadProviderSession('findmypast'),previous);
    }
    status=200; payload=undefined;
  });
  await t.test('invalid regions fail before contacting the browser', async () => {
    requests.length = 0;
    await assert.rejects(loginFindmypast({region: 'attacker.example'}), /--region must be/);
    assert.equal(requests.length, 0);
  });
});
