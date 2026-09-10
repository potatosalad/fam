import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { parseInvocation } from '../src/shared/command-runtime.js';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialDirectory, CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../src/shared/storage.js';
import { configureCredentials, loadLoginCredentials, type Service } from '../src/shared/credentials.js';

const services: Service[] = ['familysearch', 'ancestry', 'myheritage', 'findmypast', 'findagrave', 'geneanet'];
const loginFile = (service: Service) => service === 'familysearch' ? 'login.json' : `${service}/login.json`;

test('storage is independent of the working directory and honors explicit profiles', () => {
  const home = join(CREDENTIAL_DIR, 'home'), xdg = join(home, 'xdg');
  assert.equal(credentialDirectory({}, 'linux', home), join(home, '.config', 'fam'));
  assert.equal(credentialDirectory({}, 'darwin', home), join(home, '.config', 'fam'));
  assert.equal(credentialDirectory({ XDG_CONFIG_HOME: xdg }, 'linux', home), join(xdg, 'fam'));
  assert.equal(credentialDirectory({ XDG_CONFIG_HOME: 'relative' }, 'linux', home), join(home, '.config', 'fam'));
  assert.equal(credentialDirectory({ APPDATA: xdg }, 'win32', home), join(xdg, 'fam'));
  assert.equal(credentialDirectory({ FAM_CONFIG_DIR: xdg }, 'linux', home), xdg);
  assert.equal(credentialDirectory({ FAMILYSEARCH_CONFIG_DIR: xdg }, 'linux', home), xdg);
  assert.equal(credentialDirectory({ FAM_CONFIG_DIR: home, FAMILYSEARCH_CONFIG_DIR: xdg }, 'linux', home), home);
  for (const value of ['', 'relative']) assert.throws(() => credentialDirectory({ FAM_CONFIG_DIR: value }), /absolute path/);
});

test('credential helpers override saved login, pass literal arguments and refresh explicit setup', async () => {
  const password = ' private ünicode password\n';
  try {
    await writePrivateJson('login.json', { username: 'old', password: 'old' });
    await writePrivateJson('config.json', { credentialsCommand: [process.execPath, '-e',
      'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))', '--', 'file-helper', password] });
    assert.deepEqual(await loadLoginCredentials('familysearch'), { username: 'file-helper', password });
    // Changing the configured helper must take effect without caching or shell evaluation.
    process.env.FAM_CREDENTIALS_COMMAND = JSON.stringify([process.execPath, '-e',
      'process.stdout.write(JSON.stringify({username:process.argv[2],password:process.argv[1]}))', '--', 'a b; $(literal)']);
    assert.deepEqual(await loadLoginCredentials('familysearch'), { username: 'familysearch', password: 'a b; $(literal)' });
    assert.deepEqual(await readPrivateJson('login.json'), { username: 'old', password: 'old' });
    await configureCredentials('findmypast');
    assert.deepEqual(await readPrivateJson(loginFile('findmypast')), { username: 'findmypast', password: 'a b; $(literal)' });
    process.env.FAMILYSEARCH_USERNAME = 'env'; process.env.FAMILYSEARCH_PASSWORD = 'password';
    process.env.FAM_CREDENTIALS_COMMAND = '["missing-command"]';
    assert.deepEqual(await loadLoginCredentials('familysearch'), { username: 'env', password: 'password' });
    delete process.env.FAMILYSEARCH_PASSWORD;
    await assert.rejects(loadLoginCredentials('familysearch'), /Set both/);
  } finally {
    delete process.env.FAM_CREDENTIALS_COMMAND;
    delete process.env.FAMILYSEARCH_USERNAME; delete process.env.FAMILYSEARCH_PASSWORD;
    for (const path of ['config.json', 'login.json', loginFile('findmypast')]) await rm(join(CREDENTIAL_DIR, path), { force: true });
  }
});

test('helper failures suppress secrets and never fall back to cached credentials', async () => {
  const secret = 'fixture-secret-must-not-appear';
  try {
    await writePrivateJson('login.json', { username: 'old', password: 'old' });
    for (const code of [
      `process.stdout.write('${secret}'); process.stderr.write('${secret}'); process.exit(1)`,
      `process.stdout.write('${secret}')`,
      `process.stdout.write(JSON.stringify({username:'${secret}',password:42}))`,
      `process.stdout.write('x'.repeat(65537))`,
    ]) {
      process.env.FAM_CREDENTIALS_COMMAND = JSON.stringify([process.execPath, '-e', code]);
      await assert.rejects(loadLoginCredentials('familysearch'), error => {
        assert.match(String(error), /Credential command failed/);
        assert.ok(!String(error).includes(secret));
        return true;
      });
    }
    for (const value of ['secret-not-json', '[]', '[42]', '[""]', '["node",42]', '["node\\u0000"]', '{}']) {
      process.env.FAM_CREDENTIALS_COMMAND = value;
      await assert.rejects(loadLoginCredentials('familysearch'), /JSON array/);
    }
    assert.deepEqual(await readPrivateJson('login.json'), { username: 'old', password: 'old' });
  } finally {
    delete process.env.FAM_CREDENTIALS_COMMAND;
    await rm(join(CREDENTIAL_DIR, 'login.json'), { force: true });
  }
});

test('private storage rejects paths outside its root and secures nested service directories', async () => {
  for (const path of ['../escape.json', '', CREDENTIAL_DIR]) {
    await assert.rejects(writePrivateJson(path, {}), /within/);
    await assert.rejects(readPrivateJson(path), /within/);
  }
  await writePrivateJson('nested/service/login.json', { password: 'fixture' });
  if (process.platform !== 'win32') {
    for (const path of ['', 'nested', 'nested/service']) assert.equal((await stat(join(CREDENTIAL_DIR, path))).mode & 0o777, 0o700);
    assert.equal((await stat(join(CREDENTIAL_DIR, 'nested/service/login.json'))).mode & 0o777, 0o600);
  }
});

test('each provider handler uses its own environment and private credential file', async t => {
  const cwd = process.cwd();
  process.chdir(CREDENTIAL_DIR);
  t.after(() => process.chdir(cwd));
  for (const service of services) {
    const prefix = service.toUpperCase(), username = `${prefix}_USERNAME`, password = `${prefix}_PASSWORD`;
    try {
      await assert.rejects(loadLoginCredentials(service), new RegExp(`${service} credentials`));
      await writePrivateJson(loginFile(service), { username: 'saved user', password: ' saved password\n' });
      assert.deepEqual(await loadLoginCredentials(service), { username: 'saved user', password: ' saved password\n' });
      process.env[username] = 'environment user';
      await assert.rejects(loadLoginCredentials(service), /Set both/);
      process.env[password] = ' environment password ';
      assert.deepEqual(await loadLoginCredentials(service), { username: 'environment user', password: ' environment password ' });
      assert.equal((await readPrivateJson<{username: string}>(loginFile(service)))?.username, 'saved user');
      const {runProvider} = await import(`../src/${service}/cli.js`);
      const result = await runProvider(parseInvocation([`${service}.credential`, 'set']).args);
      assert.equal(result.credentialDirectory, CREDENTIAL_DIR);
      assert.doesNotMatch(JSON.stringify(result), /environment user|environment password/);
      assert.deepEqual(await readPrivateJson(loginFile(service)), { username: 'environment user', password: ' environment password ' });
      assert.throws(() => parseInvocation([`${service}.session`, 'get', '--stdin']), /Unknown option/);
      process.env[password] = '';
      await assert.rejects(loadLoginCredentials(service), /Set both/);
      delete process.env[username]; delete process.env[password];
      await writePrivateJson(loginFile(service), { username: 'bad', password: 42 });
      await assert.rejects(loadLoginCredentials(service), /nonempty username and password/);
    } finally {
      delete process.env[username]; delete process.env[password];
      await rm(join(CREDENTIAL_DIR, loginFile(service)), { force: true });
    }
  }
});

test('shared credential input rejects malformed, oversized and nonterminal input without replacing credentials', async t => {
  const saved = { username: 'fixture-user', password: 'saved-password' };
  await writePrivateJson('login.json', saved);
  let input = Readable.from([]);
  t.mock.getter(process, 'stdin', () => input);
  t.after(() => rm(join(CREDENTIAL_DIR, 'login.json'), { force: true }));
  for (const [source, error] of [
    ['secret-not-json', /Credential input/], ['{"password":"secret"}', /nonempty username and password/],
    ['x'.repeat(65_537), /exceeded 64 KiB/],
  ] as const) {
    input = Readable.from([Buffer.from(source)]);
    await assert.rejects(configureCredentials('familysearch', { stdin: true }), failure => {
      assert.match(String(failure), error); assert.doesNotMatch(String(failure), /secret/); return true;
    });
    assert.deepEqual(await readPrivateJson('login.json'), saved);
  }
  await assert.rejects(configureCredentials('familysearch'), /needs a terminal/);
  assert.deepEqual(await readPrivateJson('login.json'), saved);
});

test('CLI credential stdin works outside the checkout without echoing secrets', async t => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'credential-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, 'profile');
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const input = { username: 'fixture-user', password: ' private ünicode password\n' };
  const result = await new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), cli, 'familysearch.credential', 'set', '--stdin', '--json'], {
      cwd: directory, timeout: 15_000, env: { ...process.env, FAM_CONFIG_DIR: config, FAM_HISTORY: '0',
        FAMILYSEARCH_PASSWORD: 'ignored partial environment' }, stdio: 'pipe',
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => stdout += text); child.stderr.on('data', text => stderr += text);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error); });
    child.stdin.end(JSON.stringify(input));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.credentialDirectory, config);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-user|private ünicode password/);
  assert.deepEqual(JSON.parse(await readFile(join(config, 'login.json'), 'utf8')), input);
  if (process.platform !== 'win32') assert.equal((await stat(join(config, 'login.json'))).mode & 0o777, 0o600);
});
