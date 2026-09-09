import {join} from 'node:path';
import {CREDENTIAL_DIR, historyFiles, readPrivateJsonl, appendPrivateJsonl} from './storage.js';
import {randomUUID} from 'node:crypto';
import {UsageError, type Values} from './command-runtime.js';
import {errorSummary} from './command-history.js';
import {reportDiagnostic} from './diagnostics.js';
import {shellCommand} from './shell-command.js';
import type {HistoryInput} from './command-input.js';
import {historyStatistics, type HistoryStatsData} from './history-stats.js';

export const historyOutcomes = ['success', 'soft_failure', 'hard_failure', 'incomplete'] as const;
export type HistoryOutcome = typeof historyOutcomes[number];
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const array = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface HistoryDiagnostic {code: string; message: string; path?: string; error?: ObjectValue}
export interface HistoryEntry {
  id: string; command: string; provider: string | null; startedAt: string; finishedAt: string | null;
  lastRecordedAt: string; archived: boolean; archivedAt: string | null; archiveId: string | null;
  outcome: HistoryOutcome; durationMs: number | null; exitCode: number | null; settled: boolean | null;
  pid: number | null; argv: string[]; version: string | null; build: {revision: string | null; dirty: boolean | null} | null;
  commandLine: string; cwd: string | null; argvCapture: 'verbatim' | 'legacy_redacted';
  inputs: HistoryInput[];
  runtime: {node: string | null; platform: string | null; arch: string | null} | null;
  error?: ObjectValue; diagnostics: HistoryDiagnostic[]; droppedDiagnostics: number;
  codes: string[]; message: string; source: {file: string; startLine: number | null; finishLine: number | null; lastLine: number};
}
interface Notice {file: string; line?: number; message: string}
interface ScanInfo {directory: string; filesScanned: number; skippedRecords: number; notices: Notice[]; omittedNotices: number; utilityHidden: boolean; archivedHidden: number}
interface Filters {
  provider: string[]; command: string; outcome: string[]; code: string; query: string;
  since: number; until: number; includeUtility: boolean;
}
interface ArchiveSelection extends Omit<Filters, 'since' | 'until'> {since: string | null; until: string | null}
export interface HistoryArchiveMarker {
  schemaVersion: 1; event: 'archive'; id: string; timestamp: string; before: string; selection: ArchiveSelection;
  files: Record<string, number>;
}
export interface HistoryArchive extends ScanInfo {
  view: 'archive'; dryRun: boolean; count: number; counts: Record<HistoryOutcome, number>;
  before: string; selection: ArchiveSelection; marker: HistoryArchiveMarker | null; markerFile: string;
}
export interface HistoryList extends ScanInfo {
  view: 'list' | 'failures'; entries: HistoryEntry[]; limit: number; offset: number; hasMore: boolean;
  nextOffset: number | null; next: string | null;
}
export interface HistoryGroup {
  key: string; count: number; success: number; soft_failure: number; hard_failure: number; incomplete: number; lastSeen: string;
}
export interface HistorySummary extends ScanInfo {
  view: 'summary'; count: number; counts: Record<HistoryOutcome, number>; since: string | null; until: string | null;
  groupBy: string; groups: HistoryGroup[]; totalGroups: number; next: string | null;
}
export interface HistoryDetail extends ScanInfo {view: 'get'; entry: HistoryEntry}
export interface HistoryStats extends ScanInfo, HistoryStatsData {}
export type HistoryView = HistoryList | HistorySummary | HistoryDetail | HistoryArchive | HistoryStats;

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function historyTime(value: string | undefined, bound: 'since' | 'until', now = Date.now()): number {
  if (value === undefined) return bound === 'since' ? -Infinity : Infinity;
  let time: number;
  const relative = /^(\d+)(m|h|d|w)$/.exec(value);
  if (relative) time = now - Number(relative[1]) * ({m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000}[relative[2]]!);
  else if (value === 'today') time = Date.parse(new Date(now).toISOString().slice(0, 10)) + (bound === 'until' ? 86_400_000 - 1 : 0);
  else if (validDate(value)) time = Date.parse(value) + (bound === 'until' ? 86_400_000 - 1 : 0);
  else if (validDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) time = Date.parse(value);
  else time = NaN;
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime()))
    throw new UsageError(`--${bound} requires today, a duration such as 24h or 7d, a UTC date, or an ISO timestamp with a timezone.`, 'fam cli.history list --since 7d');
  return time;
}
function filters(values: Values, now: number): Filters {
  const result: Filters = {provider: typeof values.provider === 'string' ? [values.provider] : array(values.provider),
    command: String(values.command ?? '').replace(/^fam\s+/i, '').trim().toLowerCase(),
    outcome: typeof values.outcome === 'string' ? [values.outcome] : array(values.outcome),
    code: String(values.code ?? '').toLowerCase(), query: String(values.query ?? '').toLowerCase(),
    since: historyTime(values.since as string | undefined, 'since', now), until: historyTime(values.until as string | undefined, 'until', now),
    includeUtility: values['include-utility'] === true};
  if (result.since > result.until) throw new UsageError('--since must not be later than --until.', 'fam cli.history list --since 7d');
  return result;
}
function codes(error: unknown): string[] {
  if (!object(error)) return [];
  return [...(typeof error.code === 'string' ? [error.code] : []),
    ...(typeof error.status === 'number' ? [`HTTP_${error.status}`] : typeof error.statusCode === 'number' ? [`HTTP_${error.statusCode}`] : []),
    ...codes(error.cause)];
}
function recordedError(error: ObjectValue, depth = 0): ObjectValue {
  const result = errorSummary(error);
  // The writer has already converted Error.stack to an array of frames.
  if (Array.isArray(error.stack)) result.stack = array(error.stack);
  if (object(error.cause) && depth < 3) result.cause = recordedError(error.cause, depth + 1);
  return result;
}
function entry(start: ObjectValue | undefined, finish: ObjectValue | undefined, file: string, startLine: number | null, finishLine: number | null, capturedInputs: unknown[], lastRecordedAt: number, lastLine: number): HistoryEntry {
  const record = finish ?? start!, argv = array(record.argv);
  const command = string(record.command) ?? (argv.slice(0, 2).join(' ') || '(help)');
  const diagnostics = (Array.isArray(record.diagnostics) ? record.diagnostics : []).filter(object).map(item => ({
    code: string(item.code) ?? 'DIAGNOSTIC', message: string(item.message) ?? '',
    ...(typeof item.path === 'string' ? {path: item.path} : {}),
    ...(object(item.error) ? {error: recordedError(item.error)} : {}),
  }));
  const error = object(record.error) ? recordedError(record.error) : undefined;
  const outcome = finish ? record.outcome as HistoryOutcome : 'incomplete';
  const inputs = (Array.isArray(record.inputs) ? record.inputs : capturedInputs).filter(object)
    .filter(input => input.kind === 'file' || input.kind === 'stdin').map(input => ({
      kind: input.kind as 'file' | 'stdin', path: string(input.path), snapshot: string(input.snapshot),
      bytes: number(input.bytes) ?? 0, sha256: string(input.sha256) ?? '', complete: input.complete === true,
      ...(typeof input.error === 'string' ? {error: input.error} : {}),
    }));
  const findings = [...new Set([...codes(error), ...diagnostics.flatMap(d => [d.code, ...codes(d.error)])])];
  if (!findings.length && outcome !== 'success') findings.push(outcome === 'incomplete' ? 'NO_FINISH' : 'EXECUTION_FAILED');
  return {id: String(record.id), command, provider: string(record.provider) ?? (/^[a-z]+\./.test(command) ? command.split('.')[0] : null),
    startedAt: new Date(String(record.startedAt)).toISOString(), finishedAt: finish ? new Date(String(finish.timestamp)).toISOString() : null,
    lastRecordedAt: new Date(lastRecordedAt).toISOString(), archived: false, archivedAt: null, archiveId: null,
    outcome, durationMs: number(record.durationMs), exitCode: number(record.exitCode), settled: typeof record.settled === 'boolean' ? record.settled : null,
    pid: number(record.pid), argv, version: string(record.version),
    commandLine: shellCommand(argv), cwd: string(record.cwd), argvCapture: record.argvCapture === 'verbatim' ? 'verbatim' : 'legacy_redacted',
    inputs,
    build: object(record.build) ? {revision: string(record.build.revision), dirty: typeof record.build.dirty === 'boolean' ? record.build.dirty : null} : null,
    runtime: object(record.runtime) ? {node: string(record.runtime.node), platform: string(record.runtime.platform), arch: string(record.runtime.arch)} : null,
    ...(error ? {error} : {}), diagnostics, droppedDiagnostics: number(record.droppedDiagnostics) ?? 0, codes: findings,
    message: string(error?.message) ?? string(diagnostics[0]?.error?.message) ?? diagnostics[0]?.message
      ?? (outcome === 'incomplete' ? 'No finish recorded; may still be running or may have been interrupted.' : ''),
    source: {file, startLine, finishLine, lastLine}};
}
function matches(row: HistoryEntry, filter: Filters): boolean {
  const time = Date.parse(row.startedAt);
  if (time < filter.since || time > filter.until) return false;
  if (filter.provider.length && !filter.provider.includes(row.provider ?? '')) return false;
  if (filter.outcome.length && !filter.outcome.includes(row.outcome)) return false;
  if (filter.command && !row.command.toLowerCase().includes(filter.command)) return false;
  if (filter.code && !row.codes.some(code => code.toLowerCase() === filter.code)) return false;
  // Archive metadata must not change whether the original entry matches a saved text filter.
  const {archived, archivedAt, archiveId, ...searchable} = row;
  if (filter.query && !JSON.stringify(searchable).toLowerCase().includes(filter.query)) return false;
  if (!filter.includeUtility && !filter.command && row.outcome === 'success'
      && (row.command.startsWith('cli.history ') || row.command.startsWith('cli.history.') || row.command === 'cli.completion query')) return false;
  return true;
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function nextCommand(action: string, values: Values, offset: number, failures: boolean): string {
  const args = [`fam cli.history${failures ? '.failures' : ''} ${action}`];
  for (const name of ['provider', 'command', 'outcome', 'code', 'query', 'since', 'until', 'include-utility', 'include-archived', 'group-by', 'limit', 'json']) {
    const value = values[name];
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === false) continue;
      args.push(`--${name}${item === true ? '' : ` ${quote(String(item))}`}`);
    }
  }
  args.push(`--offset ${offset}`); return args.join(' ');
}

function archiveSelection(filter: Filters): ArchiveSelection {
  return {...filter, since: Number.isFinite(filter.since) ? new Date(filter.since).toISOString() : null,
    until: Number.isFinite(filter.until) ? new Date(filter.until).toISOString() : null};
}
function archiveFilter(value: unknown): Filters | undefined {
  if (!object(value)) return;
  const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === 'string');
  const time = (value: unknown): value is string | null => value === null || typeof value === 'string' && Number.isFinite(Date.parse(value));
  if (!strings(value.provider) || !strings(value.outcome) || value.outcome.some(item => !historyOutcomes.includes(item as HistoryOutcome))
      || !['command', 'code', 'query'].every(key => typeof value[key] === 'string') || typeof value.includeUtility !== 'boolean'
      || !time(value.since) || !time(value.until)) return;
  const result = {...value, since: value.since === null ? -Infinity : Date.parse(value.since),
    until: value.until === null ? Infinity : Date.parse(value.until)} as unknown as Filters;
  if (result.since > result.until) return;
  return result;
}

/** Archive is an append-only visibility rule. No journal or input snapshot is rewritten. */
async function archiveMarkers(notice: (notice: Notice) => void): Promise<Array<{marker: HistoryArchiveMarker; filter: Filters}>> {
  const name = 'history/archive.jsonl', file = join(CREDENTIAL_DIR, name), result: Array<{marker: HistoryArchiveMarker; filter: Filters}> = [];
  try {
    for await (const line of readPrivateJsonl(name)) {
      const value = line.value, filter = object(value) ? archiveFilter(value.selection) : undefined;
      if (line.issue || !object(value) || value.schemaVersion !== 1 || value.event !== 'archive' || !uuid.test(String(value.id))
          || typeof value.before !== 'string' || !Number.isFinite(Date.parse(value.before))
          || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) || !filter
          || !object(value.files) || !Object.entries(value.files).every(([file, line]) => /^history\/\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && Number.isSafeInteger(line) && Number(line) >= 0)) {
        notice({file, line: line.line, message: line.issue ?? 'Unsupported or malformed archive marker.'}); continue;
      }
      result.push({marker: value as unknown as HistoryArchiveMarker, filter});
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') notice({file, message: 'Could not read archive markers; archived entries may be visible.'});
  }
  return result;
}

export async function queryHistory(action: string, values: Values, excludeId?: string, options: {now?: number; failures?: boolean} = {}): Promise<HistoryView> {
  const now = options.now ?? Date.now(), failures = options.failures === true || action === 'archive' && values.failures === true;
  const filter = filters(values, now), limit = Number(values.limit ?? (action === 'summary' ? 10 : 20)), offset = Number(values.offset ?? 0);
  if (failures) {
    if (filter.outcome.some(value => !['soft_failure', 'hard_failure'].includes(value)))
      throw new UsageError('The failures view only accepts soft_failure or hard_failure outcomes. Use list for other outcomes.', 'fam cli.history list --outcome incomplete');
    if (!filter.outcome.length) filter.outcome = ['soft_failure', 'hard_failure'];
  }
  if (action === 'archive') {
    const hasFilter = values.failures === true || ['provider', 'command', 'outcome', 'code', 'query', 'since', 'until'].some(name => {
      const value = values[name]; return Array.isArray(value) ? value.some(item => item.trim()) : typeof value === 'string' && value.trim();
    });
    if (values.all && hasFilter) throw new UsageError('Use --all or selection filters, not both.', 'fam cli.history archive --all');
    if (!failures && !values.all && !hasFilter) throw new UsageError('Choose --all to archive everything, or supply selection filters.', 'fam cli.history archive --all');
    if (values.all) filter.includeUtility = true;
  }
  const id = String(values.id ?? '').toLowerCase();
  if (action === 'get' && !/^[a-f0-9][a-f0-9-]{7,35}$/.test(id))
    throw new UsageError('--id requires a full invocation ID or at least eight characters from its beginning.', 'fam cli.history list');
  const scan: ScanInfo = {directory: join(CREDENTIAL_DIR, 'history'), filesScanned: 0, skippedRecords: 0, notices: [], omittedNotices: 0,
    utilityHidden: action !== 'get' && !filter.includeUtility && !filter.command, archivedHidden: 0};
  const notice = (value: Notice) => {
    if (!scan.notices.length) reportDiagnostic('HISTORY_READ_INCOMPLETE', 'History contains unreadable or incomplete records; see the history read notices.');
    if (scan.notices.length < 20) scan.notices.push(value); else scan.omittedNotices++;
  };
  const archives = await archiveMarkers(value => {scan.skippedRecords++; notice(value);});
  const boundaries: Record<string, number> = {};
  async function* rows(): AsyncGenerator<HistoryEntry> {
    for (const name of await historyFiles()) {
      const day = name.slice(8, 18), startOfDay = Date.parse(day);
      if (startOfDay > filter.until || startOfDay + 86_400_000 <= filter.since) continue;
      scan.filesScanned++;
      const file = join(CREDENTIAL_DIR, name);
      const records = new Map<string, {start?: ObjectValue; finish?: ObjectValue; startLine: number | null; finishLine: number | null; inputs: unknown[]; lastRecordedAt: number; lastLine: number}>();
      try {
        for await (const line of readPrivateJsonl(name)) {
          const value = line.value;
          if (line.issue || !object(value) || value.schemaVersion !== 1 || !uuid.test(String(value.id))
              || !['start', 'input', 'finish'].includes(String(value.event)) || typeof value.startedAt !== 'string'
              || !Number.isFinite(Date.parse(value.startedAt)) || new Date(value.startedAt).toISOString().slice(0, 10) !== day
              || value.event === 'finish' && (!historyOutcomes.slice(0, 3).includes(value.outcome as never)
                || typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)))) {
            scan.skippedRecords++; notice({file, line: line.line, message: line.issue ?? 'Unsupported or malformed history record.'}); continue;
          }
          boundaries[name] = line.line;
          if (value.id === excludeId) continue;
          const prior = records.get(String(value.id)) ?? {startLine: null, finishLine: null, inputs: [], lastRecordedAt: Date.parse(value.startedAt), lastLine: line.line};
          prior.lastLine = line.line;
          if (typeof value.timestamp === 'string' && Number.isFinite(Date.parse(value.timestamp))) prior.lastRecordedAt = Math.max(prior.lastRecordedAt, Date.parse(value.timestamp));
          if (value.event === 'start') {prior.start = value; prior.startLine = line.line;}
          else if (value.event === 'finish') {prior.finish = value; prior.finishLine = line.line;}
          else {prior.inputs.push(value.input); prior.start ??= value;}
          records.set(String(value.id), prior);
        }
      } catch {notice({file, message: 'Could not read this history file; results may be incomplete.'});}
      const sorted = [...records.values()].map(record => entry(record.start, record.finish, file, record.startLine, record.finishLine, record.inputs, record.lastRecordedAt, record.lastLine))
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id));
      for (const row of sorted) {
        const archive = archives.find(({marker, filter}) => row.source.lastLine <= (marker.files[name] ?? -1)
          && Date.parse(row.lastRecordedAt) <= Date.parse(marker.before) && matches(row, filter));
        if (archive) {row.archived = true; row.archivedAt = archive.marker.timestamp; row.archiveId = archive.marker.id;}
        if (action !== 'get' && !matches(row, filter)) continue;
        if (row.archived && action !== 'get' && !values['include-archived']) {scan.archivedHidden++; continue;}
        yield row;
      }
    }
  }
  if (action === 'archive') {
    const counts: Record<HistoryOutcome, number> = {success: 0, soft_failure: 0, hard_failure: 0, incomplete: 0};
    let count = 0;
    for await (const row of rows()) if (Date.parse(row.lastRecordedAt) <= now) {count++; counts[row.outcome]++;}
    const before = new Date(now).toISOString(), selection = archiveSelection(filter), dryRun = values['dry-run'] === true;
    const marker: HistoryArchiveMarker | null = !dryRun && count ? {schemaVersion: 1, event: 'archive', id: randomUUID(),
      timestamp: new Date().toISOString(), before, selection, files: boundaries} : null;
    if (marker) appendPrivateJsonl('history/archive.jsonl', marker, {separate: true});
    return {...scan, view: 'archive', dryRun, count, counts, before, selection, marker, markerFile: join(CREDENTIAL_DIR, 'history/archive.jsonl')};
  }
  if (action === 'get') {
    let selected: HistoryEntry | undefined;
    for await (const row of rows()) if (row.id.toLowerCase().startsWith(id)) {
      if (selected) throw new UsageError(`History ID prefix is ambiguous: ${selected.id}, ${row.id}. Supply a longer ID.`, 'fam cli.history get --id <ID>');
      selected = row;
    }
    if (!selected) throw Object.assign(new Error('No history entry matches that ID in the active profile. Run fam cli.history list to find an ID.'), {code: 'HISTORY_NOT_FOUND'});
    return {...scan, view: 'get', entry: selected};
  }
  if (action === 'stats') {
    const data = await historyStatistics(rows(), values, {since: filter.since, until: filter.until, now});
    return {...scan, ...data};
  }
  if (action === 'summary') {
    const groupBy = String(values['group-by'] ?? 'command'), groups = new Map<string, HistoryGroup>();
    const counts: Record<HistoryOutcome, number> = {success: 0, soft_failure: 0, hard_failure: 0, incomplete: 0};
    let first = Infinity, last = -Infinity, count = 0;
    for await (const row of rows()) {
      count++; counts[row.outcome]++;
      first = Math.min(first, Date.parse(row.startedAt)); last = Math.max(last, Date.parse(row.startedAt));
      const keys = groupBy === 'provider' ? [row.provider ?? '(unknown)'] : groupBy === 'code' ? (row.codes.length ? row.codes : ['SUCCESS']) : [row.command];
      for (const key of keys) {
        const group = groups.get(key) ?? {key, count: 0, success: 0, soft_failure: 0, hard_failure: 0, incomplete: 0, lastSeen: row.startedAt};
        group.count++; group[row.outcome]++; if (row.startedAt > group.lastSeen) group.lastSeen = row.startedAt;
        groups.set(key, group);
      }
    }
    const ordered = [...groups.values()].sort((a, b) => (b.hard_failure + b.soft_failure) - (a.hard_failure + a.soft_failure)
      || b.count - a.count || b.lastSeen.localeCompare(a.lastSeen) || a.key.localeCompare(b.key));
    return {...scan, view: 'summary', count, counts, since: count ? new Date(first).toISOString() : null, until: count ? new Date(last).toISOString() : null,
      groupBy, groups: ordered.slice(offset, limit === 0 ? undefined : offset + limit), totalGroups: ordered.length,
      next: limit > 0 && offset + limit < ordered.length ? nextCommand(action, values, offset + limit, failures) : null};
  }
  const entries: HistoryEntry[] = []; let seen = 0, hasMore = false;
  for await (const row of rows()) {
    if (seen++ < offset) continue;
    if (limit > 0 && entries.length === limit) {hasMore = true; break;}
    entries.push(row);
  }
  return {...scan, view: failures ? 'failures' : 'list', entries, limit, offset, hasMore,
    nextOffset: hasMore ? offset + limit : null, next: hasMore ? nextCommand(action, values, offset + limit, failures) : null};
}
