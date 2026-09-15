import {open, readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';

export interface CommandInput {kind: 'file' | 'stdin'; path: string | null; data: Buffer; complete: boolean}
export interface HistoryInput {kind: 'file' | 'stdin'; path: string | null; snapshot: string | null; bytes: number; sha256: string; complete: boolean; error?: string}
let sink: ((input: CommandInput) => Promise<void>) | undefined;
export function setCommandInputSink(next?: typeof sink): void {sink = next;}
async function capture(input: CommandInput): Promise<void> {
  try {await sink?.(input);} catch { /* History failures must not change command behavior. */ }
}

/** Snapshot the bytes actually read, before parsing, trimming, or decoding the input. */
export async function readCommandFile(path: string): Promise<Buffer<ArrayBuffer>>;
export async function readCommandFile(path: string, encoding: 'utf8'): Promise<string>;
export async function readCommandFile(path: string, encoding?: 'utf8'): Promise<Buffer<ArrayBuffer> | string> {
  const data = await readFile(path);
  await capture({kind: 'file', path: resolve(path), data, complete: true});
  return encoding ? data.toString(encoding) : data;
}

/** Bounded regular-file reads for uploads; capture exactly the bytes consumed. */
export async function readCommandBinaryFile(path: string, maximum: number): Promise<Buffer<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('Invalid input byte limit.');
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  const chunks: Buffer<ArrayBuffer>[] = [];
  let bytes = 0, complete = false;
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Upload input must be a regular file.');
    if (info.size > maximum) throw new Error(`Upload file exceeds --max-bytes (${maximum}).`);
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, maximum + 1 - bytes));
      const {bytesRead} = await file.read(chunk);
      if (!bytesRead) {complete = true; break;}
      chunks.push(chunk.subarray(0, bytesRead)); bytes += bytesRead;
      if (bytes > maximum) throw new Error(`Upload file exceeds --max-bytes (${maximum}).`);
    }
    if (!bytes) throw new Error('Upload file must not be empty.');
    return Buffer.concat(chunks);
  } finally {
    await file.close();
    await capture({kind: 'file', path: resolve(path), data: Buffer.concat(chunks), complete});
  }
}

export async function readCommandStdin(maximum = Infinity, limitMessage = 'Input exceeded its size limit.'): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0, complete = false;
  try {
    for await (const chunk of process.stdin) {
      const data = Buffer.from(chunk);
      chunks.push(data); bytes += data.length;
      if (bytes > maximum) throw new Error(limitMessage);
    }
    complete = true;
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await capture({kind: 'stdin', path: null, data: Buffer.concat(chunks), complete});
  }
}
