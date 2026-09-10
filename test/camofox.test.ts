import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {CookieJar} from 'tough-cookie';
import {fetchWithBrowser, closeBrowserTransportTabs, isChallenge} from '../src/shared/browser-transport.js';
import {saveBrowserConfig, browserConfig, setBrowserOverrides, endpointId, loadProviderSession, saveProviderSession, type BrowserConfig} from '../src/shared/browser-config.js';
import {stopBrowser, updateCookieJar, jarCookies} from '../src/shared/browser-runtime.js';
import {loginCooldown, waitForLogin} from '../src/shared/browser-login.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {complete, completionCatalog} from '../src/shared/completion.js';
import {HttpSession} from '../src/familysearch/http.js';
import {AmericanAncestorsHttp} from '../src/americanancestors/http.js';

test('challenge classification requires provider evidence rather than a generic denial', () => {
  assert.equal(isChallenge(new Headers({'cf-mitigated':'challenge'})), true);
  assert.equal(isChallenge(new Headers(), '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'), true);
  assert.equal(isChallenge(new Headers(), '<iframe src="/_Incapsula_Resource?x=1"></iframe>'), true);
  assert.equal(isChallenge(new Headers(), '<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><h1>Normal page</h1>'), false);
  assert.equal(isChallenge(new Headers(), '403 Forbidden: subscription required'), false);
  assert.equal(isChallenge(new Headers(), '{"description":"Cloudflare protects our website"}'), false);
});
test('browser commands and global overrides participate in discovery and completion', () => {
  assert.equal(parseInvocation(['cli.browser','setup','--local','--no-open']).values.local, true);
  assert.equal(parseInvocation(['myheritage.account','get','--transport','browser','--browser-timeout','0']).values['browser-timeout'], 0);
  assert.throws(() => parseInvocation(['cli.browser','configure','--timeout','-1']));
  assert.ok(complete(completionCatalog(), ['browser','']).candidates.includes('stop'));
  for (const provider of ['myheritage','findmypast','storied','newspaperarchive']) {
    const invocation = parseInvocation([`${provider}.session`, 'login', '--interactive', '--no-autofill']);
    assert.equal(invocation.values['no-autofill'], true);
    assert.ok(invocation.args.includes('--no-autofill'));
    assert.ok(complete(completionCatalog(), [`${provider}.session`,'login','--no-a']).candidates.includes('--no-autofill'));
  }
});
test('browser recovery preserves requests, cookies, sticky routing and independent instances', async t => {
  const requests: any[] = [];
  let page = '<html><body>Ready</body></html>', status = 200, challengeResponse = false, reply = Buffer.from([0,255,128,42]);
  const pageStates: Array<{html:string;ready:boolean}> = [];
  const responses: Array<{status:number;headers:Record<string,string>;bodyBase64:string}> = [];
  const server = createServer(async (req,res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {};
    requests.push({path:req.url, body, auth:req.headers.authorization});
    res.setHeader('content-type','application/json');
    const result = req.url === '/health' ? {ok:true} : req.url === '/fam/capabilities' ? {version:1} : req.url === '/tabs' ? {tabId:randomUUID()}
      : req.url?.endsWith('/evaluate') ? {result:pageStates.shift() ?? {html:page,ready:true}} : req.url === '/fam/request' ? responses.shift() ?? {status, headers:{'content-type':'application/octet-stream', 'x-provider':'kept', ...(challengeResponse ? {'cf-mitigated':'challenge'} : {})},bodyBase64:reply.toString('base64')}
      : req.url === '/fam/storage' ? {state:{cookies:[{name:'session',value:'cookie-secret',domain:'.example.com',path:'/api',expires:2000000000,httpOnly:true,secure:true,sameSite:'Lax'},
        {name:'fssessionid',value:'old-browser-session',domain:'.familysearch.org',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]}}
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
  await t.test('HTTP 200 interruption falls back for a provider without remembered routing', async () => {
    const start = requests.length;
    const html = '<html><title>Pardon Our Interruption</title><body>Something made us think you were a bot.</body></html>';
    const result = await fetchWithBrowser('findagrave', target, {}, async () => new Response(html, {headers:{'content-type':'application/json'}}));
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), reply);
    assert.equal(requests.slice(start).filter(r=>r.path==='/fam/request').length, 1);
    await fetchWithBrowser('findagrave', target, {}, async () => {throw new Error('routing was not remembered');});
  });
  await t.test('American Ancestors media uses shared fallback without importing native account cookies', async () => {
    const start=requests.length;
    const http=new AmericanAncestorsHttp(undefined,async(_url,init)=>{
      assert.equal(init.headers.Cookie,undefined);
      return new Response('<html><title>Pardon Our Interruption</title><body>We think you were a bot.</body></html>',{headers:{'content-type':'text/html'}});
    });
    await http.jar.setCookie('identity=synthetic-private; Domain=americanancestors.org; Path=/; Secure','https://app.americanancestors.org');
    const result=await http.request('https://75.img.americanancestors.org/image.xml',{media:true});
    assert.deepEqual(Buffer.from(result.bytes),reply);
    const calls=requests.slice(start);
    assert.equal(calls.some(r=>r.path==='/fam/cookies'),false);
    const sent=calls.find(r=>r.path==='/fam/request').body;
    assert.equal(sent.headers.cookie,undefined);assert.equal(sent.headers.authorization,undefined);
  });
  await t.test('browser recovery waits through a blank script document, navigates GET, and preserves binary output', async () => {
    const start = requests.length, image = Buffer.from([255,216,255,42]);
    responses.push({status:200,headers:{'content-type':'text/html'},bodyBase64:Buffer.from('<html><title>Pardon Our Interruption</title><body>We think you were a bot.</body></html>').toString('base64')},
      {status:200,headers:{'content-type':'image/jpeg'},bodyBase64:image.toString('base64')});
    pageStates.push({html:'<html><script>/* verification in progress */</script></html>',ready:false}, {html:'<html><body><img src="scan.jpg"></body></html>',ready:true});
    setBrowserOverrides({transport:'browser',timeout:5});
    try {
      const result = await fetchWithBrowser('familysearch', 'https://www.example.com/scan.jpg', {}, async () => {throw new Error('direct must not run');});
      assert.equal(result.headers.get('content-type'),'image/jpeg');
      assert.deepEqual(Buffer.from(await result.arrayBuffer()),image);
      const calls=requests.slice(start), navigation=calls.findIndex(r=>r.path.endsWith('/navigate'));
      assert.equal(calls[navigation].body.url,'https://www.example.com/scan.jpg');
      const evaluations=calls.flatMap((r,i)=>r.path.endsWith('/evaluate')?[i]:[]);
      assert.equal(evaluations.length,2);
      assert.ok(evaluations[0]>navigation);
      assert.ok(calls.findIndex((r,i)=>i>navigation && r.path==='/fam/prepare')>evaluations[1]);
      assert.equal(calls.filter(r=>r.path==='/fam/request').length,2);
    } finally {setBrowserOverrides({});}
  });
  await t.test('POST recovery navigates the origin and replays the exact body once', async () => {
    const start=requests.length;
    responses.push({status:403,headers:{'cf-mitigated':'challenge'},bodyBase64:''});
    const init={method:'POST',headers:{Authorization:'Bearer synthetic', 'Content-Type':'application/json'},body:'{"id":9223372036854775807}'};
    await fetchWithBrowser('myheritage',target,init,async()=>{throw new Error('direct must not run');});
    const calls=requests.slice(start), sent=calls.filter(r=>r.path==='/fam/request');
    assert.equal(calls.find(r=>r.path.endsWith('/navigate')).body.url,new URL(target).origin);
    assert.equal(sent.length,2);
    for (const request of sent) {
      assert.equal(request.body.method,'POST'); assert.equal(request.body.url,target);
      assert.equal(Buffer.from(request.body.bodyBase64,'base64').toString(),init.body);
      assert.equal(request.body.headers.authorization,'Bearer synthetic');
    }
  });
  await t.test('a repeated browser challenge preserves a verification page and never loops request replay', async () => {
    const start=requests.length;
    for(let i=0;i<2;i++) responses.push({status:503,headers:{'cf-mitigated':'challenge'},bodyBase64:''});
    await assert.rejects(fetchWithBrowser('myheritage',target,{method:'POST',body:'one operation'},async()=>{throw new Error('direct must not run');}),
      (error:any)=>error.code==='BROWSER_INTERACTION_REQUIRED' && error.vncUrl===endpoint.vncUrl);
    const calls=requests.slice(start);
    assert.equal(calls.filter(r=>r.path==='/fam/request').length,2);
    assert.equal(calls.at(-1).body.url,new URL(target).origin);
    assert.ok(calls.at(-1).path.endsWith('/navigate'));
  });
  await t.test('FamilySearch viewer cookies follow current authorization on both new and reused browser tabs', async () => {
    const http = new HttpSession();
    await http.jar.setCookie('preference=stale-native-preference; Domain=familysearch.org; Path=/; Secure', 'https://www.familysearch.org');
    setBrowserOverrides({transport:'browser'});
    try {
      for (const token of ['first-current-token', 'rotated-current-token']) {
        const start = requests.length;
        await http.request('https://www.familysearch.org/search/filmdatainfo/image-data', {
          method:'POST', headers:{Authorization:`Bearer ${token}`}, body:'{}',
        });
        const calls = requests.slice(start);
        const imports = calls.filter(r=>r.path==='/fam/cookies');
        assert.equal(imports.length,1);
        assert.equal(imports[0].body.cookies.length,1);
        assert.equal(imports[0].body.cookies[0].name,'fssessionid');
        assert.equal(imports[0].body.cookies[0].value,token);
        assert.equal(imports[0].body.cookies[0].domain,'.familysearch.org');
        assert.equal(imports[0].body.cookies[0].secure,true);
        assert.equal(imports[0].body.explicit,undefined); // Preserve browser reset protection.
        assert.ok(calls.indexOf(imports[0]) < calls.findIndex(r=>r.path==='/fam/request'));
        if (token.startsWith('rotated')) assert.equal(calls.some(r=>r.path==='/tabs'),false);
      }
    } finally {setBrowserOverrides({});}
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
    page = '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>';
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

test('browser cookies retain structured values, nameless cookies and host-only scope', async () => {
  const jar = new CookieJar(), origin = 'https://www.example.com';
  const cookie = {name: '', value: 'fixture', domain: 'www.example.com', path: '/api', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const};
  await updateCookieJar(jar, {cookies: [cookie,
    {...cookie, name: 'structured', value: 'literal; Path=/wrong; Domain=other.example'},
    {...cookie, name: 'parent-host-only', domain: 'example.com'},
    {...cookie, name: 'parent-domain', domain: '.example.com', expires: 2000000000},
    {...cookie, name: 'expired', expires: 1},
  ], origins: []}, origin);
  const cookies = await jar.getCookies(`${origin}/api`);
  assert.equal(cookies.length, 3);
  assert.equal(cookies.find(c => c.key === '')?.value, 'fixture');
  const structured = cookies.find(c => c.key === 'structured')!;
  assert.equal(structured.value, 'literal; Path=/wrong; Domain=other.example');
  assert.equal(structured.path, '/api'); assert.equal(structured.domain, 'www.example.com');
  assert.equal(structured.hostOnly, true); assert.equal(structured.httpOnly, true); assert.equal(structured.sameSite, 'lax');
  assert.equal((await jar.getCookies(`${origin}/elsewhere`)).length, 0);
  assert.deepEqual((await jar.getCookies('https://child.www.example.com/api')).map(c => c.key), ['parent-domain']);
  const restored = CookieJar.deserializeSync(jar.serializeSync());
  assert.deepEqual(jarCookies(restored, origin).find(c => c.name === ''), cookie);
});

test('provider lockouts stop password attempts without extending an existing cooldown', async () => {
  assert.equal(loginCooldown('Access has been temporarily disabled. Please try again in 24 hours.'), 86400000);
  assert.equal(loginCooldown('Incorrect password'), undefined);
  let inputs = 0;
  const tab = {provider: 'myheritage', evaluate: async () => ({origin:'https://www.myheritage.com', email:true, password:true, text:'Access has been temporarily disabled. Try again in 24 hours.'}),
    browser: {config:{timeout:0}, endpoint:{vncUrl:'https://viewer.example.test'}, api:async()=>{inputs++;}}} as any;
  const verify = async () => assert.fail('do not probe a page displaying an access restriction');
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], verify), (e:any)=>e.code==='BROWSER_LOGIN_BLOCKED');
  const first = await readPrivateJson<any>('myheritage/browser-login-block.json');
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], verify), (e:any)=>e.code==='BROWSER_LOGIN_BLOCKED');
  assert.equal((await readPrivateJson<any>('myheritage/browser-login-block.json')).blockedUntil, first.blockedUntil);
  assert.equal(inputs, 0);
});

test('a saved cooldown permits session reuse and manual completion without password input', async () => {
  const blockedUntil = new Date(Date.now() + 86400000).toISOString();
  await writePrivateJson('myheritage/browser-login-block.json', {blockedUntil});
  let inputs = 0, states = 0;
  let form = false;
  const tab = {provider: 'myheritage', evaluate: async () => ({origin:'https://www.myheritage.com', email:form, password:form, text:'Ready'}),
    browser: {config:{timeout:0}, endpoint:{vncUrl:'https://viewer.example.test'}, api:async()=>{inputs++;}, state:async()=>{states++;}, notify:async()=>{}}} as any;
  assert.equal(await waitForLogin(tab, ['https://www.myheritage.com'], async () => 'signed-in'), 'signed-in');
  assert.equal(states, 1);
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], async () => undefined), (e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
  form = true;
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], async () => undefined), (e:any)=>e.code==='BROWSER_LOGIN_BLOCKED' && e.message.includes('earlier restriction'));
  await assert.rejects(waitForLogin(tab, ['https://www.myheritage.com'], async () => undefined, {interactive:true}), (e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
  assert.equal(inputs, 0);
  assert.equal((await readPrivateJson<any>('myheritage/browser-login-block.json')).blockedUntil, blockedUntil);
});

test('interactive login autofills configured credentials without submitting, even during a saved cooldown', async () => {
  await writePrivateJson('myheritage/login.json', {username:'synthetic@example.test',password:'synthetic-password'});
  await writePrivateJson('myheritage/browser-login-block.json', {blockedUntil:new Date(Date.now()+86400000).toISOString()});
  let origin = 'https://www.myheritage.com', supported = true;
  const requests: {path:string; body:any}[] = [];
  const tab = {provider:'myheritage', userId:'fam-test-myheritage', id:'test-tab',
    evaluate:async()=>({origin,document:1,email:true,password:true,text:'Log in'}),
    browser:{config:{timeout:0},endpoint:{vncUrl:'https://viewer.example.test'},notify:async()=>{},api:async(path:string,body:any)=>{
      requests.push({path,body});return path==='/fam/capabilities'?{autofill:supported}:{ready:true,filled:true,submitted:false};
    }}} as any;
  const run = (options: {interactive?:boolean;autofill?:boolean} = {interactive:true}) => waitForLogin(tab,['https://www.myheritage.com'],async()=>undefined,options);
  await assert.rejects(run(),(e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
  assert.deepEqual(requests.map(r=>r.path),['/fam/capabilities','/fam/autofill']);
  assert.equal(requests[1].body.password,'synthetic-password');
  assert.equal(requests[1].body.origin,origin);
  requests.length=0;
  await assert.rejects(run({interactive:true,autofill:false}),(e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
  await assert.rejects(run({autofill:false}),(e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
  assert.equal(requests.length,0);
  origin='https://www.myheritage.com.attacker.example';
  await assert.rejects(run(),(e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
  assert.equal(requests.length,0);
  origin='https://www.myheritage.com'; supported=false;
  await assert.rejects(run(),(e:any)=>e.code==='BROWSER_PLUGIN_REQUIRED');
  assert.deepEqual(requests.map(r=>r.path),['/fam/capabilities']);
});

test('login completion is checked immediately after navigation or form disappearance', async () => {
  for (const change of [{document:2}, {url:'https://www.myheritage.com/family-sites/fixture/site'}, {email:false,password:false}]) {
    let reads = 0, checks = 0, states = 0;
    const initial = {origin:'https://www.myheritage.com',url:'https://www.myheritage.com/login',document:1,email:true,password:true,text:'Ready'};
    const tab = {provider:'myheritage',evaluate:async()=> ++reads === 1 ? initial : {...initial,...change},
      browser:{config:{timeout:0},endpoint:{vncUrl:'https://viewer.example.test'},state:async()=>{states++;},
        notify:async()=>assert.fail('completed sign-in should not ask for interaction'),api:async()=>assert.fail('no password input needed')}} as any;
    assert.equal(await waitForLogin(tab, [initial.origin], async()=> ++checks === 2 ? 'signed-in' : undefined), 'signed-in');
    assert.equal(checks,2); assert.equal(states,1);
  }
});
