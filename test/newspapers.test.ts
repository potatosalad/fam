import test from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {NewspapersHttp, NewspapersError, WEB, IMG} from '../src/newspapers/http.js';
import {NewspapersClient, id, searchQuery, clippingQuery} from '../src/newspapers/client.js';
import {articleId, articleCollections, articleTypes, selectArticle, rectangle, clippingRecord} from '../src/newspapers/records.js';
import {account, pageMetadata, pageObjects, publicValue} from '../src/newspapers/parse.js';
import {setBrowserOverrides} from '../src/shared/browser-config.js';
import {waitForLogin} from '../src/shared/browser-login.js';
import {resolveContext} from '../src/shared/command-search.js';
import {commands,commandById} from '../src/shared/command-registry.js';
import sharp from 'sharp';
import {mkdtemp,readFile,writeFile,stat,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {downloadDimensions,saveDownload} from '../src/newspapers/download.js';
import {parseJson} from '../src/shared/json.js';
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
 assert.throws(()=>c.ocr('123',{articleId:'../4'}));assert.throws(()=>c.ocr('123',{x:0}));
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
 assert.equal(commandById.get('newspapers.page download')?.flags.find(f=>f.name==='out')?.required,true);
 const list=commands.filter(c=>c.provider==='newspapers');assert.ok(list.some(c=>c.id==='newspapers.session login'));assert.ok(!list.some(c=>c.object==='api.gql'));
 assert.deepEqual(resolveContext(WEB+'/image/9007199254740997/').flags,{'page-id':'9007199254740997'});
 assert.deepEqual(resolveContext('https://evil.newspapers.com/image/123/').flags,{});
 assert.deepEqual(resolveContext(WEB+':8443/image/123/').flags,{});
 assert.deepEqual(resolveContext(WEB+'/clip/9007199254740997/example/').flags,{'clipping-id':'9007199254740997'});
 assert.deepEqual(resolveContext(WEB+'/clipping/123/').flags,{'clipping-id':'123'});
 assert.deepEqual(resolveContext(WEB+'/image/123/?article=12345678-1234-1234-1234-123456789ABC&fcfToken=private').flags,{'page-id':'123','article-id':'12345678-1234-1234-1234-123456789abc'});
 assert.deepEqual(resolveContext(WEB+'/image/123/?clipping_id=456&fcfToken=private').flags,{'page-id':'123','clipping-id':'456'});
 assert.deepEqual(resolveContext('https://evil.newspapers.com/clipping/123/').flags,{});
});

const downloadAuthorization={image:{imageId:123,publicationId:9,publicationTitle:'Synthetic Gazette',title:'Page 1',date:'1900-01-01',canView:true,width:32,height:48},iat:'synthetic-private-authorization',rights:{Download:{allowed:true,fcfToken:'synthetic-private-token'}}};
function downloadClient(authorization: any, image: Buffer, contentType='image/jpeg', requests: URL[] = []) {
 return new NewspapersClient(new NewspapersHttp(undefined,async value=>{
  const url=new URL(value);requests.push(url);
  if(url.pathname==='/api/client/image/authorize/')return Response.json(authorization);
  if(url.pathname==='/account/')return new Response(accountHtml);
  assert.equal(url.origin,IMG);assert.equal(url.pathname,'/img/img');
  assert.equal(url.searchParams.get('a'),'download');assert.equal(url.searchParams.get('iat'),downloadAuthorization.iat);
  assert.equal(url.searchParams.get('user'),'123');assert.equal(url.searchParams.get('id'),'123');
  assert.equal(url.searchParams.get('brightness'),'0');assert.equal(url.searchParams.get('width'),'32');
  return new Response(new Uint8Array(image),{headers:{'content-type':contentType}});
 }));
}
test('whole-page download checks current rights before reading the account or requesting an image',async()=>{
 for(const authorization of [
  {...downloadAuthorization,rights:{Download:{allowed:false}}},
  {...downloadAuthorization,rights:{}},
  {...downloadAuthorization,image:{...downloadAuthorization.image,canView:false}},
 ]){
  const calls:URL[]=[];await assert.rejects(downloadClient(authorization,Buffer.alloc(0),'image/jpeg',calls).download('123'),{code:'access-denied'});
  assert.equal(calls.length,1);
 }
});

const articleUuid='12345678-1234-1234-1234-123456789abc';
const smallRect={x:2,y:4,width:12,height:16};
function indexedArticles(){return {...Object.fromEntries(Object.values(articleCollections).map(key=>[key,[]])),marriages:[{id:articleUuid,articleId:'87654321-4321-4321-4321-cba987654321',rectangle:smallRect,marriage:{self:{fullName:'Synthetic Reader'},spouse:{fullName:'Other Reader'}},iat:'private'}]};}
test('indexed searches retain record types and opaque cursors; malformed IDs never reach the service',async()=>{
 for(const type of articleTypes)assert.equal(searchQuery({keyword:'Reader',type,cursor:'opaque+/='})['entity-types'],type);
 assert.equal(searchQuery({keyword:'Reader'})['entity-types'],'page');
 assert.throws(()=>searchQuery({keyword:'Reader',type:'unsupported' as any}));
 assert.equal(articleId(articleUuid.toUpperCase()),articleUuid);assert.equal(articleId('9007199254740997'),'9007199254740997');
 for(const value of ['../123','',123,articleUuid+'?x=1'])assert.throws(()=>articleId(value));
 const c=new NewspapersClient(new NewspapersHttp(undefined,async()=>{throw new Error('Unexpected request')}));
 assert.throws(()=>c.article('123','../456'));assert.throws(()=>c.downloadArticle('123',articleUuid,'unknown' as any));
});
test('article selection preserves extracted relatives, resolves entity IDs, and refuses missing or ambiguous matches',()=>{
 const result=selectArticle(indexedArticles(),downloadAuthorization,'123',articleUuid);
 assert.equal(result.type,'marriage');assert.equal(result.details[0].marriage.spouse.fullName,'Other Reader');assert.deepEqual(result.rectangle,smallRect);
 assert.ok(!JSON.stringify(result).includes('private'));assert.match(result.sourceUrl,/article=12345678/);
 assert.throws(()=>selectArticle(indexedArticles(),downloadAuthorization,'123','999'),{code:'not-found'});
 assert.throws(()=>selectArticle({},downloadAuthorization,'123',articleUuid),{code:'api-changed'});
 const polygon=[{x:0.25,y:0.25},{x:0.75,y:0.25},{x:0.75,y:0.75},{x:0.25,y:0.75}];
 const duplicate={...indexedArticles(),births:[{id:articleUuid,polygon}]};
 assert.throws(()=>selectArticle(duplicate,downloadAuthorization,'123',articleUuid),/--type/);
 assert.equal(selectArticle(duplicate,downloadAuthorization,'123',articleUuid,'birth').type,'birth');
 duplicate.births.push({id:articleUuid,polygon});
 assert.equal(selectArticle(duplicate,downloadAuthorization,'123',articleUuid,'birth').details.length,2);
 for(const rect of [{...smallRect,x:Infinity},{...smallRect,width:0},{...smallRect,x:30},{...smallRect,rotation:90}])assert.throws(()=>rectangle(rect,32,48),{code:'api-changed'});
 for(const type of ['birth','enslavement'] as const){
  const records={...indexedArticles(),[articleCollections[type]]:[{id:articleUuid,polygon}]};
  assert.deepEqual(selectArticle(records,downloadAuthorization,'123',articleUuid,type).rectangle,{x:8,y:12,width:16,height:24});
  for(const invalid of [[],[{x:0,y:0}],polygon.map(p=>({...p,x:2})),polygon.map(p=>({...p,y:NaN}))]){
   records[articleCollections[type]][0].polygon=invalid;
   assert.throws(()=>selectArticle(records,downloadAuthorization,'123',articleUuid,type),{code:'api-changed'});
  }
 }
 const crimes={...indexedArticles(),crimeArticles:[{articleId:'different-parent-id',rectangle:smallRect,crime:{CrimeId:articleUuid,Crime:'Synthetic report'}}]};
 assert.equal(selectArticle(crimes,downloadAuthorization,'123',articleUuid,'crime').details[0].crime.Crime,'Synthetic report');
 const conflicting={...indexedArticles(),marriages:[...indexedArticles().marriages,{...indexedArticles().marriages[0],rectangle:{...smallRect,x:3}}]};
 assert.throws(()=>selectArticle(conflicting,downloadAuthorization,'123',articleUuid),{code:'api-changed'});
});
test('article OCR resolves coordinates automatically and keeps the selected entity ID',async()=>{
 const calls:URL[]=[];const c=new NewspapersClient(new NewspapersHttp(undefined,async value=>{
  const url=new URL(value);calls.push(url);
  if(url.pathname.includes('/authorize'))return Response.json(downloadAuthorization);
  if(url.pathname.endsWith('/articles'))return Response.json(indexedArticles());
  assert.equal(url.searchParams.get('objectId'),articleUuid);assert.equal(url.searchParams.get('type'),'article');
  for(const [key,value] of Object.entries(smallRect))assert.equal(url.searchParams.get(key),String(value));
  return Response.json({ocr:'Synthetic article text'});
 }));
 assert.equal((await c.ocr('123',{articleId:articleUuid,type:'marriage'})).text,'Synthetic article text');assert.equal(calls.length,3);
 assert.throws(()=>c.ocr('123',{type:'birth'}),/requires an article ID/);
 await assert.rejects(c.ocr('123',{articleId:'999'}),{code:'not-found'});
});
test('clipping search scopes private results to the verified account and handles cursor termination',async()=>{
 assert.throws(()=>clippingQuery({mine:true,user:'another-user'}));assert.throws(()=>clippingQuery({mine:'yes' as any}));
 assert.throws(()=>clippingQuery({from:'1900-01-01'}));assert.throws(()=>clippingQuery({limit:0}));
 const query=clippingQuery({keyword:'Reader',tag:'surname',publicationId:'99',sort:'date-asc',cursor:'opaque+/='});
 assert.equal(query.visibility,'public');assert.equal(query.sort,'paper-date-asc');assert.equal(query.cursor_mark,'opaque+/=');assert.equal(query.title,'99');
 let cycle=false;const seen:URL[]=[];const c=new NewspapersClient(new NewspapersHttp(undefined,async value=>{
  const url=new URL(value);seen.push(url);if(url.pathname==='/account/')return new Response(accountHtml);
  assert.equal(url.searchParams.get('visibility'),'all');assert.equal(url.searchParams.get('user'),'123');
  return Response.json({clippings:[{clipping_id:456,page_token:'private'}],next_cursor_mark:cycle?'*':'next+/=',more_results:cycle});
 }));
 const result=await c.searchClippings({mine:true});assert.equal(result.nextCursor,null);assert.equal(seen.length,2);assert.ok(!JSON.stringify(result).includes('private'));
 cycle=true;await assert.rejects(c.searchClippings({mine:true}),{code:'api-changed'});
 const empty=new NewspapersClient(new NewspapersHttp(undefined,async()=>Response.json({clippings:[],next_cursor_mark:0,more_results:false})));
 assert.equal((await empty.searchClippings()).nextCursor,null);
 assert.throws(()=>clippingRecord({clipping_id:1,page_id:2,title:''},'3'),{code:'api-changed'});
});
test('article and clipping downloads retain crop provenance and never fetch images without Download permission',async()=>{
 const jpg=await sharp({create:{width:12,height:16,channels:3,background:'white'}}).jpeg().toBuffer();
 const clipping={clipping_id:456,page_id:123,title:'Synthetic clipping',rectangle:{...smallRect,width:4},rectangles:[{...smallRect,width:4},{...smallRect,x:10,width:4}],page_token:'private',ocr:'Synthetic text'};
 let allowed=true,images=0;const c=new NewspapersClient(new NewspapersHttp(undefined,async value=>{
  const url=new URL(value);
  if(url.pathname==='/article/api/456/')return Response.json(clipping);
  if(url.pathname.includes('/authorize'))return Response.json({...downloadAuthorization,rights:{Download:{allowed}}});
  if(url.pathname.endsWith('/articles'))return Response.json(indexedArticles());
  if(url.pathname==='/account/')return new Response(accountHtml);
  images++;assert.equal(url.origin,IMG);assert.equal(url.searchParams.get('iat'),downloadAuthorization.iat);
  if(url.searchParams.has('clippingId')){assert.equal(url.searchParams.get('clippingId'),'456');assert.ok(!url.searchParams.has('crop'));}
  else assert.equal(url.searchParams.get('crop'),'2_4_12_16');
  return new Response(new Uint8Array(jpg),{headers:{'content-type':'image/jpeg'}});
 }));
 const article=await c.downloadArticle('123',articleUuid);assert.equal(article.metadata.selection?.kind,'article');assert.deepEqual(article.bytes,jpg);
 const clip=await c.downloadClipping('456');assert.equal(clip.metadata.selection?.kind,'clipping');assert.deepEqual(clip.metadata.selection?.rectangle,smallRect);
 assert.equal(clip.metadata.selection?.rectangles.length,2);
 assert.ok(!JSON.stringify(clip.metadata).includes('private'));assert.equal(images,2);
 allowed=false;await assert.rejects(c.downloadArticle('123',articleUuid),{code:'access-denied'});await assert.rejects(c.downloadClipping('456'),{code:'access-denied'});assert.equal(images,2);
});
test('JPG export follows viewer sizing without enlarging small pages',()=>{
 assert.deepEqual(downloadDimensions(1000,2000),{width:1000,height:2000});
 assert.deepEqual(downloadDimensions(4000,4000),{width:3200,height:3200});
 assert.deepEqual(downloadDimensions(6000,8000),{width:3000,height:4000});
 assert.deepEqual(downloadDimensions(20000,20000),{width:8000,height:8000});
 for(const width of [0,-1,1.1,NaN,Infinity,100001])assert.throws(()=>downloadDimensions(width,100),{code:'api-changed'});
});
test('download preserves JPEG bytes, validates all pixels, and withholds signed image URLs',async()=>{
 const jpg=await sharp({create:{width:32,height:48,channels:3,background:'white'}}).jpeg().toBuffer();
 const result=await downloadClient(downloadAuthorization,jpg).download('123');
 assert.deepEqual(result.bytes,jpg);assert.equal(result.metadata.width,32);assert.equal(result.metadata.originalHeight,48);
 const metadata=JSON.stringify(result.metadata);assert.ok(!metadata.includes('synthetic-private'));assert.ok(!metadata.includes('img/img'));assert.match(result.metadata.sha256,/^[a-f0-9]{64}$/);
 const png=await sharp(jpg).png().toBuffer();
 const thumbnail=await sharp(jpg).resize(16,24).jpeg().toBuffer();
 for(const [bytes,type] of [[jpg,'text/html'],[Buffer.from('<html>synthetic-private</html>'),'image/jpeg'],[png,'image/jpeg'],[thumbnail,'image/jpeg'],[jpg.subarray(0,jpg.length-20),'image/jpeg']] as const){
  await assert.rejects(downloadClient(downloadAuthorization,bytes,type).download('123'),{code:'api-changed'});
 }
 const dir=await mkdtemp(join(tmpdir(),'fam-newspapers-download-'));
 try{
  const file=join(dir,'scan.jpg');const output=await saveDownload(file,result);
  assert.equal(output.saved,file);assert.deepEqual(await readFile(file),jpg);
  assert.deepEqual(JSON.parse(await readFile(output.sidecar,'utf8')),result.metadata);
  for(const path of [file,output.sidecar])assert.equal((await stat(path)).mode&0o777,0o600);
  await assert.rejects(saveDownload(file,result),{code:'EEXIST'});assert.deepEqual(await readFile(file),jpg);
  const conflict=join(dir,'conflict.jpg');await writeFile(conflict+'.json','preserve');
  await assert.rejects(saveDownload(conflict,result),{code:'EEXIST'});
  assert.equal(await readFile(conflict+'.json','utf8'),'preserve');await assert.rejects(stat(conflict),{code:'ENOENT'});
  assert.deepEqual((await readdir(dir)).sort(),['conflict.jpg.json','scan.jpg','scan.jpg.json']);
  const exact={...result,metadata:{...result.metadata,citation:{...result.metadata.citation,syntheticId:9007199254740997n}}};
  const exactOutput=await saveDownload(join(dir,'exact.jpg'),exact);
  assert.deepEqual(parseJson(await readFile(exactOutput.sidecar,'utf8')),exact.metadata);
 }finally{await rm(dir,{recursive:true,force:true});}
});
