/** Bounded public searches; no account data or response bodies are saved. */
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {writePrivateJson} from '../src/shared/storage.js';
import {FindagraveClient} from '../src/findagrave/client.js';
import {searchInput, type SearchOptions} from '../src/findagrave/research.js';

parseArgs({options:{}});
const client=await FindagraveClient.open();
const results:{name:string;status:'passed'|'failed'}[]=[];
async function search(options:SearchOptions,c=client) {
  return (await c.search(searchInput({size:3,...options})) as {memorialSearch:{total:number;memorials:Record<string,any>[]}}).memorialSearch;
}
async function check(name:string,fn:()=>Promise<void>) {
  try {await fn();results.push({name,status:'passed'});console.log(`${name}: passed`);}
  catch {results.push({name,status:'failed'});console.error(`${name}: failed`);process.exitCode=1;}
}
await check('bio-keywords-source-text-and-pagination',async()=>{
  const options={lastName:'Lincoln',bio:'president',size:2};
  const a=await search(options),b=await search({...options,from:2});
  assert.ok(a.total>0);assert.equal(a.memorials.length,2);assert.equal(b.memorials.length,2);
  assert.ok(a.memorials.every(m=>/president/i.test(m.bio?.value??'')));
  assert.ok(b.memorials.every(m=>!a.memorials.some(n=>n.id===m.id)));
  assert.equal((await search({lastName:'Lincoln',bio:'zzzzunlikelyresearchtermzzzz'})).total,0);
});
await check('maiden-name',async()=>{
  const r=await search({firstName:'Mary',lastName:'Todd',includeMaidenName:true,exact:true,birthYear:'1818'});
  assert.ok(r.memorials.some(m=>m.name.some((n:any)=>n.maiden==='Todd'&&n.last!=='Todd')));
});
await check('nickname-and-negative-control',async()=>{
  const options={firstName:'Abe',lastName:'Lincoln',birthYear:'1908'};
  assert.ok((await search({...options,includeNickname:true})).memorials.some(m=>m.id==='40244614'));
  assert.equal((await search({...options,includeNickname:false})).total,0);
});
await check('linked-relative-and-negative-control',async()=>{
  const options={firstName:'Wyatt',lastName:'Earp'};
  assert.ok((await search({...options,relative:'Nicholas Earp'})).memorials.some(m=>m.id==='311'));
  assert.equal((await search({...options,relative:'zzzzunlikelyresearchtermzzzz'})).total,0);
});
await check('date-comparisons',async()=>{
  const before=await search({lastName:'Lincoln',deathYear:'1900',deathFilter:'before'});
  const after=await search({lastName:'Lincoln',birthYear:'1900',birthFilter:'after'});
  assert.ok(before.total>0&&after.total>0);
  assert.ok(before.memorials.every(m=>m.death?.date?.year<1900));
  assert.ok(after.memorials.every(m=>m.birth?.date?.year>1900));
});
await check('cemetery-plot',async()=>{
  const r=await search({lastName:'Lincoln',cemetery:['49269'],plot:'Section 31 Site 13'});
  assert.ok(r.total>0);assert.ok(r.memorials.every(m=>m.cemetery.id==='49269'&&/^Section 31,? Site 13$/.test(m.plot)));
});
await check('anonymous-biography-search',async()=>{
  const r=await search({lastName:'Lincoln',bio:'president',size:1},await FindagraveClient.open(true));
  assert.ok(r.total>0);assert.match(r.memorials[0]!.bio.value,/president/i);
});
const report={verifiedAt:new Date().toISOString(),passed:results.filter(r=>r.status==='passed').length,
  failed:results.filter(r=>r.status==='failed').length,results};
await writePrivateJson('findagrave/verification/search.json',report);
console.log(`${report.passed} passed, ${report.failed} failed.`);
