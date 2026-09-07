import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CREDENTIAL_DIR } from '../src/shared/storage.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR,
  env: { ...process.env, FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]' },
});

test('fam routes help, status and offline catalogs outside the checkout without credential lookup', async () => {
  for (const args of [[], ['--help'], ['-h'], ['help']]) assert.match((await invoke(...args)).stdout, /Usage: fam PROVIDER/);
  assert.match((await invoke('--version')).stdout, /^\d+\.\d+\.\d+\n$/);
  for (const service of ['familysearch', 'ancestry', 'myheritage', 'findmypast', 'findagrave', 'geneanet', 'storied']) {
    for (const args of [[service, '--help'], [service, '-h'], ['help', service]]) {
      assert.match((await invoke(...args)).stdout, new RegExp(`fam ${service}`));
    }
    const status = JSON.parse((await invoke(service, 'status')).stdout);
    assert.equal(status.credentialDirectory, CREDENTIAL_DIR);
    assert.ok(JSON.parse((await invoke(service, 'ops')).stdout).length > 0);
  }
  for (const args of [['missing'], ['toString'], ['help', 'missing'], ['ancestry', 'missing'], ['--version', 'extra']]) {
    await assert.rejects(invoke(...args), error => (error as { code: number }).code === 1);
  }
});
