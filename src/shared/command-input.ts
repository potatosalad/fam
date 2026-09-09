import {readFile} from 'node:fs/promises';
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
