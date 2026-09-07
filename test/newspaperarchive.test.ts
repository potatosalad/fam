import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NewspaperArchiveClient, searchQuery, sourceUrl, operations } from '../src/newspaperarchive/client.js';
import { NewspaperArchiveHttp, NewspaperArchiveError, WEB } from '../src/newspaperarchive/http.js';
import { pageDetails } from '../src/newspaperarchive/parse.js';
import { sessionStatus } from '../src/newspaperarchive/auth.js';
import { runProvider } from '../src/newspaperarchive/cli.js';
import { loadLoginCredentials, configureCredentials, inspectLoginCredentials } from '../src/shared/credentials.js';
import { CREDENTIAL_DIR, writePrivateJson } from '../src/shared/storage.js';
import { StoriedClient, type CallInput } from '../src/storied/client.js';
import { StoriedHttp } from '../src/storied/http.js';
import { operation } from '../src/storied/catalog.js';
import { parseInvocation } from '../src/shared/command-runtime.js';
import { resolveContext } from '../src/shared/command-search.js';
import { doctorProvider } from '../src/newspaperarchive/doctor.js';

const url = `${WEB}/fixture-gazette-apr-15-1865-p-3/`;
const html = '<title>Fixture Gazette, Apr 15, 1865, p. 3</title><meta itemprop="publisher" content="Fixture Gazette"><meta property="article:published_time" content="1865-04-15"><input id="hdnImageId" value="123"><input id="hdnCurrentPage" value="3"><div class="ocr-txt">Ada &amp; William married. <script>private-script</script></div>';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
function fake(call: (name: string, input?: CallInput) => Promise<unknown>) {return {call, me: async () => ({sub: 'fixture'}), refresh: async () => {}};}

test('name, keyword, date and location filters use the NewspaperArchive native contract', () => {
  const query = searchQuery({firstName: ' Ada ', lastName: "O'Neil & Co", keyword: 'birth marriage', phrase: 'Ada O’Neil', anyWords: 'wedding obituary', excludeWords: 'advertisement',
    countryId: '7', stateId: '37', cityId: '5196', publicationId: '123', from: '1865-04-14', to: '1865-04-16', page: 2, limit: 10});
  assert.deepEqual(query, {PN:2,PS:10,FN:'Ada',LN:"O'Neil & Co",'K.AL':'birth marriage','K.EX':'Ada O’Neil','K.AN':'wedding obituary','K.WO':'advertisement',
    'L.CU':'7','L.ST':'37','L.CI':'5196','L.PID':'123','DT.DFT':'between','DT.Y':'1865','DT.M':'4','DT.D':'14','DT.EY':'1865','DT.EM':'4','DT.ED':'16'});
  for (const options of [{}, {lastName:'Smith',from:'1900-01-01'}, {lastName:'Smith',from:'1900-02-30',to:'1901-01-01'},
    {lastName:'Smith',from:'1901-01-01',to:'1900-01-01'}, {lastName:'Smith',countryId:'../x'}, {lastName:'Smith',limit:3}, {lastName:'Smith',limit:0}, {lastName:'Smith',limit:101}, {lastName:'Smith',page:1.5}]) assert.throws(() => searchQuery(options));
});

test('search preserves snippets and masking and returns honest single-page continuation', async () => {
  let calls = 0;
  const record = {imageId:123,publicationTitle:'Fixture Gazette',description:'<b>Ada</b> married',isMasked:true};
  const client = new NewspaperArchiveClient(fake(async (name, input) => {
    calls++; assert.equal(name, operations.search); assert.equal(input?.query?.PN, 2);
    return {data:{resultCount:25,searchResults:[record]},error:null};
  }));
  const results = await client.search({lastName:'Smith',page:2,limit:10});
  assert.deepEqual(results.searchResults, [{...record,sourceUrl:null}]); assert.equal(results.nextPage,3); assert.equal(results.limit,10); assert.equal(calls,1);
  const empty = new NewspaperArchiveClient(fake(async () => ({data:{resultCount:0,searchResults:null}})));
  assert.deepEqual((await empty.search({keyword:'fixture'})).searchResults,[]);
  assert.equal((await empty.search({keyword:'fixture'})).nextPage,null);
  for (const response of [{data:{resultCount:5,searchResults:null}}, {data:null,error:{message:'fixture-secret'}}, {}]) {
    await assert.rejects(new NewspaperArchiveClient(fake(async () => response)).search({keyword:'fixture'}), e => {
      assert.ok(e instanceof NewspaperArchiveError); assert.doesNotMatch(e.message,/fixture-secret/); return true;
    });
  }
});

test('catalog permits only selected reads, validates native fields, and excludes cache reloads and mutations', async () => {
  let calls = 0;
  const client = new NewspaperArchiveClient(fake(async () => {calls++; return null;}));
  for (const op of Object.values(operations)) {assert.equal(operation(op).method,'GET'); assert.doesNotMatch(op,/reload|ImageView/);}
  for (const op of ['GET /api/NewsPaperSearch/reloadcountries','PUT /api/Persons/newspaper-matches/dismiss','GET /api/Users/trees','https://evil.example']) assert.throws(() => client.call(op),/Unknown/);
  assert.equal(calls,0);
  const native = new NewspaperArchiveClient(new StoriedClient(undefined,new StoriedHttp(async()=>{calls++;return json({data:[]});})));
  await assert.rejects(native.call('countries',{query:{arbitrary:'value'}}),/Unknown/);
  await assert.rejects(native.call('countries',{body:{}}),/no request body/);
  assert.equal(calls,0);
});

test('API reads reuse Storied renewal once and save rotation before the retry', async () => {
  const paths: string[] = []; let saved = false;
  const native = new StoriedClient({accessToken:'fixture-old',refreshToken:'fixture-refresh',sessionId:'12345678-1234-1234-1234-123456789012',subject:'fixture',expiresAt:Date.now()+3600000,savedAt:'2026-01-01'}, new StoriedHttp(async (url) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path === '/oauth/token') return json({access_token:'fixture-new',token_type:'Bearer',expires_in:3600});
    if (paths.length === 1) return json({},401);
    assert.equal(saved,true); return json({data:[]});
  }), async () => {saved=true;});
  await new NewspaperArchiveClient(native).locations();
  assert.deepEqual(paths,['/api/v2/NewsPaperSearch/countries','/oauth/token','/api/v2/NewsPaperSearch/countries']);
});

test('NewspaperArchive uses the Storied environment, helper key and saved login, with no duplicate session', async () => {
  try {
    process.env.STORIED_USERNAME='fixture-user'; process.env.STORIED_PASSWORD=' secret with whitespace ';
    assert.equal(await inspectLoginCredentials('newspaperarchive'),'environment');
    assert.deepEqual(await loadLoginCredentials('newspaperarchive'),{username:'fixture-user',password:' secret with whitespace '});
    await configureCredentials('newspaperarchive');
    assert.equal(JSON.parse(await readFile(join(CREDENTIAL_DIR,'storied/login.json'),'utf8')).username,'fixture-user');
    assert.equal((await stat(join(CREDENTIAL_DIR,'storied/login.json'))).mode & 0o777,0o600);
    delete process.env.STORIED_PASSWORD;
    await assert.rejects(loadLoginCredentials('newspaperarchive'),/Set both STORIED/);
    delete process.env.STORIED_USERNAME;
    process.env.FAM_CREDENTIALS_COMMAND=JSON.stringify([process.execPath,'-e','process.stdout.write(JSON.stringify({username:process.argv[1],password:"fixture"}))']);
    assert.equal((await loadLoginCredentials('newspaperarchive')).username,'storied');
    delete process.env.FAM_CREDENTIALS_COMMAND;
    assert.equal((await loadLoginCredentials('newspaperarchive')).username,'fixture-user');
    assert.equal(doctorProvider.sessionFile,'storied/session.json');
    assert.equal(sessionStatus().sessionProvider,'storied');
  } finally {
    delete process.env.STORIED_USERNAME; delete process.env.STORIED_PASSWORD; delete process.env.FAM_CREDENTIALS_COMMAND;
    await rm(join(CREDENTIAL_DIR,'storied/login.json'),{force:true});
  }
});

test('locations and calendars retain numeric IDs and validate scope and dates before requesting', async () => {
  const calls: {name:string;input?:CallInput}[]=[];
  const client = new NewspaperArchiveClient(fake(async (name,input)=>{calls.push({name,input});return {data:[]};}));
  await client.locations({stateId:'37',cityId:'5196'});
  assert.deepEqual(calls[0],{name:operations.publications,input:{path:{stateId:37,cityId:5196}}});
  await client.dates('123','1900','04');
  assert.deepEqual(calls[1].input,{path:{pubId:123,year:'1900',month:'4'}});
  await assert.rejects(client.locations({cityId:'5196'}),/requires/);
  await assert.rejects(client.dates('123',undefined,'4'),/requires/);
  await assert.rejects(client.dates('123','1900','13'),/Month/);
  assert.equal(calls.length,2);
});

test('OCR service errors are not successful empty transcripts; public OCR includes a citation', async () => {
  assert.equal(sourceUrl({thumbnailUrl:`${WEB}/un/fixture/city/fixture-gazette/1865/04-15/123-thumbnail.jpg`,pageNumber:3}),url);
  assert.equal(sourceUrl({thumbnailUrl:'https://evil.example/fixture/1865/04-15/123-thumbnail.jpg',pageNumber:3}),null);
  const failed = new NewspaperArchiveClient(fake(async()=>({data:{succeeded:false,text:'',errorMessage:'secret remote details'}})));
  await assert.rejects(failed.ocr('123'),e=>{assert.doesNotMatch((e as Error).message,/secret remote/);return true;});
  const ok = new NewspaperArchiveClient(fake(async()=>({data:{succeeded:true,text:'Ada married William.'}})));
  assert.equal((await ok.ocr('123','1')).text,'Ada married William.');
  const page = pageDetails(html,url);
  assert.equal(page.ocr,'Ada & William married.'); assert.equal(page.imageId,'123');
  assert.match(page.citation,/Fixture Gazette, 1865-04-15, p. 3/);
  assert.equal(pageDetails(html.replace(/<div class="ocr-txt">.*<\/div>/,''),url).ocrAvailable,false);
  assert.throws(()=>pageDetails('<h1>Unexpected login page</h1>',url),/format changed/);
});

test('public page transport sends no account credentials and blocks foreign redirects, oversized responses and challenges', async () => {
  let calls=0;
  const http = new NewspaperArchiveHttp(async (request,init)=>{calls++;assert.equal(new URL(request).origin,WEB);assert.deepEqual(init.headers,{});assert.equal(init.redirect,'manual');return new Response(html);});
  for(const value of ['https://evil.example/a','http://newspaperarchive.com/a',`${WEB}/a#token`,'https://user:pass@newspaperarchive.com/a']) await assert.rejects(http.text(value));
  assert.equal(calls,0);assert.equal((await http.text(url)).text,html);
  const redirect = new NewspaperArchiveHttp(async()=>new Response('',{status:302,headers:{location:'https://evil.example/private'}}));
  await assert.rejects(redirect.text(url),/outside/);
  for(const response of [new Response('Just a moment... fixture-secret',{status:403}),new Response('fixture-secret',{status:500}),new Response('',{headers:{'content-length':String(21*1024*1024)}})]) {
    await assert.rejects(new NewspaperArchiveHttp(async()=>response).text(url),e=>{assert.doesNotMatch((e as Error).message,/fixture-secret/);return true;});
  }
});

test('CLI discovery uses named flags, resolves page URLs, and writes private offline status', async () => {
  assert.equal(parseInvocation(['newspaperarchive.newspaper','search','--last-name','Smith','--limit','10']).command.provider,'newspaperarchive');
  assert.deepEqual(resolveContext(url).flags,{url});
  const out=join(CREDENTIAL_DIR,'newspaper-status.json');
  assert.deepEqual(await runProvider(['status','--out',out]),{saved:out});
  const status=JSON.parse(await readFile(out,'utf8'));
  assert.equal(status.sessionProvider,'storied');assert.equal(status.credentialDirectory,CREDENTIAL_DIR);
  assert.equal((await stat(out)).mode & 0o777,0o600);
  await writePrivateJson('storied/session.json',{accessToken:'fixture-secret'});
  assert.doesNotMatch(JSON.stringify(await runProvider(['status'])),/fixture-secret/);
});
