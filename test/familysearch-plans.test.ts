import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildMergePlan,planMerge} from '../src/familysearch/merge-plan.js';
import {buildAttachPlan} from '../src/familysearch/attach-plan.js';
import {listPersonSources} from '../src/familysearch/source-list.js';
import {notMatches,duplicateDetails} from '../src/familysearch/not-matches.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {parseFamilyWorkflow} from '../src/familysearch/workflow-cli.js';

const analysis={survivorPersonSummary:{id:'AAAA-AAA'},duplicatePersonSummary:{id:'BBBB-BBB'},personMergeConstraint:'CAN_MERGE_ANY_ORDER',nonVitalMergeWarnings:[],uniqueNonVitalConclusionsFromDuplicate:[{conclusionId:'residence-1',conclusionType:'FACT',value:{type:'Residence'}}],
  uniqueVitalConclusionsFromDuplicate:[{conclusionId:'birth-1',conclusionType:'FACT',value:{type:'Birth'}}],
  duplicateSources:[{id:'description-id',entityRefId:'reference-id',title:'Register'}],
  duplicateSpousesAndChildren:[{coupleRelationshipId:'couple-1',children:[{personId:'child-1',relationshipId:'child-relation'}]}],
  uniqueParentChildRelationshipsAsChildFromDuplicate:[{id:'parent-relation'}],uniqueAssociationRelationshipsFromDuplicate:[{id:'association-1'}]};
test('merge plans copy source reference IDs, preserve survivor vitals by default, and explicitly preview all ten arrays',()=>{
  const plan=buildMergePlan('AAAA-AAA','BBBB-BBB',analysis,{reason:'Same documented person'});
  const body=plan.input.body as any;
  assert.equal(plan.ready,true);
  assert.deepEqual(body.idsOfSourceReferencesToCopy,['reference-id']);assert.deepEqual(body.idsOfConclusionsToCopy,['residence-1']);
  assert.equal(Object.keys(body).filter(key=>Array.isArray(body[key])).length,10);
  for(const key of Object.keys(body).filter(key=>key.endsWith('ToDelete')))assert.deepEqual(body[key],[]);
  assert.deepEqual(body.idsOfCoupleRelationshipsToCopy,[]);
  const included=buildMergePlan('AAAA-AAA','BBBB-BBB',analysis,{reason:'Same person',includeVitals:true,includeRelationships:true}).input.body as any;
  assert.deepEqual(included.idsOfConclusionsToCopy,['residence-1','birth-1']);assert.deepEqual(included.idsOfParentChildRelationshipsToCopy,['parent-relation','child-relation']);
  const missing=buildMergePlan('AAAA-AAA','BBBB-BBB',{...analysis,duplicateSources:[{id:'description-only'}]},{reason:'Same person'});
  assert.equal(missing.ready,false);assert.deepEqual((missing.input.body as any).idsOfSourceReferencesToCopy,[]);
  assert.throws(()=>buildMergePlan('AAAA-AAA','AAAA-AAA',analysis,{reason:'Same person'}),/different/);
  assert.throws(()=>buildMergePlan('AAAA-AAA','CCCC-CCC',analysis,{reason:'Same person'}),/requested survivor/);
});

test('merge planning reads declaration reasons and never executes a merge',async()=>{
  const calls:string[]=[];
  const client={operation:async(name:string)=>{calls.push(name);assert.equal(name,'persons.mergeAnalysis');return analysis;},requestDetailed:async(path:string)=>{
    assert.equal(path,'/platform/tree/persons/AAAA-AAA/not-a-match');return {status:200,data:{persons:[{id:'BBBB-BBB',attribution:{changeMessage:'Different parents',modified:123,contributor:{resource:'agent'}}}]}};
  }};
  const plan=await planMerge(client as any,'AAAA-AAA','BBBB-BBB',{reason:'Review pair'});
  assert.equal(plan.ready,false);assert.equal(plan.notAMatch.reason,'Different parents');assert.deepEqual(calls,['persons.mergeAnalysis']);
  assert.deepEqual((await notMatches({requestDetailed:async()=>({status:204})} as any,'AAAA-AAA')).items,[]);
  await assert.rejects(notMatches({requestDetailed:async()=>({status:200,data:{wrong:[]}})} as any,'AAAA-AAA'),/unfamiliar/);
  const detail=await duplicateDetails({operation:async()=>({matches:[]}),requestDetailed:client.requestDetailed} as any,'AAAA-AAA','BBBB-BBB');assert.equal(detail.notAMatch.reason,'Different parents');
});

test('attachment plans preserve exact native facts and reject ambiguous or unknown selections',()=>{
  const url='https://www.familysearch.org/ark:/61903/1:1:TEST';
  const fact={conclusionId:'fact-1',type:'http://gedcomx.org/Residence',date:{original:'1850'},place:{original:'Original place',id:'000340'}};
  const linker={record:{persistentUrl:url,recordId:'record-1'},matches:[{recordPersonId:'record-1',treePersonId:'AAAA-AAA',pairings:[{recordFact:fact,treeFact:{type:'Residence'}}]}]};
  const plan=buildAttachPlan('AAAA-AAA',url,linker,'Same household',['Residence','fact-1']);
  assert.deepEqual((plan.input.body as any).recordFactsToCopy,[fact]);assert.equal(plan.candidates.length,1);
  assert.deepEqual((buildAttachPlan('AAAA-AAA',url,linker,'Same household').input.body as any).recordFactsToCopy,[]);
  assert.throws(()=>buildAttachPlan('AAAA-AAA',url,linker,'Same household',['Death']),/No record fact/);
  assert.throws(()=>buildAttachPlan('BBBB-BBB',url,linker,'Same household'),/exactly one/);
  const responseFact={...fact,primary:true,place:{original:'Original place',standardPlaceId:340,description:'#place_340'}};
  const current=buildAttachPlan('AAAA-AAA',url,{...linker,matches:[{...linker.matches[0],pairings:[{recordFact:responseFact}]}]},'Same household',['Residence']);
  assert.deepEqual((current.input.body as any).recordFactsToCopy[0].place,{original:'Original place',id:'340',description:'#place_340'});
  assert.equal((current.input.body as any).recordFactsToCopy[0].primary,undefined);
  assert.ok(current.copy[0].omittedFields.includes('fact.primary'));assert.equal(current.candidates[0].fact.primary,true);
});

test('source listing joins reference identities, separates attachment from modification, and caches names',async()=>{
  let historyCalls=0,contributorCalls=0;
  const client={operation:async(name:string,input:any)=>{
    if(name==='sources.forPerson')return {person:{id:'AAAA-AAA',sources:[{id:'ref-1',descriptionId:'source-1',modifiedBy:'user-2',modifiedTime:'200',tags:[]},{id:'ref-2',descriptionId:'source-1',modifiedBy:'user-2',modifiedTime:'300'}]},sourceDescriptions:[{id:'source-1',title:'Register',recordUrl:'ark-url'}]};
    if(name==='history.changes'){
      historyCalls++;
      return historyCalls===1?{lastPage:false,nextPageToken:'next',contactNames:{'user-1':'First contributor'},changes:[{changeId:'unrelated',journalEvent:{op:'ENTITY_REF_ADDED',entityRef:{entityRefId:'different-ref',value:{uri:'source-1'}}}}]}:
        {lastPage:true,changes:[{changeId:'attach-event',attribution:{modified:'999'},journalEvent:{op:'ENTITY_REF_ADDED',entityRef:{entityRefId:'ref-1',attribution:{modified:'100',contributor:{id:'user-1'},changeMessage:'Evidence'}}}}]};
    }
    assert.equal(name,'contributors.get');assert.equal(input.contributorOrCisId,'user-2');contributorCalls++;return {contributor:{contactName:'Editor'}};
  }};
  const result=await listPersonSources(client as any,'AAAA-AAA',2);
  assert.equal(result.items[0].title,'Register');assert.equal(result.items[0].attachedAt,'1970-01-01T00:00:00.100Z');assert.equal(result.items[0].modifiedAt,'1970-01-01T00:00:00.200Z');
  assert.equal(result.items[0].attachedBy?.name,'First contributor');assert.equal(result.items[1].attachedAt,null);assert.equal(result.items[1].modifiedBy?.name,'Editor');
  assert.equal(contributorCalls,1);assert.equal(result.historyComplete,true);
});

test('workflow command flags bind to validated read-only plans',()=>{
  const invocation=parseInvocation(['familysearch.merge','plan','--survivor-id','AAAA-AAA','--duplicate-id','BBBB-BBB','--reason','Evidence','--include-vitals']);
  const parsed=parseFamilyWorkflow(invocation.args);assert.equal(parsed.includeVitals,true);assert.equal(parsed.reason,'Evidence');
  const source=parseInvocation(['familysearch.source','list','--person-id','AAAA-AAA']);assert.equal(parseFamilyWorkflow(source.args).maxPages,10);
});

test('attachment plans distinguish the requested indexed person from other household attachments',()=>{
  const url='https://www.familysearch.org/ark:/61903/1:1:TEST';
  const linker={record:{persistentUrl:url,recordId:'record-1'},matches:[{recordPersonId:'record-1',treePersonId:'AAAA-AAA',pairings:[]}],
    recordAttachments:[{recordPersonId:'record-2',treePersonId:'AAAA-AAA',sourceReferenceId:'other-person-source'}]};
  const plan=(recordAttachments:any[]|undefined)=>buildAttachPlan('AAAA-AAA',url,{...linker,recordAttachments},'Evidence');
  assert.equal(plan(linker.recordAttachments).ready,true);
  const attached=plan([...linker.recordAttachments,{recordPersonId:'record-1',treePersonId:'AAAA-AAA',sourceReferenceId:'existing-source'}]);
  assert.equal(attached.alreadyAttached,true);assert.equal(attached.ready,false);assert.equal(attached.attachments[0].sourceReferenceId,'existing-source');
  assert.match(attached.warnings[0],/already attached/);
  const elsewhere=plan([{recordPersonId:'record-1',treePersonId:'BBBB-BBB'}]);
  assert.equal(elsewhere.attachmentStatus,'attached-elsewhere');assert.equal(elsewhere.ready,false);
  assert.equal(plan(undefined).attachmentStatus,'unknown');assert.equal(plan(undefined).ready,false);
});

test('not-a-match attribution resolves names once, normalizes dates, and retains the original fields',async()=>{
  let calls=0;
  const raw={modified:1704067200000,contributor:{resourceId:'contributor-1',resource:'https://www.familysearch.org/platform/users/agents/contributor-1'}};
  const result=await notMatches({requestDetailed:async()=>({status:200,data:{persons:[{id:'BBBB-BBB',attribution:raw},{id:'CCCC-CCC',attribution:raw}]}}),
    operation:async(name:string,input:any)=>{calls++;assert.equal(name,'contributors.get');assert.equal(input.contributorOrCisId,'contributor-1');return {contributor:{contactName:'Synthetic Contributor',email:'private@example.test'}};}} as any,'AAAA-AAA');
  assert.equal(calls,1);assert.equal(result.items[0].contributor.name,'Synthetic Contributor');assert.equal(result.items[0].modified,new Date(raw.modified).toISOString());
  assert.deepEqual(result.items[0].attribution,raw);assert.equal(result.items[0].reason,null);assert.doesNotMatch(JSON.stringify(result),/private@example/);
  const unavailable=await notMatches({requestDetailed:async()=>({status:200,data:{persons:[{id:'BBBB-BBB',attribution:raw}]}}),operation:async()=>{throw new Error('Unavailable');}} as any,'AAAA-AAA');
  assert.equal(unavailable.items[0].contributor.name,null);assert.equal(unavailable.items[0].contributor.id,'contributor-1');
});
