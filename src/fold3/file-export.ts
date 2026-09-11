import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm,lstat,open} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {hostname} from 'node:os';
import {parseJson,stringifyJson} from '../shared/json.js';
import type {Fold3Client} from './client.js';
import {downloadImage,saveDownload} from './download.js';
import {fileImages,fileInfo,type FileInfo,type FileImage} from './research.js';
import {integer,object} from './parse.js';

export interface FileExportOptions {maxPages?:number;resume?:boolean}
interface ExportPage extends FileImage {filename:string;sha256?:string;bytes?:number}
interface Manifest {version:1;provider:'Fold3';file:FileInfo;createdAt:string;updatedAt:string;complete:boolean;pages:ExportPage[]}
const filename=(page:FileImage)=>`${String(page.ordinal+1).padStart(6,'0')}-${page.imageId}.jpg`;
async function writeManifest(path:string,manifest:Manifest){
  const temp=`${path}.${randomUUID()}.tmp`;
  try{await writeFile(temp,stringifyJson(manifest,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
async function optionalStat(path:string){try{return await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
async function verifySaved(directory:string,page:ExportPage){
  const path=join(directory,filename(page)),sidecar=path+'.json',scan=await optionalStat(path),side=await optionalStat(sidecar);
  if(!scan&&!side){if(page.sha256)throw new Error('An exported page is missing; restore it before resuming.');return null;}
  if(!scan?.isFile()||!side?.isFile()||scan.size>64*1024*1024||side.size>4*1024*1024)throw new Error('An existing export page or sidecar is incomplete or invalid; it was left unchanged.');
  const metadata=object(parseJson(await readFile(sidecar,'utf8'))),bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex');
  if(metadata.imageId!==page.imageId||metadata.sha256!==sha256||metadata.bytes!==bytes.length||page.sha256!==undefined&&page.sha256!==sha256||page.bytes!==undefined&&page.bytes!==bytes.length)throw new Error('An existing exported page failed its identity, size, or checksum check; it was left unchanged.');
  return {sha256,bytes:bytes.length};
}

/** Enumerate first, then save pages sequentially. Resume validates every saved pair. */
export async function exportFile(client:Fold3Client,value:string,destination:string,options:FileExportOptions={}){
  if(!destination?.trim())throw new Error('Supply --out DIRECTORY for the file export.');
  if(Object.keys(options).some(k=>!['maxPages','resume'].includes(k))||options.resume!==undefined&&typeof options.resume!=='boolean')throw new Error('Unknown Fold3 file export option.');
  const maxPages=integer(options.maxPages??500,1,10000),file=await fileInfo(client,value);
  if(file.total>maxPages)throw new Error(`The file contains ${file.total} pages, exceeding --max-pages ${maxPages}. Raise the bound explicitly to export it.`);
  const pages:ExportPage[]=[];
  for(let offset=0;offset<file.total;){
    const part=await fileImages(client,file,100,offset);pages.push(...part.items.map(p=>({...p,filename:filename(p)})));offset+=part.items.length;
  }
  if(pages.length!==file.total||new Set(pages.map(p=>p.imageId)).size!==pages.length)throw new Error('Fold3 file enumeration was incomplete or contained repeated images.');
  const directory=resolve(destination),manifestPath=join(directory,'manifest.json'),lockPath=join(directory,'.fam-fold3.lock');
  await mkdir(dirname(directory),{recursive:true,mode:0o700});
  if(options.resume){if(!(await lstat(directory)).isDirectory())throw new Error('Resume requires the original export directory.');}
  else await mkdir(directory,{mode:0o700}); // Existing directories are never reused implicitly.
  let lock;
  try{lock=await open(lockPath,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error(`This export is locked. If no exporter is running, remove ${lockPath} and retry with --resume.`);throw e;}
  let manifest:Manifest|undefined,downloaded=0,reused=0;
  try{
    await lock.writeFile(stringifyJson({pid:process.pid,host:hostname(),startedAt:new Date().toISOString()}));
    if(options.resume){
      const stat=await lstat(manifestPath);if(!stat.isFile()||stat.size>16*1024*1024)throw new Error('Invalid Fold3 export manifest.');
      const saved=object(parseJson(await readFile(manifestPath,'utf8')));
      if(saved.version!==1||saved.provider!=='Fold3'||saved.file?.anchorImageId!==file.anchorImageId||saved.file?.clusterId!==file.clusterId||saved.file?.total!==file.total||!Array.isArray(saved.pages)||saved.pages.length!==pages.length||saved.pages.some((p:any,i:number)=>p.imageId!==pages[i].imageId||p.ordinal!==i||p.filename!==pages[i].filename))throw new Error('The export manifest does not match this file or its current page order; existing files were left unchanged.');
      for(let i=0;i<pages.length;i++){
        const p=saved.pages[i];
        if(p.sha256!==undefined&&(typeof p.sha256!=='string'||! /^[a-f0-9]{64}$/.test(p.sha256))||p.bytes!==undefined&&(!Number.isSafeInteger(p.bytes)||p.bytes<1))throw new Error('Invalid checksum in Fold3 export manifest.');
        pages[i].sha256=p.sha256;pages[i].bytes=p.bytes;
      }
      // Validate all existing files before making further downloads.
      for(const page of pages){const existing=await verifySaved(directory,page);if(existing){Object.assign(page,existing);reused++;}}
      manifest={version:1,provider:'Fold3',file,createdAt:typeof saved.createdAt==='string'?saved.createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),complete:false,pages};
    }else manifest={version:1,provider:'Fold3',file,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),complete:false,pages};
    await writeManifest(manifestPath,manifest);
    for(const page of pages){
      if(page.sha256)continue;
      const saved=await saveDownload(join(directory,page.filename),await downloadImage(client,page.imageId));
      page.sha256=saved.sha256;page.bytes=saved.bytes;downloaded++;manifest.updatedAt=new Date().toISOString();await writeManifest(manifestPath,manifest);
    }
    manifest.complete=true;manifest.updatedAt=new Date().toISOString();await writeManifest(manifestPath,manifest);
    return {saved:directory,manifest:manifestPath,complete:true,total:file.total,downloaded,reused,clusterId:file.clusterId,
      note:'Every page in the website scan cluster was saved with a citation and checksum. A cluster is the website grouping, not a guarantee of archival completeness or original image resolution.'};
  }catch(error){
    if(manifest&&error instanceof Error)error.message+=` Progress is saved in ${manifestPath}; retry the same file and directory with --resume.`;
    throw error;
  }finally{await lock.close();await rm(lockPath,{force:true});}
}
