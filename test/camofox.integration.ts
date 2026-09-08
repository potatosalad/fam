import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
// @ts-expect-error This server-side JS plugin runs in Camofox, not the TypeScript SDK.
import {register} from '../browser/camofox-plugin/index.js';
// @ts-expect-error Express is only a development dependency for plugin integration tests.
import express from 'express';

test('Camofox plugin observes real browser responses, checkpoints state and isolates tab cleanup', {timeout:60000}, async t => {
  const directory = await mkdtemp(join(tmpdir(),'fam-camofox-plugin-'));
  const browser = await chromium.launch({channel:process.env.FAM_TEST_BROWSER_CHANNEL,headless:true});
  const context = await browser.newContext({ignoreHTTPSErrors:true}), page = await context.newPage(), other = await context.newPage();
  let external = 0, logins = 0;
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=localhost'], {stdio:'ignore'});
  const web = createServer({key:await readFile(join(directory,'key.pem')), cert:await readFile(join(directory,'cert.pem'))}, async (req,res) => {
    let body = Buffer.alloc(0); for await (const chunk of req) body=Buffer.concat([body,chunk]);
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
