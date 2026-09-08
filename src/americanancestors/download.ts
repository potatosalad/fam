import sharp, {type OverlayOptions} from 'sharp';
import {load} from 'cheerio';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, writeFile, link, rm, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {AmericanAncestorsClient} from './client.js';
import {AmericanAncestorsError, checkUrl} from './http.js';
export function deepZoom(xml: string) {
  const $ = load(xml, {xmlMode:true}), image = $('Image'), size = image.children('Size');
  const width = Number(size.attr('Width')), height = Number(size.attr('Height')), tileSize = Number(image.attr('TileSize')), overlap = Number(image.attr('Overlap')), format = image.attr('Format');
  if (image.length !== 1 || ![width,height,tileSize,overlap].every(Number.isSafeInteger) || width < 1 || height < 1 || width * height > 100_000_000 ||
      tileSize < 64 || tileSize > 2048 || overlap < 0 || overlap > 8 || !['jpg','png'].includes(format ?? '') || image.attr('Url')) throw new AmericanAncestorsError('api-changed');
  const columns = Math.ceil(width/tileSize), rows = Math.ceil(height/tileSize);
  if (columns * rows > 1024) throw new Error('Image exceeds the 1024-tile download limit.');
  return {width,height,tileSize,overlap,format:format!,columns,rows,level:Math.ceil(Math.log2(Math.max(width,height)))};
}
export async function downloadImage(client: AmericanAncestorsClient, source: string) {
  const image = await client.image(source);
  if (image.kind === 'familysearch') throw new Error('This scan is hosted by FamilySearch. Use fam americanancestors.image get for its ARK, then fam familysearch.image download with your FamilySearch session.');
  if (!image.downloadAvailable) throw new AmericanAncestorsError('access-denied');
  const manifest = checkUrl(image.imageSource,true), xml = await client.http.text(manifest,{media:true}), info = deepZoom(xml.text);
  const base = manifest.href.replace(/\.xml$/,'_files'), tiles: OverlayOptions[] = [];
  for (let y=0;y<info.rows;y++) for (let x=0;x<info.columns;x++) {
    if (tiles.length) await delay(100);
    const response = await client.http.request(`${base}/${info.level}/${x}_${y}.${info.format}`,{media:true});
    if (!/^(?:image\/(?:jpeg|png)|(?:application|binary)\/octet-stream)(?:;|$)/i.test(response.contentType)) throw new AmericanAncestorsError('api-changed');
    const left = x * info.tileSize, top = y * info.tileSize, width = Math.min(info.tileSize,info.width-left), height = Math.min(info.tileSize,info.height-top);
    try {
      const tile = await sharp(response.bytes,{failOn:'error',limitInputPixels:5_000_000}).extract({left:x ? info.overlap : 0,top:y ? info.overlap : 0,width,height}).png().toBuffer();
      tiles.push({input:tile,left,top});
    } catch {throw new Error('American Ancestors returned an invalid image tile; no download was saved.');}
  }
  const bytes = await sharp({create:{width:info.width,height:info.height,channels:3,background:'white'}}).composite(tiles).png().toBuffer();
  return {bytes,metadata:{sourceUrl:image.sourceUrl,citation:image.citation,manifestUrl:manifest.href,format:'png',width:info.width,height:info.height,tiles:tiles.length,
    representation:'Reconstructed full-resolution published Deep Zoom tiles, not the archival original file.',downloadedAt:new Date().toISOString(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
export async function saveDownload(path: string, result: Awaited<ReturnType<typeof downloadImage>>) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp = `${path}.${randomUUID()}.tmp`, side = `${path}.json`, sideTemp = `${side}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp,result.bytes,{mode:0o600,flag:'wx'}); await writeFile(sideTemp,JSON.stringify(result.metadata,null,2)+'\n',{mode:0o600,flag:'wx'});
    await link(temp,path); try {await link(sideTemp,side);} catch(error) {await rm(path); throw error;}
  } finally {await rm(temp,{force:true});await rm(sideTemp,{force:true});}
}
export async function saveOutput(path: string, text: string) {
  await mkdir(dirname(path),{recursive:true,mode:0o700}); const temp = `${path}.${randomUUID()}.tmp`;
  try {await writeFile(temp,text,{mode:0o600,flag:'wx'});await rename(temp,path);} finally {await rm(temp,{force:true});}
}
