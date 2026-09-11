import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Impit} from 'impit';
import {CookieJar} from 'tough-cookie';
import {doctorProviders, diagnoseProvider, runDoctor, formatDoctor, type DoctorReport} from '../src/shared/doctor.js';
import {DoctorIssue, type DoctorProvider} from '../src/shared/doctor-checks.js';
import {BrowserError, saveBrowserConfig} from '../src/shared/browser-config.js';
import {CREDENTIAL_DIR, readPrivateJson, writePrivateJson} from '../src/shared/storage.js';
import {CHURCH_CLIENT_ID, REDIRECT_URI} from '../src/familysearch/auth.js';
import {CHURCH_ORIGIN} from '../src/familysearch/http.js';
import {StoriedHttp} from '../src/storied/http.js';

// Recovery regressions must never contact a provider, credential helper, or browser.
beforeEach(async t => {
  await rm(join(CREDENTIAL_DIR, 'cache/health'), {recursive: true, force: true});
  t.mock.method(Impit.prototype, 'fetch', async () => {assert.fail('Unexpected provider request');});
  t.mock.method(globalThis, 'fetch', async () => {assert.fail('Unexpected browser request');});
});

type State = {generation: number};
function fixture(provider: DoctorProvider, initial: State | undefined = {generation: 0}) {
  const events: string[] = [];
  let saved = initial;
  const deps = {
    read: async <T>(file: string) => (file === provider.sessionFile ? saved : undefined) as T | undefined,
    write: async (_file: string, next: unknown) => {events.push('save'); saved = next as State;},
    credentials: async () => 'file' as const, now: Date.now, browser: async () => true,
  };
  const p: DoctorProvider = {...provider, pending: undefined,
    inspect: value => {
      assert.equal(typeof (value as State)?.generation, 'number');
      return {mode: 'native', refreshAvailable: !!provider.refresh, expiresAt: 1};
    },
    refresh: provider.refresh ? async () => {events.push('refresh'); return {generation: 1};} : undefined,
    login: {...provider.login!, run: async () => {events.push('login'); return saved = {generation: 2};}},
    probe: {id: 'account', label: 'Synthetic account', run: async value => {
      const generation = (value as State).generation;
      events.push(`access:${generation}`);
      if (generation < 2) throw {status: generation === 0 ? 401 : 403};
    }},
  };
  return {p, deps, events};
}

test('every authenticated provider checks access, refreshes when supported, and signs in once before verifying again', async () => {
  for (const load of Object.values(doctorProviders)) {
    const actual = (await load()).doctorProvider;
    assert.ok(actual.login, `${actual.service} needs normal login recovery`);
    const {p, deps, events} = fixture(actual);
    const report = await diagnoseProvider(p, true, deps);
    assert.equal(report.status, 'ok', actual.service);
    assert.deepEqual(events, ['access:0', ...actual.refresh ? ['refresh', 'save', 'access:1'] : [], 'login', 'access:2'], actual.service);
    assert.equal(report.checks[0].code, 'session-verified');
    assert.ok(report.checks.some(check => check.code === 'session-login'));
    assert.deepEqual(report.recovery?.map(attempt => [attempt.method, attempt.outcome]), [
      ...actual.refresh ? [['refresh', 'failed']] : [], ['login', 'succeeded'],
    ]);
  }
});

test('healthy access wins over expiry metadata, and a successful refresh avoids login for every provider', async () => {
  for (const load of Object.values(doctorProviders)) {
    const actual = (await load()).doctorProvider;
    const {p, deps, events} = fixture(actual);
    p.probe.run = async () => {events.push('access');};
    assert.equal((await diagnoseProvider(p, true, deps)).status, 'ok');
    assert.deepEqual(events, ['access'], actual.service);
    if (!p.refresh) continue;
    events.length = 0;
    p.probe.run = async state => {events.push('access'); if ((state as State).generation === 0) throw {status: 401};};
    assert.equal((await diagnoseProvider(p, true, deps)).status, 'ok');
    assert.deepEqual(events, ['access', 'refresh', 'save', 'access'], actual.service);
  }
});

test('no-fix and offline checks never refresh, sign in, or save returned session changes', async () => {
  for (const load of Object.values(doctorProviders)) {
    const {p, deps, events} = fixture((await load()).doctorProvider);
    const failure = await diagnoseProvider(p, true, deps, undefined, {repair: false});
    assert.equal(failure.status, 'error'); assert.deepEqual(events, ['access:0']); assert.equal(failure.recovery, undefined);
    events.length = 0;
    p.probe.run = async () => {events.push('access'); return {session: {generation: 1}};};
    assert.equal((await diagnoseProvider(p, true, deps, undefined, {repair: false})).status, 'ok');
    assert.deepEqual(events, ['access']);
    events.length = 0;
    await diagnoseProvider(p, false, deps);
    assert.deepEqual(events, []);
  }
});

test('missing sessions can sign in, and failed login attempts are bounded and redacted', async () => {
  for (const load of Object.values(doctorProviders)) {
    const actual = (await load()).doctorProvider;
    const missing = fixture(actual);
    missing.deps.read = async () => undefined;
    assert.equal((await diagnoseProvider(missing.p, true, missing.deps)).status, 'ok');
    assert.deepEqual(missing.events, ['login', 'access:2']);
    const {p, deps, events} = fixture(actual);
    p.login!.run = async () => {events.push('login'); throw new Error('PRIVATE password and token');};
    const result = await diagnoseProvider(p, true, deps);
    assert.equal(result.status, 'error');
    assert.equal(events.filter(event => event === 'login').length, 1);
    assert.equal(result.checks.at(-1)?.code, 'login-failed');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|password and token/);
  }
});

test('NewspaperArchive has no hidden refresh and retains the rotated shared session', async t => {
  const session = {accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000,
    sessionId: '00000000-0000-4000-8000-000000000001', subject: 'synthetic-user', savedAt: new Date().toISOString()};
  const requests: string[] = [];
  t.mock.method(StoriedHttp.prototype, 'request', async (path: string, options: any) => {
    requests.push(path);
    if (path === '/oauth/token') return {access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer'};
    if (options.token === 'old-access') throw {status: 401};
    if (path === '/userinfo') return {sub: 'synthetic-user'};
    assert.match(path, /NewsPaperSearch\/countries$/);
    return {data: []};
  });
  await writePrivateJson('storied/session.json', session);
  try {
    const diagnostic = await runDoctor(['newspaperarchive'], true, undefined, undefined, {repair: false});
    assert.equal(diagnostic.status, 'error'); assert.deepEqual(requests, ['/userinfo']);
    assert.deepEqual(await readPrivateJson('storied/session.json'), session);
    requests.length = 0;
    const fixed = await runDoctor(['newspaperarchive'], true, undefined, undefined, {force: true});
    assert.equal(fixed.status, 'ok', JSON.stringify(fixed));
    assert.deepEqual(requests.slice(0, 3), ['/userinfo', '/oauth/token', '/userinfo']);
    assert.equal(requests.length, 4);
    const saved = await readPrivateJson<any>('storied/session.json');
    assert.equal(saved.accessToken, 'new-access'); assert.equal(saved.refreshToken, 'new-refresh');
  } finally {await rm(join(CREDENTIAL_DIR, 'storied/session.json'), {force: true});}
});

test('ambiguous access failures receive recovery; rate limits, outages, and save failures do not trigger new logins', async () => {
  const actual = (await doctorProviders.ancestry()).doctorProvider;
  for (const error of [{status: 403}, new DoctorIssue('api-changed'), new Error('Unrecognized account response')]) {
    const {p, deps, events} = fixture(actual);
    p.probe.run = async state => {events.push('access'); if ((state as State).generation < 2) throw error;};
    assert.equal((await diagnoseProvider(p, true, deps)).status, 'ok');
    assert.deepEqual(events, ['access', 'refresh', 'save', 'access', 'login', 'access']);
  }
  for (const error of [{status: 429}, {status: 503}, new Error('Network request failed'), new DoctorIssue('session-save-failed')]) {
    const {p, deps, events} = fixture(actual);
    p.probe.run = async () => {events.push('access'); throw error;};
    assert.equal((await diagnoseProvider(p, true, deps)).status, 'error');
    assert.deepEqual(events, ['access']);
  }
});

test('browser recovery reports required interaction and cooldowns without repeated login attempts', async () => {
  const actual = (await doctorProviders.myheritage()).doctorProvider;
  for (const [code, expected] of [['BROWSER_INTERACTION_REQUIRED', 'verification-required'], ['BROWSER_LOGIN_BLOCKED', 'login-blocked'], ['BROWSER_UNAVAILABLE', 'browser-unavailable']]) {
    const {p, deps, events} = fixture(actual);
    p.refresh = undefined;
    p.login!.run = async () => {events.push('login'); throw new BrowserError('PRIVATE challenge data', code, 'https://private.invalid/SECRET');};
    const result = await diagnoseProvider(p, true, deps);
    assert.equal(result.checks.at(-1)?.code, expected);
    assert.deepEqual(events, ['access:0', 'login']);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|private.invalid/);
  }
});

test('shared sessions get only one failed renewal and login attempt across their provider checks', async t => {
  const events: string[] = [];
  for (const service of ['storied', 'newspaperarchive'] as const) {
    const {p} = fixture((await doctorProviders[service]()).doctorProvider);
    p.sessionFile = 'synthetic-shared-session.json';
    p.refresh = async () => {events.push('refresh'); throw {status: 403};};
    p.login!.run = async () => {events.push('login'); throw new Error('Login failed');};
    t.mock.method(doctorProviders, service, async () => ({doctorProvider: p}));
  }
  await writePrivateJson('synthetic-shared-session.json', {generation: 0});
  await saveBrowserConfig({version: 1, mode: 'remote', remote: {url: 'http://127.0.0.1:1', vncUrl: 'https://viewer.example.test'},
    timeout: 0, transport: 'http', session: 'test', open: false});
  try {
    const report = await runDoctor(['storied', 'newspaperarchive']);
    assert.equal(report.status, 'error');
    assert.deepEqual(events, ['refresh', 'login']);
    assert.ok(report.providers[1].checks.some(check => check.code === 'login-already-attempted'));
  } finally {
    await rm(join(CREDENTIAL_DIR, 'synthetic-shared-session.json'), {force: true});
    await rm(join(CREDENTIAL_DIR, 'browser/config.json'), {force: true});
  }
});

test('FamilySearch recovers a 401 and denied refresh through its real login adapter against synthetic HTTP responses', async t => {
  const jar = new CookieJar(); jar.setCookieSync('synthetic=cookie; Path=/', 'https://www.familysearch.org');
  const session = {version: 1, clientId: CHURCH_CLIENT_ID, obtainedAt: new Date().toISOString(),
    tokens: {access_token: 'old-access', refresh_token: 'old-refresh'}, cookies: jar.serializeSync()};
  await writePrivateJson('session.json', session);
  await writePrivateJson('login.json', {username: 'synthetic-user', password: 'synthetic-password'});
  const events: string[] = [];
  let state = '';
  const json = (value: unknown) => new Response(JSON.stringify(value));
  const action = (name: string, value: unknown[] = []) => ({stateHandle: 'synthetic-state', remediation: {value: [{name, href: `${CHURCH_ORIGIN}/idp/idx/${name}`, value}]}});
  t.mock.method(Impit.prototype, 'fetch', async (url: unknown, init: any) => {
    const target = new URL(String(url)), body = String(init?.body ?? '');
    if (target.pathname === '/platform/users/current') {
      events.push('access');
      return new Headers(init.headers).get('authorization') === 'Bearer old-access' ? new Response('{}', {status: 401}) : json({users: [{id: 'synthetic-user'}]}) as never;
    }
    if (target.pathname === '/service/mobile/api/v1/login') {events.push('refresh'); return new Response('{}', {status: 403}) as never;}
    if (target.pathname === '/cis-web/oauth2/v3/authorization') {
      events.push('login'); state = target.searchParams.get('state')!;
      return new Response('', {status: 302, headers: {location: `${CHURCH_ORIGIN}/synthetic-login`}}) as never;
    }
    if (target.pathname === '/synthetic-login') return new Response('{"stateToken":"synthetic"}') as never;
    if (target.pathname.endsWith('/introspect')) return json(action('identify')) as never;
    if (target.pathname.endsWith('/identify')) return json(action('select-authenticator-authenticate', [{name: 'authenticator', options: [{label: 'Password', value: {form: {value: [{name: 'id', value: 'password'}]}}}]}])) as never;
    if (target.pathname.endsWith('/select-authenticator-authenticate')) return json(action('challenge-authenticator', [{name: 'credentials', form: {value: [{name: 'passcode'}]}}])) as never;
    if (target.pathname.endsWith('/challenge-authenticator')) {
      assert.equal(JSON.parse(body).credentials.passcode, 'synthetic-password');
      return json({success: {href: `${CHURCH_ORIGIN}/synthetic-success`}}) as never;
    }
    if (target.pathname === '/synthetic-success') return new Response('', {status: 302, headers: {location: `${REDIRECT_URI}?code=synthetic-code&state=${state}`}}) as never;
    if (target.pathname === '/cis-web/oauth2/v3/token') return json({access_token: 'new-access', refresh_token: 'new-refresh'}) as never;
    assert.fail(`Unexpected synthetic route: ${target.pathname}`);
  });
  try {
    const report = await runDoctor(['familysearch']);
    assert.equal(report.status, 'ok', JSON.stringify(report));
    assert.deepEqual(events, ['access', 'refresh', 'login', 'access']);
    assert.equal((await readPrivateJson<any>('session.json')).tokens.refresh_token, 'new-refresh');
    assert.match(formatDoctor(report), /Signed in again and verified/);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-password|old-access|new-access|new-refresh/);
  } finally {await rm(join(CREDENTIAL_DIR, 'session.json'), {force: true}); await rm(join(CREDENTIAL_DIR, 'login.json'), {force: true});}
});

test('the CLI forwards --no-fix and preserves saved sessions after a failed access probe', async () => {
  const preload = join(CREDENTIAL_DIR, 'doctor-no-fix.mjs');
  const session = {token: 'synthetic-token', contributorId: '123'};
  await writePrivateJson('findagrave/session.json', session);
  await writePrivateJson('findagrave/login.json', {username: 'synthetic-user', password: 'synthetic-password'});
  await writeFile(preload, `import {Impit} from ${JSON.stringify(import.meta.resolve('impit'))};
    Impit.prototype.fetch = async (_url, init) => {
      if (!String(init.body).includes('SignedInContributor')) throw new Error('Login must not run');
      return new Response('{}', {status: 401});
    };`);
  try {
    await assert.rejects(promisify(execFile)(process.execPath, ['--import', preload, '--import', import.meta.resolve('tsx'),
      fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'doctor', '--provider', 'findagrave', '--no-fix', '--json'],
    {cwd: CREDENTIAL_DIR, env: {...process.env, FAM_HISTORY: '0'}}), (error: any) => {
      const report = JSON.parse(error.stdout).data as DoctorReport;
      assert.equal(error.code, 1); assert.equal(error.stderr, '');
      assert.equal(report.providers[0].recovery, undefined);
      assert.equal(report.providers[0].checks.at(-1)?.code, 'session-rejected');
      return true;
    });
    assert.deepEqual(JSON.parse(await readFile(join(CREDENTIAL_DIR, 'findagrave/session.json'), 'utf8')), session);
  } finally {
    for (const file of ['doctor-no-fix.mjs', 'findagrave/session.json', 'findagrave/login.json']) await rm(join(CREDENTIAL_DIR, file), {force: true});
  }
});
