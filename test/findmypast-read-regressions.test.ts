import test from 'node:test';
import assert from 'node:assert/strict';
import {FindmypastClient} from '../src/findmypast/client.js';
import type {ApiRequest,ApiResponse} from '../src/familysearch/transport-types.js';
function fixture(send:(url:string,options:ApiRequest)=>unknown){
  return new FindmypastClient(undefined,{exchange:async<T>(url:string|URL,options:ApiRequest={}):Promise<ApiResponse<T>>=>({status:200,headers:{},data:await send(String(url),options) as T})});
}
test('entitlement service errors fail but genuine access denials remain data',async()=>{
  const error=fixture(()=>({data:{getTranscriptEntitlement:{decision:false,reason:'Error',fulfillmentAction:-1}}}));
  await assert.rejects(error.entitlement('missing'),/entitlement.*lookup failed/i);
  const denial={decision:false,reason:'SubscriptionRequired',fulfillmentAction:1};
  const denied=fixture(()=>({data:{getTranscriptEntitlement:denial}}));
  assert.deepEqual((await denied.entitlement('REC/1')).getTranscriptEntitlement,denial);
});
test('newspaper search references resolve to the current issue manifest route',async()=>{
  const client=fixture(url=>{assert.match(url,/\/obscura\/api\/manifest\/0000123\/19000101$/);return {sequences:[{canvases:[{'@id':'synthetic'}]}]};});
  for(const id of ['BL/0000123/19000101/0005','BL/0000123/19000101/061','BL/0000123/19000101'])assert.ok((await client.newspaperManifest(id)).sequences);
  await assert.rejects(client.newspaperManifest('BL/../../other'),/newspaper.*ID/i);
});
test('collection metadata refuses empty articles and explains search identifier mismatch',async()=>{
  let calls=0;
  const client=fixture((_url,options)=>{calls++;assert.equal((options.body as any).variables.recordMetadataId,'missing');return {data:{recordSetInformation:'<div class="Article"> <br> </div>'}};});
  await assert.rejects(client.collection('missing'),/record metadata ID.*collection search/i);
  assert.equal(calls,1);
  const valid=fixture(()=>({data:{recordSetInformation:'<div class="Article"><p>Synthetic collection</p></div>'}}));
  assert.match((await valid.collection('synthetic')).recordSetInformation,/Synthetic collection/);
});
test('image details resolves a record to its image without confirming a purchase',async()=>{
  const calls:string[]=[];
  const client=fixture((url,options)=>{
    calls.push(url);
    if(url.endsWith('/graphql')){
      assert.deepEqual((options.body as any).variables.filter,[{field:'Id',values:['REC/1']}]);
      return {data:{root:{search:{recordSearch:{records:[{id:'REC/other',image:{id:'wrong'}},{id:'REC/1',image:{id:'IMG/2',recordMetadataId:'metadata'}}]}}}}};
    }
    assert.match(url,/image\/IMG%2F2\/detail\.json$/);
    assert.deepEqual(options.query,{recordMetadataId:'metadata',parentRecordId:'REC/1',confirmedPurchase:false});
    return {imageCount:2};
  });
  assert.equal((await client.image('REC/1')).imageCount,2);assert.equal(calls.length,2);
  const empty=fixture(url=>url.endsWith('/graphql')?{data:{root:{search:{recordSearch:{records:[{id:'REC/1',image:{id:'IMG/2',recordMetadataId:'metadata'}}]}}}}}:{});
  await assert.rejects(empty.image('REC/1'),e=>e instanceof Error && 'code' in e && e.code==='image-details-unavailable' && /FamilySearch.*ImagePal.*transcript/i.test(e.message));
  const missing=fixture(()=>({data:{root:{search:{recordSearch:{records:[]}}}}}));
  await assert.rejects(missing.image('REC/1'),/record.*not found/i);
});
