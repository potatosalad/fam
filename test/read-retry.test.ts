import test from 'node:test';
import assert from 'node:assert/strict';
import {Impit} from 'impit';
import {retryRead, retryDelay, setReadRetryPolicy, transientConnectionError} from '../src/shared/read-retry.js';
import {fetchWithBrowser} from '../src/shared/browser-transport.js';
import {BrowserError} from '../src/shared/browser-config.js';
import {HttpSession} from '../src/familysearch/http.js';
import {ResearchTransport} from '../src/familysearch/research-transport.js';
import {ArchiveHttp} from '../src/internetarchive/http.js';
import {parseInvocation} from '../src/shared/command-runtime.js';

const busy = (after = '0') => new Response('busy', {status:503, headers:{'retry-after':after}});
const disconnected = () => Object.assign(new Error('private URL and credentials must not appear in progress'), {name:'ConnectError'});

test('connection failures and overload retry the read with bounded, safe progress', async()=>{
  const messages:string[]=[], sleeps:number[]=[];let calls=0;
  setReadRetryPolicy({progress:message=>messages.push(message)});
  try {
    const result=await retryRead('example',async()=>{calls++;if(calls===1)throw disconnected();return calls===2?busy():Response.json({ok:true});},{sleep:async ms=>{sleeps.push(ms);}});
    assert.deepEqual(await result.json(),{ok:true});assert.equal(calls,3);assert.equal(sleeps.length,2);
    assert.match(messages[0],/temporary connection failure.*attempt 2\/3/);assert.match(messages[1],/HTTP 503.*attempt 3\/3/);
    assert.ok(messages.every(message=>!message.includes('private')));
  }finally{setReadRetryPolicy();}
});
test('fail-fast disables retries for both HTTP failures and connection exceptions',async()=>{
  setReadRetryPolicy({failFast:true,progress:()=>assert.fail('No retry progress expected')});
  try {
    let calls=0;assert.equal((await retryRead('example',async()=>{calls++;return busy();})).status,503);assert.equal(calls,1);
    calls=0;await assert.rejects(retryRead('example',async()=>{calls++;throw disconnected();}),{name:'ConnectError'});assert.equal(calls,1);
    const parsed=parseInvocation(['ancestry.record','search','--last-name','Example','--fail-fast']);
    assert.equal(parsed.values['fail-fast'],true);assert.ok(!parsed.args.includes('--fail-fast'));
  }finally{setReadRetryPolicy();}
});
test('three attempts and cumulative Retry-After budget are hard limits',async()=>{
  let calls=0;const sleeps:number[]=[];
  const result=await retryRead('example',async()=>{calls++;return busy('20');},{sleep:async ms=>{sleeps.push(ms);}});
  assert.equal(result.status,503);assert.equal(calls,2);assert.deepEqual(sleeps,[20000]);
  calls=0;await retryRead('example',async()=>{calls++;return busy('31');},{sleep:async()=>assert.fail('Must not retry early')});assert.equal(calls,1);
  calls=0;await retryRead('example',async()=>{calls++;return busy();},{sleep:async()=>{}});assert.equal(calls,3);
  assert.equal(retryDelay('Sun, 06 Sep 2026 22:00:02 GMT',0,Date.parse('2026-09-06T22:00:00Z')),2000);
});
test('input errors, access failures, verification errors, and cancellation are not transient',async()=>{
  for(const status of [400,401,403,404]){let calls=0;assert.equal((await retryRead('example',async()=>{calls++;return new Response('',{status});})).status,status);assert.equal(calls,1);}
  for(const error of [new TypeError('Invalid input'),new BrowserError('Verification needed'),Object.assign(new Error('cancelled'),{name:'AbortError'})]){
    let calls=0;await assert.rejects(retryRead('example',async()=>{calls++;throw error;}),e=>e===error);assert.equal(calls,1);
  }
  assert.equal(transientConnectionError(new TypeError('fetch failed',{cause:Object.assign(new Error('certificate'),{code:'CERT_HAS_EXPIRED'})})),false);
  const controller=new AbortController();let calls=0;
  setReadRetryPolicy({progress:()=>controller.abort()});
  try {await assert.rejects(retryRead('example',async()=>{calls++;return busy('1');},{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);}
  finally{setReadRetryPolicy();}
});
test('shared transport retries GET and explicit POST reads, but never automatically replays writes',async()=>{
  for(const init of [{method:'GET'},{method:'POST',retryable:true}]){
    let calls=0;const result=await fetchWithBrowser('example','https://example.test/read',init,async()=>++calls===1?busy():Response.json({ok:true}));
    assert.equal(result.status,200);assert.equal(calls,2);
  }
  for(const method of ['POST','PUT','PATCH','DELETE']){
    let calls=0;const result=await fetchWithBrowser('example','https://example.test/write',{method},async()=>{calls++;return busy();});
    assert.equal(result.status,503);assert.equal(calls,1);
  }
});
test('FamilySearch research has one retry loop and both existing transports honor fail-fast',async()=>{
  const original=Impit.prototype.fetch;let calls=0;
  Impit.prototype.fetch=(async()=>{calls++;return busy();}) as typeof original;
  const http=new HttpSession(), read=new ResearchTransport(action=>action(http,{}),async()=>{});
  const url='/search/filmdatainfo/image-data';
  try {
    await assert.rejects(read.response(url,{body:{imageId:'3:1:EXAMPLE'}}),{code:'temporary-failure'});assert.equal(calls,3);
    setReadRetryPolicy({failFast:true});calls=0;
    await assert.rejects(read.response(url,{body:{imageId:'3:1:EXAMPLE'}}),{code:'temporary-failure'});assert.equal(calls,1);
    calls=0;const archive=new ArchiveHttp({fetch:async()=>{calls++;return busy();}});
    await assert.rejects(archive.request('https://archive.org/metadata/example'),{code:'SERVICE_UNAVAILABLE'});assert.equal(calls,1);
  }finally{Impit.prototype.fetch=original;setReadRetryPolicy();}
});
