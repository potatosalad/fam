import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, link } from 'node:fs/promises';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { GeneanetClient, id } from './client.js';
import { checkUrl, WEB } from './http.js';

export interface Download { bytes: Uint8Array; metadata: Record<string, unknown> }
async function download(client: GeneanetClient, url: string, metadata: Record<string, unknown>, referer: string): Promise<Download> {
  const target = checkUrl(url);
  if (target.origin !== WEB || !/^(?:\/media\/download\/\d+\/\d+|\/archival-registers\/download\/\d+\/\d+|\/library\/viewer\/pdf\/\d+)$/.test(target.pathname) ||
      [...target.searchParams.keys()].some(k => k !== 'page')) throw new Error('The viewer returned an unsupported download URL.');
  const response = await client.http.request(target, {binary: true, referer});
  const bytes = response.bytes, type = response.contentType.split(';')[0].trim();
  let properties: Record<string, unknown>;
  if (type === 'application/pdf' || type === 'application/x-pdf') {
    if (!Buffer.from(bytes.subarray(0, 8)).toString().startsWith('%PDF-') || !Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString().includes('%%EOF')) throw new Error('Geneanet returned an incomplete or invalid PDF.');
    properties = {format: 'pdf'};
  } else if (/^image\/(jpeg|png|gif|webp|tiff)$/.test(type)) {
    try {
      const image = sharp(bytes, {failOn: 'error', limitInputPixels: 100_000_000});
      const info = await image.metadata(); await image.stats();
      if (!info.width || !info.height) throw new Error();
      properties = {format: info.format, width: info.width, height: info.height};
    } catch { throw new Error('Geneanet did not return a decodable image.'); }
  } else throw new Error('Geneanet did not return an image or PDF; no file was saved.');
  return {bytes, metadata: {...metadata, sourceUrl: referer, downloadUrl: response.url, downloadedAt: new Date().toISOString(),
    contentType: type, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), ...properties}};
}
export async function downloadMedia(client: GeneanetClient, depositId: string, viewId: string): Promise<Download> {
  const deposit = await client.media(id(depositId));
  const view = deposit.views.find(v => String(v.id) === id(viewId));
  if (!view) throw new Error('This view does not belong to the Geneanet media deposit.');
  return download(client, `${WEB}/media/download/${depositId}/${viewId}`, {kind: 'media', depositId, viewId, page: view.page,
    title: deposit.title, contributor: deposit.username, type: deposit.type}, `${WEB}/media/public/${depositId}`);
}
export async function downloadRecord(client: GeneanetClient, source: string): Promise<Download> {
  const record = await client.record(source), viewer = record.viewer;
  if (!viewer?.downloadUrl) throw new Error('This record has no permitted image/PDF download. Use media metadata for a portrait; an index may have no attached scan.');
  const target = checkUrl(viewer.downloadUrl);
  const expected = viewer.kind === 'register' ? `/archival-registers/download/${id(viewer.id)}/${id(viewer.page)}` : `/library/viewer/pdf/${id(viewer.id)}`;
  if (target.pathname !== expected) throw new Error('The download does not match the requested record.');
  if (viewer.kind === 'book' && viewer.singlePage && target.searchParams.get('page') !== viewer.page) throw new Error('The PDF download does not match the requested page.');
  return download(client, target.href, {kind: viewer.kind, id: viewer.id, page: viewer.page, pages: viewer.pages,
    singlePage: viewer.singlePage, title: record.title, attribution: record.text.slice(0, 4000)}, record.url);
}
/** Atomic creation with no overwriting, even when another process creates the destination. */
export async function saveDownload(path: string, result: Download): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${randomUUID()}.tmp`, side = `${path}.json`, sideTemp = `${side}.${randomUUID()}.tmp`;
  let created = false;
  try {
    await writeFile(temporary, result.bytes, {flag: 'wx', mode: 0o600});
    await writeFile(sideTemp, `${JSON.stringify(result.metadata, null, 2)}\n`, {flag: 'wx', mode: 0o600});
    await link(temporary, path); created = true;
    try { await link(sideTemp, side); } catch (error) { if (created) await rm(path); throw error; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Download destination or sidecar already exists.');
    throw error;
  } finally { await rm(temporary, {force: true}); await rm(sideTemp, {force: true}); }
}
export async function saveOutput(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, {flag: 'wx', mode: 0o600}); await rename(temporary, path); }
  finally { await rm(temporary, {force: true}); }
}
