import type {FindResult, ListResult} from './client.js';

export function humanWayback(data: unknown): string {
  const result = data as FindResult | ListResult;
  if ('snapshots' in result) return `${result.snapshots.length ? result.snapshots.map(s => `${s.timestamp}  ${s.archiveUrl}`).join('\n') : 'No captures found.'}\n`
    + (result.truncated ? '\nMore captures available: increase --limit or narrow --from/--to.\n' : '');
  return result.snapshot ? `${result.snapshot.archiveUrl}\nCaptured: ${result.snapshot.timestamp}\n` : `No successful capture indexed for ${result.url}.\n`;
}
