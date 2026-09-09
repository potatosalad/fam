import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {CREDENTIAL_DIR, writePrivateFile} from './storage.js';
import type {SearchProgress} from './command-embeddings.js';

export async function searchModelFile(model: {id: string; revision: string}, name: string, expected: {bytes: number; sha256: string}, progress?: SearchProgress): Promise<Uint8Array> {
  const relative = `cache/command-search/models/${model.revision}/${name}`;
  const valid = (bytes: Uint8Array) => bytes.length === expected.bytes && createHash('sha256').update(bytes).digest('hex') === expected.sha256;
  try {
    const bytes = await readFile(join(CREDENTIAL_DIR, relative));
    if (valid(bytes)) return bytes;
  } catch { /* Fetch missing or unreadable model data, without touching credentials. */ }
  progress?.(`Downloading local search ${model.id}/${name} (${(expected.bytes / 1e6).toFixed(1)} MB)…`);
  const response = await fetch(`https://huggingface.co/${model.id}/resolve/${model.revision}/${name}`, {signal: AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`Search model download failed (HTTP ${response.status}).`);
  // Bound download size as well as time, and publish only verified complete files.
  if (!response.body) throw new Error('Search model download returned no data.');
  const reader = response.body.getReader(), bytes = new Uint8Array(expected.bytes);
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (length + value.length > bytes.length) throw new Error('Search model download exceeded its expected size.');
      bytes.set(value, length); length += value.length;
    }
  } finally {await reader.cancel();}
  if (length !== bytes.length || !valid(bytes)) throw new Error('Search model download failed its SHA-256 integrity check.');
  try {await writePrivateFile(relative, bytes);}
  catch {progress?.('Could not cache the search model; using it in memory for this invocation.');}
  return bytes;
}
