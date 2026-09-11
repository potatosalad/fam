import {parseArgs} from 'node:util';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CREDENTIAL_DIR} from '../shared/storage.js';
import {configureCredentials} from '../shared/credentials.js';
import {readCommandFile,readCommandStdin} from '../shared/command-input.js';
import {inspectResult} from '../shared/diagnostics.js';
import {parseJson,stringifyJson} from '../shared/json.js';
import {Fold3Client,operations,type Operation,type SearchOptions} from './client.js';
import {loadSession,loginBrowser,loginNative,sessionStatus} from './auth.js';
import {downloadImage,saveDownload} from './download.js';
import {exportFile} from './file-export.js';
import type {ConnectionOptions} from './research.js';
const strings=['keyword','name','type','publication-id','place','conflict','service-number','year','birth-year','death-year','limit','offset','sort','out','prefix','direction','max-pages'];
export async function runProvider(argv:string[]){
  const {values,positionals:[command,arg,extra]}=parseArgs({args:argv,allowPositionals:true,options:{...Object.fromEntries(strings.map(name=>[name,{type:'string' as const}])),...Object.fromEntries(['filter','field','facet','path'].map(name=>[name,{type:'string' as const,multiple:true}])),...Object.fromEntries(['native','stdin','interactive','no-autofill','resume'].map(name=>[name,{type:'boolean' as const}]))}});
  const v=values as Record<string,any>,options=Object.fromEntries(Object.entries(v).filter(([key])=>!['out','native','stdin','interactive','no-autofill'].includes(key)).map(([key,value])=>[key.replace(/-([a-z])/g,(_m,c)=>c.toUpperCase()),['limit','offset','year','birth-year','death-year'].includes(key)?Number(value):value])) as SearchOptions;
  let result:unknown;
  if(command==='credentials'){await configureCredentials('fold3',{stdin:v.stdin});result={saved:true};}
  else if(command==='auth')result=sessionStatus(await(v.native?loginNative():loginBrowser({interactive:v.interactive,autofill:!v['no-autofill']})));
  else if(command==='status')result={...sessionStatus(await loadSession()),credentialDirectory:CREDENTIAL_DIR};
  else if(command==='ops')result=Object.entries(operations).map(([name,op])=>({name,...op})).filter(op=>!arg||JSON.stringify(op).toLowerCase().includes(arg.toLowerCase()));
  else if(command==='schema'){if(!Object.hasOwn(operations,arg))throw new Error('Unknown Fold3 read operation.');result={name:arg,...operations[arg as Operation]};}
  else{
    const client=await Fold3Client.open();
    if(command==='search')result=await client.search(options);else if(command==='facets')result=await client.facets(options);
    else if(command==='publications')result=await client.publications(v.keyword,options.limit,options.offset);
    else if(command==='publication')result=await client.publication(arg);
    else if(command==='publication-browse')result=await client.browse(arg,{path:v.path,prefix:v.prefix,limit:options.limit,offset:options.offset});
    else if(command==='file')result=await client.file(arg);
    else if(command==='file-images')result=await client.fileImages(arg,options.limit,options.offset);
    else if(command==='connections')result=await client.connections(arg,{type:v.type,direction:v.direction,limit:options.limit,offset:options.offset} as ConnectionOptions);
    else if(command==='file-download')return exportFile(client,arg,v.out,{maxPages:v['max-pages']===undefined?undefined:Number(v['max-pages']),resume:v.resume});
    else if(command==='image')result=await client.image(arg);
    else if(command==='record'||command==='memorial'||command==='unit'||command==='document')result=await client.record(arg,command);
    else if(command==='filmstrip')result=await client.filmstrip(arg,options.limit);
    else if(command==='ocr')result=await client.ocr(arg);
    else if(command==='ocr-hits')result=await client.ocrHits(arg,v.keyword);
    else if(command==='download'){if(typeof v.out!=='string'||!v.out.trim())throw new Error('Supply --out FILE.jpg.');return saveDownload(v.out,await downloadImage(client,arg));}
    else if(command==='me')result=await client.me();else if(command==='verify')result=await client.verify();else if(command==='refresh')result=await client.refresh();
    else if(command==='call'){const text=extra===undefined?'{}':extra==='-'?await readCommandStdin():extra.trimStart().startsWith('{')?extra:await readCommandFile(extra,'utf8');let input:any;try{input=parseJson(text);}catch{throw new Error('Input must be valid JSON.');}result=await client.call(arg,input);}
    else throw new Error('Unknown Fold3 command. Run fam fold3 --help.');
  }
  if(typeof v.out==='string'){inspectResult(result);await mkdir(dirname(v.out),{recursive:true,mode:0o700});const temp=`${v.out}.${randomUUID()}.tmp`;try{await writeFile(temp,stringifyJson(result,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,v.out);}finally{await rm(temp,{force:true});}return {saved:v.out};}
  return result;
}
