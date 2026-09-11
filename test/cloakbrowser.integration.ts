import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm, readFile, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
// @ts-ignore The Docker service is shipped as JavaScript.
import {createService} from '../browser/cloakbrowser/server.mjs';
import {Camofox} from '../src/shared/browser-runtime.js';

test('CloakBrowser service persists normal profiles, implements fam HTTP, and deletes switch state', {timeout:120000}, async t=>{
  const root=await mkdtemp(join(tmpdir(),'fam-cloak-service-'));
  const web=createServer(async(req,res)=>{
    let body=Buffer.alloc(0);for await(const chunk of req)body=Buffer.concat([body,chunk]);
    if(req.url==='/echo'){res.setHeader('content-type','application/json');res.end(JSON.stringify({cookie:req.headers.cookie,method:req.method,body:body.toString('base64')}));return;}
    res.setHeader('content-type','text/html');res.end('<!doctype html><title>Synthetic site</title><body>Ready</body>');
  });
  await new Promise<void>(r=>web.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(web.address() as any).port}`;
  const launched:string[]=[];
  const service=await createService({apiKey:'synthetic-cloak-key',profileDir:root,launchContext:async({id,directory,state}:any)=>{
    launched.push(id);
    const context=await chromium.launchPersistentContext(join(directory,'chromium'),{headless:true,channel:process.env.FAM_TEST_BROWSER_CHANNEL});
    if(state)await context.setStorageState(state);
    return {context,stop:()=>context.close()};
  }});
  const api=service.app.listen(0,'127.0.0.1');await new Promise<void>(r=>api.once('listening',r));
  const base=`http://127.0.0.1:${api.address().port}`;
  const browser=new Camofox({version:1,mode:'remote',remote:{engine:'cloakbrowser',url:base,vncUrl:base,apiKey:'synthetic-cloak-key'},timeout:0,transport:'auto',session:'test',open:false});
  t.after(async()=>{await service.close();await Promise.all([new Promise<void>(r=>api.close(()=>r())),new Promise<void>(r=>web.close(()=>r()))]);await rm(root,{recursive:true,force:true});});
  assert.equal((await fetch(`${base}/health`)).status,403);
  const capabilities=await browser.capabilities();assert.equal(capabilities.engine,'cloakbrowser');assert.equal(capabilities.purge,true);assert.equal(capabilities.privateFetch,true);
  const tab=await browser.tab('myheritage',origin);
  await tab.evaluate(`document.cookie='login=synthetic; Path=/';localStorage.setItem('saved','yes');true`);
  const result=await tab.request(`${origin}/echo`,{method:'POST',body:Buffer.from([0,128,255])});
  assert.deepEqual(await result.json(),{cookie:'login=synthetic',method:'POST',body:Buffer.from([0,128,255]).toString('base64')});
  assert.equal((await browser.api(`/tabs?userId=${browser.userId('myheritage')}`)).tabs[0].listItemId,'fam');
  const other=await browser.tab('findmypast',origin);
  assert.equal(await other.evaluate('document.cookie'),'');
  await tab.close();assert.equal(service.sessions.has(browser.userId('myheritage')),false);
  const restored=await browser.tab('myheritage',origin);
  assert.equal(await restored.evaluate("localStorage.getItem('saved')"),'yes');
  assert.match(await restored.evaluate<string>('document.cookie'),/login=synthetic/);
  assert.equal(launched.filter(id=>id.endsWith('-myheritage')).length,2);
  const [a,b]=await Promise.all([browser.tab('web'),browser.tab('web')]);
  assert.notEqual(a.id,b.id);assert.equal(launched.filter(id=>id.endsWith('-web')).length,1);
  await Promise.all([a.close(),b.close()]);
  await browser.api('/fam/reset',{all:true,discard:true});
  assert.equal(service.sessions.size,0);
  assert.equal((await readdir(root)).includes('fam-reset-backups'),false);
  for(const entry of await readdir(root))if(/^[a-f0-9]{32}$/.test(entry)){
    assert.deepEqual(JSON.parse(await readFile(join(root,entry,'storage-state.json'),'utf8')),{cookies:[],origins:[]});
    assert.equal((await readdir(join(root,entry))).includes('chromium'),false);
  }
  const clean=await browser.tab('myheritage',origin);
  assert.equal(await clean.evaluate('document.cookie'), '');assert.equal(await clean.evaluate('localStorage.length'),0);
  assert.equal((await browser.api('/fam/cookies',{userId:browser.userId('myheritage'),cookies:[{name:'stale',value:'old',url:origin}]})).imported,0);
});
