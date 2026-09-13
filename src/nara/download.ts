import {mkdir, open, writeFile, link, rm, lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {NaraError, mediaUrl} from './url.js';

export async function downloadObject(object: {downloadUrl: string | null; [key: string]: unknown}, out: string,
  options: {fetch?: typeof fetch; timeout: number; maxBytes: number}) {
  const sidecar = `${out}.provenance.json`;
  for (const path of [out, sidecar]) {
    try {await lstat(path);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error;}
    throw Object.assign(new NaraError('Output or provenance file already exists.'), {code: 'EEXIST'});
  }
  let url = mediaUrl(object.downloadUrl!);
  const signal = AbortSignal.timeout(options.timeout * 1000);
  let response: Response | undefined;
  for (let hop = 0; hop < 5; hop++) {
    response = await (options.fetch ?? fetch)(url, {method: 'GET', credentials: 'omit', redirect: 'manual', signal,
      headers: {Accept: '*/*', 'User-Agent': 'fam (+https://github.com/potatosalad/fam)'}});
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location || hop === 4) throw new NaraError('Catalog download redirect limit exceeded.', 'UNSAFE_URL');
    url = mediaUrl(new URL(location, url).href);
  }
  if (!response?.ok || !response.body) {
    await response?.body?.cancel();
    throw new NaraError(`Catalog download returned HTTP ${response?.status ?? 'unknown'}.`, 'DOWNLOAD_FAILED');
  }
  const contentType = response.headers.get('content-type') ?? '';
  const advertised = response.headers.get('content-length');
  if (/text\/html|application\/(?:json|xml)/i.test(contentType) || advertised && /^\d+$/.test(advertised) && BigInt(advertised) > BigInt(options.maxBytes)) {
    await response.body.cancel();
    throw new NaraError('Download returned an error document or exceeded --max-bytes; nothing was saved.', 'INVALID_DOWNLOAD');
  }
  await mkdir(dirname(out), {recursive: true, mode: 0o700});
  const temporary = `${out}.${randomUUID()}.tmp`, sideTemp = `${sidecar}.${randomUUID()}.tmp`;
  let saved = false, savedSide = false, bytes = 0;
  const hash = createHash('sha256');
  const reader = response.body.getReader();
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > options.maxBytes) throw new NaraError('Download exceeded --max-bytes; nothing was saved.', 'SIZE_LIMIT');
        if (bytes === part.value.length && /^\s*(?:<!doctype\s+html|<html|\{\s*"(?:message|error)")/i.test(Buffer.from(part.value).toString('utf8', 0, 300)))
          throw new NaraError('Download returned an error document; nothing was saved.', 'INVALID_DOWNLOAD');
        hash.update(part.value); await handle.writeFile(part.value);
      }
    } finally {await handle.close();}
    if (!bytes || advertised && /^\d+$/.test(advertised) && !response.headers.has('content-encoding') && BigInt(bytes) !== BigInt(advertised))
      throw new NaraError('Download was empty or truncated; nothing was saved.', 'INVALID_DOWNLOAD');
    const sha256 = hash.digest('hex');
    const metadata = {schemaVersion: 1, ...object, downloadedAt: new Date().toISOString(), downloadUrl: url, contentType, bytes, sha256};
    await writeFile(sideTemp, JSON.stringify(metadata, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
    await link(temporary, out); saved = true;
    await link(sideTemp, sidecar); savedSide = true;
    return {saved: out, provenance: sidecar, bytes, sha256, sourceUrl: url};
  } catch (error) {
    if (saved) await rm(out, {force: true});
    if (savedSide) await rm(sidecar, {force: true});
    throw error;
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock(); await rm(temporary, {force: true}); await rm(sideTemp, {force: true});}
}
