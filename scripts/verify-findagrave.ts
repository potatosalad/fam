/** Read-only live checks. No password login, writes, or personal response data in reports. */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { writePrivateJson } from '../src/storage.js';
import { FindagraveClient } from '../src/findagrave/client.js';
import { FindagraveHttpError } from '../src/findagrave/http.js';
import { searchInput, memorialPhotos, downloadPhoto } from '../src/findagrave/research.js';
import { contracts } from '../src/findagrave/catalog.js';

const {values} = parseArgs({options:{anonymous:{type:'boolean'}}});
const client = await FindagraveClient.open(values.anonymous);
const results: {name:string;status:'passed'|'failed'|'blocked';details?:Record<string,unknown>}[]=[];
const object=(value:unknown):Record<string,any>=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Record<string,any>;};
async function check(name:string,fn:()=>Promise<Record<string,unknown>|void>, image=false) {
  try {const details=await fn();results.push({name,status:'passed',...(details?{details}:{})});console.log(`${name}: passed`);}
  catch(error) {
    const blocked=image&&error instanceof FindagraveHttpError&&[403,429].includes(error.status);
    results.push({name,status:blocked?'blocked':'failed',details:{error:error instanceof FindagraveHttpError?`HTTP ${error.status}`:error instanceof Error?error.name:'Error'}});
    console.log(`${name}: ${blocked?'blocked':'failed'}`);
  }
}
await check('exact-name-and-birth-year-search',async()=>{
  const r=object(await client.search(searchInput({firstName:'Abraham',lastName:'Lincoln',birthYear:'1809',exact:true,size:5})));
  const data=object(r.memorialSearch);assert.ok(data.total>0);assert.ok(data.memorials.some((m:any)=>String(m.id)==='10324'));
  return {returned:data.memorials.length,total:data.total};
});
await check('search-pagination-and-sort',async()=>{
  const input=searchInput({lastName:'Lincoln',sort:'birth',size:2});
  const a=object(await client.search(input)).memorialSearch,b=object(await client.search({...input,from:2})).memorialSearch;
  assert.equal(a.memorials.length,2);assert.equal(b.memorials.length,2);
  assert.notEqual(a.memorials[0].id,b.memorials[0].id);return {pages:2,perPage:2};
});
await check('memorial-and-relationships',async()=>{
  const m=await client.memorial('311');assert.equal(String(m.id),'311');assert.ok(Array.isArray(m.relationships));assert.ok(m.birth&&m.death&&m.cemetery);
  return {relationshipCount:(m.relationships as unknown[]).length};
});
await check('photo-pagination',async()=>{
  const a=await memorialPhotos(client,'311',2,0),b=await memorialPhotos(client,'311',2,2);
  assert.equal(a.photos.length,2);assert.equal(b.photos.length,2);assert.notEqual(a.photos[0]!.id,b.photos[0]!.id);
  return {total:a.total,pages:2};
});
await check('cemetery-search',async()=>{
  const r=object(await client.cemeteries({name:'Oak Ridge Cemetery',size:3,from:0})).cemeteries;
  assert.ok(r.total>0);assert.equal(r.cemeteries.length,3);return {returned:r.cemeteries.length};
});
await check('cemetery-details',async()=>{
  const r=object(await client.cemetery('8027'));assert.ok(Array.isArray(r.cemeteries?.cemeteries));assert.ok(r.cemeteries.cemeteries.some((c:any)=>String(c.id)==='8027'));
});
await check('location-typeahead',async()=>{
  const r=object(await client.locations('Springfield, Illinois',3)).locationsByTypeahead;assert.ok(r.locations.length>0);return {returned:r.locations.length};
});
await check('contributor-public-profile',async()=>{
  const r=object(await client.contributor('83'));assert.ok(Array.isArray(r.contributorsById));assert.ok(r.contributorsById.some((p:any)=>String(p.id)==='83'));
});
await check('global-memorial-tags',async()=>{
  const r=object(await client.graphql('GlobalMemorialTags'));assert.ok(Array.isArray(r.globalMemorialTags));return {count:r.globalMemorialTags.length};
});
let virtualId:string|undefined;
await check('public-virtual-cemetery-list',async()=>{
  const r=object(await client.virtualCemeteries('83',3)).virtualCemeterySearch;assert.ok(Array.isArray(r.virtualCemeteries));
  virtualId=r.virtualCemeteries[0]?.id;return {returned:r.virtualCemeteries.length};
});
if(virtualId)await check('virtual-cemetery-memorials',async()=>{
  const r=object(await client.virtualCemetery(String(virtualId),3));assert.ok(r.getVirtualCemetery);assert.ok(Array.isArray(r.getVirtualCemetery.memorials));return {returnedObject:true};
});
if(!values.anonymous){
  await check('authenticated-profile',async()=>{assert.ok((await client.me()).id);});
  await check('saved-session-revalidation',async()=>{assert.equal((await client.validateSession()).sessionSaved,true);});
  await check('my-cemeteries',async()=>{const r=object(await client.myCemeteries(3));assert.ok(r.signedInContributor?.myCemeteriesSearch);});
  await check('my-virtual-cemeteries',async()=>{const r=object(await client.virtualCemeteries(undefined,3));assert.ok(Array.isArray(r.virtualCemeterySearch?.virtualCemeteries));});
  await check('volunteer-cemeteries',async()=>{const r=object(await client.graphql('VolunteerCemeteries'));assert.ok(r.signedInContributor?.id);assert.ok(r.signedInContributor.volunteerCemeteries===null||Array.isArray(r.signedInContributor.volunteerCemeteries));});
  for(const kind of ['mine','claimed','volunteer'])await check(`photo-requests-${kind}`,async()=>{
    const r=object(await client.call(`requests.${kind}`,{query:{limit:3,skip:0}}));
    assert.ok(Object.keys(r).length>0);return {responseFields:Object.keys(r)};
  });
}
await check('original-photo-download',async()=>{
  const r=await downloadPhoto(client,'311','42543930');assert.ok(r.bytes.length>1000);
  return {bytes:r.bytes.length,width:r.metadata.width,height:r.metadata.height,sha256:r.metadata.sha256};
},true);
const report={verifiedAt:new Date().toISOString(),mode:values.anonymous?'anonymous':'native',apkVersion:contracts.apkVersion,
  passed:results.filter(r=>r.status==='passed').length,failed:results.filter(r=>r.status==='failed').length,blocked:results.filter(r=>r.status==='blocked').length,results};
await writePrivateJson(`findagrave/verification/${values.anonymous?'anonymous':'account'}.json`,report);
console.log(`Find a Grave: ${report.passed} passed, ${report.failed} failed, ${report.blocked} blocked.`);
if(report.failed)process.exitCode=1;
