import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile, symlink, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {writeOutputFile, writeOutputFiles, writePrivateJson, readPrivateJson} from '../src/shared/storage.js';
import {commands, providerNames} from '../src/shared/command-registry.js';
import {parseInvocation} from '../src/shared/command-runtime.js';

test('provider JSON writers refuse existing destinations independently of root preflight', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-provider-output-'));
  try {
    for (const provider of ['ancestry', 'findagrave', 'findmypast', 'myheritage', 'newspaperarchive', 'newspapers', 'storied', 'fold3', 'geneanet', 'americanancestors']) {
      const path = join(directory, `${provider}.json`);
      await writeFile(path, 'sentinel');
      const invocation = parseInvocation([`${provider}.session`, 'get', '--out', path]);
      const {runProvider} = await import(`../src/${provider}/cli.js`);
      await assert.rejects(runProvider(invocation.args), {code: 'EEXIST'}, provider);
      assert.equal(await readFile(path, 'utf8'), 'sentinel', provider);
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', fileURLToPath(new URL('./fixtures/no-network.mjs', import.meta.url)), cli, ...args,
  '--json', '--errors', 'stdout', '--reasoning', 'synthetic output safety test'], {
  timeout: 20000, maxBuffer: 1024 * 1024, env: {...process.env, FAM_HISTORY: '0'},
});

test('shared output files refuse existing files and dangling symlinks without changing bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-'));
  try {
    const path = join(directory, 'result.json');
    await writeOutputFile(path, 'sentinel');
    await assert.rejects(writeOutputFile(path, 'replacement'), {code: 'EEXIST'});
    assert.equal(await readFile(path, 'utf8'), 'sentinel');
    if (process.platform !== 'win32') {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      const link = join(directory, 'dangling');
      await symlink(join(directory, 'absent'), link);
      await assert.rejects(writeOutputFile(link, 'replacement'), {code: 'EEXIST'});
    }
    assert.ok((await readdir(directory)).every(name => !name.endsWith('.tmp')));
    await writePrivateJson('output-safety/credential.json', {token: 'synthetic-old'});
    await writePrivateJson('output-safety/credential.json', {token: 'synthetic-new'});
    assert.deepEqual(await readPrivateJson('output-safety/credential.json'), {token: 'synthetic-new'});
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('concurrent output creation has one winner and leaves no partial temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-race-'));
  try {
    const path = join(directory, 'result');
    const results = await Promise.allSettled(['first', 'second'].map(text => writeOutputFile(path, text)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'EEXIST');
    assert.ok(['first', 'second'].includes(await readFile(path, 'utf8')));
    assert.deepEqual(await readdir(directory), ['result']);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('output pairs publish complete bytes and preserve either existing destination', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-pair-'));
  try {
    const path = join(directory, 'scan.jpg'), sidecar = `${path}.json`;
    const files = [{path, data: Uint8Array.of(1, 2, 3)}, {path: sidecar, data: 'synthetic provenance'}];
    await writeFile(sidecar, 'sentinel provenance');
    await assert.rejects(writeOutputFiles(files), {code: 'EEXIST'});
    await assert.rejects(stat(path), {code: 'ENOENT'});
    assert.equal(await readFile(sidecar, 'utf8'), 'sentinel provenance');
    await rm(sidecar);
    await writeFile(path, 'sentinel image');
    await assert.rejects(writeOutputFiles(files), {code: 'EEXIST'});
    assert.equal(await readFile(path, 'utf8'), 'sentinel image');
    await assert.rejects(stat(sidecar), {code: 'ENOENT'});
    await rm(path);
    await writeOutputFiles(files);
    assert.deepEqual(await readFile(path), Buffer.from([1, 2, 3]));
    assert.equal(await readFile(sidecar, 'utf8'), 'synthetic provenance');
    assert.deepEqual((await readdir(directory)).sort(), ['scan.jpg', 'scan.jpg.json']);
    if (process.platform !== 'win32') assert.equal((await stat(sidecar)).mode & 0o777, 0o600);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('pair publication conflict rolls back only files created by that call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-rollback-'));
  try {
    const path = join(directory, 'result');
    // Two publishers in the same transaction target one name: preflight passes,
    // but the second exclusive link collides after the first is published.
    await assert.rejects(writeOutputFiles([{path, data: 'first'}, {path, data: 'second'}]), {code: 'EEXIST'});
    assert.deepEqual(await readdir(directory), []);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('every provider refuses an existing --out path before opening sessions or making requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-cli-'));
  try {
    const path = join(directory, 'sentinel.json');
    await writeFile(path, 'sentinel');
    await Promise.all(['cli', ...providerNames].map(async provider => {
      const command = commands.find(command => command.provider === provider && command.action !== 'download' && command.action !== 'export'
        && command.flags.some(flag => flag.name === 'out'));
      assert.ok(command, provider);
      const [namespace, action] = command.id.split(' ');
      const required = command.flags.filter(flag => flag.required && flag.name !== 'out').flatMap(flag => [`--${flag.name}`, flag.choices?.[0] ?? (flag.type === 'integer' || flag.type === 'number' ? String(flag.minimum ?? 1) : 'synthetic')]);
      const result = await invoke(namespace, action, ...required, '--out', path).catch(error => error);
      assert.equal(result.code, 1, `${provider}: ${result.stdout || result.stderr}`);
      assert.equal(JSON.parse(result.stdout).error.code, 'EEXIST', provider);
    }));
    assert.equal(await readFile(path, 'utf8'), 'sentinel');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('NARA download checks its .provenance.json destination before rendering the Catalog', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-nara-'));
  try {
    const path = join(directory, 'map.jpg');
    await writeFile(`${path}.provenance.json`, 'sentinel provenance');
    const result = await invoke('nara.object', 'download', '--naid', '123', '--out', path).catch(error => error);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).error.code, 'EEXIST');
    assert.equal(await readFile(`${path}.provenance.json`, 'utf8'), 'sentinel provenance');
    await assert.rejects(stat(path), {code: 'ENOENT'});
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('image downloads refuse an existing provenance sidecar before provider access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-output-sidecar-'));
  try {
    const path = join(directory, 'image.jpg');
    await writeFile(`${path}.json`, 'sentinel provenance');
    const cases = [
      ['findmypast.image', 'download', '--record-id', 'synthetic'],
      ['findagrave.photo', 'download', '--memorial-id', '123', '--photo-id', '456'],
      ['myheritage.document', 'download', '--url', 'https://www.myheritage.com/research/record-1-123/synthetic'],
    ];
    for (const args of cases) {
      const result = await invoke(...args, '--out', path).catch(error => error);
      assert.equal(result.code, 1, result.stdout || result.stderr);
      assert.equal(JSON.parse(result.stdout).error.code, 'EEXIST', args.join(' '));
      assert.equal(await readFile(`${path}.json`, 'utf8'), 'sentinel provenance');
      await assert.rejects(stat(path), {code: 'ENOENT'});
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});
