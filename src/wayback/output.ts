import type {FindResult, ListResult} from './client.js';

export function humanWayback(data: unknown): string {
  const result = data as FindResult | ListResult;
  const warnings = (result.warnings ?? []).map(w => `Warning: ${w}\n`).join('');
  if ('snapshots' in result) return warnings + `${result.snapshots.length ? result.snapshots.map(s => `${s.timestamp}  ${s.archiveUrl}`).join('\n') : result.partial ? 'No safe captures returned in this partial CDX window.' : 'No captures found.'}\n`
    + (result.truncated ? '\nCDX response window filled: increase --limit or narrow --from/--to; additional safe captures are not guaranteed.\n' : '');
  return warnings + (result.snapshot ? `${result.snapshot.archiveUrl}\nCaptured: ${result.snapshot.timestamp}\n` : result.partial ? 'No safe capture returned in this partial CDX window.\n' : `No successful capture indexed for ${result.url}.\n`);
}
