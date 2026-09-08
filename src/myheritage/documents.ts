import {fetchWithBrowser} from '../shared/browser-transport.js';
import {load} from 'cheerio';
import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {WEB, MyHeritageHttpError, type MyHeritageHttp} from './http.js';
import type {MyHeritageSession} from './auth.js';
import {pageJson} from './page-data.js';
import {parseRecordPage, recordUrl, MyHeritageResearchVerificationError} from './research.js';
import {stringifyJson} from '../shared/json.js';

export interface DocumentPage {page: number; name: string; originalUrl: string; previewUrl?: string; records: unknown[];}
export interface DocumentManifest {recordId: string; recordUrl: string; title: string; pageCount: number; initialPage: number; pages: DocumentPage[]; embeddedText?: string; transcriptionAvailable: boolean; relatedDocuments: {key: string; pageCount: number}[];}
function imageUrl(value: string, root: string, page: string) {
  const url = new URL(root && !value.includes('://') ? root + value : value, page);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Document sources must be HTTPS URLs without embedded credentials.');
  // The viewer's original-image download handler removes these colorization-only parameters.
  url.searchParams.delete('collection_in_color_token'); url.searchParams.delete('csrf_token');
  return url.href;
}
/** DocumentViewer.getAbsoluteImageSource uses sources.links/root and the second image of a low/high pair. */
export function parseDocumentPage(html: string, url: string, relatedKey?: string): DocumentManifest {
  const record = parseRecordPage(html, url);
  const initial = pageJson<Record<string, any>>(html, 'documentViewerOptions');
  if (!initial) throw new Error('No document viewer is available for this record with the saved session.');
  if (relatedKey && !initial.relatedRecords?.[relatedKey]) throw new Error('Unknown related document key; see fam myheritage.document get --url URL.');
  const viewer = relatedKey ? {...initial,...initial.relatedRecords[relatedKey]} : initial;
  const source = viewer.sources, links: unknown[] = Array.isArray(source) ? source : source?.links ?? [];
  if (!Array.isArray(links) || !links.length) throw new Error('This record has no accessible document pages.');
  const root = typeof source?.root === 'string' ? source.root : '';
  const pages = links.map((entry, index): DocumentPage => {
    const pair = Array.isArray(entry) ? entry : [entry];
    if (typeof pair[0] !== 'string' || typeof (pair[1] ?? pair[0]) !== 'string') throw new Error('Unsupported document source format.');
    return {page:index+1, name:String(source?.names?.[index] ?? `Page ${index+1}`), originalUrl:imageUrl(pair[1] ?? pair[0],root,url),
      ...(pair.length>1 ? {previewUrl:imageUrl(pair[0],root,url)} : {}), records:viewer.pagesContent?.[index] ?? []};
  });
  const $ = load(html); const text = $('#ocrTextContainer').clone(); text.find('script,style').remove(); text.find('br').replaceWith('\n');
  const embeddedText = text.text().trim();
  return {recordId:record.id,recordUrl:url,title:record.title,pageCount:pages.length,initialPage:Number(source?.start ?? 0)+1,pages,
    ...(embeddedText?{embeddedText}:{}),transcriptionAvailable:pageJson(html,'isImageTranscriptionEnabled')===true,
    relatedDocuments:Object.entries<any>(initial.relatedRecords ?? {}).map(([key,value])=>({key,pageCount:(Array.isArray(value.sources)?value.sources:value.sources?.links??[]).length}))};
}
function destination(value: string) {
  const url = new URL(value);
  if (url.protocol!=='https:' || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)) throw new Error('Refusing an unsafe document destination.');
  return url;
}
async function atomicFile(path: string, data: string | Uint8Array) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=`${path}.${randomUUID()}.tmp`;
  try{await writeFile(temp,data,{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
}
export class MyHeritageDocuments {
  private cached = new Map<string, Promise<DocumentManifest>>();
  constructor(private readonly session: MyHeritageSession, private readonly http: Pick<MyHeritageHttp,'exchange'|'jar'>, private readonly persist:()=>Promise<void>){}
  private async load(value: string, relatedKey?: string) {
    const url=recordUrl(value).href,key=JSON.stringify([url,relatedKey]);
    if(!this.cached.has(key))this.cached.set(key,(async()=>{
      const r=await this.http.exchange<string>(url,{response:'text',headers:this.session.browser?.userAgent?{'User-Agent':this.session.browser.userAgent}:{}}).catch(e=>{if(e instanceof MyHeritageHttpError&&e.status===406)throw new MyHeritageResearchVerificationError();throw e;});
      const manifest=parseDocumentPage(r.data,url,relatedKey);await this.persist();return manifest;
    })().catch(error=>{this.cached.delete(key);throw error;}));
    return this.cached.get(key)!;
  }
  async document(value: string, relatedKey?: string) {return this.load(value,relatedKey);}
  async download(value: string, output: string, page = 1, relatedKey?: string) {
    if(!Number.isSafeInteger(page)||page<1)throw new Error('Document page numbers start at 1.');
    const manifest=await this.document(value,relatedKey),selected=manifest.pages[page-1];if(!selected)throw new Error(`Document has ${manifest.pageCount} pages.`);
    let url=destination(selected.originalUrl),bytes:Uint8Array|undefined,contentType='';const visited=new Set<string>();
    for(let attempt=0;attempt<6;attempt++){
      if(visited.has(url.href))throw new Error('Document redirect loop.');visited.add(url.href);
      const headers:Record<string,string>={Accept:'image/*,application/pdf',...(this.session.browser?.userAgent?{'User-Agent':this.session.browser.userAgent}:{})};
      // Account cookies never go to FamilySearch, Filae or other image providers.
      if(url.origin===WEB){const cookie=await this.http.jar.getCookieString(url.href);if(cookie)headers.Cookie=cookie;}
      const r=await fetchWithBrowser('myheritage',url,{headers},()=>fetch(url,{headers,redirect:'manual',signal:AbortSignal.timeout(60_000)}),url.origin===WEB?this.http.jar:undefined);
      if([301,302,303,307,308].includes(r.status)){const next=r.headers.get('location');await r.body?.cancel();if(!next)throw new Error('Document redirect has no destination.');url=destination(new URL(next,url).href);continue;}
      if(!r.ok){await r.body?.cancel();throw new Error(`Document provider ${url.hostname} returned HTTP ${r.status}; no retries were attempted.`);}
      contentType=r.headers.get('content-type')??'';
      if(!/^(image\/|application\/pdf|application\/octet-stream)/i.test(contentType)){await r.body?.cancel();throw new Error('Document provider returned a page instead of a document.');}
      if(Number(r.headers.get('content-length')??0)>200_000_000){await r.body?.cancel();throw new Error('Document exceeds 200 MB.');}
      const chunks:Uint8Array[]=[];let length=0;for await(const chunk of r.body!){length+=chunk.length;if(length>200_000_000){await r.body?.cancel().catch(()=>{});throw new Error('Document exceeds 200 MB.');}chunks.push(chunk);}
      bytes=Buffer.concat(chunks);break;
    }
    if(!bytes?.length)throw new Error('No document bytes received.');
    const pdf=Buffer.from(bytes.subarray(0,5)).toString()==='%PDF-';
    const info=pdf?{format:'pdf'}:await sharp(bytes,{limitInputPixels:300_000_000}).metadata().then(m=>{if(!m.width||!m.height)throw new Error('Invalid document image.');return{format:m.format,width:m.width,height:m.height};}).catch(()=>{throw new Error('Downloaded bytes are not a readable document image.');});
    const path=resolve(output),provenance={recordId:manifest.recordId,recordUrl:manifest.recordUrl,title:manifest.title,page,pageCount:manifest.pageCount,
      sourceUrl:selected.originalUrl,finalUrl:url.href,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),contentType,...info,downloadedAt:new Date().toISOString()};
    await atomicFile(path,bytes);await atomicFile(`${path}.json`,stringifyJson(provenance,2)+'\n');
    return{saved:path,metadata:`${path}.json`,page,pageCount:manifest.pageCount,bytes:bytes.length,...info};
  }
}
