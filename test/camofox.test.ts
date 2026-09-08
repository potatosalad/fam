import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {CookieJar} from 'tough-cookie';
import {fetchWithBrowser, closeBrowserTransportTabs, isChallenge} from '../src/shared/browser-transport.js';
import {saveBrowserConfig, browserConfig, setBrowserOverrides, endpointId, loadProviderSession, saveProviderSession, type BrowserConfig} from '../src/shared/browser-config.js';
import {stopBrowser, updateCookieJar} from '../src/shared/browser-runtime.js';
import {loginCooldown, waitForLogin} from '../src/shared/browser-login.js';
import {readPrivateJson} from '../src/shared/storage.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {complete, completionCatalog} from '../src/shared/completion.js';

test('challenge classification requires provider evidence rather than a generic denial', () => {
  assert.equal(isChallenge(new Headers({'cf-mitigated':'challenge'})), true);
  assert.equal(isChallenge(new Headers(), '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'), true);
  assert.equal(isChallenge(new Headers(), '<iframe src="/_Incapsula_Resource?x=1"></iframe>'), true);
  assert.equal(isChallenge(new Headers(), '403 Forbidden: subscription required'), false);
  assert.equal(isChallenge(new Headers(), '{"description":"Cloudflare protects our website"}'), false);
});
test('browser commands and global overrides participate in discovery and completion', () => {
  assert.equal(parseInvocation(['cli.browser','setup','--local','--no-open']).values.local, true);
  assert.equal(parseInvocation(['myheritage.account','get','--transport','browser','--browser-timeout','0']).values['browser-timeout'], 0);
  assert.throws(() => parseInvocation(['cli.browser','configure','--timeout','-1']));
  assert.ok(complete(completionCatalog(), ['browser','']).candidates.includes('stop'));
});
test('browser recovery preserves requests, cookies, sticky routing and independent instances', async t => {
  const requests: any[] = [];
  let page = '<html><body>Ready</body></html>', status = 200, challengeResponse = false, reply = Buffer.from([0,255,128,42]);
  const server = createServer(async (req,res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    requests.push({path:req.url, body, auth:req.headers.authorization});
    res.setHeader('content-type','application/json');
    const result = req.url === '/health' ? {ok:true} : req.url === '/fam/capabilities' ? {version:1} : req.url === '/tabs' ? {tabId:randomUUID()}
      : req.url?.endsWith('/evaluate') ? {result:page} : req.url === '/fam/request' ? {status, headers:{'content-type':'application/octet-stream', 'x-provider':'kept', ...(challengeResponse ? {'cf-mitigated':'challenge'} : {})},bodyBase64:reply.toString('base64')}
      : req.url === '/fam/storage' ? {state:{cookies:[{name:'session',value:'cookie-secret',domain:'.example.com',path:'/api',expires:2000000000,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]}}
      : req.url === '/fam/close' ? {closed:2} : {};
    res.end(JSON.stringify({ok:true,...result}));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address() as {port:number};
  const endpoint = {url:`http://127.0.0.1:${address.port}`,vncUrl:'https://viewer.example.org/browser/',apiKey:'api-secret'};
  const config: BrowserConfig = {version:1,mode:'remote',remote:endpoint,local:{...endpoint,container:'unused'},timeout:0,transport:'auto',session:'test',open:false};
  await saveBrowserConfig(config);
  t.after(async () => {setBrowserOverrides({}); await closeBrowserTransportTabs(); await new Promise<void>(resolve => server.close(() => resolve()));});
  const target = 'https://www.example.com/api/records', jar = new CookieJar();
  await t.test('ordinary errors and network ambiguity do not trigger browser retries', async () => {
    for (const code of [401,403,429,500,503]) {
      const response = await fetchWithBrowser('myheritage',target,{},async()=>new Response('denied',{status:code}));
      assert.equal(response.status,code);
    }
    await assert.rejects(fetchWithBrowser('myheritage',target,{},async()=>{throw new Error('network');}),/network/);
    assert.equal(requests.length,0);
  });
  await t.test('a confirmed challenge retries the exact POST and preserves binary data', async () => {
    let direct = 0;
    const response = await fetchWithBrowser('myheritage',target,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer native-secret'},body:'{"id":9223372036854775807}'},async()=>{direct++;return new Response('challenge',{status:403,headers:{'cf-mitigated':'challenge'}});},jar);
    assert.equal(direct,1); assert.deepEqual(Buffer.from(await response.arrayBuffer()),reply);
    assert.equal(response.headers.get('x-provider'),'kept');
    const sent = requests.find(r=>r.path==='/fam/request').body;
    assert.equal(sent.method,'POST'); assert.equal(Buffer.from(sent.bodyBase64,'base64').toString(),'{"id":9223372036854775807}');
    assert.equal(sent.url,target);
    const cookie = (await jar.getCookies(target))[0];
    assert.equal(cookie.httpOnly,true); assert.equal(cookie.path,'/api'); assert.equal(cookie.sameSite,'lax');
    assert.ok(requests.every(r=>r.auth==='Bearer api-secret'));
  });
  await t.test('subsequent commands use the remembered browser and explicit HTTP still works', async () => {
    await fetchWithBrowser('myheritage',target,{},async()=>{throw new Error('direct must not run');});
    setBrowserOverrides({transport:'http'});
    assert.equal(await (await fetchWithBrowser('myheritage',target,{},async()=>new Response('direct'))).text(),'direct');
    setBrowserOverrides({});
  });
  await t.test('local and remote transport decisions and saved sessions are separate', async () => {
    await saveProviderSession('myheritage',{browserInstance:endpointId(config),account:'remote'} as any);
    await saveBrowserConfig({...config,mode:'local'});
    assert.equal(await (await fetchWithBrowser('myheritage',target,{},async()=>new Response('local direct'))).text(),'local direct');
    assert.equal(await loadProviderSession('myheritage'),undefined);
    await saveBrowserConfig(config);
    assert.equal((await loadProviderSession<any>('myheritage')).account,'remote');
  });
  await t.test('explicit native sign-in takes precedence without deleting the browser login', async () => {
    await saveProviderSession('myheritage', {account: 'native'} as any);
    assert.equal((await loadProviderSession<any>('myheritage')).account, 'native');
    await saveProviderSession('myheritage', {browserInstance: endpointId(config), account: 'browser-again'} as any);
    assert.equal((await loadProviderSession<any>('myheritage')).account, 'browser-again');
    setBrowserOverrides({timeout: undefined, transport: undefined});
    assert.equal((await browserConfig())?.timeout, 0);
    assert.equal((await browserConfig())?.transport, 'auto');
  });
  await t.test('remote stop only asks to close fam sessions and never calls global stop', async () => {
    const stopped = await stopBrowser(config);
    assert.equal(stopped.browserStopped,false);
    assert.equal(requests.some(r=>r.path==='/stop'),false);
    assert.ok(requests.find(r=>r.path==='/fam/close').body.userIds.every((id:string)=>id.startsWith('fam-test-')));
  });
  await t.test('zero wait surfaces the configured viewer URL for unattended intervention', async () => {
    await closeBrowserTransportTabs();
    challengeResponse = true;
    page = '<html><script src="/cdn-cgi/challenge-platform/test"></script></html>';
    await assert.rejects(fetchWithBrowser('myheritage',target,{},async()=>new Response('unused')), (error:any)=>error.code==='BROWSER_INTERACTION_REQUIRED' && error.vncUrl===endpoint.vncUrl);
    challengeResponse = false;
    page = '<html>Ready</html>'; status = 204; reply = Buffer.alloc(0);
    assert.equal((await fetchWithBrowser('myheritage',target,{},async()=>new Response('unused'))).status,204);
  });
});
test('cookie export respects domain, path, expiry and HTTP-only attributes', async () => {
  const jar = new CookieJar();
  await jar.setCookie('deleted=old; Path=/api; Secure', 'https://www.example.com');
  await updateCookieJar(jar,{cookies:[{name:'unrelated',value:'private',domain:'other.example',path:'/',expires:-1,httpOnly:true,secure:true}],origins:[]},'https://www.example.com');
  assert.equal(jar.serializeSync().cookies.length,0);
});

test('provider lockouts stop password attempts without extending an existing cooldown', async () => {
  assert.equal(loginCooldown('Access has been temporarily disabled. Please try again in 24 hours.'), 86400000);
  assert.equal(loginCooldown('Incorrect password'), undefined);
  let inputs = 0;
  const tab = {provider: 'myheritage', evaluate: async () => ({origin:'https://www.myheritage.com', email:true, password:true, text:'Access has been temporarily disabled. Try again in 24 hours.'}),
    browser: {config:{timeout:0}, endpoint:{vncUrl:'https://viewer.example.test'}, api:async()=>{inputs++;}}} as any;
  const verify = async () => undefined;
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], verify), (e:any)=>e.code==='BROWSER_LOGIN_BLOCKED');
  const first = await readPrivateJson<any>('myheritage/browser-login-block.json');
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], verify), (e:any)=>e.code==='BROWSER_LOGIN_BLOCKED');
  assert.equal((await readPrivateJson<any>('myheritage/browser-login-block.json')).blockedUntil, first.blockedUntil);
  assert.equal(inputs, 0);
});
