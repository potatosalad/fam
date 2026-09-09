import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// @ts-expect-error Build tooling is executable JavaScript.
import {publishBuild} from '../scripts/build.mjs';

const run = promisify(execFile);

test('build publication pins lazy imports, retains a working CLI, and packages only current output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'bin'));
  await copyFile(new URL('../bin/fam.mjs', import.meta.url), join(root, 'bin/fam.mjs'));
  await writeFile(join(root, 'package.json'), JSON.stringify({name: 'fam-build-fixture', version: '1.0.0', type: 'module', files: ['bin/', 'dist/']}));
  const first = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(first, 'cli.js'), "console.log('ready'); await new Promise(r => process.stdin.once('data', r)); console.log((await import('./late.js')).value); process.stdin.destroy();");
  await writeFile(join(first, 'late.js'), "export const value = 'first build';");
  await publishBuild(root, first);
  const child = spawn(process.execPath, [join(root, 'bin/fam.mjs')], {cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe']});
  t.after(() => {child.kill();});
  let output = '', errors = '';
  child.stderr.on('data', chunk => {errors += chunk;});
  const finished = new Promise<number | null>(resolve => child.on('exit', resolve));
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => {output += chunk; if (output.includes('ready')) resolve();});
    child.on('exit', () => reject(new Error(`CLI exited before ready: ${errors}`)));
  });
  const second = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(second, 'cli.js'), "console.log('second build');");
  await publishBuild(root, second);
  child.stdin.end('continue');
  assert.equal(await finished, 0, errors);
  assert.match(output, /first build/);
  assert.equal((await run(process.execPath, [join(root, 'bin/fam.mjs')], {cwd: tmpdir()})).stdout.trim(), 'second build');
  assert.equal(await readFile(join(root, 'dist/late.js'), 'utf8'), "export const value = 'first build';");
  const packed = JSON.parse((await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: root})).stdout);
  const pack = Array.isArray(packed) ? packed[0] : packed['fam-build-fixture'];
  assert.ok(pack.files.some((file: {path: string}) => file.path === 'dist/cli.js'));
  assert.ok(!pack.files.some((file: {path: string}) => file.path.includes('late.js') || file.path.includes('.fam-build')));
  // A packaged install has no development pointer and uses the same executable.
  await rm(join(root, '.fam-build.json'));
  assert.equal((await run(process.execPath, [join(root, 'bin/fam.mjs')], {cwd: tmpdir()})).stdout.trim(), 'second build');
});

test('a failed compiler does not replace the previous build or leave partial snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-failed-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'node_modules/typescript/bin'), {recursive: true});
  await copyFile(new URL('../scripts/build.mjs', import.meta.url), join(root, 'scripts/build.mjs'));
  await writeFile(join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(1);');
  await writeFile(join(root, '.fam-build.json'), '{"directory":".fam-build-previous"}\n');
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/cli.js'), 'previous build');
  await assert.rejects(run(process.execPath, [join(root, 'scripts/build.mjs')]));
  assert.equal(await readFile(join(root, 'dist/cli.js'), 'utf8'), 'previous build');
  assert.equal(await readFile(join(root, '.fam-build.json'), 'utf8'), '{"directory":".fam-build-previous"}\n');
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.fam-build-')), []);
});
