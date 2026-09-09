import {inspectResult} from '../shared/diagnostics.js';
import {parseArgs} from 'node:util';
import {CREDENTIAL_DIR} from '../shared/storage.js';
import {configureCredentials} from '../shared/credentials.js';
import {stringifyJson} from '../shared/json.js';
import {authenticate,loadSession,sessionStatus} from './auth.js';
import {AmericanAncestorsClient,operations,describeOperation,type SearchOptions} from './client.js';
import {validateSearch, type FamilyMember} from './search.js';
import {exportRecords} from './export.js';
import {downloadImage,saveDownload,saveOutput} from './download.js';
export async function runProvider(argv: string[]) {
  const strings = ['first-name','last-name','keywords','location','from-year','to-year','collection','category','project','record-type','volume-id','page-name','page','out','filter','limit','resume'];
  const {values:raw,positionals:[command,arg]} = parseArgs({args:argv,allowPositionals:true,options:{
    ...Object.fromEntries(strings.map(n => [n,{type:'string' as const}])),
    family:{type:'string',multiple:true},field:{type:'string',multiple:true},
    ...Object.fromEntries(['stdin','anonymous','exact','soundex','free','images','details'].map(n => [n,{type:'boolean' as const}])),
  }});
  const v:Record<string,string|string[]|boolean|undefined> = raw;
  let result: unknown;
  if (command === 'credentials') {await configureCredentials('americanancestors',{stdin:!!v.stdin});result={saved:true};}
  else if (command === 'status') result={...sessionStatus(await loadSession()),credentialDirectory:CREDENTIAL_DIR};
  else if (command === 'auth') result=sessionStatus(await authenticate());
  else if (command === 'ops') result=Object.keys(operations).filter(k => !arg || JSON.stringify(describeOperation(k)).toLowerCase().includes(arg.toLowerCase())).map(describeOperation);
  else if (command === 'schema') result=describeOperation(arg);
  else {
    const str = (n:string) => v[n] as string | undefined;
    let family:FamilyMember[]|undefined;
    if(v.family) {try {family=(v.family as string[]).map(text=>JSON.parse(text));}catch{throw new Error('--family requires a JSON object with relationship and firstName/lastName.');}}
    let fields:Record<string,string>|undefined;
    if(v.field) {
      const pairs=(v.field as string[]).map(text=>{const i=text.indexOf('=');if(i<1)throw new Error('--field requires NAME=VALUE or ID=VALUE.');return [text.slice(0,i).trim(),text.slice(i+1)] as const;});
      if(new Set(pairs.map(([k])=>k)).size!==pairs.length)throw new Error('Duplicate --field criterion.');fields=Object.fromEntries(pairs);
    }
    const options:SearchOptions={family,fields,firstName:str('first-name'),lastName:str('last-name'),keywords:str('keywords'),location:str('location'),fromYear:str('from-year'),toYear:str('to-year'),collection:str('collection'),category:str('category'),project:str('project'),recordType:str('record-type'),volumeId:str('volume-id'),pageName:str('page-name'),page:Number(v.page ?? 1),exact:!!v.exact,soundex:!!v.soundex,free:!!v.free,images:!!v.images};
    if (command === 'search' || command === 'export' && !v.resume) validateSearch(options);
    const client=await AmericanAncestorsClient.open(!!v.anonymous);
    if (command === 'me' || command === 'verify') result=await client.me();
    else if (command === 'collections') result=await client.collections(arg);
    else if (command === 'collection') result=await client.collection(arg);
    else if (command === 'search') result=await client.search(options);
    else if (command === 'volumes') result=await client.volumes(arg,str('filter'));
    else if (command === 'browse') result=await client.browse(arg,str('volume-id')!,str('page-name'));
    else if (command === 'pages') result=await client.pages(arg,Number(v.limit??10));
    else if (command === 'export') {
      const searchFlags=['first-name','last-name','keywords','location','from-year','to-year','collection','category','project','record-type','volume-id','page-name','page','exact','soundex','free','images','family','field','anonymous'];
      if(v.resume && searchFlags.some(key=>v[key]!==undefined))throw new Error('Resume uses the saved query and signed-in access; omit search filters and --anonymous.');
      return exportRecords(client,{out:str('out'),resume:str('resume'),search:v.resume?undefined:options,limit:Number(v.limit),details:v.details as boolean|undefined});
    }
    else if (command === 'record') result=await client.record(arg);
    else if (command === 'image') result=await client.image(arg);
    else if (command === 'download') {
      if (!v.out) throw new Error('Image download requires --out.');
      const download=await downloadImage(client,arg);await saveDownload(String(v.out),download);return {saved:v.out,...download.metadata};
    } else throw new Error('Unknown American Ancestors command.');
  }
  if (v.out) inspectResult(result);
  if (v.out) {await saveOutput(String(v.out),stringifyJson(result,2)+'\n');return {saved:v.out};}
  return result;
}
