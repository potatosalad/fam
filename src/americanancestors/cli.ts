import {parseArgs} from 'node:util';
import {CREDENTIAL_DIR} from '../shared/storage.js';
import {configureCredentials} from '../shared/credentials.js';
import {stringifyJson} from '../shared/json.js';
import {authenticate,loadSession,sessionStatus} from './auth.js';
import {AmericanAncestorsClient,operations,describeOperation,searchQuery,type SearchOptions} from './client.js';
import {downloadImage,saveDownload,saveOutput} from './download.js';
export async function runProvider(argv: string[]) {
  const strings = ['first-name','last-name','keywords','location','from-year','to-year','collection','category','project','record-type','volume-id','page-name','page','out'];
  const {values:v,positionals:[command,arg]} = parseArgs({args:argv,allowPositionals:true,options:{
    ...Object.fromEntries(strings.map(n => [n,{type:'string' as const}])),
    ...Object.fromEntries(['stdin','anonymous','exact','soundex','free','images'].map(n => [n,{type:'boolean' as const}])),
  }});
  let result: unknown;
  if (command === 'credentials') {await configureCredentials('americanancestors',{stdin:!!v.stdin});result={saved:true};}
  else if (command === 'status') result={...sessionStatus(await loadSession()),credentialDirectory:CREDENTIAL_DIR};
  else if (command === 'auth') result=sessionStatus(await authenticate());
  else if (command === 'ops') result=Object.keys(operations).filter(k => !arg || JSON.stringify(describeOperation(k)).toLowerCase().includes(arg.toLowerCase())).map(describeOperation);
  else if (command === 'schema') result=describeOperation(arg);
  else {
    const str = (n:string) => v[n] as string | undefined;
    const options:SearchOptions={firstName:str('first-name'),lastName:str('last-name'),keywords:str('keywords'),location:str('location'),fromYear:str('from-year'),toYear:str('to-year'),collection:str('collection'),category:str('category'),project:str('project'),recordType:str('record-type'),volumeId:str('volume-id'),pageName:str('page-name'),page:Number(v.page ?? 1),exact:!!v.exact,soundex:!!v.soundex,free:!!v.free,images:!!v.images};
    if (command === 'search') searchQuery(options);
    const client=await AmericanAncestorsClient.open(!!v.anonymous);
    if (command === 'me' || command === 'verify') result=await client.me();
    else if (command === 'collections') result=await client.collections(arg);
    else if (command === 'collection') result=await client.collection(arg);
    else if (command === 'search') result=await client.search(options);
    else if (command === 'record') result=await client.record(arg);
    else if (command === 'image') result=await client.image(arg);
    else if (command === 'download') {
      if (!v.out) throw new Error('Image download requires --out.');
      const download=await downloadImage(client,arg);await saveDownload(String(v.out),download);return {saved:v.out,...download.metadata};
    } else throw new Error('Unknown American Ancestors command.');
  }
  if (v.out) {await saveOutput(String(v.out),stringifyJson(result,2)+'\n');return {saved:v.out};}
  return result;
}
