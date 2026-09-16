import type {FamilySearchClient} from './client.js';
import {InputError} from '../shared/input-error.js';
import {prepareOperation} from './operations.js';
import {contracts} from './generated/schema.js';
import type {WireType} from './contract-types.js';

/** Project decoded response data onto the recovered write model, retaining every omission in the preview. */
function writableFact(fact: any) {
  const value={...fact,...(fact.place?{place:{...fact.place,...(fact.place.id==null&&fact.place.standardPlaceId!=null?{id:fact.place.standardPlaceId}:{})}}:{})};
  const omittedFields:string[]=[];
  function project(value:any,type:WireType,path:string,depth=0):any {
    if(depth>64)throw new Error('Record fact exceeds 64 nested levels.');
    if(type.kind==='array'&&Array.isArray(value))return value.map((v,i)=>project(v,type.items,`${path}[${i}]`,depth+1));
    if(type.kind==='ref'&&value&&typeof value==='object'&&!Array.isArray(value)){
      const fields=contracts.models[type.name];
      return Object.fromEntries(Object.entries(value).flatMap(([key,v])=>{
        if(!Object.hasOwn(fields,key)){omittedFields.push(`${path}.${key}`);return [];}
        return [[key,project(v,fields[key].type,`${path}.${key}`,depth+1)]];
      }));
    }
    return value;
  }
  const inputFact=project(value,{kind:'ref',name:'org/familysearch/mobile/tree/client/persondetails/ConclusionValueDto'},'fact');
  return {inputFact,omittedFields,...(fact.place?.id==null&&fact.place?.standardPlaceId!=null?{normalization:'place.standardPlaceId copied to place.id'}:{})};
}

export function recordUrl(value: string) {
  const url = new URL(value.startsWith('1:1:') ? `https://www.familysearch.org/ark:/61903/${value}` : value);
  if (url.protocol !== 'https:' || !['www.familysearch.org','familysearch.org'].includes(url.host) || url.username || url.password || !/^\/ark:\/61903\/1:1:[A-Z0-9-]+$/i.test(url.pathname)) throw new InputError('Expected an indexed-record ARK (1:1:...).');
  return `https://www.familysearch.org${url.pathname}`;
}

export function buildAttachPlan(personId: string, url: string, linker: any, reason: string, selectors: string[] = []) {
  if (!reason?.trim()) throw new InputError('Supply --reason describing why this record identifies the person.');
  url = recordUrl(url);
  const focusIds = new Set((linker.recordPersons ?? []).filter((person: any) => typeof person.recordUrl === 'string' && recordUrl(person.recordUrl) === url).map((person: any) => person.id));
  if (linker.record?.persistentUrl && recordUrl(linker.record.persistentUrl) === url) focusIds.add(linker.record.recordId);
  const matches = (linker.matches ?? []).filter((match: any) => focusIds.has(match.recordPersonId) && match.treePersonId === personId);
  if (matches.length !== 1) throw new Error('The source linker did not identify exactly one pairing for the requested record and tree person. Inspect sources.linkerMatch.');
  const attachmentsKnown = Array.isArray(linker.recordAttachments);
  const attachments = (linker.recordAttachments ?? []).filter((attachment: any) => attachment.recordPersonId === matches[0].recordPersonId);
  const alreadyAttached = attachments.some((attachment: any) => attachment.treePersonId === personId);
  const attachedElsewhere = attachments.some((attachment: any) => attachment.treePersonId !== personId);
  const warnings = [
    ...(!attachmentsKnown ? ['The source linker did not supply attachment status. Check existing sources before executing.'] : []),
    ...(alreadyAttached ? ['This indexed person is already attached to the requested tree person. Do not execute another attachment; review the existing source and facts.'] : []),
    ...(attachedElsewhere ? ['This indexed person is attached to another tree person. Review that attachment before executing.'] : []),
  ];
  const candidates = (matches[0].pairings ?? []).filter((pairing: any) => pairing.recordFact).map((pairing: any) => ({
    id:pairing.recordFact.conclusionId ?? null, type:pairing.recordFact.type ?? null, fact:pairing.recordFact, existingTreeFact:pairing.treeFact ?? null}));
  const selected = new Set<any>();
  for (const selector of selectors) {
    const found = candidates.filter((item: any) => item.id === selector || item.type === selector || item.type?.split('/').pop() === selector);
    if (!found.length) throw new InputError(`No record fact matches ${JSON.stringify(selector)}. Inspect the plan's candidates.`);
    for (const item of found) selected.add(item);
  }
  const copy=[...selected].map(item=>({...item,...writableFact(item.fact)}));
  const body = {personId,recordUrl:url,attachmentReason:reason,recordFactsToCopy:copy.map(item => item.inputFact)};
  const input = prepareOperation('sources.attachRecord',{body}).input;
  copy.forEach((item,index)=>{item.inputFact=(input.body as any).recordFactsToCopy[index];});
  return {operation:'sources.attachRecord',input,candidates,copy,ready:warnings.length===0,alreadyAttached,
    attachmentStatus:alreadyAttached?'attached':attachedElsewhere?'attached-elsewhere':attachmentsKnown?'unattached':'unknown',attachments,warnings,
    note:'Read-only attachment plan. Selected facts come directly from the source linker. Executing this input attaches the record and copies those facts in the same request.'};
}

export async function planAttachment(client: FamilySearchClient, personId: string, ark: string, reason: string, selectors: string[] = []) {
  const url = recordUrl(ark);
  prepareOperation('persons.get',{pid:personId});
  if (!reason?.trim()) throw new InputError('Supply --reason.');
  const linker = await client.operation('sources.linkerMatch',{query:{recordUrl:url,personId}});
  return buildAttachPlan(personId,url,linker,reason,selectors);
}
