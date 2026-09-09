import {beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {appendFile, mkdir, readFile, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {queryHistory, type HistoryStats} from '../src/shared/history-query.js';
import {historyOutput} from '../src/shared/history-output.js';
import {statsBucketStart} from '../src/shared/history-stats.js';
import type {Values} from '../src/shared/command-runtime.js';
import {complete, completionCatalog} from '../src/shared/completion.js';

const directory = join(CREDENTIAL_DIR, 'history'), now = Date.parse('2026-09-09T12:00:00Z');
const run = promisify(execFile), cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR, timeout: 15_000,
  env: {...process.env, FAM_HISTORY: '0', FAM_CREDENTIALS_COMMAND: '["history-must-not-fetch-credentials"]'},
});
const id = (n: number) => `${n.toString(16).padStart(8, '0')}-1000-4000-8000-000000000000`;
async function save(n: number, startedAt: string, outcome = 'success', extra: Record<string, unknown> = {}) {
  const command = String(extra.command ?? 'ancestry.person get');
  await appendFile(join(directory, startedAt.slice(0, 10) + '.jsonl'), JSON.stringify({
    schemaVersion: 1, id: id(n), event: outcome === 'incomplete' ? 'start' : 'finish',
    startedAt, timestamp: startedAt, command, argv: command.split(' '), argvCapture: 'verbatim',
    provider: command.split('.')[0], outcome, exitCode: outcome === 'hard_failure' ? 1 : 0,
    durationMs: 100, build: {revision: 'a'.repeat(40), dirty: false}, diagnostics: [], ...extra,
  }) + '\n', {mode: 0o600});
}
const stats = (values: Values = {}, excludeId?: string) => queryHistory('stats', values, excludeId, {now}) as Promise<HistoryStats>;
beforeEach(async () => {await rm(directory, {recursive: true, force: true}); await mkdir(directory, {mode: 0o700});});

test('statistics count every outcome once, use completed calls for rates, and compute weighted duration percentiles', async () => {
  await save(1, '2026-09-07T10:00:00Z', 'success', {durationMs: 0});
  await save(2, '2026-09-07T11:00:00Z', 'soft_failure', {durationMs: 100});
  await save(3, '2026-09-09T10:00:00Z', 'hard_failure', {durationMs: 900});
  await save(4, '2026-09-09T11:00:00Z', 'incomplete', {durationMs: 9999});
  await save(5, '2026-09-09T11:01:00Z', 'success', {durationMs: null});
  await save(6, '2026-09-09T11:02:00Z', 'success', {durationMs: -1});
  const result = await stats({interval: 'day', since: '2026-09-07', until: '2026-09-09'});
  assert.deepEqual(result.totals, {calls: 6, completed: 5, failures: 2, success: 3, soft_failure: 1, hard_failure: 1, incomplete: 1,
    failureRatePct: 40, duration: {samples: 3, meanMs: 1000 / 3, p50Ms: 100, p95Ms: 900, minMs: 0, maxMs: 900}});
  const buckets = result.series[0].buckets;
  assert.deepEqual(buckets.map(b => b.calls), [2, 0, 4]);
  assert.deepEqual(buckets.slice(0, 2).map(b => b.failureRatePct), [50, null]);
  assert.ok(Math.abs(buckets[2].failureRatePct! - 100 / 3) < 1e-10);
  assert.equal(buckets[0].duration.meanMs, 50);
  assert.equal(buckets[1].duration.p95Ms, null);
  assert.equal(buckets[2].duration.meanMs, 900);
  assert.equal(buckets[2].end, '2026-09-10T00:00:00.000Z');
});

test('UTC minute, hour, Monday week and calendar month boundaries retain gaps and boundary calls', async () => {
  const time = Date.parse('2024-03-03T23:42:37.123Z');
  assert.equal(new Date(statsBucketStart(time, 'minute')).toISOString(), '2024-03-03T23:42:00.000Z');
  assert.equal(new Date(statsBucketStart(time, 'hour')).toISOString(), '2024-03-03T23:00:00.000Z');
  assert.equal(new Date(statsBucketStart(time, 'week')).toISOString(), '2024-02-26T00:00:00.000Z');
  await save(1, '2024-02-29T23:59:59Z');
  await save(2, '2024-03-01T00:00:00Z');
  const monthly = await stats({interval: 'month', since: '2024-01-01', until: '2024-03-01T00:00:00Z'});
  assert.deepEqual(monthly.series[0].buckets.map(b => [b.start, b.end, b.calls]), [
    ['2024-01-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z', 0],
    ['2024-02-01T00:00:00.000Z', '2024-03-01T00:00:00.000Z', 1],
    ['2024-03-01T00:00:00.000Z', '2024-04-01T00:00:00.000Z', 1],
  ]);
  const weekly = await stats({interval: 'week', since: '2024-02-29', until: '2024-03-04'});
  assert.deepEqual(weekly.series[0].buckets.map(b => b.start), ['2024-02-26T00:00:00.000Z', '2024-03-04T00:00:00.000Z']);
});

test('all grouping dimensions work and overlapping error codes never inflate overall totals', async () => {
  await save(1, '2026-09-09T01:00:00Z', 'soft_failure', {diagnostics: [
    {code: 'AUTH_RETRY', message: 'fixture', error: {status: 401}}, {code: 'AUTH_RETRY', message: 'fixture'},
  ]});
  await save(2, '2026-09-09T02:00:00Z', 'success', {command: 'familysearch.person get', build: {revision: 'a'.repeat(40), dirty: true}});
  await save(3, '2026-09-09T03:00:00Z', 'incomplete', {build: null});
  const expected = {
    none: ['All calls'], provider: ['ancestry', 'familysearch'], command: ['ancestry.person get', 'familysearch.person get'],
    outcome: ['incomplete', 'soft_failure', 'success'], code: ['AUTH_RETRY', 'HTTP_401', 'NO_FINISH', 'SUCCESS'],
    build: ['(unknown build)', 'a'.repeat(40), 'a'.repeat(40) + ' (dirty)'],
  };
  for (const [group, keys] of Object.entries(expected)) {
    const result = await stats({'group-by': group});
    assert.equal(result.totals.calls, 3);
    assert.deepEqual(result.series.map(s => s.key).sort(), keys.sort());
    if (group === 'code') assert.ok(result.series.every(s => s.totals.calls === 1));
  }
});

test('statistics honor combined filters, archive visibility, utility exclusion, and the running invocation', async () => {
  await save(1, '2026-09-09T01:00:00Z', 'soft_failure', {diagnostics: [{code: 'AUTH_RETRY', message: 'fixture issue'}]});
  await save(2, '2026-09-09T02:00:00Z');
  await save(3, '2026-09-09T03:00:00Z', 'hard_failure', {command: 'familysearch.person get'});
  await save(4, '2026-09-09T04:00:00Z', 'success', {command: 'cli.history stats'});
  assert.equal((await stats()).totals.calls, 3);
  assert.equal((await stats({'include-utility': true})).totals.calls, 4);
  assert.equal((await stats({'include-utility': true}, id(4))).totals.calls, 3);
  const filters = {provider: ['ancestry'], command: 'person', outcome: ['soft_failure'], code: 'auth_retry', query: 'fixture', since: '24h'};
  assert.equal((await stats(filters)).totals.calls, 1);
  const before = await readFile(join(directory, '2026-09-09.jsonl'));
  await queryHistory('archive', {failures: true, provider: ['ancestry']}, undefined, {now});
  assert.equal((await stats(filters)).totals.calls, 0);
  assert.equal((await stats({...filters, 'include-archived': true})).totals.calls, 1);
  assert.equal((await stats()).archivedHidden, 1);
  assert.deepEqual(await readFile(join(directory, '2026-09-09.jsonl')), before);
});

test('automatic intervals, empty ranges, and explicit intervals have no series or bucket cap', async () => {
  const empty = await stats();
  assert.equal(empty.since, null); assert.equal(empty.until, null); assert.equal(empty.totals.failureRatePct, null);
  assert.equal(empty.series[0].buckets.length, 0);
  for (const [since, interval] of [['30m', 'minute'], ['24h', 'hour'], ['7d', 'day'], ['100d', 'week'], ['800d', 'month']]) {
    const result = await stats({since});
    assert.equal(result.interval, interval); assert.equal(result.until, new Date(now).toISOString());
    assert.ok(result.series[0].buckets.length > 0);
    assert.ok(result.series[0].buckets.every(b => b.calls === 0 && b.failureRatePct === null && b.duration.meanMs === null));
  }
  assert.equal((await stats({since: '300m', interval: 'minute'})).series[0].buckets.length, 301);
  for (let n = 1; n <= 205; n++) await save(n, '2026-09-09T01:00:00Z', 'success', {command: `ancestry.fixture${n} get`});
  const result = await stats({'group-by': 'command'});
  assert.equal(result.totals.calls, 205); assert.equal(result.series.length, 205);
});

test('graphs show comparable bars, exact counts, empty samples, and safe terminal labels', async () => {
  for (let n = 1; n <= 4; n++) await save(n, '2026-09-07T01:00:00Z', 'success', {command: 'ancestry.fixture\u001b]52;c;clipboard\u0007 get'});
  await save(5, '2026-09-09T01:00:00Z', 'hard_failure', {command: 'familysearch.person get', durationMs: 1500});
  const result = await stats({interval: 'day', 'group-by': 'provider', since: '2026-09-07', until: '2026-09-09'});
  const graph = historyOutput(result, 80);
  assert.match(graph, /Calls · shared scale/); assert.match(graph, /2026-09-08 │ +0/);
  const bars = graph.split('\n').filter(line => line.startsWith('2026-09-') && line.includes('│'));
  assert.equal(bars.length, 6);
  assert.equal(bars[0].match(/█/g)!.length / bars[5].match(/█/g)!.length, 4);
  assert.ok(graph.split('\n').every(line => line.length <= 80));
  const commands = historyOutput(await stats({'group-by': 'command', metric: 'p95-duration'}), 60);
  assert.doesNotMatch(commands, /[\u001b\u0007]/); assert.match(commands, /1.5s/);
  assert.ok(commands.split('\n').every(line => line.length <= 60));
  assert.match(historyOutput(await stats({since: '2d', interval: 'day', metric: 'failure-rate'})), /2026-09-08 │ +—/);
});

test('CLI exposes help, JSON, numeric tables and private exports without provider access', async () => {
  await save(1, '2026-09-09T01:00:00Z', 'hard_failure', {durationMs: 1234});
  const help = (await invoke(['cli.history', 'stats', '--help'])).stdout;
  const catalog = completionCatalog();
  assert.ok(complete(catalog, ['cli.history', '']).candidates.includes('stats'));
  assert.deepEqual(complete(catalog, ['cli.history', 'stats', '--metric', 'p']).candidates, ['p50-duration', 'p95-duration']);
  for (const option of ['--interval', '--group-by', '--metric', '--format', '--since', '--include-archived']) assert.ok(help.includes(option));
  for (const flags of [['--json'], ['--format', 'json']]) {
    const result = JSON.parse((await invoke(['cli.history', 'stats', ...flags])).stdout);
    assert.equal(result.data.view, 'stats'); assert.equal(result.data.totals.duration.p95Ms, 1234);
    assert.equal(result.data.series[0].buckets[0].hard_failure, 1);
  }
  const table = (await invoke(['cli.history', 'stats', '--format', 'table'])).stdout;
  assert.match(table, /TIME \(UTC\).*CALLS.*HARD.*SOFT.*P95/); assert.doesNotMatch(table, /█/);
  const output = join(CREDENTIAL_DIR, 'stats.json');
  await invoke(['cli.history', 'stats', '--json', '--out', output]);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).data.totals.calls, 1);
  if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(invoke(['cli.history', 'stats', '--interval', 'fortnight', '--json']), (error: any) => {
    assert.equal(error.code, 2); assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_ARGUMENT'); return true;
  });
});

test('graph value columns align across groups with different magnitudes', async () => {
  await save(1, '2026-09-09T01:00:00Z', 'success', {durationMs: 1});
  await save(2, '2026-09-09T01:00:00Z', 'success', {durationMs: 800, command: 'familysearch.person get'});
  const graph = historyOutput(await stats({'group-by': 'provider', metric: 'avg-duration'}), 80);
  const bars = graph.split('\n').filter(line => line.includes(' │ '));
  assert.equal(bars.length, 2);
  assert.ok(bars.every(line => line.length === 79));
});
