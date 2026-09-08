import {mkdir, open, readFile, rm, lstat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AmericanAncestorsClient} from './client.js';
import {validateSearch, type SearchOptions} from './search.js';
import {saveOutput} from './download.js';
import {stringifyJson, parseJson} from '../shared/json.js';

type SearchPage = Awaited<ReturnType<AmericanAncestorsClient['search']>>;
type Entry = SearchPage['items'][number] & {details?: Awaited<ReturnType<AmericanAncestorsClient['record']>>; retrievedAt: string};
export interface ResearchExport {
  schemaVersion: 1; provider: 'americanancestors'; kind: 'record-export';
  createdAt: string; updatedAt: string; options: SearchOptions; includeDetails: boolean;
  items: Entry[]; total: number | null; query: string | null; complete: boolean;
  checkpoint: {page: number; index: number; pageHash: string | null};
  note: string;
}
export interface ExportOptions {out?: string; resume?: string; search?: SearchOptions; limit: number; details?: boolean}
const maximumRecords = 10_000, maximumBytes = 50 * 1024 * 1024;
function count(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value)>=minimum && Number(value)<=maximum;
}
export function validateExport(value: unknown): asserts value is ResearchExport {
  const s = value as ResearchExport;
  if (!s || s.schemaVersion!==1 || s.provider!=='americanancestors' || s.kind!=='record-export' || !Array.isArray(s.items) || s.items.length>maximumRecords ||
      typeof s.includeDetails!=='boolean' || typeof s.complete!=='boolean' || !s.checkpoint || !count(s.checkpoint.page,1,1_000_000) || !count(s.checkpoint.index,0,1000) ||
      s.checkpoint.pageHash!==null && !/^[a-f0-9]{64}$/.test(s.checkpoint.pageHash) ||
      s.total!==null && !count(s.total,0,Number.MAX_SAFE_INTEGER) || s.query!==null && typeof s.query!=='string') throw new Error('Invalid American Ancestors export checkpoint.');
  validateSearch(s.options);
  const seen=new Set<string>();
  for(const item of s.items) {
    if(!item || typeof item.recordId!=='string' || typeof item.collectionId!=='string' || !/^\d+$/.test(item.recordId) || !/^\d+$/.test(item.collectionId))throw new Error('Invalid record IDs in the export.');
    const key=`${item.collectionId}:${item.recordId}`;if(seen.has(key))throw new Error('Duplicate record IDs in the export.');seen.add(key);
  }
  if(s.total!==null && s.items.length>s.total || s.checkpoint.pageHash===null && s.checkpoint.index!==0 || s.complete && s.total!==s.items.length)throw new Error('Inconsistent American Ancestors export checkpoint.');
}
const fingerprint = (page: SearchPage) => createHash('sha256').update(stringifyJson({total:page.total,pageSize:page.pageSize,ids:page.items.map(r=>[r.collectionId,r.recordId])})).digest('hex');
function queryIdentity(source: string) {const q=new URL(source).searchParams;q.delete('page');q.sort();return q.toString();}

/** One private atomic file contains both records and cursor, so failures cannot advance past unsaved data. */
export async function exportRecords(client: Pick<AmericanAncestorsClient,'search'|'record'>, options: ExportOptions) {
  if(!count(options.limit,1,1000))throw new Error('Export --limit must be 1–1000 additional records per run.');
  if(!options.out && !options.resume)throw new Error('A new export requires --out; continue an existing file with --resume.');
  if(options.resume && (options.search!==undefined || options.details!==undefined))throw new Error('Resume uses the saved query and details setting; do not supply search filters or --details.');
  const path=resolve(options.resume ?? options.out!);
  if(options.resume && options.out && resolve(options.out)!==path)throw new Error('Resume must update the same export file; omit --out.');
  if(!options.resume) {validateSearch(options.search!);if((options.search!.page??1)!==1)throw new Error('New exports must start at page 1 to track completeness.');}
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const lockPath=path+'.lock';
  let lock;
  try {lock=await open(lockPath,'wx',0o600);}
  catch(error) {if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error(`Export is locked. Wait for the other writer. After a forced process termination, remove ${lockPath} only after confirming no export is running.`);throw error;}
  let interrupted=false;
  const interrupt=()=>{interrupted=true;};
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  const checkInterrupted=()=>{if(interrupted)throw new Error('Export interrupted; completed records are saved. Resume the same file.');};
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    let state:ResearchExport;
    if(options.resume) {
      const info=await lstat(path);
      if(!info.isFile() || info.size>maximumBytes)throw new Error('Resume requires a regular export file no larger than 50 MiB.');
      let value:unknown;try{value=parseJson(await readFile(path,'utf8'));}catch{throw new Error('Cannot parse the export file.');}
      validateExport(value);state=value;
    } else {
      // Exclusive creation protects existing research files, including symlinks.
      const file=await open(path,'wx',0o600);await file.close();
      const now=new Date().toISOString();
      state={schemaVersion:1,provider:'americanancestors',kind:'record-export',createdAt:now,updatedAt:now,options:options.search!,includeDetails:options.details??false,
        items:[],total:null,query:null,complete:false,checkpoint:{page:options.search!.page??1,index:0,pageHash:null},
        note:'Search snapshot with source URLs. --details adds indexed fields and collection citations, not scans or OCR. The index can change; changed pages halt resume.'};
    }
    const save=async()=>{
      state.updatedAt=new Date().toISOString();const text=stringifyJson(state,2)+'\n';
      if(Buffer.byteLength(text)>maximumBytes)throw new Error('Export exceeds 50 MiB; the previous checkpoint remains intact.');
      await saveOutput(path,text);
    };
    if(!options.resume)await save();
    const before=state.items.length, seen=new Set(state.items.map(r=>`${r.collectionId}:${r.recordId}`));
    let requests=0;
    while(!state.complete && state.items.length-before<options.limit && state.items.length<maximumRecords) {
      checkInterrupted();if(requests++)await delay(500);
      const page=await client.search({...state.options,page:state.checkpoint.page});checkInterrupted();
      if(page.page!==state.checkpoint.page)throw new Error('Provider ignored the export page; the checkpoint was retained.');
      const expectedCount=Math.max(0,Math.min(page.pageSize,page.total-(page.page-1)*page.pageSize));
      if(!count(page.pageSize,1,1000) || !count(page.total,0,Number.MAX_SAFE_INTEGER) || page.items.length!==expectedCount ||
          page.nextPage!==(page.page*page.pageSize<page.total?page.page+1:null))throw new Error('Provider returned inconsistent export pagination; the checkpoint was retained.');
      const hash=fingerprint(page), query=queryIdentity(page.sourceUrl);
      if(state.total!==null && state.total!==page.total || state.query!==null && state.query!==query ||
          state.checkpoint.pageHash!==null && state.checkpoint.pageHash!==hash || state.checkpoint.index>page.items.length || state.checkpoint.index>state.items.length || state.checkpoint.index>0 &&
          stringifyJson(state.items.slice(-state.checkpoint.index).map(r=>[r.collectionId,r.recordId]))!==stringifyJson(page.items.slice(0,state.checkpoint.index).map(r=>[r.collectionId,r.recordId])))
        throw new Error('Search results or field definitions changed since the checkpoint. Start a fresh export to avoid skipping or duplicating records.');
      state.total=page.total;state.query=query;state.checkpoint.pageHash=hash;
      while(state.checkpoint.index<page.items.length && state.items.length-before<options.limit && state.items.length<maximumRecords) {
        checkInterrupted();const item=page.items[state.checkpoint.index],key=`${item.collectionId}:${item.recordId}`;
        if(seen.has(key))throw new Error('The provider repeated an exported record. The previous checkpoint was retained.');
        let details:Entry['details'];
        if(state.includeDetails) {if(!item.sourceUrl)throw new Error('Export record has no source URL.');await delay(250);checkInterrupted();details=await client.record(item.sourceUrl);checkInterrupted();}
        state.items.push({...item,...(details?{details}:{}),retrievedAt:new Date().toISOString()});seen.add(key);state.checkpoint.index++;
        state.complete=page.nextPage===null && state.checkpoint.index===page.items.length;
        await save();
      }
      if(page.items.length===0) {state.complete=page.total===0;await save();if(!state.complete)throw new Error('Provider returned an unexpected empty export page.');}
      if(state.checkpoint.index===page.items.length && page.nextPage!==null && state.items.length-before<options.limit && state.items.length<maximumRecords) {
        if(page.nextPage!==page.page+1)throw new Error('Provider returned invalid continuation.');
        // Leave the last committed page/hash on disk until the next page has saved data.
        state.checkpoint={page:page.nextPage,index:0,pageHash:null};
      }
    }
    return {saved:path,added:state.items.length-before,records:state.items.length,total:state.total,complete:state.complete,includeDetails:state.includeDetails,
      resume:state.complete?null:path,atCapacity:state.items.length===maximumRecords&&!state.complete};
  } finally {process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);await lock.close();await rm(lockPath,{force:true});}
}
