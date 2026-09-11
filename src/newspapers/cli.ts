import {parseArgs} from 'node:util';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectResult} from '../shared/diagnostics.js';
import {readCommandFile, readCommandStdin} from '../shared/command-input.js';
import {CREDENTIAL_DIR} from '../shared/storage.js';
import {configureCredentials} from '../shared/credentials.js';
import {parseJson,stringifyJson} from '../shared/json.js';
import {NewspapersClient, operations, type Operation} from './client.js';
import {loadSession, loginNewspapers, sessionStatus} from './auth.js';
import {saveDownload} from './download.js';
const strings=['keyword','publication-id','country','region','city','from','to','sort','limit','cursor','offset','article-id','clipping-id','x','y','width','height','out'] as const;
export async function runProvider(argv: string[]) {
  const {values:parsed,positionals:[command,arg,extra]}=parseArgs({args:argv,allowPositionals:true,options:{...Object.fromEntries(strings.map(k=>[k,{type:'string' as const}])),stdin:{type:'boolean'},interactive:{type:'boolean'},'no-autofill':{type:'boolean'}}});
  const v=parsed as Record<string,string|boolean|undefined>;
  const number=(name:string)=>v[name]===undefined?undefined:Number(v[name]);
  const options=Object.fromEntries(Object.entries(v).filter(([k])=>k !== 'out' && (strings as readonly string[]).includes(k)).map(([k,value])=>[k.replace(/-([a-z])/g,(_m,l)=>l.toUpperCase()),['limit','offset','x','y','width','height'].includes(k)?Number(value):value]));
  let result:unknown;
  if(command==='credentials'){await configureCredentials('newspapers',{stdin:v.stdin as boolean});result={saved:true};}
  else if(command==='auth')result=sessionStatus(await loginNewspapers({interactive:v.interactive as boolean,autofill:!v['no-autofill']}));
  else if(command==='status')result={...sessionStatus(await loadSession()),credentialDirectory:CREDENTIAL_DIR};
  else if(command==='ops')result=Object.entries(operations).map(([name,op])=>({name,...op})).filter(op=>!arg||JSON.stringify(op).toLowerCase().includes(arg.toLowerCase()));
  else if(command==='schema'){if(!Object.hasOwn(operations,arg))throw new Error('Unknown Newspapers operation.');result={name:arg,...operations[arg as Operation]};}
  else{
    const client=await NewspapersClient.open();
    if(command==='me')result=await client.me();else if(command==='verify')result=await client.verify();else if(command==='refresh')result=await client.refresh();
    else if(command==='search')result=await client.search(options);
    else if(command==='locations')result=await client.locations(arg,number('limit'));
    else if(command==='browse')result=await client.browse(arg);
    else if(command==='publication')result=await client.publication(arg);
    else if(command==='issue')result=await client.issue(arg,extra);
    else if(command==='page')result=await client.page(arg);
    else if(command==='download'){
      if(typeof v.out!=='string' || !v.out.trim())throw new Error('Supply --out FILE.jpg for the page download.');
      return saveDownload(v.out,await client.download(arg));
    }
    else if(command==='hits')result=await client.hits(arg,v.keyword as string);
    else if(command==='clippings')result=await client.clippings(arg,number('offset'),number('limit'));
    else if(command==='articles')result=await client.articles(arg);
    else if(command==='ocr')result=await client.ocr(arg,options);
    else if(command==='call'){
      const text=extra===undefined?'{}':extra==='-'?await readCommandStdin():extra.trimStart().startsWith('{')?extra:await readCommandFile(extra,'utf8');
      let input:any;try{input=parseJson(text);}catch{throw new Error('Input must be valid JSON.');}result=await client.call(arg,input);
    }else throw new Error('Unknown Newspapers command. Run fam newspapers --help.');
  }
  if (typeof v.out==='string') {
    inspectResult(result);await mkdir(dirname(v.out),{recursive:true,mode:0o700});const temporary=v.out+'.'+randomUUID()+'.tmp';
    try{await writeFile(temporary,stringifyJson(result,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,v.out);}finally{await rm(temporary,{force:true});}
    return {saved:v.out};
  }
  return result;
}
