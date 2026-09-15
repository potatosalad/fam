import {parseArgs} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {FamilySearchClient} from './client.js';
import {InputError} from '../shared/input-error.js';
import {stringifyJson} from '../shared/json.js';
import {prepareOperation} from './operations.js';
import {listPersonSources} from './source-list.js';
import {planMerge} from './merge-plan.js';
import {planAttachment,recordUrl} from './attach-plan.js';
import {notMatches,duplicateDetails} from './not-matches.js';

export const workflowCommands = ['source-list','merge-plan','attach-plan','not-matches','duplicate-details'];
export function parseFamilyWorkflow(args: string[]) {
  const command=args[0];
  const {values}=parseArgs({args:args.slice(1),allowPositionals:false,options:{
    ...Object.fromEntries(['person-id','survivor-id','duplicate-id','ark','reason','max-pages'].map(key=>[key,{type:'string' as const}])),
    'copy-fact':{type:'string',multiple:true},'include-vitals':{type:'boolean'},'include-relationships':{type:'boolean'},'include-analysis':{type:'boolean'},
  }});
  const v=values as Record<string,string|boolean|string[]|undefined>;
  if (!workflowCommands.includes(command)) throw new InputError('Unknown FamilySearch workflow.');
  const personId=v['person-id'] as string, survivorId=v['survivor-id'] as string, duplicateId=v['duplicate-id'] as string;
  if (command==='merge-plan') {
    prepareOperation('persons.mergeAnalysis',{survivorId,duplicateId});
    if (survivorId===duplicateId) throw new InputError('A merge requires different person IDs.');
  } else prepareOperation('persons.get',{pid:personId});
  if (command==='duplicate-details') prepareOperation('hints.duplicate',{personId,duplicateId});
  if (command==='attach-plan') recordUrl(v.ark as string);
  if (['attach-plan','merge-plan'].includes(command) && !(v.reason as string)?.trim()) throw new InputError('Supply a nonempty --reason.');
  const maxPages=Number(v['max-pages']??10);
  if (!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>100) throw new InputError('--max-pages requires 1–100.');
  return {command,personId,survivorId,duplicateId,maxPages,reason:v.reason as string,ark:v.ark as string,selectors:v['copy-fact'] as string[]|undefined,
    includeVitals:v['include-vitals']===true,includeRelationships:v['include-relationships']===true,includeAnalysis:v['include-analysis']===true};
}

export async function runFamilyWorkflow(args: string[], output?: string) {
  if (!workflowCommands.includes(args[0])) return undefined;
  const o=parseFamilyWorkflow(args),client=await FamilySearchClient.open();let result:any;
  if (o.command==='source-list') result=await listPersonSources(client,o.personId,o.maxPages);
  else if (o.command==='merge-plan') {
    const {analysis,...plan}=await planMerge(client,o.survivorId,o.duplicateId,o);
    result={...plan,...(o.includeAnalysis?{analysis}:{})};
  } else if (o.command==='attach-plan') result=await planAttachment(client,o.personId,o.ark,o.reason,o.selectors);
  else if (o.command==='not-matches') result=await notMatches(client,o.personId);
  else result=await duplicateDetails(client,o.personId,o.duplicateId);
  if (output) {
    const path=resolve(output);await mkdir(dirname(path),{recursive:true,mode:0o700});
    await writeFile(path,stringifyJson(result.input??result,2)+'\n',{mode:0o600,flag:'wx'});
    return {data:{...result,saved:path}};
  }
  return {data:result};
}
