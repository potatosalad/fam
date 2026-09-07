import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'graphql';
import { FindagraveClient, FindagraveGraphQLError } from '../src/findagrave/client.js';
import { authenticateFindagrave, sessionStatus, type FindagraveSession } from '../src/findagrave/auth.js';
import { contracts, graphqlOperation, validateDocument } from '../src/findagrave/catalog.js';
import { restOperations, prepareRest } from '../src/findagrave/rest.js';
import { checkUrl, FindagraveHttpError, IMAGES } from '../src/findagrave/http.js';
import { searchInput, memorialPhotos } from '../src/findagrave/research.js';
import { downloadPhoto } from '../src/findagrave/research.js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Impit } from 'impit';
import { loadFindagraveCredentials } from '../src/findagrave/auth.js';
import { FindagraveHttp, GRAPHQL } from '../src/findagrave/http.js';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../src/shared/storage.js';
import type { ApiRequest, ApiResponse } from '../src/familysearch/transport-types.js';

const session: FindagraveSession = {contributorId:'synthetic-contributor',token:'synthetic-token',savedAt:'2026-01-01T00:00:00Z',validatedAt:'2026-01-01T00:00:00Z'};
function mock(fn: (url:string, options:ApiRequest) => unknown | Promise<unknown>) {
  return {async exchange<T>(url:string|URL,options:ApiRequest={}):Promise<ApiResponse<T>> {return {data:await fn(String(url),options) as T,status:200,headers:{}};}};
}
test('Find a Grave every recovered GraphQL document parses and has a unique stable ID',()=>{
  assert.equal(contracts.graphql.length,32);
  assert.equal(new Set(contracts.graphql.map(o=>o.id)).size,32);
  for(const op of contracts.graphql) {assert.ok(parse(op.document));assert.equal(op.sha256,createHash('sha256').update(op.document).digest('hex'));}
  assert.equal(contracts.models.length,270);
  assert.equal(contracts.httpCallSites.length,47);
  assert.ok(contracts.enums.find(e=>e.name==='MemorialSearchYearFilter')?.values.includes('exact'));
});
test('Find a Grave duplicate operation names require explicit aliases or IDs',()=>{
  assert.throws(()=>graphqlOperation('FindMemorial'),/Ambiguous/);
  assert.throws(()=>graphqlOperation('Authenticate'),/Ambiguous/);
  assert.match(graphqlOperation('memorial').document,/relationships/);
  assert.match(graphqlOperation('memorial.edits').document,/edits/);
});
test('Find a Grave GraphQL required variables and scalar/list types are checked',()=>{
  const op=graphqlOperation('memorial');
  assert.throws(()=>validateDocument(op.document,{}),/ids/);
  assert.throws(()=>validateDocument(op.document,{ids:'12'}),/ids/);
  assert.throws(()=>validateDocument(op.document,{ids:['12'],extra:true}),/Unknown/);
  assert.equal(validateDocument(op.document,{ids:['12']}),'FindMemorial');
});
test('Find a Grave search uses serializer wire enums and zero-based offsets',()=>{
  const input=searchInput({firstName:'Ada',lastName:'Example',birthYear:'1815',yearRange:'2',sort:'birth',descending:true,size:5,from:10,exact:true});
  assert.equal(input.birthYearFilter,'exact');assert.equal(input.birthYearRange,2);assert.equal(input.orderBy,'BIRTH_DESC');assert.equal(input.from,10);
  assert.deepEqual(searchInput({input:{lastName:'Example',size:7,from:14}}),{lastName:'Example',size:7,from:14});
  assert.throws(()=>searchInput({}),/Provide/);
  assert.throws(()=>searchInput({lastName:'Example',yearRange:'2'}),/requires/);
  assert.throws(()=>searchInput({lastName:'Example',size:-2}),/integer/);
  assert.throws(()=>searchInput({lastName:'Example',sort:'relevance',descending:true}),/descending/);
});
test('Find a Grave research search preserves keyword syntax and combines family filters',()=>{
  const input=searchInput({lastName:'Example',bio:'"born in Ireland" OR Dublin',relative:'Mary',includeMaidenName:true,includeNickname:true,
    similar:true,plot:'Section 3',deathYear:'1900',deathFilter:'before',size:4,from:8});
  assert.equal(input.bio,'"born in Ireland" OR Dublin');assert.equal(input.linkedToName,'Mary');
  assert.equal(input.includeMaidenName,true);assert.equal(input.includeNickname,true);assert.equal(input.fuzzyNames,true);
  assert.equal(input.plot,'Section 3');assert.equal(input.deathYearFilter,'before');assert.equal(input.from,8);
  assert.equal(searchInput({lastName:'Example',birthFilter:'unknown'}).birthYearFilter,'unknown');
  assert.equal(searchInput({birthYear:'1850',input:{birthYearFilter:'after'}}).birthYearFilter,'after');
});
test('Find a Grave research search rejects conflicting or incomplete filters',()=>{
  for(const options of [{bio:''},{bio:' '},{bio:'x'.repeat(51)},{lastName:'Example',exact:true,similar:true},
    {lastName:'Example',birthFilter:'before'},{lastName:'Example',birthYear:'1850',birthFilter:'unknown'},
    {lastName:'Example',deathYear:'1900',deathFilter:'before',yearRange:'2'},{includeMaidenName:true},{includeNickname:true}]) {
    assert.throws(()=>searchInput(options));
  }
});
test('Find a Grave biography searches return source text through the existing GraphQL endpoint',async()=>{
  const biography={value:'Born in Dublin.',language:'en'};
  const client=new FindagraveClient(undefined,mock((url,o)=>{
    assert.equal(url,'https://www.findagrave.com/orc/graphql');
    const body=o.body as {query:string;variables:{input:Record<string,unknown>}};
    assert.ok(parse(body.query));assert.match(body.query,/bio\s*\{\s*value\s+language\s*\}/);
    assert.equal(body.variables.input.bio,'Dublin');assert.equal(body.variables.input.from,5);
    return {data:{memorialSearch:{total:6,memorials:[{id:'synthetic',bio:biography}]}}};
  }));
  assert.deepEqual(await client.search(searchInput({bio:'Dublin',from:5})),{memorialSearch:{total:6,memorials:[{id:'synthetic',bio:biography}]}});
});
test('Find a Grave every executable REST route binds path and body with its documented verb',()=>{
  for(const op of restOperations){
    const path=Object.fromEntries([...op.path.matchAll(/\{([^}]+)\}/g)].map(m=>[m[1]!, 'synthetic']));
    const request=prepareRest(op.name,{path,...(op.body?{body:{value:'synthetic'}}:{})});
    assert.equal(request.options.method,op.method);assert.ok(!request.url.includes('{'));
  }
});
test('Find a Grave explicitly identifies mutating GET routes',()=>{
  for(const name of ['request.claim','request.unclaim','request.delete','my-cemetery.add','my-cemetery.remove']) {
    const op=restOperations.find(o=>o.name===name)!;assert.equal(op.method,'GET');assert.equal(op.write,true);
  }
});
test('Find a Grave REST rejects missing/unexpected bindings before HTTP',()=>{
  assert.throws(()=>prepareRest('requests.cemetery'),/cemeteryId/);
  assert.throws(()=>prepareRest('cemetery.plots',{path:{cemeteryId:'..'}}),/invalid/);
  assert.throws(()=>prepareRest('requests.mine',{query:{fgmSeed:'secret'}}),/Unknown query/);
  assert.throws(()=>prepareRest('requests.mine',{body:{}}),/does not take/);
  assert.throws(()=>prepareRest('photo.update',{}),/requires body/);
  assert.match(prepareRest('cemetery.plots',{path:{cemeteryId:'a/b'}}).url,/a%2Fb/);
  const form=prepareRest('virtual-cemetery.toggle-memorial',{body:{memorialId:'a b',checked:true}});
  assert.equal(form.options.body,'memorialId=a+b&checked=true');
});
test('Find a Grave credentials attach only to the site, never image CDN',async()=>{
  const calls: {url:string;headers?:Record<string,string>}[]=[];
  const client=new FindagraveClient(session,mock((url,o)=>{calls.push({url,headers:o.headers});return {data:{signedInContributor:{id:session.contributorId}}};}));
  await client.me();await client.request(`${IMAGES}/photos/example.jpg`,{response:'binary'});
  assert.equal(calls[0]!.headers?.fgmSeed,session.token);assert.equal(calls[0]!.headers?.fgm,session.contributorId);
  assert.equal(calls[1]!.headers?.fgmSeed,undefined);assert.equal(calls[1]!.headers?.fgm,undefined);
  await assert.rejects(client.request('https://evil.example/',{}),/outside/);
  await assert.rejects(client.request('/orc/graphql',{headers:{FGMSEED:'override'}}),/managed/);
});
test('Find a Grave rejects external origins, ports and embedded URL credentials',()=>{
  for(const url of ['http://www.findagrave.com','https://www.findagrave.com.evil.test','https://user:pass@www.findagrave.com','https://www.findagrave.com:8443','https://images.findagrave.com/#token']) assert.throws(()=>checkUrl(new URL(url)),/outside/);
});
test('Find a Grave HTTP and GraphQL failures never trigger automatic login or replay',async()=>{
  for(const status of [401,403,429,500]){
    let calls=0;const client=new FindagraveClient(session,mock(()=>{calls++;throw new FindagraveHttpError(status,'/orc/graphql');}));
    await assert.rejects(client.graphql('VolunteerForCemetery',{ids:['example']}));assert.equal(calls,1);
  }
  const client=new FindagraveClient(session,mock(()=>({data:{},errors:[{message:'private response',extensions:{code:'FORBIDDEN'}}]})));
  await assert.rejects(client.me(),e=>e instanceof FindagraveGraphQLError && e.message.includes('FORBIDDEN') && !e.message.includes('private response'));
});
test('Find a Grave login sends mobile credentials and validates identity before saving',async()=>{
  let calls=0,saved:FindagraveSession|undefined;
  const http=mock((url,o)=>{
    calls++;const body=o.body as {operationName:string;variables:Record<string,unknown>};
    if(calls===1){assert.deepEqual(body.variables.credentials,{email:'example@example.test',password:'synthetic-password',remember:true,isMobile:true});return {data:{authenticate:{token:session.token,contributor:{id:session.contributorId}}}};}
    assert.equal(o.headers?.fgmSeed,session.token);return {data:{signedInContributor:{id:session.contributorId}}};
  });
  await authenticateFindagrave(http,{username:'example@example.test',password:'synthetic-password'},async s=>{saved=s;});
  assert.equal(calls,2);assert.equal(saved?.token,session.token);
  assert.ok(!JSON.stringify(sessionStatus(saved)).includes(session.token));
});
test('Find a Grave native login uses public credential storage; API commands require an explicit login',async()=>{
  let calls=0;
  const http=mock((_url,o)=>{
    calls++;
    const body=o.body as {operationName:string;variables:{credentials?:{email:string;password:string}}};
    if(body.operationName==='Authenticate'){
      assert.deepEqual(body.variables.credentials,{email:'public-fixture@example.invalid',password:' synthetic-public password ',remember:true,isMobile:true});
      return {data:{authenticate:{token:session.token,contributor:{id:session.contributorId}}}};
    }
    assert.equal(body.operationName,'SignedInContributor');
    return {data:{signedInContributor:{id:session.contributorId}}};
  });
  try{
    await assert.rejects(loadFindagraveCredentials(),/findagrave credentials/);
    await writePrivateJson('findagrave/login.json',{username:'public-fixture@example.invalid',password:' synthetic-public password '});
    await assert.rejects(FindagraveClient.open(),/No Find a Grave session/);
    assert.equal(calls,0);
    const saved=await authenticateFindagrave(http);
    const persisted=await readPrivateJson<FindagraveSession>('findagrave/session.json');
    assert.equal(persisted?.token,saved.token);assert.equal(persisted?.contributorId,saved.contributorId);
    assert.equal(persisted?.savedAt,saved.savedAt);assert.equal(persisted?.validatedAt,saved.validatedAt);
    assert.equal(calls,2);
    assert.equal((await FindagraveClient.open()).status().sessionSaved,true);
    assert.equal((await FindagraveClient.open(true)).status().sessionSaved,false);
    if(process.platform!=='win32')assert.equal((await stat(join(CREDENTIAL_DIR,'findagrave/session.json'))).mode&0o777,0o600);
  }finally{await rm(join(CREDENTIAL_DIR,'findagrave'),{recursive:true,force:true});}
});
test('Find a Grave transport strips CDN credentials, redacts errors and refuses redirects without replay',async()=>{
  const original=Impit.prototype.fetch;
  let calls=0;
  Impit.prototype.fetch=async function(url,init){
    calls++;assert.equal(init?.redirect,'manual');
    const headers=new Headers(init?.headers as HeadersInit);
    if(String(url).startsWith(IMAGES)){
      for(const name of ['fgm','fgmSeed','Authorization','Cookie','ak'])assert.equal(headers.get(name),null);
      return new Response('private CDN diagnostic',{status:403}) as never;
    }
    assert.equal(headers.get('fgmSeed'),'synthetic-token');
    return new Response('private redirect diagnostic',{status:302,headers:{location:'https://evil.example/', 'set-cookie':'FixtureCookie=synthetic-cookie; Secure; Path=/'}}) as never;
  };
  try{
    const http=new FindagraveHttp();
    const credentials={fgm:'synthetic-contributor',fgmSeed:'synthetic-token',Authorization:'synthetic-token',Cookie:'FixtureCookie=synthetic-cookie',ak:'synthetic-app-key'};
    await assert.rejects(http.exchange(`${GRAPHQL}?token=synthetic-query`,{headers:credentials}),e=>e instanceof FindagraveHttpError&&e.status===302&&!/private|synthetic/.test(e.message));
    await assert.rejects(http.exchange(`${IMAGES}/photos/example.jpg`,{headers:credentials}),e=>e instanceof FindagraveHttpError&&e.status===403&&!e.message.includes('private'));
    assert.equal(calls,2);
  }finally{Impit.prototype.fetch=original;}
});
test('Find a Grave failed login or mismatched profile leaves saved session untouched',async()=>{
  let saved=false,calls=0;
  const http=mock(()=>{calls++;return calls===1?{data:{authenticate:{token:'synthetic',contributor:{id:'a'}}}}:{data:{signedInContributor:{id:'b'}}};});
  await assert.rejects(authenticateFindagrave(http,{username:'example',password:'synthetic'},async()=>{saved=true;}),/validation failed/);
  assert.equal(saved,false);assert.equal(calls,2);
  calls=0;
  await assert.rejects(authenticateFindagrave(mock(()=>{calls++;return {data:{authenticate:{result:'locked'}}};}),{username:'example',password:'synthetic'},async()=>{saved=true;}),/not retried/);
  assert.equal(saved,false);assert.equal(calls,1);
});
test('Find a Grave generic queries cannot print authentication tokens, including aliased fields',async()=>{
  let calls=0;const client=new FindagraveClient(session,mock(()=>{calls++;return {};}));
  await assert.rejects(client.graphql('auth.password',{credentials:{email:'example',password:'synthetic'}}),/managed/);
  await assert.rejects(client.query('mutation X { alias: authenticate(credentials: {email: "example",password: "synthetic"}) { token } }'),/managed/);
  assert.equal(calls,0);
});
test('Find a Grave photo paging uses returned identity and actual from/size arguments',async()=>{
  const client=new FindagraveClient(undefined,mock((url,o)=>{
    const body=o.body as {query:string;variables:Record<string,unknown>};
    assert.match(body.query,/photos\(from: \$photoFrom, size: \$photoSize\)/);
    assert.equal(body.variables.photoFrom,20);assert.equal(body.variables.photoSize,10);
    return {data:{memorialsById:[{id:'example',photos:{total:31,photos:[{id:'photo',path:'https://images.findagrave.com/photos/example.jpg'}]}}]}};
  }));
  const page=await memorialPhotos(client,'example',10,20);assert.equal(page.total,31);assert.equal(page.photos.length,1);
});
test('Find a Grave photo downloads validate pixels and retain attribution/checksum',async()=>{
  const bytes=new Uint8Array(await sharp({create:{width:12,height:8,channels:3,background:'#abcdef'}}).jpeg().toBuffer());
  const client=new FindagraveClient(session,mock((url,o)=>{
    if(url.startsWith(IMAGES)){
      assert.equal(o.headers?.fgmSeed,undefined);assert.equal(o.headers?.['User-Agent'],'Mozilla/5.0');
      assert.equal(o.headers?.Referer,'https://www.findagrave.com/memorial/example');assert.equal(o.headers?.Accept,'*/*');return bytes;
    }
    return {data:{memorialsById:[{id:'example',photos:{total:1,photos:[{id:'photo',path:`${IMAGES}/photos/synthetic.jpg`,caption:'Synthetic image',contributor:{id:'synthetic',publicName:'Example'}}]}}]}};
  }));
  const r=await downloadPhoto(client,'example','photo');
  assert.equal(r.metadata.width,12);assert.equal(r.metadata.height,8);assert.equal(r.metadata.caption,'Synthetic image');
  assert.equal(r.metadata.sha256,createHash('sha256').update(bytes).digest('hex'));
});
test('Find a Grave image transport strips credentials and rejects redirects and CDN errors',async t=>{
  let status=200,calls=0;
  t.mock.method(globalThis,'fetch',async (url:URL,options:RequestInit)=>{
    calls++;assert.equal(url.origin,IMAGES);assert.equal(options.redirect,'manual');
    const headers=new Headers(options.headers);
    for(const key of ['authorization','cookie','fgm','fgmSeed','ak'])assert.equal(headers.has(key),false);
    assert.equal(headers.get('user-agent'),'Mozilla/5.0');assert.equal(headers.get('referer'),'https://www.findagrave.com/memorial/311');
    return new Response(status===200?new Uint8Array([1,2,3]):'private error response',{status,headers:{location:'https://foreign.example/'}});
  });
  const http=new FindagraveHttp();
  http.jar.setCookieSync('session=synthetic; Domain=.findagrave.com; Secure','https://www.findagrave.com');
  const options:ApiRequest={response:'binary',headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.findagrave.com/memorial/311',
    Cookie:'synthetic',authorization:'synthetic',fgm:'synthetic',fgmSeed:'synthetic',ak:'synthetic'}};
  const r=await http.exchange<Uint8Array>(`${IMAGES}/photos/example.jpg`,options);
  assert.deepEqual([...r.data],[1,2,3]);
  for(const code of [302,403,429]){
    status=code;
    await assert.rejects(http.exchange(`${IMAGES}/photos/example.jpg`,options),e=>e instanceof FindagraveHttpError&&e.status===code&&!e.message.includes('private'));
  }
  assert.equal(calls,4);
});
test('Find a Grave photo downloads reject an unrelated photo or foreign image URL',async()=>{
  let transfers=0;
  const client=new FindagraveClient(session,mock((url)=>{
    if(!url.endsWith('/orc/graphql'))transfers++;
    return {data:{memorialsById:[{id:'example',photos:{total:1,photos:[{id:'photo',path:'https://evil.example/photo.jpg'}]}}]}};
  }));
  await assert.rejects(downloadPhoto(client,'example','unrelated'),/not found/);
  await assert.rejects(downloadPhoto(client,'example','photo'),/not a Find a Grave image/);
  assert.equal(transfers,0);
});
