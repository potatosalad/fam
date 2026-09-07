import test from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {parse} from 'graphql';
import {execFileSync} from 'node:child_process';
import {pageJson} from '../src/myheritage/page-data.js';
import {buildRecordSearch, MyHeritageResearch, parseRecordPage, recordUrl} from '../src/myheritage/research.js';
import {historicalRecordsQuery, collectionCatalogQuery, collectionPageQuery} from '../src/myheritage/research-queries.js';
import {MyHeritageHttpError} from '../src/myheritage/http.js';
import type {ApiRequest, ApiResponse} from '../src/familysearch/transport-types.js';
import type {MyHeritageSession} from '../src/myheritage/auth.js';

const context = {user:{isLoggedIn:true,siteId:'SITE',guestId:'GUEST'},fgToken:'fresh-research-token',lang:'EN'};
const page = `var clientData = JSON.parse('${JSON.stringify(context).replaceAll('"','\\"')}'); var mhXsrfToken = "csrf-fixture";`;
const recordHtml = `<script>window.recordData = {"collectionId":"101","itemId":"202","groupId":""};</script>
<title>Fixture record</title><table><tr class="recordFieldsRow" data-field-id="NAME"><td class="recordFieldLabel">Name</td><td class="recordFieldValue">Anne &amp; Marie<script>throw new Error('not data')</script></td></tr>
<tr class="recordFieldsRow"><td class="recordFieldLabel">Birth</td><td class="recordFieldValue"><span>1880</span><div>New York</div><a href="javascript:alert(1)">map</a><a href="/research/record-101-203/person">relative</a></td></tr></table>`;
function fixture(send: (url: string, request: ApiRequest) => Promise<{data: any; status?: number}>) {
  const jar = new CookieJar(); jar.setCookieSync('PHPSESSID=fixture-session; Path=/; Secure','https://www.myheritage.com');
  const session: MyHeritageSession = {accessToken:'old-token',mode:'browser',browser:{pageUrl:'https://www.myheritage.com/family-trees/fixture/SITE',userAgent:'fixture-browser'},deviceId:'fixture-device',savedAt:'',cookies:jar.serializeSync()};
  let saved = 0;
  const client = new MyHeritageResearch(session,{jar,exchange:async<T>(url: string|URL, request: ApiRequest = {}): Promise<ApiResponse<T>> => {
    const result = await send(String(url),request); return {status:result.status??200,data:result.data,headers:{}};
  }},async()=>{saved++;});
  return {client,session,saves:()=>saved};
}
test('page JSON handles escaped JavaScript strings without evaluating expressions',()=>{
  assert.deepEqual(pageJson(page,'clientData'),context);
  assert.deepEqual(pageJson('var recordData = {"itemId":9223372036854775807};','recordData'),{itemId:9223372036854775807n});
  assert.equal(pageJson('var data = JSON.parse(\'"O\\\'Neill \\u263a"\');','data'),"O'Neill ☺");
  assert.throws(()=>pageJson('var data = JSON.parse(fetch("https://evil.example"));','data'),/encoding/);
  assert.throws(()=>pageJson('var data = JSON.parse(\'{}\' + steal());','data'),/expression/);
  assert.throws(()=>pageJson('var data = (() => steal())();','data'));
});
test('research documents remain valid with quoted inputs and preserve full record selections',()=>{
  for(const document of [historicalRecordsQuery('EN',20),historicalRecordsQuery('EN',20,'cursor"value'),collectionCatalogQuery('EN','SITE','(query: "census\\\" archives")',20,5),collectionPageQuery]) assert.doesNotThrow(()=>parse(document));
});
test('record filters encode names, punctuation, date ranges and relative pointers independently',()=>{
  const q=buildRecordSearch({firstName:'Anne Marie',lastName:'Q.-Smith',exact:true,events:[{type:'birth',year:1880,yearRange:2},{type:'residence',place:'New York'}],relatives:[{type:'father',firstName:'John'}]});
  assert.equal(q.recordType,'historical');
  assert.match(q.webQuery.find(x=>x.key==='qname')!.value,/fn.Anne\/3Marie/);
  assert.match(q.webQuery.find(x=>x.key==='qname')!.value,/ln.Q\/2\/1Smith/);
  assert.match(q.webQuery.find(x=>x.key==='qevents-event1')!.value,/ey.1880 me.true mer.2/);
  assert.match(q.webQuery.find(x=>x.key==='qevents-any/1event_1')!.value,/et.livedin/);
  const pointer=q.webQuery.find(x=>x.key==='qrelatives-relative')!.value.match(/rn\.\*(\S+)/)![1];
  assert(q.webQuery.some(x=>x.key===pointer&&x.value.startsWith('Name ')));
});
test('invalid and misspelled research filters fail before network',async()=>{
  const {client}=fixture(async()=>{throw new Error('Network must not run');});
  for(const options of [{},{firstName:'A',collection:'1',category:'2'},{firstName:'A',limit:101},{firstName:'A',offset:-1},{firstName:'A',typo:true},{events:[{type:'birth',year:0}]},{relatives:[{type:'mother'}]}]) await assert.rejects(client.search(options as never));
  assert.throws(()=>recordUrl('https://evil.example/research/record-1-2/name'));
  assert.throws(()=>recordUrl('https://www.myheritage.com/FP/API/Mobile/login.php'));
  assert.throws(()=>recordUrl('record-1-2'),/link URL/);
});
test('record search uses saved session, server-side scope, variables and explicit pagination',async()=>{
  let contexts=0;
  const f=fixture(async(url,req)=>{
    if(url.endsWith('/research')){contexts++;return{data:page};}
    assert.equal(url,'https://www.myheritage.com/web-family-graphql/search_in_historical_records/');
    assert.equal(req.headers?.Authorization,undefined);assert.equal(req.method,'POST');
    const form=new URLSearchParams(String(req.body)), vars=JSON.parse(form.get('variables')!).query;
    assert.equal(form.get('bearer_token'),'fresh-research-token');assert.equal(form.get('mhc#PHPSESSID'),'fixture-session');
    assert.equal(vars.request.additional_options.hierarchy_context,'collection-101');assert.equal(vars.request.additional_options.record_type_filter,undefined);
    assert.equal(vars.offset,20);assert.equal(vars.offer_free_trial,false);
    return{status:230,data:{data:{search_query_upload:{response:{summary:{},results:{count:100,data:[{record:{id:'record-101-202',name:'Anne',collection:{id:'collection-101'}},record_type:'record',cursor:'21',user_info:{is_purchased:false}}]}}}}}};
  });
  const r=await f.client.search({firstName:'Anne',collection:'101',offset:20,limit:20});
  assert.equal(r.nextOffset,40);assert.equal(r.returned,1);assert.equal(r.data[0].user_info.is_purchased,false);assert.equal(r.serviceStatus,230);assert.match(r.notice!,/230/);
  assert.equal(contexts,1);assert.equal(f.session.accessToken,'fresh-research-token');assert.equal(f.saves(),2);
});
test('expired research sessions and API challenges stop without password retries',async()=>{
  let calls=0;
  const expired=fixture(async()=>{calls++;return{data:page.replace('isLoggedIn\\":true','isLoggedIn\\":false')};});
  await assert.rejects(expired.client.search({lastName:'Smith'}),/signed-in/);assert.equal(calls,1);
  const challenge=fixture(async url=>{if(url.endsWith('/research'))return{data:page};throw new MyHeritageHttpError(406,url);});
  await assert.rejects(challenge.client.search({lastName:'Smith'}),/406/);
});
test('record pages extract readable fields and safe links without script text',()=>{
  const r=parseRecordPage(recordHtml,'https://www.myheritage.com/research/record-101-202/anne');
  assert.equal(r.id,'record-101-202');assert.equal(r.title,'Anne & Marie');assert(!JSON.stringify(r).includes('throw new'));
  assert.equal(r.fields[1]!.links.length,1);assert.match(r.fields[1]!.links[0]!.url,/record-101-203/);
  assert.throws(()=>parseRecordPage('<html>Sign in</html>','https://www.myheritage.com'),/unavailable/);
});
test('record fields remain available when an optional citation is denied',async()=>{
  const f=fixture(async url=>{
    if(url.endsWith('/research'))return{data:page};
    if(url.includes('/research/record-'))return{data:recordHtml};
    throw new MyHeritageHttpError(403,url);
  });
  const r=await f.client.record('https://www.myheritage.com/research/record-101-202/anne');
  assert.equal(r.fields.length,2);assert.equal(r.citations.length,0);assert.equal(r.warnings[0]!.operation,'citation');
});
test('catalog filters remain scoped in the authenticated website query',async()=>{
  const f=fixture(async(url,req)=>{
    if(url.endsWith('/research'))return{data:page};
    assert(url.endsWith('/collection_catalog/'));
    const q=JSON.parse(new URLSearchParams(String(req.body)).get('query')!);
    assert.match(q,/category:"searchcategory-1000"/);assert.match(q,/only_with_images:true/);assert.match(q,/offset:5,limit:5/);
    return{data:{data:{search:{catalog:{summary:{},collections:{count:12,data:[]}}}}}};
  });
  const r=await f.client.catalog({category:'1000',images:true,offset:5,limit:5});assert.equal(r.count,12);
});
test('CLI exposes record search and rejects invalid research flags before authentication',()=>{
  const cli=['--import','tsx','src/cli.ts', 'myheritage'];
  const help=execFileSync(process.execPath,[...cli,'--help'],{encoding:'utf8'});assert.match(help,/search \[JSON_OR_FILE\]/);assert.match(help,/--birth-year/);
  for(const args of [['search','--birth-year','oops'],['person','123','--first-name','A'],['search','{"lastName":"Smith","unexpected":true}']]) assert.throws(()=>execFileSync(process.execPath,[...cli,...args],{stdio:'pipe'}));
});

test('record type filters cannot override a collection or category silently',async()=>{
  assert.equal(buildRecordSearch({firstName:'Anne',collection:'101'}).recordType,'all');
  for (const scope of [{collection:'101'},{category:'1000'}]) assert.throws(()=>buildRecordSearch({firstName:'Anne',...scope,recordType:'historical'}),/discards the scope/);
  const f=fixture(async url=>url.endsWith('/research')?{data:page}:{data:{data:{search_query_upload:{response:{results:{count:1,data:[{record:{id:'wrong',collection:{id:'collection-999'}}}]}}}}}});
  await assert.rejects(f.client.search({firstName:'Anne',collection:'101'}),/outside the requested collection/);
});
