import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {rm, stat, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Impit} from 'impit';
import {createDoctorCheckCache} from '../src/shared/doctor-cache.js';
import {diagnoseProvider, runDoctor, formatDoctor, type DoctorOptions, type DoctorReport} from '../src/shared/doctor.js';
import type {DoctorCheck, DoctorProvider} from '../src/shared/doctor-checks.js';
import {CREDENTIAL_DIR, writePrivateJson} from '../src/shared/storage.js';
import {WaybackClient} from '../src/wayback/client.js';
import {InternetArchiveClient} from '../src/internetarchive/client.js';
import {CyndisListHttp} from '../src/cyndislist/http.js';
import {CATEGORY_INDEX} from '../src/cyndislist/url.js';

const minute = 60_000;
function fixture() {
  const files = new Map<string, any>();
  let now = Date.parse('2026-01-01T00:00:00Z'), random = 0;
  const deps = {
    read: async <T>(file: string) => structuredClone(files.get(file)) as T | undefined,
    write: async (file: string, value: unknown) => {files.set(file, structuredClone(value));},
    now: () => now, random: () => random,
  };
  return {files, deps, cache: createDoctorCheckCache(deps), advance: (ms: number) => {now += ms;}, jitter: (value: number) => {random = value;}};
}
const passed = (id: string): DoctorCheck => ({id, status: 'ok', code: 'probe-passed', message: 'Synthetic check passed.'});

beforeEach(async t => {
  await rm(join(CREDENTIAL_DIR, 'cache/health'), {recursive: true, force: true});
  t.mock.method(Impit.prototype, 'fetch', async () => {assert.fail('Unexpected provider request');});
  t.mock.method(globalThis, 'fetch', async () => {assert.fail('Unexpected browser request');});
});

test('each provider/check pair gets an independent fixed 45–75 minute expiry that reads never extend', async () => {
  const f = fixture(), calls: string[] = [];
  const run = (provider: 'ancestry' | 'familysearch', id: string) => f.cache.run(provider, id, async () => {calls.push(`${provider}/${id}`); return passed(id);});
  const short = await run('ancestry', 'account');
  f.jitter(0.5);
  const medium = await run('ancestry', 'trees');
  f.jitter(1 - Number.EPSILON);
  const long = await run('familysearch', 'account');
  for (const [result, minutes] of [[short, 45], [medium, 60], [long, 75]] as const) {
    assert.equal(Date.parse(result.expiresAt!) - Date.parse(result.checkedAt!), minutes * minute);
    assert.equal(result.cached, false);
  }
  f.advance(45 * minute - 1);
  assert.deepEqual(await run('ancestry', 'account'), {...short, cached: true});
  f.advance(1);
  assert.equal((await run('ancestry', 'account')).cached, false, 'expiry is exclusive');
  assert.deepEqual(await run('ancestry', 'trees'), {...medium, cached: true});
  assert.deepEqual(await run('familysearch', 'account'), {...long, cached: true});
  assert.deepEqual(calls, ['ancestry/account', 'ancestry/trees', 'familysearch/account', 'ancestry/account']);
  f.advance(15 * minute);
  assert.equal((await run('ancestry', 'trees')).cached, false);
  assert.equal((await run('familysearch', 'account')).cached, true);
  f.advance(15 * minute);
  assert.equal((await run('familysearch', 'account')).cached, false);
  assert.equal(f.files.size, 3, 'no provider-wide cache entry');
});

test('force replaces the previous result and expiry; completed failures and no-data results are cached', async () => {
  const f = fixture();
  const initial = await f.cache.run('ancestry', 'account', async () => passed('account'));
  f.advance(minute); f.jitter(0.5);
  const failed = await f.cache.run('ancestry', 'account', async () => ({id: 'account', status: 'error', code: 'rate-limited', message: 'Rate limited.'}), {force: true});
  assert.equal(failed.cached, false); assert.equal(failed.status, 'error');
  assert.notEqual(failed.expiresAt, initial.expiresAt);
  assert.deepEqual(await createDoctorCheckCache(f.deps).run('ancestry', 'account', async () => {assert.fail('cached failure');}), {...failed, cached: true});
  const noData = await f.cache.run('ancestry', 'trees', async () => ({id: 'trees', status: 'skipped', code: 'no-data', message: 'No tree.'}));
  assert.deepEqual(await f.cache.run('ancestry', 'trees', async () => {assert.fail('cached no-data');}), {...noData, cached: true});
});

test('overlapping checks share their own lock while a different check completes independently', async () => {
  const cache = createDoctorCheckCache(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let calls = 0;
  const slow = async () => {calls++; entered.resolve(); await release.promise; return passed('account');};
  const first = cache.run('ancestry', 'account', slow);
  await entered.promise;
  const second = cache.run('ancestry', 'account', slow);
  try {
    assert.equal((await cache.run('ancestry', 'trees', async () => passed('trees'))).cached, false);
    release.resolve();
    assert.deepEqual((await Promise.all([first, second])).map(result => result.cached), [false, true]);
    assert.equal(calls, 1);
  } finally {release.resolve(); await Promise.all([first, second]);}
});

test('an unavailable check lock makes no provider requests', async () => {
  const f = fixture();
  const cache = createDoctorCheckCache({...f.deps, lock: async () => {throw new Error('PRIVATE lock detail');}});
  const result = await cache.run('ancestry', 'account', async () => {assert.fail('lock unavailable');});
  assert.equal(result.code, 'live-check-unavailable'); assert.equal(result.status, 'warning');
  assert.equal(f.files.size, 0); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test('malformed, mismatched, future, and expired entries miss; cache I/O failure retains the actual result', async () => {
  const f = fixture(), file = 'cache/health/ancestry/account.json';
  await f.cache.run('ancestry', 'account', async () => passed('account'));
  const saved = structuredClone(f.files.get(file));
  for (const entry of [null, [], {}, {...saved, version: 2}, {...saved, provider: 'familysearch'},
    {...saved, check: {...saved.check, id: 'trees'}}, {...saved, check: {...saved.check, status: 'invalid'}},
    {...saved, check: {...saved.check, action: {secret: true}}},
    {...saved, checkedAt: saved.checkedAt + minute, expiresAt: saved.expiresAt + minute},
    {...saved, expiresAt: saved.checkedAt + 76 * minute},
    {...saved, checkedAt: saved.checkedAt - 45 * minute, expiresAt: saved.checkedAt}]) {
    f.files.set(file, entry);
    assert.equal((await f.cache.run('ancestry', 'account', async () => passed('account'))).cached, false);
  }
  const broken = createDoctorCheckCache({...f.deps,
    read: async () => {throw new Error('PRIVATE corrupted file');}, write: async () => {throw new Error('PRIVATE disk error');}});
  const result = await broken.run('ancestry', 'account', async () => passed('account'));
  assert.equal(result.status, 'ok'); assert.equal(result.cached, false); assert.equal(result.expiresAt, undefined);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

function authenticated() {
  const f = fixture();
  let session: unknown = {expiresAt: f.deps.now() + 120 * minute}, credentialChecks = 0, localReads = 0, sessionWrites = 0;
  const p: DoctorProvider = {
    service: 'ancestry', sessionFile: 'synthetic-session.json',
    inspect: value => {
      const expiresAt = (value as {expiresAt?: number})?.expiresAt;
      if (typeof expiresAt !== 'number') throw new Error('Invalid session');
      return {mode: 'native', expiresAt, refreshAvailable: true};
    },
    recovery: () => 'Run fam ancestry.session login.',
    probe: {id: 'account', label: 'Synthetic account', run: async () => {}},
    pending: [{file: 'pending.json', check: () => ({id: 'pending', status: 'warning', code: 'verification-pending', scope: 'password-login', message: 'Pending sign-in.'})}],
    limitations: ['Synthetic access only.'],
  };
  const deps = {
    read: async <T>(file: string) => {localReads++; return (file === p.sessionFile ? session : undefined) as T | undefined;},
    write: async (_file: string, value: unknown) => {sessionWrites++; session = value;},
    credentials: async () => {credentialChecks++; return 'file' as const;}, now: f.deps.now, cache: f.cache,
  };
  const run = (options: DoctorOptions = {}, live = true) => diagnoseProvider(p, live, deps, undefined, options);
  return {...f, p, deps, run, setSession: (value: unknown) => {session = value;}, counts: () => ({credentialChecks, localReads, sessionWrites})};
}

test('cache hits rerun local inspection and never restore sessions or hide missing, invalid, or expired local state', async () => {
  const f = authenticated(); let probes = 0;
  f.p.probe.run = async () => {probes++; return {session: {expiresAt: f.deps.now() + 120 * minute, token: 'PRIVATE'}};};
  const first = await f.run();
  assert.equal(first.checks[0].code, 'session-verified');
  const second = await f.run();
  assert.equal(second.checks[0].code, 'session-saved');
  assert.equal(second.checks.at(-1)?.cached, true);
  assert.deepEqual(f.counts(), {credentialChecks: 2, localReads: 4, sessionWrites: 1});
  for (const [session, code] of [[undefined, 'session-missing'], [{}, 'session-invalid'], [{expiresAt: f.deps.now() - 1}, 'session-expired']] as const) {
    f.setSession(session);
    const result = await f.run();
    assert.equal(result.checks[0].code, code); assert.notEqual(result.status, 'ok');
    assert.equal(result.checks.at(-1)?.cached, true);
  }
  assert.equal(probes, 1); assert.equal(f.counts().sessionWrites, 1);
  assert.doesNotMatch(JSON.stringify([...f.files.values()]), /PRIVATE|token|expiresAt.*120/);
  const report: DoctorReport = {schemaVersion: 1, checkedAt: new Date(f.deps.now()).toISOString(), mode: 'live', status: second.status, providers: [second]};
  assert.match(formatDoctor(report), /cached live result/);
  assert.match(formatDoctor(report, true), /Cached result: .*; expires/);
});

test('cached failures do not repeat refresh or login, and --force with --no-fix still forbids session changes', async () => {
  const f = authenticated(), events: string[] = [];
  f.p.probe.run = async () => {events.push('probe'); throw {status: 401};};
  f.p.refresh = async () => {events.push('refresh'); throw {status: 401};};
  f.p.login = {kind: 'credentials', run: async () => {events.push('login'); throw new Error('PRIVATE');}};
  const first = await f.run();
  assert.equal(first.status, 'error'); assert.deepEqual(events, ['probe', 'refresh', 'login']);
  const second = await f.run();
  assert.equal(second.status, 'error'); assert.equal(second.recovery, undefined);
  assert.equal(second.checks.at(-1)?.cached, true); assert.equal(events.length, 3);
  await f.run({force: true});
  assert.deepEqual(events, ['probe', 'refresh', 'login', 'probe', 'refresh', 'login']);
  f.p.probe.run = async () => {events.push('probe'); return {session: {expiresAt: 1}};};
  assert.equal((await f.run({force: true, repair: false})).status, 'ok');
  assert.equal(f.counts().sessionWrites, 0); assert.equal(events.length, 7);
  assert.equal((await f.run()).checks.at(-1)?.cached, true);
});

test('offline bypasses cache I/O even with force; local blockers never fill a live cache', async () => {
  const f = authenticated();
  f.deps.cache = createDoctorCheckCache({...f.deps, random: () => 0,
    read: async () => {assert.fail('offline cache read');}, write: async () => {assert.fail('offline cache write');}});
  f.p.probe.run = async () => {assert.fail('offline probe');};
  assert.equal((await f.run({force: true}, false)).checks.at(-1)?.code, 'live-not-requested');
  f.deps.cache = f.cache; f.setSession(undefined);
  assert.equal((await f.run()).checks.at(-1)?.code, 'live-blocked');
  assert.equal(f.files.size, 0);
  f.setSession({expiresAt: f.deps.now() + minute});
  f.p.probe.run = async () => {};
  assert.equal((await f.run()).checks.at(-1)?.cached, false);
});

test('public probes cache individually, preserve fresh local browser checks, and persist privately', async t => {
  const wayback = t.mock.method(WaybackClient.prototype, 'find', async () => []);
  const archive = t.mock.method(InternetArchiveClient.prototype, 'search', async () => ({}));
  const directory = t.mock.method(CyndisListHttp.prototype, 'get', async () => ({url: CATEGORY_INDEX, contentType: 'text/html',
    text: '<html><title>Genealogy Categories</title><div id="contentarea-inner"><h1>Genealogy Categories</h1><ul><li><a href="/example/">Example</a> (12)</li></ul></div></html>'}));
  const providers = ['cyndislist', 'internetarchive', 'wayback'] as const;
  const first = await runDoctor([...providers]);
  assert.ok(first.providers.every(p => p.checks.at(-1)?.cached === false));
  await writePrivateJson('browser/config.json', {invalid: true});
  try {
    const second = await runDoctor([...providers]);
    assert.ok(second.providers.every(p => p.checks.at(-1)?.cached === true));
    assert.equal(second.providers[0].status, 'error');
    assert.equal(second.providers[0].checks.find(check => check.id === 'browser')?.code, 'browser-config-invalid');
    assert.deepEqual([wayback, archive, directory].map(mock => mock.mock.callCount()), [1, 1, 1]);
    await runDoctor(['internetarchive'], true, undefined, undefined, {force: true});
    assert.deepEqual([wayback, archive, directory].map(mock => mock.mock.callCount()), [1, 2, 1]);
    await runDoctor([...providers], false, undefined, undefined, {force: true});
    assert.deepEqual([wayback, archive, directory].map(mock => mock.mock.callCount()), [1, 2, 1]);
    const path = join(CREDENTIAL_DIR, 'cache/health/internetarchive/availability.json');
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(path, '..'))).mode & 0o777, 0o700);
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.check.id, 'availability'); assert.equal(saved.session, undefined); assert.equal(saved.checks, undefined);
  } finally {await rm(join(CREDENTIAL_DIR, 'browser/config.json'), {force: true});}
});
