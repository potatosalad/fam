import {beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AmericanAncestorsClient} from '../src/americanancestors/client.js';
import {searchQuery,searchFields,validateSearch,type SearchOptions} from '../src/americanancestors/search.js';
import {AmericanAncestorsHttp,WEB,APP} from '../src/americanancestors/http.js';
import {imageDetails,searchResults} from '../src/americanancestors/parse.js';
import {exportRecords,validateExport} from '../src/americanancestors/export.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {simulateDelays} from './simulated-time.js';
beforeEach(simulateDelays);
const response=(text:string)=>new Response(text,{headers:{'content-type':'text/html'}});
const schema=searchFields([{AttributeId:9007199254740993n,Name:'Generation',Type:'string'},{AttributeId:15,Name:'Article Title Only',Type:'boolean'}]);

test('family and collection fields encode the observed indexed query without losing IDs',()=>{
  const q=searchQuery({collection:'Example',family:[{relationship:'Father',firstName:'José',lastName:'Smith'},{relationship:'Mother',firstName:'Anne'}],fields:{Generation:'5','Article Title Only':true}},schema);
  assert.equal(q.get('fam1type'),'Father');assert.equal(q.get('fam2first'),'Anne');assert.equal(q.get('fam1first'),'José');assert.equal(q.get('[0].Id'),'9007199254740993');assert.equal(q.get('[0].Value'),'5');assert.equal(q.get('[1].Value'),'true');assert.equal(q.get('[0].AttType'),'Attribute');
  for(const fields of [{Unknown:'x'},{Generation:true},{'Article Title Only':false},{Generation:'5','9007199254740993':'6'}])assert.throws(()=>searchQuery({collection:'Example',fields},schema));
  for(const family of [[{relationship:'Child',firstName:'A'}],Array(4).fill({relationship:'Any',firstName:'A'}),[{relationship:'Spouse'}]])assert.throws(()=>validateSearch({collection:'Example',family} as SearchOptions));
  assert.throws(()=>validateSearch({lastName:'A',fields:{Generation:'5'}}));assert.throws(()=>validateSearch({lastName:'A',unexpected:'x'} as SearchOptions));
  const call=parseInvocation(['americanancestors.record','search','--collection','Example','--family','{"relationship":"Spouse","lastName":"Smith"}','--field','Generation=5','--field','Article Title Only=true']);assert.equal(call.args.filter(x=>x==='--field').length,2);
});
test('field definitions are fetched once per client; unknown fields never issue a search',async()=>{
  const paths:string[]=[];const c=new AmericanAncestorsClient(new AmericanAncestorsHttp(undefined,async url=>{
    paths.push(new URL(url).pathname);
    return response(JSON.stringify({attributes:[{AttributeId:1,Name:'Generation',Type:'string'}]}));
  }));
  for(let i=0;i<2;i++)await assert.rejects(c.search({collection:'Example',fields:{Bogus:'1'}}),/Unknown/);
  assert.deepEqual(paths,['/SearchResults/ExtendedDropdowns']);
});
test('journal title hits are records, not invented person names; ignored pages fail',()=>{
  const html='<input class="total-hits" value="1"><input class="index-page" value="1"><input class="page-size" value="50"><div id="tblSearchResult"><table><tbody><tr><td><a id="record-123" href="/DB1/r/123">Example Journal</a><div class="nameValueDiv">Journals</div></td><td><label class="labelDivStyle">TEXT</label><div class="valueDiv">Example article</div></td><td></td></tr></tbody></table></div>';
  const r=searchResults(html,searchQuery({collection:'Example Journal'})).items[0];assert.equal(r.kind,'record');assert.equal(r.name,null);assert.equal(r.collection,'Example Journal');assert.equal(r.category,'Journals');
  assert.throws(()=>searchResults(html,searchQuery({collection:'Example Journal',page:2})),/format changed/);
});
const viewer=(page:string,next?:string)=>`<input id="pages" value="${page}"><input id="hdnVolumeid" value="7"><input id="hdnCollectionID" value="1">${next?`<input id="hdnNextPageName" value="${next}"><input id="hdnNextPageRid" value="9007199254740993">`:''}<script>initImage('https://75.img.americanancestors.org/abcd.xml', jQuery.parseJSON('false'))</script><a id="download"></a>`;
test('browsing resolves the first page and follows provider labels; membership and page mismatches fail',async()=>{
  const requests:string[]=[];
  const c=new AmericanAncestorsClient(new AmericanAncestorsHttp(undefined,async url=>{
    requests.push(url);const u=new URL(url);
    if(u.pathname.endsWith('GetDatabseUrl'))return response('"1/example"');
    if(u.pathname.endsWith('ExtendedDropdowns'))return response('{"volumes":[{"VolumeId":7,"Name":"Example volume","SequenceId":1}],"attributes":[]}');
    if(u.pathname.endsWith('SearchTips'))return response('"Example tips"');
    if(u.pathname.endsWith('CollectionId'))return response('{"collection_id":1}');
    const p=u.searchParams.get('pageName');return response(p==='ii'?viewer('ii','1'):p==='1'?viewer('1'):viewer('i','ii'));
  }));
  const first=await c.browse('Example','7');assert.equal(first.pageName,'i');assert.match(first.nextUrl!,/pageName=ii/);assert.match(first.nextUrl!,/rId=9007199254740993/);
  const list=await c.pages(first.sourceUrl,2);assert.deepEqual(list.items.map(i=>i.pageName),['i','ii']);assert.equal(new URL(list.nextUrl!).searchParams.get('pageName'),'1');assert.equal(list.complete,false);
  await assert.rejects(c.browse('Example','8'),/does not belong/);await assert.rejects(c.browse('Example','7','missing'),/did not return/);
  const before=requests.length;await assert.rejects(c.pages(first.sourceUrl,101));assert.equal(requests.length,before);
});

type Page=Awaited<ReturnType<AmericanAncestorsClient['search']>>;
function fakeClient() {
  const reads:number[]=[], details:string[]=[];let failAt='',drift=false,wrongPage=false;
  return {reads,details,setFail:(id:string)=>{failAt=id;},setDrift:()=>{drift=true;},setWrongPage:()=>{wrongPage=true;},
    async search(o:SearchOptions):Promise<Page> {
      const page=o.page??1;reads.push(page);const all=['1','2','3','4','5'];if(drift)all.reverse();
      const q=searchQuery(o,schema);const items=all.slice((page-1)*2,page*2).map(id=>({collectionId:'1',recordId:id,kind:'person',name:'Example',title:null,category:null,collection:'Example',sourceUrl:`${WEB}/DB1/r/${id}`,imageUrl:null,events:'Example',fields:[],relationships:'',masked:false}));
      return {items,total:5,page:wrongPage?1:page,pageSize:2,nextPage:page<3?page+1:null,sourceUrl:`${WEB}/search/database-search?${q}`,nextUrl:null,accessNote:'Fixture'};
    },
    async record(url:string) {const id=url.split('/').at(-1)!;details.push(id);if(id===failAt)throw Error('Synthetic record access failure');return {sourceUrl:url,recordId:id,recordType:'Birth',fields:[{label:'Name',value:'Example'}],citation:'Example collection citation',descriptionAndSearchTips:'Example'};},
  };
}
test('bounded export resumes inside and across pages; failed detail lookup retains the precise checkpoint',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fam-aa-export-')),out=join(dir,'research.json'),c=fakeClient();
  const search:SearchOptions={collection:'Example',family:[{relationship:'Spouse',lastName:'Smith'}],fields:{Generation:'5'}};
  try {
    const one=await exportRecords(c,{out,search,details:true,limit:1});assert.equal(one.records,1);assert.equal(one.complete,false);
    const two=await exportRecords(c,{resume:out,limit:2});assert.equal(two.records,3);assert.equal(two.added,2);
    let saved=JSON.parse(await readFile(out,'utf8'));assert.equal(saved.checkpoint.page,2);assert.equal(saved.checkpoint.index,1);assert.deepEqual(saved.options,search);assert.equal((await stat(out)).mode&0o777,0o600);
    c.setFail('4');await assert.rejects(exportRecords(c,{resume:out,limit:10}),/Synthetic/);
    saved=JSON.parse(await readFile(out,'utf8'));assert.equal(saved.items.length,3);await assert.rejects(access(out+'.lock'));
    c.setFail('');const done=await exportRecords(c,{resume:out,limit:10});assert.equal(done.complete,true);assert.equal(done.records,5);
    saved=JSON.parse(await readFile(out,'utf8'));assert.deepEqual(saved.items.map((r:any)=>r.recordId),['1','2','3','4','5']);assert.ok(saved.items.every((r:any)=>r.details.citation));validateExport(saved);
    const n=c.reads.length;await exportRecords(c,{resume:out,limit:1});assert.equal(c.reads.length,n);
    assert.deepEqual(c.details,['1','2','3','4','4','5']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('exports reject drift, ignored pagination, conflicting resume options and existing outputs',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fam-aa-export-')),out=join(dir,'research.json'),c=fakeClient();
  try {
    await exportRecords(c,{out,search:{lastName:'Example'},limit:1});const original=await readFile(out,'utf8');
    await assert.rejects(exportRecords(c,{out,search:{lastName:'Example'},limit:1}));assert.equal(await readFile(out,'utf8'),original);
    await assert.rejects(exportRecords(c,{resume:out,search:{lastName:'Other'},limit:1}),/saved query/);
    c.setDrift();await assert.rejects(exportRecords(c,{resume:out,limit:1}),/changed/);assert.equal(await readFile(out,'utf8'),original);
    await writeFile(out+'.lock','fixture');await assert.rejects(exportRecords(c,{resume:out,limit:1}),/locked/);await rm(out+'.lock');
    const different=join(dir,'other.json'),d=fakeClient();await exportRecords(d,{out:different,search:{lastName:'Example'},limit:2});d.setWrongPage();await assert.rejects(exportRecords(d,{resume:different,limit:2}),/ignored/);assert.equal(JSON.parse(await readFile(different,'utf8')).items.length,2);
    await assert.rejects(exportRecords(c,{out:join(dir,'invalid.json'),search:{lastName:'Example',page:2},limit:1}));await assert.rejects(access(join(dir,'invalid.json')));
    for(const limit of [0,1001,NaN])await assert.rejects(exportRecords(c,{resume:out,limit}));
    assert.throws(()=>validateExport({schemaVersion:1,provider:'evil'}));
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('export completes honest empty results and rejects unexpected empty pages',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fam-aa-export-'));const c=fakeClient();
  const search=c.search.bind(c);c.search=async o=>({...await search(o),items:[],total:0,nextPage:null});
  try {const r=await exportRecords(c,{out:join(dir,'empty.json'),search:{lastName:'Example'},limit:1});assert.equal(r.complete,true);assert.equal(r.records,0);}
  finally{await rm(dir,{recursive:true,force:true});}
});
test('graceful interruption retains a resumable file and releases its writer lock',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fam-aa-export-')),out=join(dir,'interrupted.json'),c=fakeClient();const original=c.record.bind(c);
  let interrupt=true;
  c.record=async url=>{const r=await original(url);if(interrupt){interrupt=false;process.emit('SIGINT');}return r;};
  try {
    await assert.rejects(exportRecords(c,{out,search:{lastName:'Example'},details:true,limit:1}),/interrupted/);
    const saved=JSON.parse(await readFile(out,'utf8'));assert.equal(saved.items.length,0);validateExport(saved);await assert.rejects(access(out+'.lock'));
    assert.equal((await exportRecords(c,{resume:out,limit:1})).records,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('inconsistent page counts and edited checkpoint prefixes cannot skip records',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fam-aa-export-')),out=join(dir,'research.json'),c=fakeClient();
  try {
    await exportRecords(c,{out,search:{lastName:'Example'},limit:1});const state=JSON.parse(await readFile(out,'utf8'));state.items[0].recordId='999';await writeFile(out,JSON.stringify(state));
    await assert.rejects(exportRecords(c,{resume:out,limit:2}),/changed/);
    const d=fakeClient(),search=d.search.bind(d);d.search=async o=>({...await search(o),items:[]});
    await assert.rejects(exportRecords(d,{out:join(dir,'short.json'),search:{lastName:'Example'},limit:1}),/inconsistent/);
    assert.equal(JSON.parse(await readFile(join(dir,'short.json'),'utf8')).items.length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
