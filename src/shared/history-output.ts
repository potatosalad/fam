import type {HistoryEntry, HistoryView} from './history-query.js';

// Log strings are data: never allow terminal escape sequences to reach the screen.
const safe = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (value: unknown, width: number): string => {
  const text = safe(value); return text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;
};
const when = (value: string) => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
const duration = (value: number | null): string => value === null ? '—' : value < 1000 ? `${value}ms` : value < 60_000 ? `${(value / 1000).toFixed(1)}s` : `${(value / 60_000).toFixed(1)}m`;
const labels = {success: 'OK', soft_failure: 'SOFT', hard_failure: 'HARD', incomplete: 'UNFINISHED'};
function wrapped(value: unknown, width: number, indent = ''): string[] {
  const lines: string[] = [];
  let line = indent;
  for (const word of safe(value).split(' ')) {
    if (line.length > indent.length && line.length + word.length + 1 > width) {lines.push(line); line = indent;}
    if (word.length > width - indent.length) {
      if (line.length > indent.length) {lines.push(line); line = indent;}
      for (let start = 0; start < word.length; start += width - indent.length) lines.push(indent + word.slice(start, start + width - indent.length));
    } else line += `${line.length > indent.length ? ' ' : ''}${word}`;
  }
  if (line.length > indent.length) lines.push(line);
  return lines;
}
function detail(row: HistoryEntry, width: number): string[] {
  const lines = [...wrapped(`${labels[row.outcome]} · ${row.command}`, width), `ID: ${row.id}`,
    `Started: ${when(row.startedAt)} UTC`, `Finished: ${row.finishedAt ? `${when(row.finishedAt)} UTC` : 'No finish recorded'}`,
    `Duration: ${duration(row.durationMs)}    Exit: ${row.exitCode ?? '—'}    PID: ${row.pid ?? '—'}`,
    `Version: ${safe(row.version ?? 'unknown')}    Build: ${safe(row.build?.revision ?? 'unknown')}${row.build?.dirty ? ' (uncommitted changes)' : ''}`,
    `Runtime: ${safe(row.runtime?.node ?? 'unknown')} · ${safe(row.runtime?.platform ?? 'unknown')} ${safe(row.runtime?.arch ?? '')}`,
    '', ...wrapped(`Recorded arguments: fam ${row.argv.join(' ')}`, width),
    'Argument values were redacted when recorded.'];
  if (row.outcome === 'incomplete') lines.push('', ...wrapped(row.message, width));
  const errorLines = (error: Record<string, unknown>, indent = ''): void => {
    for (const key of ['name', 'code', 'status', 'statusCode', 'message']) if (error[key] !== undefined) lines.push(...wrapped(`${key}: ${safe(error[key])}`, width, indent));
    if (Array.isArray(error.stack)) for (const frame of error.stack) lines.push(...wrapped(frame, width, indent + '  '));
    if (error.cause && typeof error.cause === 'object') {lines.push(indent + 'Cause:'); errorLines(error.cause as Record<string, unknown>, indent + '  ');}
  };
  if (row.error) {lines.push('', 'Error'); errorLines(row.error, '  ');}
  if (row.diagnostics.length) lines.push('', `Diagnostics (${row.diagnostics.length})`);
  for (const finding of row.diagnostics) {
    lines.push(...wrapped(`${finding.code}: ${finding.message}`, width, '  '));
    if (finding.path) lines.push(...wrapped(`Result path: ${finding.path}`, width, '    '));
    if (finding.error) errorLines(finding.error, '    ');
  }
  if (row.droppedDiagnostics) lines.push(`${row.droppedDiagnostics} additional diagnostics were omitted when recorded.`);
  lines.push('', ...wrapped(`Source: ${row.source.file}`, width), `Lines: start ${row.source.startLine ?? 'missing'}, finish ${row.source.finishLine ?? 'missing'}`);
  return lines;
}
export function historyOutput(result: HistoryView, columns = 100): string {
  const width = Math.max(60, columns), lines: string[] = [];
  if (result.view === 'get') lines.push(...detail(result.entry, width));
  else if (result.view === 'summary') {
    lines.push('Command history summary', `${result.count} invocations · ${result.counts.success} OK · ${result.counts.soft_failure} soft · ${result.counts.hard_failure} hard · ${result.counts.incomplete} unfinished`);
    if (result.since && result.until) lines.push(`${when(result.since)} → ${when(result.until)} UTC`);
    lines.push('', `By ${result.groupBy} · most failures first`);
    if (!result.groups.length) lines.push('No matching history groups.');
    else {
      lines.push('  CALLS  HARD  SOFT UNFIN  GROUP');
      for (const group of result.groups) lines.push(`${String(group.count).padStart(7)}${String(group.hard_failure).padStart(6)}${String(group.soft_failure).padStart(6)}${String(group.incomplete).padStart(6)}  ${clip(group.key, width - 27)}`);
    }
    if (result.groupBy === 'code') lines.push('', 'One invocation can appear under several codes; each code counts it once.');
    if (result.next) lines.push('', ...wrapped(`More: ${result.next}`, width));
  } else {
    lines.push(result.view === 'failures' ? 'Command failures · newest first' : 'Recent command history · newest first');
    if (!result.entries.length) lines.push('', result.view === 'failures' ? 'No matching failures.' : 'No matching history entries.');
    else {
      lines.push('', `WHEN (UTC)           RESULT      DURATION  ID${width >= 90 ? '        COMMAND' : ''}`);
      for (const row of result.entries) {
        const prefix = `${when(row.startedAt)}  ${labels[row.outcome].padEnd(10)}  ${duration(row.durationMs).padStart(7)}  ${row.id.slice(0, 8)}  `;
        if (width < 90) lines.push(prefix.trimEnd(), ...wrapped(row.command, width, '  '));
        else {
          const command = wrapped(row.command, width, ' '.repeat(prefix.length));
          lines.push(prefix + (command.shift()?.trim() ?? ''), ...command);
        }
        if (row.codes.length || row.message) lines.push('  ' + clip(`${row.codes.join(', ')}${row.message ? ` · ${row.message}` : ''}`, width - 2));
      }
      lines.push('', `Showing ${result.offset + 1}–${result.offset + result.entries.length}${result.hasMore ? ' · more available' : ''}.`,
        `Details: fam cli.history get --id ${result.entries[0].id.slice(0, 8)}`);
      if (result.next) lines.push(...wrapped(`More: ${result.next}`, width));
    }
  }
  if (result.view !== 'get') {
    lines.push('', ...wrapped('SOFT = recovered or returned issues; HARD = command failed; unfinished = no finish recorded.', width));
    if (result.utilityHidden) lines.push(...wrapped('Successful history queries and completion lookups are hidden; use --include-utility to show them.', width));
  }
  if (result.notices.length) {
    lines.push('', `History read notices (${result.notices.length + result.omittedNotices}; ${result.skippedRecords} records skipped)`);
    for (const notice of result.notices) lines.push(...wrapped(`${notice.file}${notice.line ? `:${notice.line}` : ''}: ${notice.message}`, width, '  '));
    if (result.omittedNotices) lines.push(`  ${result.omittedNotices} additional notices omitted.`);
  }
  if (result.view !== 'get') lines.push('', ...wrapped(`History: ${result.directory}`, width));
  return lines.join('\n') + '\n';
}
