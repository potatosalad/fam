import test from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {Fold3Http,Fold3Error,WEB,IMG,checkUrl} from '../src/fold3/http.js';
import {Fold3Client,searchQuery} from '../src/fold3/client.js';
import {account,hydration,id,imageDetails,page,publicData} from '../src/fold3/parse.js';
import {loginNative,saveSession,loadSession} from '../src/fold3/auth.js';
import {downloadImage,saveDownload} from '../src/fold3/download.js';
import {parseJson,stringifyJson} from '../src/shared/json.js';
import {commandById,commands} from '../src/shared/command-registry.js';
import {resolveContext} from '../src/shared/command-search.js';
import {browserUserId,setBrowserOverrides} from '../src/shared/browser-config.js';
import {mkdtemp,readFile,stat,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
const response=(value:unknown)=>new Response(stringifyJson(value),{headers:{'content-type':'application/json'}});
const wrapper=(allowed=['VIEW','DOWNLOAD'])=>({w:{id:{ct:'IMAGE',id:'123'},c:'1900-01-01'},d:{t:'Synthetic muster roll',w:4,h:3,o:true,m:[{n:'name',v:'Test Ancestor'}]},r:{p:{allowed,denied:{}},o:{token:'synthetic-secret'},x:{collectionType:'PUBLICATION',collectionObjectId:7}}});
const doc=(content:unknown)=>'<h1>Synthetic source</h1><script id="hydrate-data" type="application/json">'+stringifyJson({F3_COMPONENT_DATA:content,F3_PAGE_DATA:{csrf:'synthetic-secret',session:{}}})+'</script><script>throw new Error("never execute");</script>';

test('Fold3 search maps fields, reusable facets, sorts, and bounded pagination',()=>{
 const q=searchQuery({name:'Test Ancestor',publicationId:'9007199254740997',birthYear:1880,type:'record',filter:['military.conflict=WWI','military.conflict=WWII'],field:['military.rank=Private'],facet:['place'],sort:'CHRONOLOGICAL_ASC',limit:2,offset:4});
 assert.equal(q.maxCount,2);assert.equal(q.offset,4);assert.equal(q.sortOrder,'CHRONOLOGICAL_ASC');assert.equal(q.fieldedKeywords[0].type,'full-name');
 assert.equal(q.filters.find(f=>f.type==='general.title.id')?.values[0],'9007199254740997');assert.deepEqual(q.filters.find(f=>f.type==='military.conflict')?.values,['WWI','WWII']);
 assert.equal(searchQuery({},true).maxCount,0);
 for(const value of [{},{name:'X',limit:101},{name:'X',offset:9999},{name:'X',field:['bad']},{name:'X',facet:['../x']},{name:'X',filter:'place=US'},{name:'X',unknown:1},{name:42},{name:'X',sort:'invented'}])assert.throws(()=>searchQuery(value as any));
});
test('wire IDs remain exact and research output excludes account context and signed tokens',()=>{
 const parsed=parseJson('{"userId":9007199254740997,"username":"fixture","accountStatus":"non-subscriber","passwordSerial":1}');
 assert.equal(account(parsed).userId,'9007199254740997');assert.ok(!('passwordSerial' in account(parsed)));
 assert.throws(()=>id(9007199254740997));for(const value of ['../123','0','1e3',undefined])assert.throws(()=>id(value));
 const text=doc({content:{title:'Muster roll',token:'synthetic-secret',url:IMG+'/img/img?id=123&token=synthetic-secret&signature=synthetic-secret'},mapboxToken:'synthetic-secret'});
 const result=page(text,WEB+'/record/123');assert.doesNotMatch(stringifyJson(result),/synthetic-secret|csrf|session|mapboxToken/);assert.equal(result.title,'Synthetic source');assert.equal(hydration(text).F3_PAGE_DATA.csrf,'synthetic-secret');
 assert.throws(()=>page(doc({next:'/'}),WEB+'/login'),{code:'session-rejected'});
 assert.throws(()=>page(doc({next:'/'}),WEB+'/record/123'),{code:'api-changed'});
 assert.throws(()=>hydration('<h1>Changed</h1>'),{code:'api-changed'});assert.throws(()=>imageDetails(wrapper(),'456'),{code:'api-changed'});
 assert.doesNotMatch(stringifyJson(publicData(wrapper())),/synthetic-secret/);
});
test('native requests enforce origins, cookie scope, redirect limits and non-replayed POSTs',async()=>{
 for(const url of ['http://www.fold3.com/','https://www.fold3.com.evil.test/','https://evil.fold3.com/','https://user:pass@www.fold3.com/','https://www.fold3.com:444/','https://www.fold3.com/#secret'])assert.throws(()=>checkUrl(url));
 const jar=new CookieJar();jar.setCookieSync('sess=synthetic; Secure; Path=/',WEB);
 const seen:Array<{url:string;headers:Headers}>=[];
 const http=new Fold3Http(jar.serializeSync(),async(url,init)=>{seen.push({url,headers:new Headers(init.headers)});return seen.length===1?new Response(null,{status:302,headers:{location:IMG+'/img/img?id=123'}}):new Response(new Uint8Array([0,255,1,128]));});
 assert.deepEqual([...((await http.request(WEB+'/document/123')).bytes)],[0,255,1,128]);assert.equal(seen[1].headers.get('cookie'),null);
 let count=0;const external=new Fold3Http(undefined,async()=>{count++;return new Response(null,{status:302,headers:{location:'https://evil.test/'}});});
 await assert.rejects(external.request(WEB+'/record/123'),/outside/);assert.equal(count,1);
 count=0;await assert.rejects(external.request(WEB+'/node/auth/user',{body:{username:'test',password:'synthetic'}}),{code:'api-changed'});assert.equal(count,1);
 await assert.rejects(external.request(WEB+'/node/delete',{body:{}}),/Unsupported/);assert.equal(count,1);
});
test('empty account, challenges, API failures and rate limits never trigger password retries',async()=>{
 for(const [status,text,code] of [[200,'','session-rejected'],[401,'private','session-rejected'],[403,'private','access-denied'],[403,'<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script>','verification-required'],[429,'private','http']] as const){
  let attempts=0;const c=new Fold3Client(new Fold3Http(undefined,async()=>{attempts++;return new Response(text,{status});}));
  await assert.rejects(c.me(),e=>e instanceof Fold3Error&&e.code===code&&!e.message.includes('private'));assert.equal(attempts,1);
 }
});
test('a challenged native login submits once and leaves the saved session unchanged',async()=>{
 const jar=new CookieJar();jar.setCookieSync('sess=old; Secure; Path=/',WEB);
 const previous={mode:'native' as const,cookies:jar.serializeSync(),savedAt:'2026-01-01T00:00:00Z'};await saveSession(previous);
 process.env.FOLD3_USERNAME='fixture';process.env.FOLD3_PASSWORD='synthetic';let count=0;
 try{const http=new Fold3Http(undefined,async(url,init)=>{count++;if(count===1)return new Response(doc({}));assert.equal(url,WEB+'/node/auth/user');assert.equal(new Headers(init.headers).get('x-csrf-token'),'synthetic-secret');return new Response('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script>',{status:403});});
 await assert.rejects(loginNative(http),{code:'verification-required'});assert.equal(count,2);assert.deepEqual(await loadSession(),previous);
 }finally{delete process.env.FOLD3_USERNAME;delete process.env.FOLD3_PASSWORD;}
});
test('search normalizes compact results and does not present incomplete pages as exhaustive',async()=>{
 let payload:any;const c=new Fold3Client(new Fold3Http(undefined,async(_url,init)=>{payload=JSON.parse(String(init.body));return response({hits:[{doc:{id:{ct:'INDEX_RECORD',id:9007199254740997n},t:'Synthetic',md:[{n:'birth-date',v:'1880'}]},hp:['match']}],total:3,timedOut:false,shards:{failed:0}});}));
 const found=await c.search({name:'Test',limit:1});assert.equal(found.items[0].id,'9007199254740997');assert.equal(found.nextOffset,1);assert.equal(payload.fieldedKeywords[0].type,'full-name');
 const partial=new Fold3Client(new Fold3Http(undefined,async()=>response({hits:[],total:3,timedOut:true})));const r=await partial.search({name:'Test'});assert.equal(r.incomplete,true);assert.equal(r.nextOffset,null);
 let requests=0;const forbidden=new Fold3Client(new Fold3Http(undefined,async()=>{requests++;return response({});}));
 await assert.rejects(forbidden.call('delete'));await assert.rejects(forbidden.call('image',{id:'123',token:'injected'}));assert.equal(requests,0);
});
test('compact filmstrip and text OCR decode independently from viewing permissions',async()=>{
 const c=new Fold3Client(new Fold3Http(undefined,async url=>url.includes('/filmstrip/')?response({a:123,n:[{i:123,c:'7.cluster',o:0,t:'Page 1'}],c:[{i:'7.cluster',t:'File',z:2}]}):new Response('Synthetic OCR\nTest Ancestor',{headers:{'content-type':'text/plain'}})));
 const strip=await c.filmstrip('123',2);assert.equal(strip.nodes[0].imageId,'123');assert.equal(strip.clusters[0].size,2);assert.match((await c.ocr('123')).text,/Test Ancestor/);
});
test('downloads require fresh permission, validate JPEG, and publish private sidecars without overwriting',async()=>{
 const jpeg=await sharp({create:{width:4,height:3,channels:3,background:'#abcdef'}}).jpeg().toBuffer();let requests=0;
 const c=new Fold3Client(new Fold3Http(undefined,async url=>{requests++;return url.startsWith(IMG)?new Response(jpeg,{headers:{'content-type':'image/jpeg'}}):url.includes('/publication/pub/')?response({id:7,t:'Synthetic military records',cal:'REGISTERED'}):response(wrapper());}));
 const result=await downloadImage(c,'123');assert.equal(requests,3);assert.equal(result.metadata.citation.publication.title,'Synthetic military records');assert.equal(result.metadata.width,4);assert.doesNotMatch(stringifyJson(result.metadata),/synthetic-secret|token=/);
 const denied=new Fold3Client(new Fold3Http(undefined,async()=>{requests++;return response(wrapper(['VIEW']));}));requests=0;await assert.rejects(downloadImage(denied,'123'),{code:'access-denied'});assert.equal(requests,1);
 const html=new Fold3Client(new Fold3Http(undefined,async url=>url.startsWith(IMG)?new Response('<html>paywall</html>',{headers:{'content-type':'image/jpeg'}}):url.includes('/publication/pub/')?response({id:7,t:'Synthetic'}):response(wrapper())));await assert.rejects(downloadImage(html,'123'),{code:'api-changed'});
 const dir=await mkdtemp(join(tmpdir(),'fam-fold3-'));try{const out=join(dir,'scan.jpg');await saveDownload(out,result);assert.equal((await stat(out)).mode&0o777,0o600);assert.equal((await stat(out+'.json')).mode&0o777,0o600);assert.deepEqual(await readFile(out),jpeg);await assert.rejects(saveDownload(out,result));
 const other=join(dir,'existing-sidecar.jpg');await writeFile(other+'.json','preserve');await assert.rejects(saveDownload(other,result));await assert.rejects(stat(other));assert.equal(await readFile(other+'.json','utf8'),'preserve');}finally{await rm(dir,{recursive:true,force:true});}
});
test('Fold3 commands, URL context and digit-bearing browser identity integrate with shared discovery',()=>{
 assert.ok(commandById.has('fold3.record search'));assert.equal(commandById.get('fold3.image download')!.flags.find(f=>f.name==='out')!.required,true);
 assert.ok(!commands.some(c=>c.provider==='fold3'&&c.object==='api.gql'));assert.ok(commandById.has('fold3.session verify'));
 assert.deepEqual(resolveContext(WEB+'/record/9007199254740997/ancestor').flags,{'record-id':'9007199254740997'});
 assert.deepEqual(resolveContext(WEB+'/document/123').flags,{'image-id':'123'});assert.deepEqual(resolveContext('https://evil.fold3.com/image/123').flags,{});
 assert.equal(browserUserId({session:'fixture'} as any,'fold3'),'fam-fixture-fold3');assert.throws(()=>browserUserId({session:'fixture'} as any,'../fold3'));
 setBrowserOverrides({transport:'http'});
});

test('oversized and cyclic HTTP responses stop without returning provider diagnostics',async()=>{
 let requests=0;const loop=new Fold3Http(undefined,async()=>{requests++;return new Response(null,{status:302,headers:{location:WEB+'/record/123'}});});
 await assert.rejects(loop.request(WEB+'/record/123'),/redirect limit/);assert.equal(requests,6);
 const oversized=new Fold3Http(undefined,async()=>new Response('private',{headers:{'content-length':String(65*1024*1024)}}));
 await assert.rejects(oversized.request(WEB+'/record/123'),/exceeded 64 MiB/);
});
