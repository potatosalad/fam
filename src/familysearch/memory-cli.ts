import {InputError} from '../shared/input-error.js';
import {parseArgs} from 'node:util';
import {basename, dirname, extname, resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, link, rm, lstat} from 'node:fs/promises';
import {readCommandBinaryFile} from '../shared/command-input.js';
import {stringifyJson} from '../shared/json.js';
import {memoryUpload} from './workflows.js';
import {FamilySearchClient} from './client.js';

const mediaTypes: Record<string, string> = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.txt': 'text/plain'};

export async function prepareMemoryUpload(args: string[]) {
  const {values: v} = parseArgs({args, allowPositionals: false, options: Object.fromEntries(
    ['file', 'title', 'description', 'visibility', 'media-type', 'max-bytes'].map(key => [key, {type: 'string' as const}]))});
  if (!v.file) throw new InputError('Memory upload requires --file PATH.');
  if (!['private', 'public'].includes(v.visibility ?? '')) throw new InputError('Choose --visibility private or public.');
  const maximum = v['max-bytes'] === undefined ? 16 * 1024 * 1024 : Number(v['max-bytes']);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 256 * 1024 * 1024) throw new InputError('--max-bytes must be 1–268435456.');
  const path = resolve(v.file), filename = basename(path);
  const mediaType = v['media-type'] ?? mediaTypes[extname(filename).toLowerCase()];
  if (!mediaType || !/^[a-z][a-z0-9.+-]*\/[a-z][a-z0-9.+-]*$/i.test(mediaType)) throw new InputError('Specify a valid --media-type for this file, such as image/jpeg or application/pdf.');
  const bytes = await readCommandBinaryFile(path, maximum);
  const body = memoryUpload({file: new Blob([bytes], {type: mediaType}), filename, title: v.title, description: v.description, isPrivate: v.visibility === 'private'});
  return {body, upload: {filename, mediaType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), visibility: v.visibility,
    ...(v.title === undefined ? {} : {title: v.title}), ...(v.description === undefined ? {} : {description: v.description})}};
}

export async function runMemoryUpload(args: string[], output?: string) {
  const prepared = await prepareMemoryUpload(args);
  // Prepare a private receipt file before uploading, so unwritable paths fail
  // before a mutation. Publish it without replacing an existing receipt.
  const path = output ? resolve(output) : undefined;
  const temporary = path ? `${path}.${randomUUID()}.tmp` : undefined;
  if (path) {
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    try {await lstat(path); throw new Error('Receipt already exists; choose a new --out path.');}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  }
  const file = temporary ? await open(temporary, 'wx', 0o600) : undefined;
  let received = false, published = false;
  try {
    const client = await FamilySearchClient.open();
    const data = await client.operation('memories.upload', {body: prepared.body});
    const result = {...data, upload: prepared.upload};
    if (!file) return result;
    received = true;
    let written = false;
    try {
      await file.writeFile(`${stringifyJson(result, 2)}\n`);
      await file.sync();
      written = true;
      await link(temporary!, path!);
      published = true;
    } catch {
      return {...result, receiptWarning: `Upload completed. Could not save ${path}. ${written ? 'A complete receipt is' : 'A possibly incomplete receipt is'} at ${temporary}; the full result is also returned here.`};
    }
    return {saved: path, ...result};
  } finally {
    await file?.close().catch(() => {});
    if (temporary && (!received || published)) await rm(temporary, {force: true});
  }
}
