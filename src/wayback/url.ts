import {UsageError} from '../shared/command-runtime.js';

export function originalUrl(input: string): string {
  let url: URL;
  try {url = new URL(input);} catch {throw new UsageError('--url must be an absolute HTTP(S) URL.');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new UsageError('--url must use HTTP(S) without embedded credentials.');
  url.hash = '';
  return url.href;
}
export function archiveUrl(input: string): string {
  const url = new URL(originalUrl(input));
  if (!['archive.org', 'web.archive.org'].includes(url.hostname) || url.port)
    throw new Error('Wayback returned a destination outside Internet Archive.');
  url.protocol = 'https:';
  return url.href;
}
export function timestamp(input?: string): string | undefined {
  if (input === undefined) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const date = new Date(`${input}T00:00:00Z`);
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== input) throw new UsageError('Invalid calendar date.');
    return input.replaceAll('-', '');
  }
  if (!/^\d{4}(?:\d{2}){0,5}$/.test(input)) throw new UsageError('Use YYYY, YYYY-MM-DD, or a Wayback timestamp (YYYYMMDDhhmmss).');
  const padded = fullTimestamp(input);
  const date = new Date(`${padded.slice(0,4)}-${padded.slice(4,6)}-${padded.slice(6,8)}T${padded.slice(8,10)}:${padded.slice(10,12)}:${padded.slice(12,14)}Z`);
  if (!Number.isFinite(+date) || date.toISOString().replace(/[-:T]/g, '').slice(0,14) !== padded) throw new UsageError('Invalid Wayback timestamp.');
  return input;
}
export const fullTimestamp = (input: string): string => input + '0101000000'.slice(input.length - 4);
export interface Snapshot {timestamp: string; originalUrl: string; archiveUrl: string; rawUrl: string; status?: number; mimeType?: string; digest?: string}
export function snapshot(time: string, original: string): Snapshot {
  if (!/^\d{14}$/.test(time)) throw new Error('Wayback returned an invalid capture timestamp.');
  timestamp(time);
  const url = originalUrl(original);
  return {timestamp: time, originalUrl: url, archiveUrl: `https://web.archive.org/web/${time}/${url}`, rawUrl: `https://web.archive.org/web/${time}id_/${url}`};
}
export function replaySnapshot(input: string): Snapshot | undefined {
  const url = new URL(originalUrl(input));
  if (url.hostname !== 'web.archive.org') return undefined;
  archiveUrl(url.href);
  const match = (url.pathname + url.search).match(/^\/web\/(\d{14})(?:[a-z]{1,3}_)?\/(https?:\/\/.+)$/);
  if (!match) throw new UsageError('Use an original URL or a Wayback snapshot URL with a full 14-digit timestamp.');
  return snapshot(match[1], match[2]);
}
