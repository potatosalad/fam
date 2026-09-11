import type {Fold3Client} from './client.js';
import {fileInfo,fileImages,type FileInfo,type FileImage} from './research.js';
import {Fold3Error,WEB} from './http.js';
import {id,integer,object} from './parse.js';

export interface TranscriptPage extends FileImage {status:'available'|'unavailable'|'access-denied';text?:string}
export interface FileTranscript {version:1;provider:'Fold3';kind:'file-ocr';file:FileInfo;retrievedAt:string;complete:boolean;pages:TranscriptPage[]}
const maxTextBytes=16*1024*1024;
export async function fileTranscript(client:Fold3Client,value:string,maxPages=100):Promise<FileTranscript>{
  integer(maxPages,1,10000);const file=await fileInfo(client,value);
  if(file.total>maxPages)throw new Error(`The file has ${file.total} pages, exceeding --max-pages ${maxPages}.`);
  const inventory:FileImage[]=[];
  for(let offset=0;offset<file.total;){const r=await fileImages(client,file,100,offset);inventory.push(...r.items);offset+=r.items.length;}
  if(new Set(inventory.map(p=>p.imageId)).size!==file.total)throw new Error('The file contains repeated image IDs.');
  const pages:TranscriptPage[]=[];let bytes=0;
  for(const page of inventory){
    try{const result=await client.ocr(page.imageId);bytes+=Buffer.byteLength(result.text);if(bytes>maxTextBytes)throw new Error('File OCR exceeded the 16 MiB text bound.');pages.push({...page,status:'available',text:result.text});}
    catch(error){if(!(error instanceof Fold3Error)||!['not-found','ocr-unavailable','access-denied'].includes(error.code))throw error;pages.push({...page,status:error.code==='access-denied'?'access-denied':'unavailable'});}
  }
  return {version:1,provider:'Fold3',kind:'file-ocr',file,retrievedAt:new Date().toISOString(),complete:pages.every(p=>p.status==='available'),pages};
}

/** Validate cached input and rebuild citations from IDs, never trust cached URLs. */
export function validateTranscript(value:unknown):FileTranscript{
  const v=object(value),file=object(v.file);
  if(v.version!==1||v.provider!=='Fold3'||v.kind!=='file-ocr'||!Array.isArray(v.pages)||!Number.isSafeInteger(file.total)||file.total<1||file.total>10000||v.pages.length!==file.total)throw new Error('Expected a complete Fold3 file OCR inventory.');
  id(file.anchorImageId);let bytes=0;
  const pages=v.pages.map((page:any,i:number)=>{
    object(page);const imageId=id(page.imageId);
    if(page.ordinal!==i||typeof page.title!=='string'||!['available','unavailable','access-denied'].includes(page.status)||page.status==='available'&&(typeof page.text!=='string'||!page.text.trim())||page.status!=='available'&&page.text!==undefined)throw new Error('Invalid Fold3 transcript page.');
    if(page.text)bytes+=Buffer.byteLength(page.text);
    return {imageId,ordinal:i,title:page.title,status:page.status,text:page.text,sourceUrl:`${WEB}/image/${imageId}`} as TranscriptPage;
  });
  if(bytes>maxTextBytes||new Set(pages.map(p=>p.imageId)).size!==pages.length||!pages.some(p=>p.imageId===file.anchorImageId))throw new Error('Invalid or oversized Fold3 transcript.');
  return {...v,file,pages,complete:pages.every(p=>p.status==='available')} as FileTranscript;
}

export function searchTranscript(value:unknown,keyword:string,limit=20,offset=0){
  if(typeof keyword!=='string'||!keyword.trim()||keyword.length>500)throw new Error('Supply a nonempty literal OCR search term of at most 500 characters.');
  integer(limit,1,100);integer(offset,0,9999);if(offset+limit>10000)throw new Error('OCR match pagination is bounded to 10,000 matches.');
  const transcript=validateTranscript(value),pattern=new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
  const matches:Array<{imageId:string;page:number;sourceUrl:string;start:number;length:number;context:string}>=[];let seen=0,more=false;
  outer:for(const page of transcript.pages){if(page.status!=='available')continue;
    for(const match of page.text!.matchAll(pattern)){
      if(seen++<offset)continue;
      if(matches.length===limit){more=true;break outer;}
      matches.push({imageId:page.imageId,page:page.ordinal+1,sourceUrl:page.sourceUrl,start:match.index,length:match[0].length,context:page.text!.slice(Math.max(0,match.index-100),match.index+match[0].length+100)});
    }
  }
  return {keyword,matches,offset,limit,nextOffset:more&&offset+limit<10000?offset+limit:null,windowLimitReached:more&&offset+limit>=10000,totalPages:transcript.pages.length,pagesWithOcr:transcript.pages.filter(p=>p.status==='available').length,
    incomplete:!transcript.complete,unavailablePages:transcript.pages.filter(p=>p.status!=='available').map(p=>({imageId:p.imageId,page:p.ordinal+1,status:p.status,sourceUrl:p.sourceUrl})),
    note:'Literal, case-insensitive search of available machine OCR. Character offsets are UTF-16; citations point to the original scans. Missing OCR is not evidence that the person or phrase is absent.'};
}
