import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import { CHURCH_CLIENT_ID } from '../src/familysearch/auth.js';
import { diagnoseProvider, doctorProviders, runDoctor, formatDoctor, type DoctorReport, type DoctorEvent } from '../src/shared/doctor.js';
import { DoctorIssue, failure, graphData, type DoctorProvider } from '../src/shared/doctor-checks.js';
import { inspectLoginCredentials, type Service } from '../src/shared/credentials.js';
import { CREDENTIAL_DIR, writePrivateJson } from '../src/shared/storage.js';

const now = Date.now();
const jar = new CookieJar();
jar.setCookieSync('PHPSESSID=synthetic-cookie; Path=/; Secure', 'https://www.myheritage.com');
const sessions: Partial<Record<Service, any>> = {
  familysearch: {version: 1, clientId: CHURCH_CLIENT_ID, obtainedAt: new Date(now).toISOString(), tokens: {access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600}, cookies: jar.serializeSync()},
  ancestry: {deviceId: 'synthetic-device', tokens: {access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', user_id: 'synthetic-user'}, expiresAt: now + 3600_000, cookies: jar.serializeSync()},
  myheritage: {accessToken: 'synthetic-access', deviceId: 'synthetic-device', cookies: jar.serializeSync()},
  findmypast: {tokens: {access_token: 'synthetic-access', refresh_token: 'synthetic-refresh'}, expiresAt: now + 3600_000},
  findagrave: {token: 'synthetic-access', contributorId: '123', cookies: jar.serializeSync()},
  geneanet: {version: 1, username: 'synthetic-user', savedAt: new Date(now).toISOString(), validatedAt: new Date(now).toISOString(), cookies: jar.serializeSync()},
};
const services = Object.keys(sessions) as Service[];
const browserPage = 'var isLoggedIn = true; var currentUserAccountID = "123"; var siteID = "456"; var mediaUploaderData = {"fgToken":"fresh-browser-token"}; var mhXsrfToken = "synthetic-csrf"; var treeSelectionMenuEntries = [];';
async function provider(service: Service) { return (await doctorProviders[service]()).doctorProvider; }
function dependencies(p: DoctorProvider, session: unknown, extra: Record<string, unknown> = {}) {
  return {read: async <T>(file: string) => (file === p.sessionFile ? session : extra[file]) as T | undefined,
    write: async () => {}, credentials: async () => 'none' as const, now: () => now};
}
const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args, ...args[0] === 'cli.health' ? ['--offline'] : []], {
  cwd: CREDENTIAL_DIR, env: {...process.env, FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]'},
});

test('CLI checks online by default and reports only verified sessions as OK', async () => {
  const preload = join(CREDENTIAL_DIR, 'doctor-network.mjs');
  await writePrivateJson('findagrave/session.json', sessions.findagrave);
  await writeFile(preload, `import {Impit} from ${JSON.stringify(import.meta.resolve('impit'))};
    Impit.prototype.fetch = async function(url, init) {
      if (!String(init.body).includes('SignedInContributor')) throw new Error('Unexpected request');
      return new Response('{"data":{"signedInContributor":{"id":"123"}}}');
    };`);
  try {
    for (const command of [['cli.health', 'check'], ['doctor']]) {
      const result = await run(process.execPath, ['--import', preload, '--import', import.meta.resolve('tsx'), cli, ...command, '--provider', 'findagrave', '--json'],
        {cwd: CREDENTIAL_DIR, env: {...process.env, FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]'}});
      const report = JSON.parse(result.stdout).data;
      assert.equal(report.mode, 'live'); assert.equal(report.status, 'ok'); assert.equal(result.stderr, '');
      assert.ok(report.providers[0].checks.some((c: any) => c.code === 'probe-passed'));
    }
  } finally {await rm(preload); await rm(join(CREDENTIAL_DIR, 'findagrave/session.json'));}
});

test('independent health checks finish while a slow provider is pending, preserving report order and failures', {timeout: 5000}, async t => {
  const gate = Promise.withResolvers<void>(), fast = Promise.withResolvers<void>();
  const events: DoctorEvent[] = [];
  const ancestry = await provider('ancestry'), grave = await provider('findagrave');
  t.mock.method(doctorProviders, 'ancestry', async () => ({doctorProvider: {...ancestry,
    probe: {...ancestry.probe, run: async () => {await gate.promise;}}}}));
  t.mock.method(doctorProviders, 'findagrave', async () => ({doctorProvider: {...grave,
    probe: {...grave.probe, run: async () => {throw {status: 401};}}}}));
  t.mock.method(doctorProviders, 'geneanet', async () => {throw new Error('PRIVATE');});
  await writePrivateJson('ancestry/session.json', sessions.ancestry);
  await writePrivateJson('findagrave/session.json', sessions.findagrave);
  const pending = runDoctor(['ancestry', 'findagrave', 'geneanet'], true, undefined, event => {
    events.push(event);
    if (event.type === 'complete' && event.provider === 'findagrave') fast.resolve();
  });
  try {
    await fast.promise;
    assert.ok(!events.some(event => event.type === 'complete' && event.provider === 'ancestry'));
    gate.resolve();
    const report = await pending;
    assert.deepEqual(report.providers.map(p => p.provider), ['ancestry', 'findagrave', 'geneanet']);
    assert.deepEqual(report.providers.map(p => p.status), ['ok', 'error', 'error']);
    assert.equal(report.status, 'error');
    assert.equal(report.providers[2].checks[0].code, 'provider-unavailable');
    assert.equal(events.filter(event => event.type === 'complete').length, 3);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  } finally {
    gate.resolve(); await pending;
    await rm(join(CREDENTIAL_DIR, 'ancestry/session.json'), {force: true});
    await rm(join(CREDENTIAL_DIR, 'findagrave/session.json'), {force: true});
  }
});

test('providers sharing a session wait for renewal and read the saved replacement', {timeout: 5000}, async t => {
  const first = Promise.withResolvers<void>(), waiting = Promise.withResolvers<void>();
  const probes: string[] = [];
  let active = 0, renewals = 0;
  for (const service of ['storied', 'newspaperarchive'] as const) {
    const original = (await doctorProviders[service]()).doctorProvider;
    const synthetic: DoctorProvider = {...original, sessionFile: 'doctor-shared-session.json',
      inspect: value => ({mode: 'native', expiresAt: (value as {expiresAt: number}).expiresAt, refreshAvailable: true}),
      refresh: async () => {renewals++; return {expiresAt: Date.now() + 3600_000, rotated: true};},
      probe: {id: 'account', label: 'Synthetic shared account', run: async value => {
        if (!(value as {rotated?: boolean}).rotated) throw {status: 401};
        assert.equal(++active, 1, 'shared session probes must not overlap');
        assert.equal((value as {rotated: boolean}).rotated, true);
        probes.push(service);
        if (probes.length === 1) await first.promise;
        active--;
      }},
    };
    t.mock.method(doctorProviders, service, async () => ({doctorProvider: synthetic}));
  }
  await writePrivateJson('doctor-shared-session.json', {expiresAt: 0});
  const pending = runDoctor(['storied', 'newspaperarchive'], true, undefined, event => {
    if (event.type === 'progress' && event.label === 'Waiting for shared session') waiting.resolve();
  });
  try {
    await waiting.promise;
    first.resolve();
    const report = await pending;
    assert.equal(report.status, 'ok'); assert.equal(renewals, 1);
    assert.equal(probes.length, 2);
    assert.deepEqual(report.providers.map(p => p.provider), ['storied', 'newspaperarchive']);
  } finally {first.resolve(); await pending; await rm(join(CREDENTIAL_DIR, 'doctor-shared-session.json'), {force: true});}
});

test('native doctor checks renew once, persist rotated tokens, then verify the session', async t => {
  for (const service of ['familysearch', 'ancestry', 'myheritage', 'findmypast'] as const) {
    for (const expired of service === 'myheritage' ? [false] : [false, true]) {
      const p = await provider(service), s = structuredClone(sessions[service]), events: string[] = [];
      if (expired) {
        if (service === 'familysearch') s.obtainedAt = new Date(now - 7200_000).toISOString();
        else s.expiresAt = now - 1;
      }
      let saved: any;
      const fetch = t.mock.method(Impit.prototype, 'fetch', async (url: unknown, init: any) => {
        const u = new URL(String(url)), body = String(init?.body ?? '');
        assert.doesNotMatch(body, /password|user_credentials|Email=|Pwd=/);
        if (/\/login$|\/tokens?$|refresh-token/.test(u.pathname)) {
          events.push('refresh');
          if (service === 'myheritage') return new Response('<MyHeritage><Result>0</Result><FamilyGraphAccessToken>rotated-access</FamilyGraphAccessToken></MyHeritage>') as never;
          assert.match(body, /refresh_token/);
          return new Response(JSON.stringify({access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer'})) as never;
        }
        if (new Headers(init.headers).get('authorization') === 'Bearer synthetic-access') {
          events.push('rejected'); return new Response('{}', {status: 401}) as never;
        }
        events.push('verify');
        assert.equal(saved?.accessToken ?? saved?.tokens.access_token, 'rotated-access', 'save precedes verification');
        const data = service === 'familysearch' ? {users: [{id: '123'}]} : service === 'ancestry' ? {data: {trees: {treeConnection: {nodes: []}}}}
          : service === 'myheritage' ? {id: 'user-123'} : {data: {currentUserProfile: {id: '123'}}};
        return new Response(JSON.stringify(data)) as never;
      });
      const result = await diagnoseProvider(p, true, {...dependencies(p, s), write: async (file, value) => {
        assert.equal(file, p.sessionFile); events.push('save'); saved = value;
      }});
      assert.equal(result.status, 'ok', JSON.stringify(result));
      assert.deepEqual(events, ['rejected', 'refresh', 'save', 'verify', ...service === 'findmypast' ? [] : ['save']], service);
      if (service !== 'myheritage') assert.equal(saved.tokens.refresh_token, 'rotated-refresh');
      assert.equal(result.checks[0].code, 'session-verified');
      assert.doesNotMatch(JSON.stringify(result), /rotated-access|rotated-refresh|synthetic-/);
      fetch.mock.restore();
    }
  }
});

test('doctor bounds renewal, saves before failed verification, and leaves ordinary failures alone', async () => {
  const base = await provider('ancestry');
  for (const expired of [false, true]) for (const status of [401, 403, 429, 503]) {
    const events: string[] = [], s = {...sessions.ancestry, expiresAt: expired ? now - 1 : now + 3600_000};
    const p: DoctorProvider = {...base, refresh: async () => {events.push('refresh'); return sessions.ancestry;},
      probe: {id: 'trees', label: 'Session', run: async () => {events.push('probe'); throw {status};}}};
    const r = await diagnoseProvider(p, true, {...dependencies(p, s), write: async () => {events.push('save');}});
    assert.equal(r.status, 'error');
    assert.deepEqual(events, [401, 403].includes(status) ? ['probe', 'refresh', 'save', 'probe'] : ['probe']);
  }
  for (const problem of ['rejected', 'network', 'save'] as const) {
    const events: string[] = [];
    const p: DoctorProvider = {...base, refresh: async () => {
      events.push('refresh');
      if (problem === 'rejected') throw {status: 400};
      if (problem === 'network') throw new Error('Network request failed SECRET');
      return sessions.ancestry;
    }, probe: {id: 'trees', label: 'Session', run: async () => {events.push('probe'); throw {status: 401};}}};
    const result = await diagnoseProvider(p, true, {...dependencies(p, {...sessions.ancestry, expiresAt: now - 1}),
      write: async () => {events.push('save'); throw new Error('SECRET path');}});
    assert.deepEqual(events, problem === 'save' ? ['probe', 'refresh', 'save'] : ['probe', 'refresh']);
    assert.equal(result.checks.at(-1)?.code, problem === 'rejected' ? 'refresh-rejected' : problem === 'save' ? 'session-save-failed' : 'network');
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  }
});

test('offline never renews or writes and password configuration cannot block online session checks', async () => {
  const base = await provider('ancestry');
  let probes = 0;
  const p: DoctorProvider = {...base, refresh: async () => {assert.fail('no renewal needed');},
    probe: {...base.probe, run: async () => {probes++;}}};
  const deps = {...dependencies(p, sessions.ancestry, {'ancestry/pending-auth.json': {}}),
    credentials: async (): Promise<never> => {throw new Error('SECRET');}, write: async () => {assert.fail('no write');}};
  await diagnoseProvider(p, false, {...deps, read: async <T>(file: string) =>
    (file === p.sessionFile ? {...sessions.ancestry, expiresAt: now - 1} : undefined) as T});
  assert.equal(probes, 0);
  const result = await diagnoseProvider(p, true, deps);
  assert.equal(probes, 1); assert.equal(result.status, 'ok');
  assert.ok(result.checks.some(c => c.code === 'credentials-invalid' && c.scope === 'password-login'));
});

test('doctor help, filtering, JSON, local-only behavior, and exit codes work outside the checkout', async () => {
  for (const args of [['cli.health', 'check', '--help']]) assert.match((await invoke(...args)).stdout, /fam cli\.health check/);
  for (const args of [['cli.health', 'check', '--provider', 'toString'], ['cli.health', 'check', '--bogus'], ['cli.health', 'check', '--live=yes'], ['cli.health', 'check', '--format', 'invalid']]) {
    await assert.rejects(invoke(...args), error => (error as any).code === 2);
  }
  await assert.rejects(invoke('cli.health', 'check', '--provider', 'ancestry', '--json'), error => {
    const e = error as any, report = JSON.parse(e.stdout).data;
    assert.equal(e.code, 1); assert.equal(e.stderr, ''); assert.equal(report.mode, 'local');
    assert.deepEqual(report.providers.map((p: any) => p.provider), ['ancestry']);
    assert.equal(report.providers[0].checks.find((c: any) => c.id === 'credentials').code, 'credentials-helper');
    assert.equal(report.providers[0].checks.find((c: any) => c.id === 'trees').status, 'skipped');
    return true;
  });
  await writePrivateJson('ancestry/session.json', sessions.ancestry);
  try {
    const {stdout} = await invoke('cli.health', 'check', '--provider', 'ancestry', '--provider', 'ancestry', '--json');
    const report = JSON.parse(stdout).data;
    assert.equal(report.status, 'ok'); assert.equal(report.providers.length, 1);
    const compact = await invoke('cli.health', 'check', '--provider', 'ancestry', '--format', 'text');
    assert.match(compact.stdout, /ancestry\s+SAVED/); assert.equal(compact.stderr, '');
    assert.ok(compact.stdout.split('\n').length < 6);
    assert.doesNotMatch(compact.stdout, /Profile:|Coverage:|credentials:/);
    assert.match((await invoke('cli.health', 'check', '--provider', 'ancestry', '--verbose', '--format', 'text')).stdout, /Profile:|credentials:/);
    assert.doesNotMatch(stdout, /synthetic-access|synthetic-refresh|synthetic-user|synthetic-cookie|helper-must-never-run/);
  } finally {await rm(join(CREDENTIAL_DIR, 'ancestry/session.json'));}
});

test('credential inspection respects precedence without helper execution or secret output', async () => {
  const saved = {...process.env};
  try {
    process.env.FAM_CREDENTIALS_COMMAND = '["helper-must-never-run"]';
    assert.equal(await inspectLoginCredentials('ancestry'), 'helper');
    process.env.ANCESTRY_USERNAME = 'synthetic-user';
    await assert.rejects(inspectLoginCredentials('ancestry'), /Set both/);
    process.env.ANCESTRY_PASSWORD = 'synthetic-password';
    process.env.FAM_CREDENTIALS_COMMAND = 'malformed-secret';
    assert.equal(await inspectLoginCredentials('ancestry'), 'environment');
    delete process.env.ANCESTRY_USERNAME; delete process.env.ANCESTRY_PASSWORD;
    await assert.rejects(inspectLoginCredentials('ancestry'), /must be a JSON array/);
    delete process.env.FAM_CREDENTIALS_COMMAND;
    await writePrivateJson('ancestry/login.json', {username: 'synthetic-user', password: 'synthetic-password'});
    assert.equal(await inspectLoginCredentials('ancestry'), 'file');
  } finally {
    for (const name of ['FAM_CREDENTIALS_COMMAND', 'ANCESTRY_USERNAME', 'ANCESTRY_PASSWORD']) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
    await rm(join(CREDENTIAL_DIR, 'ancestry/login.json'), {force: true});
  }
});

test('all providers handle missing, malformed, unexpired, and unknown-expiry sessions offline', async t => {
  t.mock.method(Impit.prototype, 'fetch', async () => {throw new Error('Network must never run');});
  for (const service of services) {
    const p = await provider(service);
    for (const value of [null, {}, [], {tokens: null}, {...sessions[service], cookies: {cookies: 'bad'}}]) {
      // Native Findmypast does not use a cookie jar.
      if (service === 'findmypast' && value && (value as any).cookies) continue;
      const r = await diagnoseProvider(p, false, dependencies(p, value));
      assert.equal(r.checks[0].code, 'session-invalid', service);
    }
    const missing = await diagnoseProvider(p, false, dependencies(p, undefined));
    assert.equal(missing.checks[0].code, 'session-missing');
    const good = await diagnoseProvider(p, false, dependencies(p, sessions[service]));
    assert.equal(good.status, 'ok', service);
    assert.equal(good.checks.find(c => c.id === p.probe.id)?.status, 'skipped');
  }
});

test('known expiry and pending verification include provider-specific recovery; old blocks do not warn', async () => {
  for (const service of ['familysearch', 'ancestry', 'findmypast'] as const) {
    const p = await provider(service), s = structuredClone(sessions[service]);
    if (service === 'familysearch') {s.obtainedAt = new Date(now - 7200_000).toISOString();} else s.expiresAt = now - 1;
    const r = await diagnoseProvider(p, false, dependencies(p, s));
    assert.equal(r.checks[0].code, 'session-expired'); assert.match(r.checks[0].action!, new RegExp(`fam ${service}\\.session login`));
    s.expiresAt = 1e30;
    if (service !== 'familysearch') assert.throws(() => p.inspect(s));
  }
  const p = await provider('myheritage');
  const r = await diagnoseProvider(p, false, dependencies(p, sessions.myheritage, {
    'myheritage/pending-auth.json': {description: 'PRIVATE-DATA'}, 'myheritage/login-block.json': {blockedUntil: new Date(now + 60_000).toISOString()},
  }));
  assert.ok(r.checks.some(c => c.code === 'verification-pending'));
  assert.ok(r.checks.some(c => c.code === 'login-blocked'));
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE-DATA/);
  const old = await diagnoseProvider(p, false, dependencies(p, sessions.myheritage, {'myheritage/login-block.json': {blockedUntil: new Date(now - 1).toISOString()}}));
  assert.equal(old.status, 'ok');
});

test('live checks skip missing or malformed sessions without configured credentials or browser recovery', async t => {
  const fetch = t.mock.method(Impit.prototype, 'fetch', async () => {throw new Error('No request allowed');});
  for (const service of services) {
    const p = await provider(service);
    for (const value of [undefined, null, {}]) {
      const r = await diagnoseProvider(p, true, dependencies(p, value));
      assert.equal(r.checks.find(c => c.id === p.probe.id)?.code, 'live-blocked');
    }
    const unreadable = await diagnoseProvider(p, true, {...dependencies(p, sessions[service]), read: async () => {throw new Error('SECRET');}});
    assert.equal(unreadable.checks.find(c => c.id === p.probe.id)?.code, 'live-blocked');
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('HTTP, GraphQL, schema, network and account failures remain distinct and redacted', () => {
  for (const [error, code] of [
    [{status: 401}, 'session-rejected'], [{status: 403}, 'access-denied'], [{status: 429}, 'rate-limited'],
    [{status: 503}, 'service-unavailable'], [{status: 406}, 'verification-required'],
    [new Error('Network request failed for https://private.invalid/SECRET'), 'network'],
    [new Error('Expected JSON SECRET'), 'api-changed'], [new Error('SECRET'), 'check-failed'],
  ] as const) {
    const r = failure(error, 'Run fam findagrave.session login.');
    assert.equal(r.code, code); assert.doesNotMatch(JSON.stringify(r), /SECRET|private.invalid/);
  }
  for (const [extensions, code] of [[{code: 'UNAUTHENTICATED'}, 'session-rejected'], [{code: 'FORBIDDEN'}, 'access-denied'], [{code: 'SECRET'}, 'api-changed']] as const) {
    assert.throws(() => graphData({data: {partial: true}, errors: [{message: 'SECRET', extensions}]}), e => e instanceof DoctorIssue && e.code === code);
  }
  for (const value of [null, '<html>Login</html>', {}, {data: null}]) assert.throws(() => graphData(value));
});

test('healthy providers make one session request and preserve updated cookies without searches, login or token renewal', async t => {
  const before: Record<string, string> = {};
  for (const service of services) {
    const p = await provider(service); await writePrivateJson(p.sessionFile, sessions[service]);
    before[p.sessionFile] = await readFile(join(CREDENTIAL_DIR, p.sessionFile), 'utf8');
  }
  const fetch = t.mock.method(Impit.prototype, 'fetch', async (url: unknown, init: any) => {
    const u = new URL(String(url)), body = init?.body ? String(init.body) : '', operation = body.startsWith('{') ? JSON.parse(body).operationName : undefined;
    assert.doesNotMatch(u.pathname, /login|refresh|oauth|ancauth|research|catalog|search/);
    assert.doesNotMatch(body, /mutation|synthetic-refresh|password|SearchRecordSets|MemorialSearch/);
    assert.equal(init.redirect, 'manual');
    if (u.origin === 'https://en.geneanet.org' && u.pathname === '/') return new Response('<script>$.extend(true, keys.elements, {"user":{"username":"synthetic-user"}});</script>', {headers: {'set-cookie': 'new=SECRET; Path=/; Secure'}}) as never;
    let data: unknown;
    if (u.pathname === '/platform/users/current') data = {users: [{id: 'synthetic-user'}]};
    else if (operation === 'GetTreeList') data = {data: {trees: {treeConnection: {nodes: []}}}};
    else if (u.pathname === '/me') data = {id: 'user-123'};
    else if (operation === 'GetCurrentUserProfile') data = {data: {currentUserProfile: {id: '123'}}};
    else if (operation === 'SignedInContributor') data = {data: {signedInContributor: {id: '123'}}};
    else throw new Error(`Unexpected request: ${u.pathname}`);
    return new Response(JSON.stringify(data), {headers: {'set-cookie': 'new=SECRET; Path=/; Secure'}}) as never;
  });
  try {
    for (const service of services) {
      const start = fetch.mock.callCount(), report = await runDoctor([service], true);
      assert.equal(report.status, 'ok', JSON.stringify(report));
      assert.equal(fetch.mock.callCount() - start, 1, service);
      assert.doesNotMatch(JSON.stringify(report) + formatDoctor(report), /synthetic-access|synthetic-refresh|synthetic-user|synthetic-cookie|SECRET/);
    }
    for (const [file, contents] of Object.entries(before)) {
      const saved = JSON.parse(await readFile(join(CREDENTIAL_DIR, file), 'utf8'));
      if (file === 'findmypast/session.json') assert.deepEqual(saved, JSON.parse(contents));
      else assert.ok(saved.cookies.cookies.some((c: any) => c.key === 'new' && c.value === 'SECRET'), file);
    }
  } finally {for (const file of Object.keys(before)) await rm(join(CREDENTIAL_DIR, file), {force: true});}
});

test('sessions without renewal do not retry 401s, and null profiles fail', async t => {
  let requests = 0;
  const fetch = t.mock.method(Impit.prototype, 'fetch', async (_url: unknown, init: any) => {
    requests++; assert.doesNotMatch(String(init?.body), /refresh_token|password/);
    return new Response('{"private":"SECRET"}', {status: 401}) as never;
  });
  for (const service of services) {
    const p = {...await provider(service), refresh: undefined}, s = structuredClone(sessions[service]);
    const start = requests, r = await diagnoseProvider(p, true, dependencies(p, s));
    assert.equal(requests - start, 1, service);
    assert.equal(r.checks.find(c => c.id === p.probe.id)?.code, 'session-rejected');
  }
  fetch.mock.mockImplementation(async () => new Response('{"data":{"currentUserProfile":null}}') as never);
  const p = await provider('findmypast');
  await assert.rejects(p.probe.run(sessions.findmypast), e => e instanceof DoctorIssue && e.code === 'session-rejected');
});

test('Findmypast keeps the captured origin and MyHeritage requests browser setup when recovery is unavailable', async t => {
  const p = await provider('findmypast'), s = {mode: 'browser', apiBase: 'https://www.findmypast.co.uk/titan/marshal', cookies: jar.serializeSync()};
  assert.equal(p.inspect(s).mode, 'browser');
  assert.throws(() => p.inspect({...s, apiBase: 'https://evil.example/titan/marshal'}));
  const fetch = t.mock.method(Impit.prototype, 'fetch', async (url: unknown, init: any) => {
    assert.equal(String(url), `${s.apiBase}/graphql`); assert.equal(new Headers(init.headers).get('authorization'), null);
    return new Response('{"data":{"currentUserProfile":{"id":"123"}}}') as never;
  });
  await p.probe.run(s);
  fetch.mock.mockImplementation(async () => new Response('var isLoggedIn = false;') as never);
  const mh = await provider('myheritage'), browser = {...sessions.myheritage, mode: 'browser', browser: {pageUrl: 'https://www.myheritage.com/family-trees/synthetic'}};
  const r = await diagnoseProvider(mh, true, dependencies(mh, browser));
  assert.equal(r.checks.find(c => c.id === 'account')?.code, 'session-rejected');
  assert.match(r.checks.find(c => c.id === 'account')?.action!, /fam browser setup/);
  assert.equal(fetch.mock.callCount(), 2); // One Findmypast request, one MyHeritage request.
});

test('MyHeritage HTTP 200 security challenges do not imply expired credentials or trigger renewal', async t => {
  const p = await provider('myheritage');
  const fetch = t.mock.method(Impit.prototype, 'fetch', async () => new Response('<html><body><iframe src="/_Incapsula_Resource?synthetic=SECRET"></iframe></body></html>') as never);
  for (const s of [sessions.myheritage, {...sessions.myheritage, mode: 'browser', browser: {pageUrl: 'https://www.myheritage.com/family-trees/synthetic'}}]) {
    const start = fetch.mock.callCount();
    const r = await diagnoseProvider(p, true, {...dependencies(p, s), write: async () => {assert.fail('challenge must not replace saved credentials');}});
    assert.equal(fetch.mock.callCount() - start, 1);
    assert.equal(r.checks.at(-1)?.code, 'request-challenged');
    assert.doesNotMatch(JSON.stringify(r), /SECRET/);
    assert.match(formatDoctor({schemaVersion: 1, checkedAt: new Date(now).toISOString(), mode: 'live', status: r.status, providers: [r]}), /WAIT\s+Request challenged; session unverified/);
  }
});

test('malformed JSON on disk does not abort reports for other providers', async () => {
  await writeFile(join(CREDENTIAL_DIR, 'session.json'), 'SECRET-invalid-json');
  try {
    const r = await runDoctor(['familysearch', 'findagrave'], false);
    assert.equal(r.providers.length, 2); assert.equal(r.providers[0].checks[0].code, 'session-invalid');
    assert.equal(r.providers[1].checks[0].code, 'session-missing'); assert.doesNotMatch(JSON.stringify(r), /SECRET/);
  } finally {await rm(join(CREDENTIAL_DIR, 'session.json'));}
});

test('MyHeritage browser check saves current page credentials without native login or API follow-ups', async t => {
  const p = await provider('myheritage'), s = {...sessions.myheritage, mode: 'browser', browser: {pageUrl: 'https://www.myheritage.com/family-trees/synthetic'}};
  const before = JSON.stringify(s);
  const fetch = t.mock.method(Impit.prototype, 'fetch', async (url: unknown, init: any) => {
    assert.equal(String(url), s.browser.pageUrl);
    assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).get('authorization'), null);
    return new Response(browserPage, {headers: {'set-cookie': 'renewed=synthetic; Path=/; Secure'}}) as never;
  });
  const saved: any[] = [];
  const r = await diagnoseProvider(p, true, {...dependencies(p, s), write: async (_file, value) => {saved.push(value);}});
  assert.equal(r.status, 'ok'); assert.equal(fetch.mock.callCount(), 1);
  assert.equal(saved[0].accessToken, 'fresh-browser-token');
  assert.ok(saved[0].cookies.cookies.some((c: any) => c.key === 'renewed'));
  assert.equal(JSON.stringify(s), before);
  fetch.mock.mockImplementation(async () => new Response('', {status: 302, headers: {location: 'https://www.myheritage.com/login'}}) as never);
  const redirected = await diagnoseProvider(p, true, dependencies(p, s));
  assert.equal(redirected.status, 'error'); assert.equal(fetch.mock.callCount(), 2);
});

test('compact output shows one row per provider and one relevant action, with details available separately', () => {
  const report: DoctorReport = {schemaVersion: 1, checkedAt: new Date(now).toISOString(), mode: 'local', status: 'warning', providers: [
    {provider: 'familysearch', status: 'ok', checks: [{id: 'session', status: 'ok', code: 'session-saved', message: 'Saved session metadata.'}], limitations: ['No tree traversal.']},
    {provider: 'myheritage', status: 'warning', checks: [
      {id: 'verification', status: 'warning', code: 'verification-pending', message: 'Verification pending.', action: 'Do not show this before the cooldown.'},
      {id: 'login-block', status: 'warning', code: 'login-blocked', message: 'Password sign-in is blocked until 2026-09-07T22:00:00.000Z.', action: 'Wait until the cooldown ends. More details here.'},
      {id: 'account', status: 'skipped', code: 'live-blocked', message: 'No request sent.'},
    ], limitations: ['No API follow-ups.']},
  ]};
  const compact = formatDoctor(report);
  assert.match(compact, /familysearch\s+SAVED\s+Not checked online/);
  assert.match(compact, /myheritage\s+BLOCKED\s+until 2026-09-07T22:00:00.000Z/);
  assert.match(compact, /myheritage: Wait until the cooldown ends\./);
  assert.doesNotMatch(compact, /credentials|Profile:|Coverage:|More details|Do not show|skipped|errors,/);
  assert.ok(compact.split('\n').length <= 6);
  const verbose = formatDoctor(report, true);
  assert.match(verbose, /Profile:|Coverage:|verification/);
  assert.match(verbose, /No request sent/);
});

test('MyHeritage password-login restrictions do not block or mislabel saved browser or native sessions', async t => {
  const p = await provider('myheritage');
  const browser = {...sessions.myheritage, mode: 'browser', browser: {pageUrl: 'https://www.myheritage.com/family-trees/synthetic'}};
  const pending = {'myheritage/login-block.json': {blockedUntil: new Date(now + 60_000).toISOString()},
    'myheritage/pending-auth.json': {description: 'PRIVATE'}};
  const report = (result: Awaited<ReturnType<typeof diagnoseProvider>>, mode: 'local' | 'live'): DoctorReport =>
    ({schemaVersion: 1, checkedAt: new Date(now).toISOString(), mode, status: result.status, providers: [result]});
  const fetch = t.mock.method(Impit.prototype, 'fetch', async (url: unknown, init: any) => {
    const u = new URL(String(url));
    assert.doesNotMatch(u.pathname, /login|refresh|oauth/);
    assert.equal(init.method, 'GET');
    if (u.pathname === '/me') return new Response('{"id":"user-123"}') as never;
    assert.equal(String(url), browser.browser.pageUrl);
    return new Response(browserPage) as never;
  });
  const local = await diagnoseProvider(p, false, dependencies(p, browser, pending));
  assert.equal(fetch.mock.callCount(), 0); assert.equal(local.status, 'ok');
  assert.match(formatDoctor(report(local, 'local')), /myheritage\s+SAVED\s+Browser session; not checked online/);
  assert.doesNotMatch(formatDoctor(report(local, 'local')), /BLOCKED|Wait until/);
  assert.match(formatDoctor(report(local, 'local'), true), /login-block \[password login only\]/);
  assert.ok(local.checks.filter(c => c.scope === 'password-login').every(c => c.status === 'warning'));
  assert.doesNotMatch(JSON.stringify(local), /PRIVATE/);
  for (const saved of [browser, sessions.myheritage]) {
    const start = fetch.mock.callCount();
    const live = await diagnoseProvider(p, true, dependencies(p, saved, pending));
    assert.equal(live.status, 'ok'); assert.equal(fetch.mock.callCount() - start, 1);
    assert.match(formatDoctor(report(live, 'live')), /myheritage\s+OK/);
  }
  // A missing session still requires setup, and a real session rejection still fails.
  const missing = await diagnoseProvider(p, true, dependencies(p, undefined, pending));
  assert.equal(missing.status, 'warning'); assert.equal(fetch.mock.callCount(), 2);
  assert.equal(missing.checks.find(c => c.id === 'account')?.code, 'live-blocked');
  fetch.mock.mockImplementation(async () => new Response('var isLoggedIn = false;') as never);
  const rejected = await diagnoseProvider(p, true, dependencies(p, browser, pending));
  assert.equal(rejected.status, 'error'); assert.equal(fetch.mock.callCount(), 3);
  assert.equal(rejected.checks.find(c => c.id === 'account')?.code, 'session-rejected');
  assert.match(formatDoctor(report(rejected, 'live')), /myheritage\s+INVALID/);
});

test('password-login-only notices do not fail the installed CLI or erase the cooldown', async () => {
  const browser = {...sessions.myheritage, mode: 'browser', browser: {pageUrl: 'https://www.myheritage.com/family-trees/synthetic'}};
  const filename = 'myheritage/login-block.json';
  await writePrivateJson('myheritage/session.json', browser);
  await writePrivateJson(filename, {blockedUntil: new Date(now + 60_000).toISOString()});
  const before = await readFile(join(CREDENTIAL_DIR, filename), 'utf8');
  try {
    const {stdout, stderr} = await invoke('cli.health', 'check', '--provider', 'myheritage', '--format', 'text');
    assert.equal(stderr, ''); assert.match(stdout, /myheritage\s+SAVED\s+Browser session/); assert.doesNotMatch(stdout, /BLOCKED/);
    const json = JSON.parse((await invoke('cli.health', 'check', '--provider', 'myheritage', '--json')).stdout).data;
    assert.equal(json.status, 'ok');
    assert.equal(json.providers[0].checks.find((c: any) => c.code === 'login-blocked').scope, 'password-login');
    assert.equal(await readFile(join(CREDENTIAL_DIR, filename), 'utf8'), before);
  } finally {
    await rm(join(CREDENTIAL_DIR, filename), {force: true});
    await rm(join(CREDENTIAL_DIR, 'myheritage/session.json'), {force: true});
  }
});
