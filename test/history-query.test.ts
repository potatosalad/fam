import {beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CREDENTIAL_DIR, readPrivateJsonl} from '../src/shared/storage.js';
import {historyTime, queryHistory, type HistoryList, type HistorySummary, type HistoryDetail} from '../src/shared/history-query.js';
import {historyOutput} from '../src/shared/history-output.js';
import {completionCatalog, complete} from '../src/shared/completion.js';
import {parseInvocation} from '../src/shared/command-runtime.js';

const directory = join(CREDENTIAL_DIR, 'history');
const now = Date.parse('2026-09-09T12:00:00Z');
const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (args: string[], env = {}) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR, timeout: 15_000, env: {...process.env, FAM_HISTORY: '0', FAM_CREDENTIALS_COMMAND: '["history-must-not-fetch-credentials"]', ...env},
});
const id = (number: number) => `${number.toString(16).padStart(8, '0')}-1000-4000-8000-000000000000`;
function record(number: number, startedAt: string, command: string, outcome = 'success', extra = {}) {
  return {schemaVersion: 1, id: id(number), event: 'finish', startedAt, timestamp: startedAt,
    command, provider: command.split('.')[0], argv: command.split(' '), outcome, exitCode: outcome === 'hard_failure' ? 1 : 0,
    settled: true, durationMs: 1250, pid: 12345, version: '0.3.2', build: {revision: 'a'.repeat(40), dirty: false},
    runtime: {node: 'v24.0.0', platform: 'linux', arch: 'x64'}, diagnostics: [], ...extra};
}
async function save(value: ReturnType<typeof record>, startOnly = false) {
  const path = join(directory, value.startedAt.slice(0, 10) + '.jsonl');
  const start = {...value, event: 'start', command: null, provider: null};
  for (const key of ['outcome', 'exitCode', 'settled', 'durationMs', 'diagnostics', 'error']) delete (start as any)[key];
  await appendFile(path, JSON.stringify(start) + '\n' + (startOnly ? '' : JSON.stringify(value) + '\n'), {mode: 0o600});
  return path;
}
beforeEach(async () => {await rm(directory, {recursive: true, force: true}); await mkdir(directory, {mode: 0o700});});

test('history merges start/finish records once and orders by start time even for late finishes', async () => {
  await save(record(1, '2026-09-08T23:00:00Z', 'familysearch.image download', 'success', {timestamp: '2026-09-09T13:00:00Z'}));
  await save(record(2, '2026-09-09T10:00:00Z', 'ancestry.person get', 'hard_failure', {error: {message: 'Fixture failed', code: 'FIXTURE'}}));
  await save(record(3, '2026-09-09T11:00:00Z', 'myheritage.record search'), true);
  const result = await queryHistory('list', {}) as HistoryList;
  assert.deepEqual(result.entries.map(row => row.id), [id(3), id(2), id(1)]);
  assert.deepEqual(result.entries.map(row => row.outcome), ['incomplete', 'hard_failure', 'success']);
  assert.equal(result.entries[0].command, 'myheritage.record search');
  assert.equal(result.entries[0].provider, 'myheritage');
  assert.equal(result.entries[0].finishedAt, null); assert.equal(result.entries[0].exitCode, null);
  assert.match(result.entries[0].message, /may still be running/);
  assert.ok(result.entries[1].source.startLine); assert.ok(result.entries[1].source.finishLine);
  const failures = await queryHistory('list', {}, undefined, {failures: true}) as HistoryList;
  assert.deepEqual(failures.entries.map(row => row.id), [id(2)]);
});

test('provider, command, outcome, code, text and time filters compose and paginate matching calls', async () => {
  await save(record(1, '2026-09-01T10:00:00Z', 'ancestry.person get', 'hard_failure'));
  for (const number of [2, 3, 4]) await save(record(number, `2026-09-09T0${number}:00:00Z`, 'ancestry.person get', 'soft_failure', {
    diagnostics: [{code: 'AUTH_RETRY', message: 'Renewing the fixture session', error: {status: 401, cause: {code: 'EXPIRED'}}}],
  }));
  await save(record(5, '2026-09-09T09:00:00Z', 'familysearch.person get', 'hard_failure'));
  const values = {provider: ['ancestry', 'myheritage'], command: 'FAM ancestry.PERSON', outcome: ['soft_failure'], code: 'http_401', query: 'fixture session', since: '7d', limit: 1};
  const first = await queryHistory('list', values, undefined, {now, failures: true}) as HistoryList;
  assert.deepEqual(first.entries.map(row => row.id), [id(4)]); assert.equal(first.filesScanned, 1);
  assert.equal(first.hasMore, true); assert.equal(first.nextOffset, 1);
  assert.match(first.next!, /^fam cli.history.failures list/); assert.match(first.next!, /--query 'fixture session'/);
  assert.equal(first.next!.match(/--provider/g)?.length, 2);
  const second = await queryHistory('list', {...values, offset: 1, limit: 2}, undefined, {now, failures: true}) as HistoryList;
  assert.deepEqual(second.entries.map(row => row.id), [id(3), id(2)]); assert.equal(second.hasMore, false);
  assert.deepEqual((await queryHistory('list', {code: 'expired'}) as HistoryList).entries.map(row => row.id), [id(4), id(3), id(2)]);
});

test('dates include UTC days, relative durations use a fixed clock, and invalid filters fail clearly', async () => {
  assert.equal(historyTime('today', 'since', now), Date.parse('2026-09-09T00:00:00Z'));
  assert.equal(historyTime('2026-09-09', 'until', now), Date.parse('2026-09-09T23:59:59.999Z'));
  assert.equal(historyTime('24h', 'since', now), now - 86_400_000);
  assert.equal(historyTime('2026-09-09T07:00:00-05:00', 'since', now), now);
  for (const invalid of ['2026-02-30', '2026-09-09T10:00', 'yesterday-ish', '2026-09-09T99:00:00Z'])
    assert.throws(() => historyTime(invalid, 'since', now), /--since requires/);
  await assert.rejects(queryHistory('list', {since: '2026-09-10', until: '2026-09-09'}), /must not be later/);
  await save(record(1, '2026-09-09T23:59:59Z', 'ancestry.person get'));
  await save(record(2, '2026-09-10T00:00:00Z', 'ancestry.person get'));
  assert.deepEqual((await queryHistory('list', {since: '2026-09-09', until: '2026-09-09'}) as HistoryList).entries.map(row => row.id), [id(1)]);
});

test('failure summaries count each invocation once per code and prioritize frequent failures', async () => {
  await save(record(1, '2026-09-09T01:00:00Z', 'ancestry.person get', 'soft_failure', {
    diagnostics: [{code: 'AUTH_RETRY', message: 'retry', error: {status: 401}}, {code: 'AUTH_RETRY', message: 'retry'}],
  }));
  await save(record(2, '2026-09-09T02:00:00Z', 'ancestry.person get', 'hard_failure', {error: {code: 'DENIED'}}));
  await save(record(3, '2026-09-09T03:00:00Z', 'familysearch.image download'));
  await save(record(4, '2026-09-09T04:00:00Z', 'familysearch.image download'), true);
  const all = await queryHistory('summary', {}) as HistorySummary;
  assert.equal(all.count, 4); assert.deepEqual(all.counts, {success: 1, soft_failure: 1, hard_failure: 1, incomplete: 1});
  assert.equal(all.groups[0].key, 'ancestry.person get'); assert.equal(all.groups[0].count, 2);
  const failures = await queryHistory('summary', {'group-by': 'code', limit: 1}, undefined, {failures: true}) as HistorySummary;
  assert.equal(failures.count, 2); assert.equal(failures.totalGroups, 3);
  assert.match(failures.next!, /^fam cli.history.failures summary/);
  const codes = await queryHistory('summary', {'group-by': 'code'}, undefined, {failures: true}) as HistorySummary;
  assert.equal(codes.groups.find(group => group.key === 'AUTH_RETRY')!.count, 1);
  assert.equal(codes.groups.find(group => group.key === 'HTTP_401')!.count, 1);
  const providers = await queryHistory('summary', {'group-by': 'provider'}) as HistorySummary;
  assert.deepEqual(providers.groups.map(group => group.key), ['ancestry', 'familysearch']);
});

test('utility calls are hidden only on success; explicit command filters and include-utility expose them', async () => {
  await save(record(1, '2026-09-09T01:00:00Z', 'cli.history.failures list'));
  await save(record(2, '2026-09-09T02:00:00Z', 'cli.completion query'));
  await save(record(3, '2026-09-09T03:00:00Z', 'cli.history get', 'hard_failure'));
  assert.deepEqual((await queryHistory('list', {}) as HistoryList).entries.map(row => row.id), [id(3)]);
  assert.equal((await queryHistory('list', {'include-utility': true}) as HistoryList).entries.length, 3);
  assert.equal((await queryHistory('list', {command: 'cli.history'}) as HistoryList).entries.length, 2);
  assert.equal((await queryHistory('get', {id: id(1)}) as HistoryDetail).entry.id, id(1));
});

test('broken or unsupported records do not hide valid evidence and reads never rewrite history', async () => {
  const path = await save(record(1, '2026-09-09T01:00:00Z', 'ancestry.person get'));
  await appendFile(path, 'malformed private text\n' + JSON.stringify({schemaVersion: 42, secret: 'not-an-instruction'}) + '\n' + '{"unfinished":');
  const before = await readFile(path, 'utf8');
  const result = await queryHistory('list', {}) as HistoryList;
  assert.equal(result.entries.length, 1); assert.equal(result.skippedRecords, 3); assert.equal(result.notices.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /malformed private text|not-an-instruction/);
  assert.equal(await readFile(path, 'utf8'), before);
  assert.match(historyOutput(result), /History read notices/);
  await rm(path);
  assert.equal((await queryHistory('list', {}) as HistoryList).entries.length, 0);
  await rm(directory, {recursive: true});
  assert.equal((await queryHistory('summary', {}) as HistorySummary).count, 0);
});

test('file snapshots do not follow concurrent appends and retain a finish whose start is missing', async () => {
  const path = join(directory, '2026-09-09.jsonl');
  const first = record(1, '2026-09-09T01:00:00Z', 'ancestry.person get');
  await writeFile(path, JSON.stringify(first) + '\n');
  const iterator = readPrivateJsonl('history/2026-09-09.jsonl');
  assert.equal((await iterator.next()).value?.value && true, true);
  await appendFile(path, JSON.stringify(record(2, '2026-09-09T02:00:00Z', 'ancestry.person get')) + '\n');
  assert.equal((await iterator.next()).done, true);
  const result = await queryHistory('get', {id: id(1)}) as HistoryDetail;
  assert.equal(result.entry.source.startLine, null); assert.equal(result.entry.source.finishLine, 1);
  assert.equal(result.entry.outcome, 'success');
});

test('ID lookup accepts short IDs, refuses ambiguity and never treats IDs as file paths', async () => {
  await save(record(1, '2026-09-09T01:00:00Z', 'ancestry.person get', 'hard_failure', {error: {message: 'Failure detail', stack: ['    at fixture (fixture.ts:12:3)'], cause: {code: 'FIXTURE_CAUSE', stack: ['    at inner (fixture.ts:9:1)']}}}));
  const detail = await queryHistory('get', {id: '00000001'}) as HistoryDetail;
  assert.equal(detail.entry.error?.message, 'Failure detail');
  assert.match(historyOutput(detail), /fixture\.ts:12:3/); assert.match(historyOutput(detail), /fixture\.ts:9:1/);
  await save(record(1, '2026-09-08T01:00:00Z', 'ancestry.person get', 'success', {id: '00000001-2000-4000-8000-000000000000'}));
  await assert.rejects(queryHistory('get', {id: '00000001'}), /ambiguous/);
  assert.equal((await queryHistory('get', {id: id(1)}) as HistoryDetail).entry.id, id(1));
  await assert.rejects(queryHistory('get', {id: 'ffffffff'}), {code: 'HISTORY_NOT_FOUND'});
  await assert.rejects(queryHistory('get', {id: '../secret'}), /--id requires/);
});

test('CLI exposes failures as a nested object, supports JSON and exports, and never includes its own query', async () => {
  await save(record(1, '2026-09-09T01:00:00Z', 'ancestry.person get', 'hard_failure', {error: {message: 'Fixture failure', code: 'FIXTURE'}}));
  const help = (await invoke(['cli.history'])).stdout;
  assert.match(help, /cli\.history\.failures/);
  const nested = (await invoke(['cli.history.failures'])).stdout;
  assert.match(nested, /cli\.history\.failures list/); assert.match(nested, /cli\.history\.failures summary/);
  assert.throws(() => parseInvocation(['cli.history', 'failures']));
  assert.deepEqual(complete(completionCatalog(), ['cli.history.failures', '']).candidates, ['list', 'summary']);
  assert.ok(complete(completionCatalog(), ['cli.history.failures', 'list', '--outcome', '']).candidates.includes('soft_failure'));
  const human = (await invoke(['cli.history.failures', 'list'])).stdout;
  assert.match(human, /Command failures · newest first/); assert.match(human, /HARD/); assert.match(human, /FIXTURE · Fixture failure/);
  const response = JSON.parse((await invoke(['cli.history', 'list', '--json', '--include-utility'], {FAM_HISTORY: '1'})).stdout);
  assert.equal(response.command, 'cli.history list'); assert.equal(response.data.entries.length, 1);
  const file = join(directory, (await readdir(directory)).sort().at(-1)!);
  const last = JSON.parse((await readFile(file, 'utf8')).trim().split('\n').at(-1)!);
  assert.equal(last.command, 'cli.history list'); assert.equal(last.outcome, 'success'); assert.deepEqual(last.diagnostics, []);
  const output = join(CREDENTIAL_DIR, 'history-ui-export.json');
  const saved = JSON.parse((await invoke(['cli.history.failures', 'summary', '--json', '--out', output])).stdout);
  assert.equal(saved.data.saved, output);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).data.count, 1);
  if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
  const detail = (await invoke(['cli.history', 'get', '--id', '00000001'])).stdout;
  assert.match(detail, /Fixture failure/); assert.match(detail, /Source:/);
  await assert.rejects(invoke(['cli.history.failures', 'list', '--outcome', 'success', '--json']), (error: any) => {
    assert.equal(error.code, 2); assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_ARGUMENT'); return true;
  });
});

test('human output strips terminal controls and adapts list rows to narrow terminals', async () => {
  await save(record(1, '2026-09-09T01:00:00Z', 'americanancestors.collection list', 'hard_failure', {error: {message: 'Failure\u001b]52;c;clipboard\u0007\rredrawn'}}));
  const result = await queryHistory('list', {}) as HistoryList;
  const text = historyOutput(result, 80);
  assert.doesNotMatch(text, /[\u001b\u0007\r]/);
  assert.ok(text.split('\n').every(line => line.length <= 80));
});
