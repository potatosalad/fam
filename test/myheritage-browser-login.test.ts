import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {loginMyHeritage} from '../src/myheritage/browser-login.js';
import {saveBrowserConfig, loadProviderSession} from '../src/shared/browser-config.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';

const origin = 'https://www.myheritage.com';
const home = `${origin}/family-sites/fixture/site`, tree = `${origin}/family-trees/fixture/site`;
const html = Object.entries({isLoggedIn:true, currentUserAccountID:'123', siteID:'456', familyTreeID:'1',
  mediaUploaderData:{fgToken:'fixture-token'}, mhXsrfToken:'fixture-csrf', treeSelectionMenuEntries:[]})
  .map(([key,value]) => `var ${key} = ${JSON.stringify(value)};`).join('\n');

test('MyHeritage adopts the existing rendered session during an earlier login cooldown', async t => {
  let current = home, links = [tree], restricted = false, restrictOnNavigate = false, completeLogin = false, loginPending = false;
  const requests: {path:string; body:any}[] = [];
  const server = createServer(async (req,res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : {}, path = req.url!;
    requests.push({path,body});
    let result: unknown;
    if (path === '/health') result = {ok:true};
    else if (path === '/fam/capabilities') result = {version:1};
    else if (path.startsWith('/tabs?')) result = {tabs:[
      {tabId:'unrelated',url:tree,listItemId:'another-client'},
      {tabId:'wrong-origin',url:'https://www.myheritage.com.attacker.example/family-trees/fixture/site',listItemId:'fam'},
      {tabId:'transport',url:`${origin}/.fam-browser-fixture`,listItemId:'fam'},
      {tabId:'became-transport',url:tree,listItemId:'fam'},
      {tabId:'closed',url:tree,listItemId:'fam'},
      {tabId:'working',url:current,listItemId:'fam'},
      {tabId:'login',url:`${origin}/login`,listItemId:'fam'},
    ]};
    else if (path === '/tabs/became-transport/evaluate') result = {result:`${origin}/.fam-browser-fixture`};
    else if (path === '/tabs/transport/evaluate') assert.fail('transport documents must not be adopted for login');
    else if (path === '/tabs/working/evaluate') {
      const expression: string = body.expression;
      if (loginPending && expression.includes('performance.timeOrigin')) {current=home; loginPending=false;}
      if (completeLogin && expression.includes('html:')) {
        result = {result:{url:current,links,html:'var registrationClientData = {"isLoggedIn":false};'}};
        loginPending = true; completeLogin = false;
      } else {
        result = {result:expression === 'location.href' ? current : expression === 'navigator.userAgent' ? 'fixture-agent'
          : expression.includes('html:') ? {url:current,links,html:current===tree&&!restricted?html:'<html>Home</html>'}
          : {origin,url:current,password:false,email:false,text:restricted?'Access has been temporarily disabled. Try again in 24 hours.':'Signed in'}};
      }
    } else if (path === '/tabs/working/navigate') {
      current = loginPending ? `${origin}/login` : body.url; restricted = restrictOnNavigate; result = {ok:true};
    } else if (path === '/fam/request') {
      assert.equal(body.tabId, 'working');
      assert.equal(new URL(body.url).pathname, '/FP/API/FamilyTree/get-current-user-permissions.php');
      result = {status:200,headers:{'content-type':'application/json'},bodyBase64:Buffer.from('{"success":true}').toString('base64')};
    } else if (path === '/fam/storage') result = {state:{cookies:[{name:'PHPSESSID',value:'fixture-cookie',domain:'.myheritage.com',path:'/',expires:-1,httpOnly:true,secure:true}],origins:[]}};
    else if (path === '/fam/close-tab') result = {};
    else {res.statusCode=400; result={error:'unexpected-browser-operation'};}
    res.setHeader('content-type','application/json'); res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const port=(server.address() as {port:number}).port;
  await saveBrowserConfig({version:1,mode:'remote',remote:{url:`http://127.0.0.1:${port}`,vncUrl:'https://viewer.example.test'},timeout:0,transport:'auto',session:'test',open:false});
  const blockedUntil=new Date(Date.now()+86400000).toISOString();
  await writePrivateJson('myheritage/browser-login-block.json',{blockedUntil});

  await t.test('follows the existing family-site tree link once and saves its verified session', async()=>{
    const session=await loginMyHeritage();
    assert.equal(session.accessToken,'fixture-token');
    assert.equal(session.browser?.pageUrl,tree);
    assert.equal(requests.filter(r=>r.path.endsWith('/navigate')).length,1);
    assert.equal(requests.filter(r=>r.path==='/fam/request').length,1);
    assert.equal((await loadProviderSession<any>('myheritage')).accessToken,'fixture-token');
    assert.equal((await readPrivateJson<any>('myheritage/browser-login-block.json')).blockedUntil,blockedUntil);
    assert.equal(requests.some(r=>r.path==='/tabs'||r.path==='/fam/input'),false);
  });
  await t.test('reuses an already-rendered tree without opening or navigating another tab', async()=>{
    requests.length=0;
    await loginMyHeritage();
    assert.equal(requests.some(r=>r.path==='/tabs'||r.path.endsWith('/navigate')||r.path==='/fam/input'),false);
    assert.equal(requests.filter(r=>r.path==='/fam/request').length,1);
  });
  await t.test('never navigates a foreign tree link or probes a guessed tree URL', async()=>{
    requests.length=0; current=home; links=['https://evil.example/family-trees/fixture/site'];
    await assert.rejects(loginMyHeritage(),(e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');
    assert.equal(requests.some(r=>r.path==='/tabs'||r.path.endsWith('/navigate')||r.path==='/fam/request'||r.path==='/fam/input'),false);
  });
  await t.test('waits for sign-in before following a requested tree and detects completion on the next poll', async()=>{
    requests.length=0; current=`${origin}/login`; links=[]; completeLogin=true;
    const session=await loginMyHeritage({treeUrl:tree,autofill:false});
    assert.equal(session.browser?.pageUrl,tree);
    assert.equal(requests.filter(r=>r.path.endsWith('/navigate')).length,1);
    assert.equal(requests.filter(r=>r.path==='/fam/request').length,1);
    assert.equal(requests.some(r=>r.path==='/fam/input'),false);
  });
  await t.test('a newly displayed restriction stops verification and preserves the prior deadline', async()=>{
    requests.length=0; current=home; links=[tree]; restrictOnNavigate=true;
    await assert.rejects(loginMyHeritage(),(e:any)=>e.code==='BROWSER_LOGIN_BLOCKED');
    assert.equal(requests.filter(r=>r.path.endsWith('/navigate')).length,1);
    assert.equal(requests.some(r=>r.path==='/fam/request'||r.path==='/fam/input'),false);
    assert.equal((await readPrivateJson<any>('myheritage/browser-login-block.json')).blockedUntil,blockedUntil);
  });
});
