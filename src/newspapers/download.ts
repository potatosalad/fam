import sharp from 'sharp';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile, link, rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {NewspapersHttp, NewspapersError, WEB, IMG} from './http.js';
import {account, pageMetadata} from './parse.js';

/** Match the viewer's Save as JPG size calculation, including its larger-page limits. */
export function downloadDimensions(width: number, height: number) {
  if (![width,height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 100_000)) throw new NewspapersError('api-changed');
  const area = width * height;
  const scale = area <= 10_240_000 ? 1 : Math.sqrt(Math.min(Math.max(10_240_000,area/4),64_000_000)/area);
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

/** Authorization and signed image URLs are used here only, never returned in metadata. */
export async function downloadPage(http: NewspapersHttp, pageId: string, authorization: any) {
  const citation = pageMetadata(authorization,pageId);
  if (authorization.image.canView !== true || authorization.rights?.Download?.allowed !== true) throw new NewspapersError('access-denied');
  if (typeof authorization.iat !== 'string' || !authorization.iat) throw new NewspapersError('api-changed');
  const dimensions = downloadDimensions(authorization.image.width,authorization.image.height);
  const user = account((await http.get(`${WEB}/account/`)).text());
  const url = new URL('/img/img',IMG);
  url.search = new URLSearchParams({institutionId:'0',id:pageId,user:user.id,iat:authorization.iat,
    brightness:'0',contrast:'0',invert:'0',width:String(dimensions.width),height:String(dimensions.height),
    a:'download',filename:`newspapers_${pageId}`,highlight:'light',ts:String(Math.floor(Date.now()/1000))}).toString();
  const response = await http.get(url,{Accept:'image/jpeg'});
  if (!/^(?:image\/jpeg|(?:application|binary)\/octet-stream)(?:;|$)/i.test(response.contentType)) throw new NewspapersError('api-changed');
  try {
    const image = sharp(response.bytes,{failOn:'warning',limitInputPixels:65_000_000});
    const metadata = await image.metadata();
    if (metadata.format !== 'jpeg' || metadata.width !== dimensions.width || metadata.height !== dimensions.height) throw new Error('Unexpected scan dimensions or format.');
    // Decode all pixels so an HTTP 200 or valid header cannot disguise a truncated scan.
    await image.stats();
  } catch {throw new NewspapersError('api-changed');}
  return {bytes:response.bytes,metadata:{pageId,sourceUrl:citation.sourceUrl,citation,format:'jpeg',...dimensions,
    originalWidth:authorization.image.width as number,originalHeight:authorization.image.height as number,
    representation:'Whole-page website Save as JPG export; larger scans are downsampled by the viewer’s size calculation.',
    downloadedAt:new Date().toISOString(),bytes:response.bytes.length,sha256:createHash('sha256').update(response.bytes).digest('hex')}};
}

export type NewspapersDownload = Awaited<ReturnType<typeof downloadPage>>;

/** Publish a private image and citation sidecar without replacing either existing file. */
export async function saveDownload(path: string, result: NewspapersDownload) {
  path = resolve(path);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp = `${path}.${randomUUID()}.tmp`, sidecar = `${path}.json`, sideTemp = `${sidecar}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp,result.bytes,{mode:0o600,flag:'wx'});
    await writeFile(sideTemp,JSON.stringify(result.metadata,null,2)+'\n',{mode:0o600,flag:'wx'});
    await link(temp,path);
    try {await link(sideTemp,sidecar);} catch(error) {await rm(path);throw error;}
  } finally {await rm(temp,{force:true});await rm(sideTemp,{force:true});}
  return {saved:path,sidecar,...result.metadata};
}
