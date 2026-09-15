import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {prepareApiInput} from '../src/familysearch/api-input.js';
import {prepareOperation} from '../src/familysearch/operations.js';
import {imageReference, resolveImageReference} from '../src/fold3/image-reference.js';
import {Fold3Client} from '../src/fold3/client.js';
import {Fold3Http, IMG} from '../src/fold3/http.js';
import {downloadImage} from '../src/fold3/download.js';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';

test('FamilySearch normalizes only exact numeric IDs and search years', async () => {
  const input = {pid: 340, body: {conclusionType:'FACT', value:{type:'Birth',place:{id:9007199254740997n}}}};
  const result = prepareOperation('persons.addFact', input);
  assert.equal(result.input.pid, '340');
  assert.equal((result.options.body as any).value.place.id, '9007199254740997');
  assert.equal(input.body.value.place.id, 9007199254740997n);
  const search=await prepareApiInput('search.results','{"body":{"searchType":"RECORDS","events":[{"eventType":"birth","year":{"value":1838,"range":0}}]}}');
  assert.equal((search.input.body as any).events[0].year.value,'1838');
  assert.throws(()=>prepareOperation('persons.addFact',{...input,pid:Number.MAX_SAFE_INTEGER+1}),/exact integer/);
  assert.throws(()=>prepareOperation('persons.addFact',{...input,body:{conclusionType:123,value:{}}}),/expected string/);
  assert.equal(prepareOperation('persons.get',{pid:'000340'}).input.pid,'000340');
});

test('create previews warn about Living and explicit deceased adds a dateless Death fact once',async()=>{
  const text=JSON.stringify({body:{person:{names:[],gender:{value:{type:'Female'}},facts:[{value:{type:'Birth',date:{original:'1838'}}}]}}});
  const living=await prepareApiInput('persons.create',text);
  assert.equal(living.creation?.status,'living-by-default');assert.equal(living.creation?.warnings.length,1);
  const deceased=await prepareApiInput('persons.create',text,[],{deceased:true});
  assert.equal(deceased.creation?.status,'deceased');assert.deepEqual((deceased.input.body as any).person.facts[1],{value:{type:'Death'}});
  assert.equal((await prepareApiInput('persons.create',JSON.stringify(deceased.input),[],{deceased:true})).creation?.warnings.length,0);
  assert.equal(((await prepareApiInput('persons.create',JSON.stringify(deceased.input),[],{deceased:true})).input.body as any).person.facts.length,2);
  await assert.rejects(prepareApiInput('persons.get','{"pid":"ABCD-123"}',[],{deceased:true}),/only/);
});

test('Fold3 entry IDs resolve to the parent scan without guessing across numeric namespaces',async()=>{
  const seen:string[]=[];
  const client={entry:async(id:string)=>{seen.push(id);return {parentImageId:'123'};}} as Fold3Client;
  assert.equal(await resolveImageReference(client,imageReference(undefined,'456')),'123');
  assert.equal(await resolveImageReference(client,imageReference('https://www.fold3.com/sub-image/456/test')),'123');
  assert.equal(await resolveImageReference(client,imageReference('456')),'456');
  assert.deepEqual(seen,['456','456']);
  assert.throws(()=>imageReference('123','456'),/exactly one/);
  assert.throws(()=>imageReference('https://evil.test/sub-image/456'),/Expected/);
});

test('Fold3 refuses reduced exports unless requested and always preserves the real dimensions',async()=>{
  const jpeg=await sharp({create:{width:2,height:2,channels:3,background:'#abcdef'}}).jpeg().toBuffer();
  const c=new Fold3Client(new Fold3Http(undefined,async url=>url.startsWith(IMG)?new Response(jpeg,{headers:{'content-type':'image/jpeg'}}):new Response(JSON.stringify({w:{id:{ct:'IMAGE',id:'123'}},d:{w:4,h:4},r:{p:{allowed:['VIEW','DOWNLOAD'],denied:{}},o:{token:'synthetic'}}}),{headers:{'content-type':'application/json'}})));
  await assert.rejects(downloadImage(c,'123'),{code:'reduced-resolution'});
  const result=await downloadImage(c,'123',{allowReduced:true});
  assert.equal(result.metadata.fullSize,false);assert.equal(result.metadata.width,2);assert.equal(result.metadata.sourceWidth,4);
  assert.match(result.metadata.warning!,/reduced-resolution/);
});

test('JSON failures can use stdout while maintaining nonzero exits and clean envelopes',async()=>{
  const run=promisify(execFile), cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
  for(const flags of [['--errors','stdout'],['--errors=stdout']]){
    await assert.rejects(run(process.execPath,['--import',import.meta.resolve('tsx'),cli,'familysearch.api','call','--json',...flags,'--reasoning','Verify machine error routing'],{cwd:CREDENTIAL_DIR,env:{...process.env,FAM_HISTORY:'0'}}),(error:any)=>{
      assert.equal(error.code,2);assert.equal(JSON.parse(error.stdout).ok,false);assert.equal(error.stderr,'');return true;
    });
  }
});
