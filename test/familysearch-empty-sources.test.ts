import test from 'node:test';
import assert from 'node:assert/strict';
import {FamilySearchClient} from '../src/familysearch/client.js';
import {listPersonSources} from '../src/familysearch/source-list.js';
test('sources HTTP 204 is an empty source list, not a malformed response',async()=>{
  const client=await FamilySearchClient.open();let calls=0;
  client.requestDetailed=(async()=>{calls++;return {status:204,headers:{},data:undefined};}) as any;
  assert.deepEqual(await client.operation('sources.forPerson',{pid:'AAAA-AAA'}),{person:{id:'AAAA-AAA',sources:[]},sourceDescriptions:[]});
  const result=await listPersonSources(client,'AAAA-AAA');
  assert.deepEqual(result,{personId:'AAAA-AAA',items:[],historyComplete:true,warnings:[]});assert.equal(calls,2);
});
test('empty HTTP 200 and unrelated HTTP 204 remain unexpected rather than inventing records',async()=>{
  const client=await FamilySearchClient.open();
  client.requestDetailed=(async()=>({status:200,headers:{},data:undefined})) as any;
  await assert.rejects(client.operation('sources.forPerson',{pid:'AAAA-AAA'}),/Unexpected empty response/);
  client.requestDetailed=(async()=>({status:204,headers:{},data:undefined})) as any;
  await assert.rejects(client.operation('persons.get',{pid:'AAAA-AAA'}),/Unexpected empty response/);
});
