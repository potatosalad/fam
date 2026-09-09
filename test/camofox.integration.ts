import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtemp, readFile, rm, mkdir, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium, type BrowserContext, type Page} from 'playwright';
import {fetchWithBrowser, closeBrowserTransportTabs} from '../src/shared/browser-transport.js';
import {saveBrowserConfig} from '../src/shared/browser-config.js';
// @ts-expect-error This server-side JS plugin runs in Camofox, not the TypeScript SDK.
import {register} from '../browser/camofox-plugin/index.js';
// @ts-expect-error Express is only a development dependency for plugin integration tests.
import express from 'express';

test('Camofox plugin observes real browser responses, checkpoints state and isolates tab cleanup', {timeout:60000}, async t => {
  const directory = await mkdtemp(join(tmpdir(),'fam-camofox-plugin-'));
  const browser = await chromium.launch({channel:process.env.FAM_TEST_BROWSER_CHANNEL,headless:true});
  const context = await browser.newContext({ignoreHTTPSErrors:true}), page = await context.newPage(), other = await context.newPage();
  let external = 0, logins = 0, challengeNavigations = 0, protectedFetches = 0;
  const protectedBytes = Buffer.from([255,216,255,0,128,42]);
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost'], {stdio:'ignore'});
  const web = createServer({key:await readFile(join(directory,'key.pem')), cert:await readFile(join(directory,'cert.pem'))}, async (req,res) => {
    let body = Buffer.alloc(0); for await (const chunk of req) body=Buffer.concat([body,chunk]);
    if (req.url === '/protected-image') {
      if (req.headers['sec-fetch-mode'] === 'navigate') {
        challengeNavigations++;
        res.setHeader('content-type','text/html');
        // Verification initially has no visible content or recognizable title.
        // A fetch never executes this script; a document navigation does.
        res.end('<html><body><script>setTimeout(()=>{document.cookie="clearance=verified; Path=/; Secure";location.replace("/verified")},750)</script></body></html>');return;
      }
      protectedFetches++;
      if (req.headers.cookie?.includes('clearance=verified')) {
        res.setHeader('content-type','image/jpeg');res.end(protectedBytes);return;
      }
      res.setHeader('content-type','text/html');
      res.end('<html><title>Pardon Our Interruption</title><body>Something about your browser made us think you were a bot.</body></html>');return;
    }
    if (req.url==='/authorize' || req.url==='/wrong') {res.writeHead(302,{location:`com.test://auth.example.test/callback?state=${req.url==='/wrong'?'wrong':'expected'}&code=good`});res.end();return;}
    if (req.url==='/form') {res.setHeader('content-type','text/html');res.end('<form method=post action=/login><input name=registrationEmail><input type=password name=password><button>Log in</button></form><div style="position:fixed;inset:0;background:white">Cookie notice</div>');return;}
    if (req.url==='/login') {assert.equal(body.toString(),'registrationEmail=synthetic%40example.test&password=synthetic-password');logins++;}
    if (req.url==='/redirect') {res.writeHead(302,{location:'/external'});res.end();return;}
    if (req.url==='/external') external++;
    if (req.url==='/empty') {res.writeHead(204);res.end();return;}
    if (req.url==='/bytes') {res.setHeader('content-type','application/octet-stream');res.setHeader('x-cookie',req.headers.cookie??'');res.setHeader('x-auth',req.headers.authorization??'');res.setHeader('set-cookie',['first=one; Path=/; HttpOnly','second=two; Expires=Wed, 09 Sep 2026 00:00:00 GMT; Path=/']);res.end(body);return;}
    res.setHeader('content-type','text/html');res.setHeader('set-cookie','session=browser-cookie; Path=/; HttpOnly; SameSite=Lax');res.end('<html><body>Browser test</body></html>');
  });
  await new Promise<void>(resolve=>web.listen(0,'127.0.0.1',resolve));
  const origin = `https://127.0.0.1:${(web.address() as {port:number}).port}`;
  await page.goto(origin);
  const userId='fam-test-storied', session={context,tabGroups:new Map([['fam',new Map([['owned',{page}]])],['unrelated',new Map([['other',{page:other}]])]]),lastAccess:Date.now()};
  const app=express(), events=new EventEmitter(), sessions=new Map([[userId,session]]);
  app.use('/tabs', express.json());
  app.get('/health', (_req:any,res:any)=>res.json({ok:true}));
  app.post('/tabs', async (_req:any,res:any)=>{
    const id=`transport-${session.tabGroups.get('fam')!.size}`;
    const transportPage=await context.newPage();session.tabGroups.get('fam')!.set(id,{page:transportPage});res.json({tabId:id});
  });
  app.post('/tabs/:id/evaluate', async (req:any,res:any)=>{
    try {res.json({result:await session.tabGroups.get('fam')!.get(req.params.id)!.page.evaluate(req.body.expression)});}
    catch {res.status(400).json({error:'navigation-in-progress'});}
  });
  app.post('/tabs/:id/navigate', async (req:any,res:any)=>{
    await session.tabGroups.get('fam')!.get(req.params.id)!.page.goto(req.body.url,{waitUntil:'domcontentloaded'});res.json({ok:true});
  });
  register(app,{sessions,events,config:{profileDir:directory},auth:()=> (_req:any,_res:any,next:any)=>next(),getSession:async()=>session});
  const api=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>api.once('listening',resolve));
  const base=`http://127.0.0.1:${api.address().port}`;
  const call=async(path:string,value:unknown)=>{const r=await fetch(`${base}/fam/${path}`,{method:'POST',headers:{'content-type':'application/vnd.fam+json'},body:JSON.stringify(value)}); const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;};
  t.after(async()=>{events.emit('server:shutdown');await browser.close();await Promise.all([new Promise<void>(resolve=>web.close(()=>resolve())),new Promise<void>(resolve=>api.close(()=>resolve()))]);await rm(directory,{recursive:true,force:true});});
  await page.goto(`${origin}/form`);
  const interactive = await call('autofill', {userId,tabId:'owned',origin,username:'synthetic@example.test',password:'synthetic-password'});
  assert.equal(interactive.submitted,false); assert.equal(interactive.filled,true);
  assert.equal(await page.locator('input[name=registrationEmail]').inputValue(),'synthetic@example.test');
  assert.equal(await page.locator('input[type=password]').inputValue(),'synthetic-password');
  assert.equal(page.url(),`${origin}/form`); assert.equal(logins,0);
  await page.locator('input[name=registrationEmail]').fill('manually-edited@example.test');
  await page.locator('input[type=password]').fill('manually-edited-password');
  const preserved = await call('autofill', {userId,tabId:'owned',origin,username:'synthetic@example.test',password:'synthetic-password'});
  assert.equal(preserved.filled,false); assert.equal(preserved.submitted,false);
  assert.equal(await page.locator('input[name=registrationEmail]').inputValue(),'manually-edited@example.test');
  assert.equal(await page.locator('input[type=password]').inputValue(),'manually-edited-password');
  const wrongOrigin=await fetch(`${base}/fam/autofill`,{method:'POST',headers:{'content-type':'application/vnd.fam+json'},body:JSON.stringify({userId,tabId:'owned',origin:'https://wrong.example',username:'secret-user',password:'secret-password'})});
  assert.equal(wrongOrigin.status,400); assert.equal(logins,0);
  assert.equal(await page.locator('input[type=password]').inputValue(),'manually-edited-password');
  // A later password-only step is filled without clicking through either step.
  await page.setContent('<input id=email-login><button>Next</button>');
  await call('autofill',{userId,tabId:'owned',origin,username:'synthetic@example.test',password:'synthetic-password'});
  assert.equal(await page.locator('input').inputValue(),'synthetic@example.test');
  await page.setContent('<input type=password><button>Sign in</button>');
  await call('autofill',{userId,tabId:'owned',origin,username:'synthetic@example.test',password:'synthetic-password'});
  assert.equal(await page.locator('input').inputValue(),'synthetic-password'); assert.equal(logins,0);
  await page.goto(`${origin}/form`);
  const filled = await call('input', {userId, tabId:'owned', origin, username:'synthetic@example.test', password:'synthetic-password'});
  assert.equal(filled.submitted, true);
  await page.waitForURL(`${origin}/login`); assert.equal(logins,1);
  await call('prepare', {userId, tabId:'owned', origin});
  assert.equal(new URL(page.url()).origin,origin);
  const bytes=Buffer.from([0,255,128,42]);
  const result=await call('request',{userId,tabId:'owned',url:`${origin}/bytes`,method:'POST',headers:{Authorization:'Bearer synthetic-token',Cookie:'wrong=caller-cookie','User-Agent':'wrong-agent'},bodyBase64:bytes.toString('base64')});
  assert.equal(result.status,200);assert.deepEqual(Buffer.from(result.bodyBase64,'base64'),bytes);
  const responseHeaders = new Headers(result.headers);
  assert.equal(responseHeaders.get('x-cookie'),'session=browser-cookie');assert.equal(responseHeaders.get('x-auth'),'Bearer synthetic-token');
  assert.equal(responseHeaders.getSetCookie().length,2);
  const redirect=await call('request',{userId,tabId:'owned',url:`${origin}/redirect`});
  assert.equal(redirect.status,302);assert.equal(new Headers(redirect.headers).get('location'),'/external');assert.equal(external,0);
  assert.equal((await call('request',{userId,tabId:'owned',url:`${origin}/empty`})).status,204);
  await t.test('shared recovery executes a real navigation and waits for script clearance before retrying the image',async()=>{
    await saveBrowserConfig({version:1,mode:'remote',remote:{url:base,vncUrl:`${base}/viewer`},timeout:10,transport:'auto',session:'test',open:false});
    let directCalls=0;
    try {
      const result=await fetchWithBrowser('storied',`${origin}/protected-image`,{},async()=>{
        directCalls++;
        return new Response('<html><title>Pardon Our Interruption</title><body>We think you were a bot.</body></html>',{headers:{'content-type':'text/html'}});
      });
      assert.equal(directCalls,1);assert.equal(challengeNavigations,1);assert.equal(protectedFetches,2);
      assert.equal(result.headers.get('content-type'),'image/jpeg');
      assert.deepEqual(Buffer.from(await result.arrayBuffer()),protectedBytes);
      assert.ok((await context.cookies()).some(cookie=>cookie.name==='clearance' && cookie.value==='verified'));
    } finally {await closeBrowserTransportTabs();}
  });
  const state=await call('storage',{userId});assert.equal(state.state.cookies[0].httpOnly,true);
  const saved=JSON.parse(await readFile(join(directory,createHash('sha256').update(userId).digest('hex').slice(0,32),'storage-state.json'),'utf8'));
  assert.equal(saved.cookies[0].value,'browser-cookie');
  const watch=await call('callback',{userId,origin,redirectUri:'com.test://auth.example.test/callback',state:'expected',timeoutMs:30000});
  await page.goto(`${origin}/wrong`).catch(()=>{});
  assert.equal((await call('callback-result',{userId,id:watch.id})).pending,true);
  await page.goto(`${origin}/authorize`).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.match((await call('callback-result',{userId,id:watch.id})).callback,/code=good/);
  assert.equal((await call('callback-result',{userId,id:watch.id})).expired,true);
  assert.equal((await call('close',{userIds:[userId]})).closed,1);
  assert.equal(page.isClosed(),true);assert.equal(other.isClosed(),false);assert.equal(browser.isConnected(),true);
});

test('Camofox session reset clears live and persisted site data without navigating or touching another context', {timeout:60000}, async t => {
  const directory = await mkdtemp(join(tmpdir(),'fam-camofox-reset-'));
  const browser = await chromium.launch({channel:process.env.FAM_TEST_BROWSER_CHANNEL,headless:true});
  const app = express(), events = new EventEmitter();
  type Session = {context:BrowserContext; tabGroups:Map<string,Map<string,{page:Page}>>};
  const sessions = new Map<string,Session>();
  const profile = (userId:string) => join(directory,createHash('sha256').update(userId).digest('hex').slice(0,32));
  const saved = (userId:string) => readFile(join(profile(userId),'storage-state.json'),'utf8').then(JSON.parse);
  let navigations = 0, bootstrapImports = 0;
  const persist = async (userId:string, session:Session) => {
    await mkdir(profile(userId),{recursive:true});
    await writeFile(join(profile(userId),'storage-state.json'),JSON.stringify(await session.context.storageState({indexedDB:true})));
    await writeFile(join(profile(userId),'meta.json'),JSON.stringify({userId}));
  };
  const getSession = async (userId:string) => {
    if (sessions.has(userId)) return sessions.get(userId)!;
    await Promise.all(events.listeners('session:creating').map(listener=>listener({userId,contextOptions:{}})));
    const state = await saved(userId).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
    const context = await browser.newContext({storageState:state});
    await context.route('**/*',async route=>{navigations++;await route.fulfill({contentType:'text/html',body:'<h1>Synthetic site</h1>'});});
    if (!state) {bootstrapImports++;await context.addCookies([{name:'bootstrap',value:'old',url:'https://reset.example.test'}]);}
    const session:Session = {context,tabGroups:new Map([['fam',new Map()]])};
    sessions.set(userId,session); return session;
  };
  const closeSession = async (userId:string,session:Session,options:any) => {
    assert.equal(options.clearLocks,true); assert.equal(options.clearDownloads,true);
    // Model the upstream lifecycle: checkpoint before close, then destroy.
    await persist(userId,session);
    await session.context.close(); sessions.delete(userId);
    events.emit('session:destroyed',{userId});
  };
  register(app,{sessions,events,config:{profileDir:directory},auth:()=> (_req:any,_res:any,next:any)=>next(),getSession,closeSession});
  const api = app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>api.once('listening',resolve));
  const base = `http://127.0.0.1:${api.address().port}`;
  const request = async(path:string,value?:unknown) => {
    const response = await fetch(`${base}/fam/${path}`,value===undefined?{}:{method:'POST',headers:{'content-type':'application/vnd.fam+json'},body:JSON.stringify(value)});
    return {status:response.status,...await response.json()};
  };
  t.after(async()=>{events.emit('server:shutdown');await browser.close();await new Promise<void>(resolve=>api.close(()=>resolve()));await rm(directory,{recursive:true,force:true});});
  const userId = 'fam-reset-myheritage', otherId = 'fam-reset-findmypast';
  const session = await getSession(userId), other = await getSession(otherId);
  const page = await session.context.newPage(), otherPage = await other.context.newPage();
  session.tabGroups.get('fam')!.set('target',{page}); other.tabGroups.get('fam')!.set('keep',{page:otherPage});
  await page.goto('https://reset.example.test');
  await page.evaluate(async()=>{
    document.cookie='session=old'; localStorage.setItem('device','old'); sessionStorage.setItem('transient','old');
    await new Promise<void>((resolve,reject)=>{const db=indexedDB.open('device');db.onupgradeneeded=()=>db.result.createObjectStore('tokens').put('old','id');db.onsuccess=()=>{db.result.close();resolve();};db.onerror=()=>reject(db.error);});
  });
  await persist(userId,session);
  assert.ok((await saved(userId)).origins[0].indexedDB.length);
  assert.equal((await request('capabilities')).reset,true);
  await t.test('an unrelated tab group in the same context prevents a targeted reset',async()=>{
    session.tabGroups.set('unrelated',new Map([['shared',{page}]]));
    assert.equal((await request('reset',{userId})).error,'session-has-unrelated-tabs');
    assert.equal((await request('reset',{all:true})).error,'session-has-unrelated-tabs');
    assert.equal(page.isClosed(),false);
    assert.equal(otherPage.isClosed(),false);
    assert.equal((await saved(userId)).origins[0].localStorage[0].value,'old');
    session.tabGroups.delete('unrelated');
  });
  let backupDirectory:string;
  await t.test('closing and replacing a context removes all its site storage, retaining backups and other sessions',async()=>{
    const before = navigations;
    const result = await request('reset',{userId});
    assert.equal(result.status,200); assert.equal(result.closedTabs,1); assert.equal(result.browserStopped,false);
    backupDirectory=result.backupDirectory;
    assert.equal(navigations,before); assert.equal(page.isClosed(),true); assert.equal(otherPage.isClosed(),false);assert.equal(browser.isConnected(),true);
    assert.deepEqual(await saved(userId),{cookies:[],origins:[]});
    for (const copy of ['before-close','closed-profile']) {
      const old = JSON.parse(await readFile(join(backupDirectory,copy,'storage-state.json'),'utf8'));
      assert.ok(old.cookies.some((cookie:any)=>cookie.name==='session'));assert.equal(old.origins[0].localStorage[0].value,'old');
    }
    assert.equal((await stat(backupDirectory)).mode & 0o777,0o700);
    assert.equal((await stat(join(profile(userId),'storage-state.json'))).mode & 0o777,0o600);
    const imports = bootstrapImports, fresh = await getSession(userId), blank = await fresh.context.newPage();
    assert.equal(blank.url(),'about:blank');assert.equal(bootstrapImports,imports);
    assert.deepEqual(await fresh.context.storageState({indexedDB:true}),{cookies:[],origins:[]});
    assert.equal(navigations,before);
    await blank.goto('https://reset.example.test');
    assert.deepEqual(await blank.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,databases:await indexedDB.databases()})),{local:0,session:0,databases:[]});
  });
  await t.test('stale cookies from another CLI cannot reseed a reset context, but explicit import is supported',async()=>{
    const cookies=[{name:'old-http',value:'old',url:'https://reset.example.test'}];
    const blocked=await request('cookies',{userId,cookies});
    assert.equal(blocked.skipped,'session-reset');assert.equal(blocked.imported,0);
    assert.deepEqual(await sessions.get(userId)!.context.cookies(),[]);
    const explicit=await request('cookies',{userId,cookies,explicit:true});
    assert.equal(explicit.imported,1);assert.equal((await saved(userId)).cookies[0].name,'old-http');
  });
  await t.test('a dormant persisted context resets and stays empty after recreation',async()=>{
    const current=sessions.get(userId)!;
    await closeSession(userId,current,{clearLocks:true,clearDownloads:true});
    const before=navigations;
    const reset=await request('reset',{userId});assert.equal(reset.status,200);assert.equal(reset.closedTabs,0);
    assert.notEqual(reset.backupDirectory,backupDirectory!);
    assert.deepEqual(await saved(userId),{cookies:[],origins:[]});
    const fresh=await getSession(userId);assert.deepEqual(await fresh.context.cookies(),[]);
    assert.equal(navigations,before);assert.equal(otherPage.isClosed(),false);
  });
  await t.test('reset drains an in-flight cookie import and rejects new work until replacement completes',async()=>{
    const current=sessions.get(userId)!, original=current.context.addCookies.bind(current.context);
    let release!:()=>void, started!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}), entered=new Promise<void>(resolve=>{started=resolve;});
    current.context.addCookies=async cookies=>{started();await gate;await original(cookies);};
    const importing=request('cookies',{userId,explicit:true,cookies:[{name:'pending',value:'old',url:'https://reset.example.test'}]});
    await entered;
    const resetting=request('reset',{userId});
    try {
      let blocked=false;
      for (let attempt=0;attempt<20;attempt++) {
        if ((await request('storage',{userId})).error==='session-reset-in-progress') {blocked=true;break;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(blocked,true);assert.equal(sessions.has(userId),true);
    } finally {release();}
    assert.equal((await importing).status,200);assert.equal((await resetting).status,200);
    assert.deepEqual(await saved(userId),{cookies:[],origins:[]});
    assert.deepEqual(await (await getSession(userId)).context.cookies(),[]);
  });
  await t.test('--all finds active and dormant fam sessions across names and preserves unrelated sessions',async()=>{
    const dormantId='fam-another-name-myheritage', dormant=await getSession(dormantId);
    await closeSession(dormantId,dormant,{clearLocks:true,clearDownloads:true});
    const unrelatedId='unrelated-user', unrelated=await getSession(unrelatedId), unrelatedPage=await unrelated.context.newPage();
    unrelated.tabGroups.set('other-tool',new Map([['unrelated',{page:unrelatedPage}]]));
    await persist(unrelatedId,unrelated);
    const unrelatedDisk=await saved(unrelatedId), before=navigations;
    const result=await request('reset',{all:true,userIds:[userId]});
    assert.equal(result.status,200);assert.equal(result.all,true);
    assert.deepEqual(result.sessions.map((s:any)=>s.userId).sort(),[userId,otherId,dormantId].sort());
    assert.equal(navigations,before);assert.equal(otherPage.isClosed(),true);assert.equal(unrelatedPage.isClosed(),false);
    assert.equal(browser.isConnected(),true);assert.deepEqual(await saved(unrelatedId),unrelatedDisk);
    for (const id of [userId,otherId,dormantId]) assert.deepEqual(await saved(id),{cookies:[],origins:[]});
    const imports=bootstrapImports, freshId='fam-previously-unseen-findmypast';
    const stale=await request('cookies',{userId:freshId,cookies:[{name:'old-http',value:'old',url:'https://reset.example.test'}]});
    assert.equal(stale.skipped,'session-reset');
    const fresh=await getSession(freshId);
    assert.equal(bootstrapImports,imports);assert.deepEqual(await fresh.context.cookies(),[]);assert.equal(navigations,before);
  });
});
