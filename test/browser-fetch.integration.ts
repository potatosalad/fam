import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile, stat} from 'node:fs/promises';
import {chromium, firefox} from 'playwright';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {browserFetchOptions, fetchBrowserUrl} from '../src/shared/browser-fetch.js';
import {saveBrowserConfig, setBrowserOverrides} from '../src/shared/browser-config.js';
// @ts-expect-error JavaScript plugin deployed to Camofox.
import {register} from '../browser/camofox-plugin/index.js';
// @ts-expect-error Test-only express server.
import express from 'express';

test('URL fetching uses real browser navigation and requests with exact CLI output', {timeout:120000}, async t => {
  const engine=process.env.FAM_TEST_BROWSER_ENGINE === 'firefox' ? firefox : chromium;
  const browser=await engine.launch({channel:process.env.FAM_TEST_BROWSER_CHANNEL,headless:true}),context=await browser.newContext();
  const sessions=new Map<string,any>(),events=new EventEmitter();
  let origin='',requests:any[]=[],posts=0;
  const raw=Buffer.from([0,255,128,42,10]);
  const web=createServer(async(req,res)=>{
    const body:Buffer[]=[];for await(const chunk of req)body.push(chunk);
    requests.push({url:req.url,headers:req.headers,method:req.method,body:Buffer.concat(body)});
    if(req.url==='/redirect'){res.writeHead(302,{location:`http://localhost:${(web.address() as any).port}/echo`});res.end();return;}
    if(req.url==='/loop'){res.writeHead(302,{location:'/loop'});res.end();return;}
    if(req.url==='/empty'){res.writeHead(204);res.end();return;}
    if(req.url==='/cached'){res.setHeader('content-type','text/html');res.end('<html><body>Cached page<script src="/cached.js"></script></body></html>');return;}
    if(req.url==='/cached.js'){res.setHeader('content-type','text/javascript');res.setHeader('cache-control','public, max-age=3600');res.end('document.body.dataset.loaded="yes";');return;}
    if(req.url==='/binary'){res.setHeader('content-type','application/octet-stream');res.end(raw);return;}
    if(req.url==='/echo'){res.setHeader('content-type','application/json');res.end(JSON.stringify({headers:req.headers,method:req.method,body:Buffer.concat(body).toString('base64')}));return;}
    if(req.url==='/denied'){res.writeHead(403,{'content-type':'text/html'});res.end('<html><title>Permission denied</title><body>No access</body></html>');return;}
    if(req.url==='/challenge-post'){posts++;res.setHeader('content-type','text/html');res.end('<html><title>Just a moment</title><body>Cloudflare security verification</body></html>');return;}
    res.setHeader('content-type','text/html');
    if(req.url==='/stuck'){res.end('<html><title>Just a moment</title><body>Cloudflare security verification</body></html>');return;}
    if(req.url==='/protected'&&!req.headers.cookie?.includes('clearance=ok')){res.end('<html><title>Just a moment</title><body>Cloudflare security verification<script>setTimeout(()=>{document.cookie="clearance=ok; Path=/";location.reload()},250)</script></body></html>');return;}
    res.end('<!doctype html><html><head><title>Synthetic page</title></head><body><nav>Navigation</nav><article><h1>Record</h1><p>Original</p><p style="display:none">Hidden</p></article><script>setTimeout(()=>{document.querySelector("article").insertAdjacentHTML("beforeend","<p id=loaded>Rendered <b>content</b></p>")},100)</script></body></html>');
  });
  await new Promise<void>(resolve=>web.listen(0,resolve));origin=`http://127.0.0.1:${(web.address() as any).port}`;
  const app=express();app.use('/tabs',express.json());app.get('/health',(_req:any,res:any)=>res.json({ok:true}));
  app.post('/tabs',async(req:any,res:any)=>{
    const session=sessions.get(req.body.userId)??{context,tabGroups:new Map([['fam',new Map()]])};sessions.set(req.body.userId,session);
    const id=`tab-${Date.now()}-${Math.random()}`,page=await context.newPage();session.tabGroups.get('fam').set(id,{page});res.json({tabId:id});
  });
  app.post('/tabs/:id/navigate',async(req:any,res:any)=>{
    await sessions.get(req.body.userId).tabGroups.get('fam').get(req.params.id).page.goto(req.body.url,{waitUntil:'domcontentloaded'});res.json({ok:true});
  });
  register(app,{sessions,events,config:{profileDir:CREDENTIAL_DIR},auth:()=> (_req:any,_res:any,next:any)=>next(),getSession:async(id:string)=>sessions.get(id)});
  const api=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>api.once('listening',resolve));
  const base=`http://127.0.0.1:${api.address().port}`;
  await saveBrowserConfig({version:1,mode:'remote',remote:{url:base,vncUrl:`${base}/viewer`},timeout:3,transport:'auto',session:'test',open:false});
  t.after(async()=>{await browser.close();await Promise.all([new Promise<void>(r=>web.close(()=>r())),new Promise<void>(r=>api.close(()=>r()))]);});
  const fetchPage=async(path:string,values:Record<string,any>={})=>fetchBrowserUrl(await browserFetchOptions({url:origin+path,...values}));
  await t.test('rendered and original content differ; selector, settling and markup extraction work',async()=>{
    const rendered=await fetchPage('/',{format:'json','wait-for':'article','wait-ms':200,header:'X-Custom: navigation',cookie:'test=seed','user-agent':'navigation-agent',referer:'https://referrer.example/'});
    assert.match(rendered.html!,/Rendered <b>content/);assert.match(rendered.text!,/Rendered content/);assert.doesNotMatch(rendered.text!,/Navigation|Hidden/);
    assert.match(rendered.markdown!,/Rendered \*\*content\*\*/);assert.doesNotMatch(rendered.markdown!,/Hidden/);
    const nav=requests.find(r=>r.url==='/'&&r.headers['x-custom']);assert.equal(nav.headers['x-custom'],'navigation');assert.match(nav.headers.cookie,/test=seed/);
    assert.equal(nav.headers['user-agent'],'navigation-agent');assert.equal(nav.headers.referer,'https://referrer.example/');
    const original=await fetchPage('/',{mode:'navigate',format:'raw'});assert.doesNotMatch(Buffer.from(original.bodyBase64!,'base64').toString(),/<p id="loaded">/);
  });
  await t.test('request headers, cookies, methods and binary body reach the server',async()=>{
    const result=await fetchPage('/echo',{mode:'request',method:'PATCH',body:'payload',format:'json',header:['Authorization: Bearer synthetic'],referer:'https://referrer.example/','user-agent':'fam-synthetic',cookie:'added=yes'});
    const echoed=result.json as any;assert.equal(echoed.method,'PATCH');assert.equal(echoed.headers.authorization,'Bearer synthetic');
    assert.equal(echoed.headers.referer,'https://referrer.example/');assert.equal(echoed.headers['user-agent'],'fam-synthetic');
    assert.match(echoed.headers.cookie,/added=yes/);assert.equal(echoed.body,Buffer.from('payload').toString('base64'));assert.equal(echoed.headers['x-fam-request-id'],undefined);
  });
  await t.test('ordinary navigation retains the browser HTTP cache across fetches',async()=>{
    await fetchPage('/cached',{'wait-for':'body[data-loaded=yes]'});
    await fetchPage('/cached',{'wait-for':'body[data-loaded=yes]'});
    assert.equal(requests.filter(r=>r.url==='/cached.js').length,1);
  });
  await t.test('cross-origin request redirects strip all caller headers and preserve metadata',async()=>{
    const result=await fetchPage('/redirect',{mode:'request',format:'json',header:['Authorization: Bearer synthetic','X-Secret: synthetic'],cookie:'scoped=yes'});
    assert.match(result.url,/localhost/);assert.equal((result.json as any).headers.authorization,undefined);assert.equal((result.json as any).headers['x-secret'],undefined);
    assert.equal((result.json as any).headers.cookie,undefined);
    assert.equal((await fetchPage('/redirect',{mode:'request',format:'json',redirects:'manual'})).status,302);
    await assert.rejects(fetchPage('/redirect',{mode:'request',redirects:'error'}),{code:'BROWSER_REDIRECT'});
  });
  await t.test('challenge navigation executes scripts; ordinary 403 is preserved; writes never replay',async()=>{
    assert.match((await fetchPage('/protected',{'wait-ms':200})).text!,/Record/);
    assert.equal((await fetchPage('/denied')).status,403);
    setBrowserOverrides({timeout:0});
    await assert.rejects(fetchPage('/stuck'),{code:'BROWSER_INTERACTION_REQUIRED'});
    const preserved=[...sessions.get('fam-test-web').tabGroups.get('fam').values()] as any[];
    assert.ok(preserved.some(({page})=>page.url().endsWith('/stuck')));
    await assert.rejects(fetchPage('/challenge-post',{mode:'request',body:'one'}),{code:'BROWSER_INTERACTION_REQUIRED'});assert.equal(posts,1);
    setBrowserOverrides({});
  });
  await t.test('CLI output from outside the checkout preserves exact binary bytes and private files',async()=>{
    const run=promisify(execFile),cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
    const invoke=(...args:string[])=>run(process.execPath,['--import',import.meta.resolve('tsx'),cli,'cli.browser','fetch','--url',`${origin}/binary`,...args],{cwd:CREDENTIAL_DIR,encoding:'buffer',env:process.env});
    assert.deepEqual((await invoke('--format','raw')).stdout,raw);
    const out=join(CREDENTIAL_DIR,'saved.bin');await invoke('--format','raw','--out',out);assert.deepEqual(await readFile(out),raw);assert.equal((await stat(out)).mode&0o777,0o600);
    const json=JSON.parse((await invoke('--mode','request','--json')).stdout.toString());assert.equal(json.data.bodyBase64,raw.toString('base64'));assert.equal(json.ok,true);
    assert.equal((await fetchPage('/empty',{mode:'request',format:'raw'})).bodyBase64,'');
    const head=await fetchPage('/echo',{method:'HEAD',format:'raw'});assert.equal(head.bodyBase64,'');
  });
});
