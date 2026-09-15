import {test} from 'node:test';
import assert from 'node:assert/strict';
import {enrichSearchCollections} from '../src/ancestry/search.js';
import {NewspapersClient} from '../src/newspapers/client.js';
import {NewspapersHttp} from '../src/newspapers/http.js';
import {FamilySearchClient} from '../src/familysearch/client.js';
import {runRecordSearch} from '../src/familysearch/record-search.js';

test('Ancestry promotes collection titles without dropping provider fields',()=>{
  const original={RecordView:{Records:[{Gid:{Value:'-9223372036854775808:340'},Features:[{FeatureName:'CollectionMetadata',CollectionId:340,Title:'Register'}]},{Gid:{Value:'2:4'}}]},Status:'Successful'};
  const result=enrichSearchCollections(original);assert.equal(result.RecordView.Records[0].collectionTitle,'Register');assert.equal(result.RecordView.Records[0].collectionId,'340');
  assert.equal(result.RecordView.Records[0].Gid.Value,'-9223372036854775808:340');assert.equal(result.RecordView.Records[1].collectionTitle,null);assert.equal('collectionTitle' in original.RecordView.Records[0],false);
});

test('Newspapers title search uses the Papers endpoint and honest pagination',async()=>{
  const client=new NewspapersClient(new NewspapersHttp(undefined,async url=>{
    const u=new URL(url);assert.equal(u.pathname,'/api/title/query');assert.equal(u.searchParams.get('product-id'),'1');assert.equal(u.searchParams.get('keyword'),'Daily News');assert.equal(u.searchParams.get('start'),'2');
    return new Response(JSON.stringify({titles:[{id:123,title:'Daily News',url:'https://www.newspapers.com/paper/daily-news/123',token:'secret'}],count:5}),{headers:{'content-type':'application/json'}});
  }));
  const result=await client.publicationSearch('Daily News',1,2);assert.equal(result.nextOffset,3);assert.equal(result.items[0].publicationId,'123');assert.equal(result.complete,false);assert.equal('token' in result.items[0],false);
  assert.throws(()=>client.publicationSearch('   '));
});

test('FamilySearch collection sorting puts unknown counts last and supports count/title order',async t=>{
  t.mock.method(FamilySearchClient,'open',async()=>({operation:async()=>({categoryFilters:[{collectionFilters:[{collectionType:0,subCollections:[{collectionId:1,displayName:'C'},{collectionId:2,displayName:'B',count:2},{collectionId:3,displayName:'A',count:5},{collectionId:4,displayName:'D'}]}]}]})}));
  const run=async(sort?:string)=>(await runRecordSearch(['--last-name','Example',...(sort?['--sort',sort]:[])],'collections') as any).items.map((x:any)=>x.collectionId);
  assert.deepEqual(await run(),[3,2,1,4]);assert.deepEqual(await run('count-asc'),[2,3,1,4]);assert.deepEqual(await run('title'),[3,2,1,4]);
});
