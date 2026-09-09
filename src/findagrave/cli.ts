import {readCommandFile as readFile, readCommandStdin} from '../shared/command-input.js';
import {inspectResult} from '../shared/diagnostics.js';
import { configureCredentials } from '../shared/credentials.js';
import { parseArgs } from 'node:util';
import { writeFile, mkdir, rename, rm, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJson, stringifyJson } from '../shared/json.js';
import { CREDENTIAL_DIR, readPrivateJson } from '../shared/storage.js';
import { authenticateFindagrave, sessionStatus, type FindagraveSession } from './auth.js';
import { aliases, contracts, graphqlOperation } from './catalog.js';
import { FindagraveClient } from './client.js';
import { restOperations, restOperation, type RestArguments } from './rest.js';
import { integer, searchInput, memorialPhotos, downloadPhoto } from './research.js';

async function jsonInput(value?: string): Promise<Record<string,unknown>> {
  if (!value) return {};
  let text: string;
  if (value === '-') text = await readCommandStdin();
  else text = value.trimStart().startsWith('{') ? value : await readFile(value, 'utf8');
  let parsed: unknown; try {parsed = parseJson(text);} catch {throw new Error('Input must be valid JSON.');}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Input must be a JSON object.');
  return parsed as Record<string,unknown>;
}
async function outputFile(path: string, data: string | Uint8Array, exclusive = false) {
  await mkdir(dirname(path), {recursive:true, mode:0o700});
  if (exclusive) {await writeFile(path, data, {flag:'wx', mode:0o600}); return;}
  const temp = `${path}.${randomUUID()}.tmp`;
  try {await writeFile(temp, data, {flag:'wx', mode:0o600}); await rename(temp,path);} finally {await rm(temp,{force:true});}
}
export async function runProvider(argv: string[]): Promise<unknown> {
  const {values:v, positionals:p} = parseArgs({args: argv, allowPositionals:true, options:{
    help:{type:'boolean',short:'h'}, stdin:{type:'boolean'}, out:{type:'string'}, anonymous:{type:'boolean'}, limit:{type:'string'}, offset:{type:'string'}, input:{type:'string'},
    name:{type:'string'}, 'first-name':{type:'string'}, 'middle-name':{type:'string'}, 'last-name':{type:'string'},
    bio:{type:'string'}, relative:{type:'string'}, 'include-maiden-name':{type:'boolean'}, 'include-nickname':{type:'boolean'}, similar:{type:'boolean'}, plot:{type:'string'},
    'birth-filter':{type:'string'}, 'death-filter':{type:'string'},
    'birth-year':{type:'string'}, 'death-year':{type:'string'}, 'year-range':{type:'string'}, location:{type:'string'}, cemetery:{type:'string',multiple:true},
    exact:{type:'boolean'}, famous:{type:'boolean'}, veteran:{type:'boolean'}, 'has-gps':{type:'boolean'}, sort:{type:'string'}, descending:{type:'boolean'},
    latitude:{type:'string'}, longitude:{type:'string'}, distance:{type:'string'},
  }});
  const [command='help', first, second] = p;
  if (v.stdin && command !== 'credentials') throw new Error('--stdin belongs to fam findagrave.credential set.');
  const arities: Record<string,[number,number]> = {credentials:[0,0],auth:[0,0],status:[0,0],verify:[0,0],me:[0,0],search:[0,0],
    memorial:[1,1],relatives:[1,1],photos:[1,1],download:[2,2],cemeteries:[0,1],cemetery:[1,1],locations:[1,1],contributor:[1,1],
    'my-cemeteries':[0,0],'virtual-cemeteries':[0,1],'virtual-cemetery':[1,1],'volunteer-cemeteries':[0,0],tags:[0,0],requests:[0,1],
    ops:[0,1],schema:[1,1],models:[0,1],enums:[0,1],'http-sites':[0,1],gql:[1,2],query:[1,2],call:[1,2]};
  const arity = arities[command];
  if (!arity || p.length-1 < arity[0] || p.length-1 > arity[1]) throw new Error(`Invalid command or arguments; see fam cli.command list --provider findagrave.`);
  const searchFlags = ['name','first-name','middle-name','last-name','birth-year','death-year','year-range','cemetery','exact','famous','veteran','has-gps','sort','descending',
    'bio','relative','include-maiden-name','include-nickname','similar','plot','birth-filter','death-filter'] as const;
  if (command !== 'search' && searchFlags.some(k=>v[k] !== undefined)) throw new Error('Memorial search options belong to search.');
  if (!['search','cemeteries'].includes(command) && (v.input !== undefined || v.location !== undefined)) throw new Error('--input and --location belong to search or cemeteries.');
  if (command !== 'cemeteries' && [v.latitude,v.longitude,v.distance].some(x=>x!==undefined)) throw new Error('Coordinate options belong to cemeteries.');
  const paginated = ['search','photos','cemeteries','locations','my-cemeteries','virtual-cemeteries','virtual-cemetery','requests'];
  if (!paginated.includes(command) && [v.limit,v.offset].some(x=>x!==undefined)) throw new Error('This command does not accept pagination options.');
  if (command === 'download') {
    if (!v.out) throw new Error('download requires --out FILE.');
    for (const path of [v.out,`${v.out}.json`]) {
      try {await access(path);} catch(e) {if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;throw e;}
      throw new Error('Download destination or sidecar already exists.');
    }
  }
  const size = integer(v.limit,20,1,100), from = integer(v.offset,0);
  const filter = (value: unknown) => stringifyJson(value).toLowerCase().includes((first??'').toLowerCase());
  let result: unknown;
  if (command === 'credentials') {await configureCredentials('findagrave',{stdin:v.stdin});result={saved:true,credentialDirectory:CREDENTIAL_DIR,next:'fam findagrave.session login'};}
  else if (command === 'auth') result=sessionStatus(await authenticateFindagrave());
  else if (command === 'status') result={credentialDirectory:CREDENTIAL_DIR,...sessionStatus(await readPrivateJson<FindagraveSession>('findagrave/session.json'))};
  else if (command === 'ops') result=[...contracts.graphql.map(o=>({id:o.id,name:o.name,kind:o.kind,variables:o.variables,aliases:Object.keys(aliases).filter(k=>aliases[k]===o.id)})),...restOperations].filter(filter);
  else if (command === 'schema') result=restOperations.some(o=>o.name===first)?restOperation(first!):graphqlOperation(first!);
  else if (command === 'models') result=contracts.models.filter(filter);
  else if (command === 'enums') result=contracts.enums.filter(filter);
  else if (command === 'http-sites') result=contracts.httpCallSites.filter(filter);
  else {
    const input=await jsonInput(v.input);
    const search = command === 'search' ? searchInput({name:v.name,firstName:v['first-name'],middleName:v['middle-name'],lastName:v['last-name'],
      bio:v.bio,relative:v.relative,includeMaidenName:v['include-maiden-name'],includeNickname:v['include-nickname'],similar:v.similar,plot:v.plot,
      birthFilter:v['birth-filter'],deathFilter:v['death-filter'],
      birthYear:v['birth-year'],deathYear:v['death-year'],yearRange:v['year-range'],location:v.location,cemetery:v.cemetery,exact:v.exact,famous:v.famous,
      veteran:v.veteran,hasGps:v['has-gps'],sort:v.sort,descending:v.descending,size:v.limit===undefined?undefined:size,from:v.offset===undefined?undefined:from,input}) : {};
    let cemeterySearch: Record<string,unknown> = {};
    if (command === 'cemeteries') {
      cemeterySearch={...input,...(first?{name:first}:{}),...(v.location?{containingLocationId:[v.location]}:{}),size,from};
      if ((v.latitude===undefined)!==(v.longitude===undefined)) throw new Error('Use --latitude and --longitude together.');
      if (v.latitude!==undefined) {
        const lat=Number(v.latitude),lon=Number(v.longitude);
        if (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) throw new Error('Coordinates are out of range.');
        cemeterySearch.coordinates={lat,lon};
      }
      if (v.distance!==undefined) cemeterySearch.distance=integer(v.distance,0,1);
      if (!cemeterySearch.name&&!cemeterySearch.coordinates&&!cemeterySearch.containingLocationId) throw new Error('Provide a cemetery name, location, or coordinates.');
    }
    const client=await FindagraveClient.open(v.anonymous);
    switch(command) {
      case 'verify':result=await client.validateSession();break;
      case 'me':result=await client.me();break;
      case 'search':result=await client.search(search);break;
      case 'memorial':result=await client.memorial(first!);break;
      case 'relatives':result=(await client.memorial(first!)).relationships;break;
      case 'photos':result=await memorialPhotos(client,first!,size,from);break;
      case 'download':{
        const download=await downloadPhoto(client,first!,second!);
        await outputFile(v.out!,download.bytes,true);
        try {await outputFile(`${v.out}.json`,`${stringifyJson(download.metadata,2)}\n`,true);} catch(e){await rm(v.out!,{force:true});throw e;}
        return {saved: v.out, metadata: `${v.out}.json`, bytes: download.bytes.byteLength, source: download.metadata};
      }
      case 'cemeteries':result=await client.cemeteries(cemeterySearch);break;
      case 'cemetery':result=await client.cemetery(first!);break;
      case 'locations':result=await client.locations(first!,size,from);break;
      case 'contributor':result=await client.contributor(first!);break;
      case 'my-cemeteries':result=await client.myCemeteries(size,from);break;
      case 'virtual-cemeteries':result=await client.virtualCemeteries(first,size,from);break;
      case 'virtual-cemetery':result=await client.virtualCemetery(first!,size,from);break;
      case 'volunteer-cemeteries':result=await client.graphql('VolunteerCemeteries');break;
      case 'tags':result=await client.graphql('GlobalMemorialTags');break;
      case 'requests':{
        const type=first??'mine';if(!['mine','claimed','volunteer'].includes(type))throw new Error('Use requests mine, claimed, or volunteer.');
        result=await client.call(`requests.${type}`,{query:{limit:size,skip:from}});break;
      }
      case 'gql':result=await client.graphql(first!,await jsonInput(second));break;
      case 'query':result=await client.query(await readFile(first!,'utf8'),await jsonInput(second));break;
      case 'call':result=await client.call(first!,await jsonInput(second) as RestArguments);break;
    }
  }
  const output=`${stringifyJson(result??null,2)}\n`;
  if (v.out) inspectResult(result);
  if(v.out){await outputFile(v.out,output); return {saved: v.out};}
  return result;
}
