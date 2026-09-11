import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Fold3Client,searchQuery} from '../src/fold3/client.js';
import {Fold3Http,Fold3Error,WEB} from '../src/fold3/http.js';
import {fileTranscript,searchTranscript,validateTranscript} from '../src/fold3/transcript.js';
import {rectangle} from '../src/fold3/entries.js';
import {runProvider} from '../src/fold3/cli.js';
import {resolveContext} from '../src/shared/command-search.js';
import {commandById} from '../src/shared/command-registry.js';
import {stringifyJson} from '../src/shared/json.js';
const response=(v:unknown)=>new Response(stringifyJson(v),{headers:{'content-type':'application/json'}});

test('advanced searches preserve date boundaries, exclusions, and typed military scopes',()=>{
  const q=searchQuery({name:'Test Ancestor',birthFrom:'1880',birthTo:'1886-02-28',excludeFilter:['place=England','place=France'],filter:['place=US'],excludeField:['military.rank=Captain'],excludeName:'Another Ancestor',unitId:'9007199254740997',regimentId:'123',commandersOf:'456',match:'expanded'});
  assert.equal(q.filters.find(f=>f.type==='date.vital.birth')!.values[0],'1880-01-01 - 1886-02-28');
  assert.deepEqual(q.filters.filter(f=>f.type==='place').map(f=>[f.exclude,f.values]),[[false,['US']],[true,['England','France']]]);
  assert.equal(q.fieldedKeywords.filter(f=>f.exclude).length,2);assert.equal(q.strictMode,'FALSE');
  assert.deepEqual(q.forwardConnection,{ct:'MILITARY_UNIT',id:'9007199254740997'});assert.equal(q.regimentConnections![0].id,'123');assert.equal(q.commanderConnections![0].id,'456');
  assert.equal(searchQuery({unitId:'123'}).strictMode,'ALL');
  for(const options of [{name:'Test',birthFrom:'1880'},{name:'Test',birthFrom:'1886',birthTo:'1880'},{name:'Test',from:'2023-02-29',to:'2024'},{name:'Test',birthFrom:'1880',birthTo:'1890',birthYear:1885},{name:'Test',match:'exact'},{excludeFilter:['place=US']},{unitId:'../123'},{name:'Test',excludeField:'wrong'}])assert.throws(()=>searchQuery(options as any));
});

function transcriptClient(failure?:Fold3Error){
  const cluster={i:'7.fixture',t:'Synthetic diary',s:'diary\tfixture',z:3},nodes=[0,1,2].map(i=>({i:String(i+123),c:cluster.i,t:`Page ${i+1}`,o:i}));
  const client=new Fold3Client(new Fold3Http(undefined,async()=>response({a:'123',n:nodes,c:[cluster]})));
  client.ocr=async(imageId:string)=>{if(imageId==='124')throw failure??new Fold3Error('ocr-unavailable');return {imageId,text:imageId==='123'?'First a.b match.\nNavy, NAVY.':'Navy in another page.',sourceUrl:`${WEB}/image/${imageId}`,note:'Synthetic OCR'};};
  return client;
}
test('file OCR keeps unavailable pages in order and does not hide authentication or transport failures',async()=>{
  const corpus=await fileTranscript(transcriptClient(),'123',3);assert.equal(corpus.complete,false);assert.deepEqual(corpus.pages.map(p=>p.status),['available','unavailable','available']);
  assert.equal((await fileTranscript(transcriptClient(new Fold3Error('access-denied')),'123')).pages[1].status,'access-denied');
  await assert.rejects(fileTranscript(transcriptClient(new Fold3Error('session-rejected')),'123'),{code:'session-rejected'});
  await assert.rejects(fileTranscript(transcriptClient(new Fold3Error('http',429)),'123'),{code:'http'});
  await assert.rejects(fileTranscript(transcriptClient(),'123',2),/exceeding/);
});
test('OCR search uses literal matching, page citations and stable pagination across missing pages',async()=>{
  const corpus=await fileTranscript(transcriptClient(),'123');
  const first=searchTranscript(corpus,'navy',2),next=searchTranscript(corpus,'navy',2,first.nextOffset!);
  assert.equal(first.matches.length,2);assert.equal(first.nextOffset,2);assert.equal(next.matches[0].page,3);assert.equal(next.nextOffset,null);assert.equal(first.incomplete,true);assert.equal(first.unavailablePages[0].page,2);
  assert.equal(searchTranscript(corpus,'a.b').matches.length,1);assert.equal(searchTranscript(corpus,'a.*b').matches.length,0);
  const match=first.matches[0];assert.match(match.sourceUrl,/\/image\/123$/);assert.equal(corpus.pages[0].text!.slice(match.start,match.start+match.length),'Navy');
  await assert.rejects(fileTranscript(Object.assign(transcriptClient(),{ocr:async()=>({text:'x'.repeat(16*1024*1024+1)})}),'123'),/16 MiB/);
});
test('cached transcripts reject altered inventories and rebuild source URLs without contacting Fold3',async()=>{
  const corpus=await fileTranscript(transcriptClient(),'123');
  const altered=structuredClone(corpus);altered.pages[0].sourceUrl='https://evil.test/?token=secret';altered.complete=true;
  const validated=validateTranscript(altered);assert.equal(validated.complete,false);assert.equal(validated.pages[0].sourceUrl,WEB+'/image/123');
  for(const edit of [(v:any)=>v.pages.pop(),(v:any)=>v.pages[1].ordinal=5,(v:any)=>v.pages[1].imageId=v.pages[0].imageId,(v:any)=>v.pages[1].text='invented']){const copy=structuredClone(corpus);edit(copy);assert.throws(()=>validateTranscript(copy));}
  const dir=await mkdtemp(join(tmpdir(),'fam-fold3-ocr-'));const open=Fold3Client.open;
  try{const path=join(dir,'transcript.json');await writeFile(path,stringifyJson(corpus));Fold3Client.open=async()=>{throw new Error('Unexpected credential or network access');};const result:any=await runProvider(['file-ocr-search','--input',path,'--keyword','navy']);assert.equal(result.matches.length,3);}
  finally{Fold3Client.open=open;await rm(dir,{recursive:true,force:true});}
});

const rect=Buffer.from([128,0,0,4,3]).toString('base64').replace(/=+$/,'');
const scan=(info?:unknown)=>({w:{id:{ct:'IMAGE',id:'123'}},d:{w:4,h:3,si:info},r:{p:{allowed:['VIEW'],denied:{}}}});
test('entry rectangles decode padded and unpadded data without inventing coordinates',()=>{
  assert.deepEqual(rectangle(rect),{x:0,y:0,width:4,height:3,rotation:0});assert.deepEqual(rectangle(rect+'='),rectangle(rect));
  for(const r of ['','!!','gA','gACAgICAgIA='])assert.throws(()=>rectangle(r),{code:'api-changed'});
});
test('entry listing tiles constrained indexes, deduplicates overlaps, and marks partial regions',async()=>{
  let windows=0;
  const client=new Fold3Client(new Fold3Http(undefined,async url=>{
    if(url.includes('/image/document/'))return response(scan({c:2,t:'SPATIAL',v:4}));windows++;
    return response({spatial:[{i:'9007199254740997',o:0,t:'Synthetic ancestor',r:rect},{i:'9007199254740998',o:1,t:'Synthetic sibling',r:rect}]});
  }));
  const list=await client.entries('123',{limit:1});assert.equal(windows,4);assert.equal(list.total,2);assert.equal(list.complete,true);assert.equal(list.nextOffset,1);assert.equal(list.items[0].entryId,'9007199254740997');
  const part=await client.entries('123',{x:0,y:0,width:2,height:2});assert.equal(part.complete,false);
  await assert.rejects(client.entries('123',{x:0}),/all of/);await assert.rejects(client.entries('123',{x:3,y:0,width:2,height:2}),/exceeds/);
});
test('entry and contribution reads retain fields and corrections while stripping tokens and account context',async()=>{
  const de=[{w:{id:{ct:'IMAGE_ANNOTATION',id:'annotation-1'},o:9,n:1},d:{t:'full-name',v:'Test Ancestor',r:rect}},{w:{id:{ct:'CORRECTION',id:'correction-1'},n:2},d:{f:'birth-date',v:'1880',token:'secret'}}];
  const client=new Fold3Client(new Fold3Http(undefined,async url=>response(url.includes('/sub-image/')?{w:{id:{ct:'SUB_IMAGE',id:'456'}},d:{i:'123',o:0,t:'Test',r:rect,m:[{n:'age',v:'40'}]},de,r:{p:{allowed:['VIEW'],denied:{}},o:{token:'secret'},users:[{password:'secret'}]}}:{...scan(),de})));
  const item=await client.entry('456');assert.equal(item.parentImageId,'123');assert.equal(item.metadata[0].value,'40');assert.equal(item.contributions[1].field,'birth-date');assert.equal(item.contributions[1].value,'1880');assert.doesNotMatch(stringifyJson(item),/secret|password/);
  assert.equal((await client.contributions('123')).items[0].annotationType,'full-name');
  const bad=new Fold3Client(new Fold3Http(undefined,async()=>response({w:{id:{ct:'SUB_IMAGE',id:'999'}},d:{}})));await assert.rejects(bad.entry('456'),{code:'api-changed'});
  const empty=new Fold3Client(new Fold3Http(undefined,async()=>response(scan())));assert.equal((await empty.entries('123')).total,0);
});
test('OCR and entry discovery expose the new commands and exact sub-image IDs',()=>{
  for(const command of ['fold3.file.ocr get','fold3.file.ocr search','fold3.entry get','fold3.image.entry list','fold3.image.contribution list'])assert.ok(commandById.has(command));
  assert.deepEqual(resolveContext(WEB+'/sub-image/9007199254740997/test').flags,{'entry-id':'9007199254740997'});
});
