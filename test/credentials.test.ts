import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { credentialDirectory, CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../src/shared/storage.js';
import { configureCredentials, loadLoginCredentials, type Service } from '../src/shared/credentials.js';

const services: Service[] = ['familysearch', 'ancestry', 'myheritage', 'findmypast', 'findagrave'];
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

test('explicit credential helpers receive each provider and override saved credentials without caching', async () => {
  const script = 'process.stdout.write(JSON.stringify({username:process.argv[1],password:process.argv[2]}))';
  const password = ' private ünicode password\n';
  try {
    await writePrivateJson('config.json', { credentialsCommand: [process.execPath, '-e', script, '--', 'file-helper', password] });
    for (const service of services) {
      await writePrivateJson(loginFile(service), { username: 'old', password: 'old' });
      assert.deepEqual(await loadLoginCredentials(service), { username: 'file-helper', password });
      // Arguments are passed literally; the final argument identifies the provider.
      process.env.FAM_CREDENTIALS_COMMAND = JSON.stringify([process.execPath, '-e',
        'process.stdout.write(JSON.stringify({username:process.argv[2],password:process.argv[1]}))', '--', 'a b; $(literal)']);
      assert.deepEqual(await loadLoginCredentials(service), { username: service, password: 'a b; $(literal)' });
      assert.deepEqual(await readPrivateJson(loginFile(service)), { username: 'old', password: 'old' });
      await configureCredentials(service);
      assert.deepEqual(await readPrivateJson(loginFile(service)), { username: service, password: 'a b; $(literal)' });
      process.env[`${service.toUpperCase()}_USERNAME`] = 'env';
      process.env[`${service.toUpperCase()}_PASSWORD`] = 'password';
      process.env.FAM_CREDENTIALS_COMMAND = '["missing-command"]';
      assert.deepEqual(await loadLoginCredentials(service), { username: 'env', password: 'password' });
      delete process.env[`${service.toUpperCase()}_PASSWORD`];
      await assert.rejects(loadLoginCredentials(service), /Set both/);
      delete process.env[`${service.toUpperCase()}_USERNAME`];
      delete process.env.FAM_CREDENTIALS_COMMAND;
    }
  } finally {
    delete process.env.FAM_CREDENTIALS_COMMAND;
    await rm(join(CREDENTIAL_DIR, 'config.json'), { force: true });
    for (const service of services) {
      delete process.env[`${service.toUpperCase()}_USERNAME`];
      delete process.env[`${service.toUpperCase()}_PASSWORD`];
      await rm(join(CREDENTIAL_DIR, loginFile(service)), { force: true });
    }
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

for (const service of services) {
  test(`${service}: environment overrides saved login; missing or invalid credentials fail locally`, async () => {
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
      process.env[password] = '';
      await assert.rejects(loadLoginCredentials(service), /Set both/);
      delete process.env[username]; delete process.env[password];
      await writePrivateJson(loginFile(service), { username: 'bad', password: 42 });
      await assert.rejects(loadLoginCredentials(service), /nonempty username and password/);
    } finally {
      delete process.env[username]; delete process.env[password];
      await rm(join(CREDENTIAL_DIR, loginFile(service)), { force: true });
    }
  });

  test(`${service}: CLI credential setup works outside checkout without echoing secrets`, async () => {
    const directory = await mkdtemp(join(CREDENTIAL_DIR, `${service}-cli-`));
    const config = join(directory, 'profile');
    const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const run = (args: string[], input = '', env: NodeJS.ProcessEnv = {}) => new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), cli, service, ...args], {
        cwd: directory, env: { ...process.env, FAM_CONFIG_DIR: config, ...env }, stdio: 'pipe',
      });
      let stdout = '', stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', text => stdout += text); child.stderr.on('data', text => stderr += text);
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
      child.stdin.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error); });
      child.stdin.end(input);
    });
    const input = { username: 'fixture-user', password: ' private ünicode password\n' };
    const result = await run(['credentials', '--stdin'], JSON.stringify(input), { [`${service.toUpperCase()}_PASSWORD`]: 'ignored partial environment' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).credentialDirectory, config);
    assert.ok(!result.stdout.includes(input.username) && !result.stderr.includes('private'));
    assert.deepEqual(JSON.parse(await readFile(join(config, loginFile(service)), 'utf8')), input);
    const status = await run(['status']);
    assert.equal(status.code, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).credentialDirectory, config);
    for (const malformed of ['secret-not-json', '{"password":"secret"}', 'x'.repeat(65_537)]) {
      const rejected = await run(['credentials', '--stdin'], malformed);
      assert.equal(rejected.code, 1);
      assert.ok(!rejected.stderr.includes('secret'));
      assert.deepEqual(JSON.parse(await readFile(join(config, loginFile(service)), 'utf8')), input);
    }
    const noTerminal = await run(['credentials'], '', { PATH: '' });
    assert.equal(noTerminal.code, 1);
    assert.match(noTerminal.stderr, /needs a terminal/);
    const wrongFlag = await run(['status', '--stdin']);
    assert.equal(wrongFlag.code, 1);
    assert.match(wrongFlag.stderr, /belongs to/);
    const envResult = await run(['credentials'], '', {
      [`${service.toUpperCase()}_USERNAME`]: 'env user', [`${service.toUpperCase()}_PASSWORD`]: 'env pass',
    });
    assert.equal(envResult.code, 0, envResult.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(config, loginFile(service)), 'utf8')), { username: 'env user', password: 'env pass' });
  });
}
