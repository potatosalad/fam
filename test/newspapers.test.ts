import test from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {NewspapersHttp, NewspapersError, WEB, IMG} from '../src/newspapers/http.js';
import {NewspapersClient, id, searchQuery} from '../src/newspapers/client.js';
import {account, pageMetadata, pageObjects, publicValue} from '../src/newspapers/parse.js';
import {setBrowserOverrides} from '../src/shared/browser-config.js';
import {waitForLogin} from '../src/shared/browser-login.js';
import {resolveContext} from '../src/shared/command-search.js';
import {commands,commandById} from '../src/shared/command-registry.js';
const script = (chunks: string[]) => chunks.map(chunk=>`<script>self.__next_f.push(${JSON.stringify([1,chunk])})</script>`).join('');
const signedIn = {id:123,username:'reader',email:'reader@example.test',isAuthenticated:true,isSubscriber:false};
const accountHtml = script(['0:'+JSON.stringify(signedIn)+'\n']);
const jar = new CookieJar();jar.setCookieSync('user_token=synthetic; Secure; Path=/; Domain=.newspapers.com',WEB);
const session = {mode:'browser' as const,browserInstance:'a'.repeat(24),cookies:jar.serializeSync(),savedAt:'2026-01-01T00:00:00Z'};

test('account parsing joins split JSON records, keeps exact IDs, and never executes scripts',()=>{
 const stream='1:["$",null,{"id":9007199254740997,"username":"reader","isAuthenticated":true,"isSubscriber":false}]\n';
 const html=script([stream.slice(0,36),stream.slice(36)])+'<script>throw new Error("never execute")</script>';
 assert.equal(account(html).id,'9007199254740997');assert.equal(pageObjects(html).length,1);
 assert.throws(()=>account(script(['0:'+JSON.stringify({...signedIn,isAuthenticated:false})+'\n'])),{code:'session-rejected'});
 assert.throws(()=>account(script(['0:'+JSON.stringify({records:[],recordCount:0})+'\n'])),{code:'api-changed'});
});
test('metadata and raw reads remove authorization tokens and signed URL parameters',()=>{
 const value={image:{imageId:123,publicationId:9,publicationTitle:'Synthetic Gazette',canView:true},iat:'private',pqsid:'private',rights:{Get:{allowed:true,fcfToken:'private'},Download:{allowed:false}}};
 assert.deepEqual(pageMetadata(value,'123').rights,{Get:true,Download:false});
 const output=JSON.stringify(publicValue({...value,url:IMG+'/img/img?id=123&iat=private&user=12&signature=private',nested:[{authorization:'private',text:'public'}]}));
 assert.ok(!output.includes('private'));assert.ok(output.includes('public'));assert.ok(!output.includes('user=12'));
 assert.throws(()=>pageMetadata(value,'999'),{code:'api-changed'});
});
test('search preserves opaque cursors and dates, translates sort, and rejects invalid filters',()=>{
 const q=searchQuery({keyword:'Lincoln',publicationId:'9007199254740997',from:'1900-01-01',to:'1900-12-31',cursor:'AoMI+/=',sort:'date-asc',limit:2});
 assert.equal(q.start,'AoMI+/=');assert.equal(q['publication-ids'],'9007199254740997');assert.equal(q.sort,'paper-date-asc');assert.equal(q['date-start'],'1900-01-01');
 for(const input of [{},{keyword:'a',limit:0},{keyword:'a',from:'1900-02-29',to:'1900-03-01'},{keyword:'a',from:'1900-01-01'},{keyword:'a',publicationId:'../account'},{keyword:'a',city:'Chicago'}]) assert.throws(()=>searchQuery(input));
 for(const value of [12,'1e3','0','../1']) assert.throws(()=>id(value));
});
test('native HTTP keeps bytes and cookies but strips authorization on cross-origin redirects',async()=>{
 const urls:string[]=[],headers:Headers[]=[];
 const http=new NewspapersHttp(jar.serializeSync(),async(url,init)=>{
  urls.push(url);headers.push(new Headers(init.headers));
  return urls.length===1 ? new Response(null,{status:302,headers:{location:IMG+'/img/img?id=123'}}) : new Response(new Uint8Array([0,255,1,128]),{headers:{'content-type':'image/jpeg'}});
 });
 const result=await http.get(WEB+'/api/article/page/123/articles',{Authorization:'Bearer: synthetic'});
 assert.deepEqual([...result.bytes],[0,255,1,128]);assert.equal(headers[1].get('authorization'),null);assert.match(headers[1].get('cookie')!,/user_token=synthetic/);
 let requests=0;
 const blocked=new NewspapersHttp(jar.serializeSync(),async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://external.example.test/steal'}});});
 await assert.rejects(blocked.get(WEB+'/account/'),/outside Newspapers/);assert.equal(requests,1);
});
test('ordinary 403, 429, and malformed account data are not password retry triggers',async()=>{
 let attempts=0;
 for(const status of [403,429]){
  const c=new NewspapersClient(new NewspapersHttp(undefined,async()=>new Response('private server diagnostic',{status})),session,async()=>{attempts++;return session});
  await assert.rejects(c.me(),e=>e instanceof NewspapersError && e.status===status && !e.message.includes('private'));
 }
 const c=new NewspapersClient(new NewspapersHttp(undefined,async()=>new Response('<html>API changed</html>')),session,async()=>{attempts++;return session});
 await assert.rejects(c.me(),{code:'api-changed'});assert.equal(attempts,0);
});
test('a positively rejected session renews once, while explicit HTTP never invokes the browser',async()=>{
 let requests=0,renewals=0;
 const c=new NewspapersClient(new NewspapersHttp(undefined,async()=>{requests++;return new Response('',{status:401})}),session,async()=>{renewals++;return session});
 setBrowserOverrides({transport:'auto'});
 try{await assert.rejects(c.me(),{code:'session-rejected'});assert.equal(requests,2);assert.equal(renewals,1);}
 finally{setBrowserOverrides({transport:'http'});}
 requests=0;renewals=0;await assert.rejects(c.me(),{code:'session-rejected'});assert.equal(requests,1);assert.equal(renewals,0);
});
test('catalog rejects writes and unknown inputs before making any request; empty searches remain valid',async()=>{
 let requests=0;const c=new NewspapersClient(new NewspapersHttp(undefined,async()=>{requests++;return new Response(JSON.stringify({records:[],recordCount:0,nextStart:null}))}));
 assert.throws(()=>c.call('delete-account'));assert.throws(()=>c.call('page',{pageId:'123',iat:'injected'}));assert.throws(()=>c.call('issue',{publicationId:'1'}));assert.equal(requests,0);
 const result=await c.search({keyword:'synthetic'});assert.deepEqual(result.records,[]);assert.equal(result.nextCursor,null);
});
test('OCR validates selection geometry and exposes empty text without inventing a transcript',async()=>{
 let requests=0;const c=new NewspapersClient(new NewspapersHttp(undefined,async(url)=>{requests++;return new Response(JSON.stringify(url.includes('/authorize')?{image:{imageId:123,publicationId:9,publicationTitle:'Synthetic',canView:true,width:100,height:100},iat:'synthetic',rights:{Get:{allowed:true}}}:{ocr:''}));}));
 assert.throws(()=>c.ocr('123',{articleId:'4'}));assert.throws(()=>c.ocr('123',{x:0}));
 await assert.rejects(c.ocr('123',{x:90,y:0,width:20,height:10}),/exceeds/);assert.equal(requests,1);
 const result=await c.ocr('123',{x:0,y:0,width:50,height:50});assert.equal(result.available,false);assert.equal(result.text,'');
 const full=await c.ocr('123');assert.equal(full.available,false);
});
test('login fills but never submits while Turnstile is pending',async()=>{
 process.env.NEWSPAPERS_USERNAME='reader@example.test';process.env.NEWSPAPERS_PASSWORD='synthetic';const calls:string[]=[];
 const tab:any={provider:'newspapers',id:'test',userId:'fam-test-newspapers',evaluate:async()=>({origin:WEB,url:WEB+'/signin/',document:1,email:true,password:true,text:'Sign in'}),close:async()=>calls.push('close'),browser:{config:{timeout:0},endpoint:{vncUrl:'https://viewer.example.test'},notify:async()=>{},state:async()=>({}),api:async(path:string)=>{calls.push(path);return path==='/fam/capabilities'?{autofill:true}:{ready:true,submitted:false}}}};
 try{await assert.rejects(waitForLogin(tab,[WEB],async()=>undefined,{readyToSubmit:async()=>false}),{code:'BROWSER_INTERACTION_REQUIRED'});assert.deepEqual(calls,['/fam/capabilities','/fam/autofill']);}
 finally{delete process.env.NEWSPAPERS_USERNAME;delete process.env.NEWSPAPERS_PASSWORD;}
});
test('CLI exposes documented reads and resolves exact page IDs',()=>{
 assert.ok(commandById.has('newspapers.newspaper search'));
 const list=commands.filter(c=>c.provider==='newspapers');assert.ok(list.some(c=>c.id==='newspapers.session login'));assert.ok(!list.some(c=>c.object==='api.gql'));
 assert.deepEqual(resolveContext(WEB+'/image/9007199254740997/').flags,{'page-id':'9007199254740997'});
 assert.deepEqual(resolveContext('https://evil.newspapers.com/image/123/').flags,{});
 assert.deepEqual(resolveContext(WEB+':8443/image/123/').flags,{});
});
