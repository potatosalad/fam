import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {mkdtemp, readdir, readFile, stat, writeFile, mkdir, symlink, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {CREDENTIAL_DIR, appendPrivateJsonl} from '../src/shared/storage.js';
import {historyArguments, historyRedactor, errorSummary} from '../src/shared/command-history.js';
import {inspectResult, setDiagnosticSink} from '../src/shared/diagnostics.js';
import {withSessionRefresh} from '../src/shared/session-refresh.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const loader = ['--import', import.meta.resolve('tsx')];
const profile = () => mkdtemp(join(CREDENTIAL_DIR, 'history-test-'));
const invoke = (directory: string, args: string[], env = {}) => run(process.execPath, [...loader, cli, ...args], {
  cwd: directory, timeout: 15_000, env: {...process.env, FAM_CONFIG_DIR: directory, ...env},
});
async function records(directory: string) {
  const path = join(directory, 'history');
  const files = await readdir(path);
  const text = (await Promise.all(files.sort().map(file => readFile(join(path, file), 'utf8')))).join('');
  return text.trim().split('\n').map(line => JSON.parse(line));
}

test('every CLI invocation records start and actual finish, including help, dry-run and usage errors', async () => {
  const directory = await profile();
  assert.match((await invoke(directory, [])).stdout, /^fam -/);
  await invoke(directory, ['ancestry.person', 'get', '--tree-id', 'private-tree', '--person-id', 'private-person', '--dry-run', '--json']);
  await assert.rejects(invoke(directory, ['ancestry.person', 'get', '--json']), (error: any) => {
    assert.equal(error.code, 2); assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_ARGUMENT'); return true;
  });
  const rows = await records(directory), done = rows.filter(r => r.event === 'finish');
  assert.equal(rows.length, 6); assert.equal(new Set(rows.map(r => r.id)).size, 3);
  assert.deepEqual(done.map(r => r.outcome), ['success', 'success', 'hard_failure']);
  assert.equal(done[2].command, 'ancestry.person get');
  assert.equal(done[2].error.code, 'INVALID_ARGUMENT');
  assert.ok(done[2].error.stack.length); assert.equal(done[2].exitCode, 2);
  for (const record of done) {
    assert.ok(record.durationMs >= 0); assert.match(record.version, /^\d+\.\d+\.\d+$/);
    assert.equal(record.runtime.node, process.version); assert.equal(record.settled, true);
    assert.equal(rows.find(r => r.id === record.id && r.event === 'start').startedAt, record.startedAt);
  }
  assert.doesNotMatch(JSON.stringify(rows), /private-tree|private-person/);
  if (process.platform !== 'win32') {
    const path = join(directory, 'history');
    assert.equal((await stat(path)).mode & 0o777, 0o700);
    assert.equal((await stat(join(path, (await readdir(path))[0]))).mode & 0o777, 0o600);
  }
});

test('JSON errors retain exit code 1 and history omits credential stdin and saved payloads', async () => {
  const directory = await profile();
  const child = spawn(process.execPath, [...loader, cli, 'ancestry.credential', 'set', '--stdin', '--json'], {
    env: {...process.env, FAM_CONFIG_DIR: directory}, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const done = once(child, 'close');
  child.stdin.end('malformed-private-credential');
  let stderr = ''; child.stderr.on('data', chunk => stderr += chunk);
  assert.equal((await done)[0], 1);
  assert.equal(JSON.parse(stderr).ok, false);
  const history = await records(directory);
  assert.equal(history[1].outcome, 'hard_failure');
  assert.match(history[1].error.message, /Credential input/);
  assert.doesNotMatch(JSON.stringify(history), /malformed-private-credential/);
});

test('a failed credential sync is searchable as a soft failure while the command still succeeds', async () => {
  const directory = await profile();
  const child = spawn(process.execPath, [...loader, cli, 'ancestry.credential', 'set', '--stdin', '--json'], {
    env: {...process.env, FAM_CONFIG_DIR: directory, FAM_CREDENTIALS_SYNC_COMMAND: '["fam-test-missing-helper"]'},
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const done = once(child, 'close');
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  child.stdin.end(JSON.stringify({username: 'history-user@example.test', password: 'history-private-password'}));
  assert.equal((await done)[0], 0); assert.equal(JSON.parse(stdout).ok, true);
  assert.match(stderr, /sync hook failed/);
  const rows = await records(directory), result = rows[1];
  assert.equal(result.outcome, 'soft_failure'); assert.equal(result.exitCode, 0);
  assert.equal(result.diagnostics[0].code, 'CREDENTIAL_SYNC_FAILED');
  assert.doesNotMatch(JSON.stringify(rows), /history-user|history-private-password|fam-test-missing-helper/);
});

test('embedded provider errors survive --out receipts without capturing the response body', async () => {
  const directory = await profile();
  const provider = new URL('../src/cyndislist/client.ts', import.meta.url).href;
  const script = `const {CyndisListClient} = await import(${JSON.stringify(provider)});
    CyndisListClient.prototype.categories = async () => ({resources: [{title: 'private research body'}], warnings: ['fixture warning']});
    process.argv = ['node', ${JSON.stringify(cli)}, 'cyndislist.category', 'list', '--out', 'result.json', '--json'];
    await import(${JSON.stringify(cli)});`;
  const result = await run(process.execPath, [...loader, '--input-type=module', '-e', script], {
    cwd: directory, env: {...process.env, FAM_CONFIG_DIR: directory}, timeout: 15_000,
  });
  assert.equal(JSON.parse(result.stdout).data.saved, 'result.json');
  const rows = await records(directory);
  assert.equal(rows[1].outcome, 'soft_failure');
  assert.equal(rows[1].diagnostics[0].error.message, 'fixture warning');
  assert.doesNotMatch(JSON.stringify(rows), /private research body/);
});

test('concurrent processes append complete records without losing invocations', async () => {
  const directory = await profile();
  await Promise.all(Array.from({length: 8}, () => invoke(directory, ['cli.version', 'get', '--json'])));
  const rows = await records(directory);
  assert.equal(rows.length, 16); assert.equal(new Set(rows.map(r => r.id)).size, 8);
  for (const id of new Set(rows.map(r => r.id))) assert.deepEqual(rows.filter(r => r.id === id).map(r => r.event), ['start', 'finish']);
});

test('disabled or unavailable history preserves stdout and exit status', async () => {
  const directory = await profile();
  const disabled = await invoke(directory, ['cli.version', 'get', '--json'], {FAM_HISTORY: '0'});
  assert.equal(JSON.parse(disabled.stdout).ok, true); assert.equal(disabled.stderr, '');
  assert.deepEqual(await readdir(directory), []);
  await writeFile(join(directory, 'history'), 'block history directory');
  const failed = await invoke(directory, ['cli.version', 'get', '--json']);
  assert.equal(failed.stdout, disabled.stdout);
  assert.equal(failed.stderr.split('could not write command history').length - 1, 1);
  await assert.rejects(invoke(directory, ['ancestry.person', 'get']), (error: any) => {assert.equal(error.code, 2); return true;});
});

test('terminated commands leave a start record instead of a false success', async () => {
  const directory = await profile();
  const child = spawn(process.execPath, [...loader, cli, 'ancestry.credential', 'set', '--stdin'], {
    env: {...process.env, FAM_CONFIG_DIR: directory}, stdio: ['pipe', 'ignore', 'ignore'],
  });
  const done = once(child, 'close');
  try {
    let started = false;
    for (let i = 0; i < 300; i++) {
      try {started = (await records(directory)).some(r => r.event === 'start');} catch {}
      if (started) break;
      await delay(10);
    }
    assert.equal(started, true);
  } finally {child.kill('SIGKILL'); await done;}
  assert.deepEqual((await records(directory)).map(r => r.event), ['start']);
});

test('explicit failure markers include nested GraphQL errors and warnings; empty results and pagination are normal', () => {
  const found: any[] = [];
  inspectResult({items: [], complete: false, next: 'cursor', available: false, authenticated: false, errors: [], warnings: []}, value => found.push(value));
  assert.deepEqual(found, []);
  inspectResult({data: {operation: {ok: false}}, errors: [{message: 'GraphQL field failed', extensions: {code: 'INTERNAL'}}],
    children: [{warnings: ['stale cache']}], status: 'partial'}, value => found.push(value));
  assert.deepEqual(found.map(v => v.code), ['RESULT_FAILURE', 'RESULT_ERROR', 'RESULT_WARNING', 'RESULT_FAILURE']);
});

test('authentication recovery emits one diagnostic without changing retry behavior', async () => {
  const diagnostics: any[] = []; let attempts = 0;
  setDiagnosticSink(value => diagnostics.push(value));
  try {
    assert.equal(await withSessionRefresh(async () => {if (++attempts === 1) throw {status: 401}; return 'recovered';}, async () => {}), 'recovered');
    assert.equal(attempts, 2); assert.equal(diagnostics[0].code, 'AUTH_RETRY');
    await withSessionRefresh(async () => 'proactively renewed', async () => {}, true);
    assert.equal(diagnostics.length, 1);
  } finally {setDiagnosticSink(undefined);}
});

test('redaction covers split/inline values, URL credentials, bearer tokens, cookies, nested causes and multiline messages', () => {
  const args = ['ancestry.session', 'login', '--code', '123456', '--input={"password":"inline-secret"}', '--unknown=private-value'];
  assert.deepEqual(historyArguments(args), ['ancestry.session', 'login', '--code', '[REDACTED]', '--input=[REDACTED]', '--unknown=[REDACTED]']);
  const redact = historyRedactor(args, {ANCESTRY_PASSWORD: 'env-secret'});
  const result = errorSummary(Object.assign(new Error('123456 env-secret password="quoted secret" https://user:pass@example.test/personal?token=secret\nAuthorization: Bearer bearer-secret\nCookie: sid=cookie-secret'), {
    cause: new Error('access_token=nested-secret'), code: 'HTTP_ERROR', status: 401, body: 'private body', result: {password: 'private result'},
  }), redact);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /123456|env-secret|quoted secret|user:pass|personal|bearer-secret|cookie-secret|nested-secret|private body|private result/);
  assert.equal(result.code, 'HTTP_ERROR'); assert.equal(result.status, 401);
  assert.match(text, /REDACTED/);
  assert.doesNotMatch(redact('{"authorization":"custom-private-auth","access_token":"quoted-token"}'), /custom-private-auth|quoted-token/);
  assert.equal(errorSummary({message: 'field failed', extensions: {code: 'INTERNAL', private: 'hidden'}}, redact).code, 'INTERNAL');
});

test('append refuses symlink targets and restores private permissions', async () => {
  if (process.platform === 'win32') return;
  const directory = join(CREDENTIAL_DIR, 'append-test'); await mkdir(directory);
  const target = join(directory, 'target'); await writeFile(target, 'unchanged');
  await symlink(target, join(directory, 'linked.jsonl'));
  assert.throws(() => appendPrivateJsonl('append-test/linked.jsonl', {secret: 'no'}));
  assert.equal(await readFile(target, 'utf8'), 'unchanged');
  appendPrivateJsonl('append-test/real.jsonl', {event: 1});
  await chmod(join(directory, 'real.jsonl'), 0o644);
  appendPrivateJsonl('append-test/real.jsonl', {event: 2});
  assert.equal((await stat(join(directory, 'real.jsonl'))).mode & 0o777, 0o600);
});
