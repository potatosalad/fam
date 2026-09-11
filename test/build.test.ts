import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {hostname, tmpdir} from 'node:os';
// @ts-expect-error Build tooling is executable JavaScript.
import {publishBuild} from '../scripts/build.mjs';
// @ts-expect-error Launcher tooling is executable JavaScript.
import {cleanupBuilds, markBuilding, withProcessLock} from '../bin/build-state.mjs';

const run = promisify(execFile);

async function waitForReady(child: ReturnType<typeof spawn>) {
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => reject(new Error('Fixture exited before ready')));
    child.stdout!.once('data', () => resolve());
  });
}

async function stop(child: ReturnType<typeof spawn>) {
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGKILL'); await exited;
}

test('build publication pins lazy imports, retains a working CLI, and packages only current output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'bin'));
  await copyFile(new URL('../bin/fam.mjs', import.meta.url), join(root, 'bin/fam.mjs'));
  await copyFile(new URL('../bin/build-state.mjs', import.meta.url), join(root, 'bin/build-state.mjs'));
  await copyFile(new URL('../bin/update-state.mjs', import.meta.url), join(root, 'bin/update-state.mjs'));
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
  assert.ok((await readdir(root)).includes(first.split('/').at(-1)!));
  child.stdin.end('continue');
  assert.equal(await finished, 0, errors);
  assert.match(output, /first build/);
  const third = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(third, 'cli.js'), "console.log('third build');");
  const cleanup = await publishBuild(root, third);
  assert.ok(cleanup.removed.includes(first.split('/').at(-1)!));
  assert.ok(cleanup.removed.includes(second.split('/').at(-1)!));
  assert.equal((await run(process.execPath, [join(root, 'bin/fam.mjs')], {cwd: tmpdir()})).stdout.trim(), 'third build');
  assert.equal(await readFile(join(root, 'dist/late.js'), 'utf8'), "export const value = 'first build';");
  const packed = JSON.parse((await run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: root})).stdout);
  const pack = Array.isArray(packed) ? packed[0] : packed['fam-build-fixture'];
  assert.ok(pack.files.some((file: {path: string}) => file.path === 'dist/cli.js'));
  assert.ok(!pack.files.some((file: {path: string}) => file.path.includes('late.js') || file.path.includes('.fam-build')));
  assert.ok(!pack.files.some((file: {path: string}) => file.path.includes('.fam-lease') || file.path.includes('.fam-published')));
  // A packaged install has no development pointer and uses the same executable.
  await rm(join(root, '.fam-build.json'));
  assert.equal((await run(process.execPath, [join(root, 'bin/fam.mjs')], {cwd: tmpdir()})).stdout.trim(), 'third build');
});

test('multiple readers and killed processes keep builds until the last reader exits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-readers-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'bin'));
  for (const file of ['fam.mjs', 'build-state.mjs', 'update-state.mjs']) await copyFile(new URL(`../bin/${file}`, import.meta.url), join(root, 'bin', file));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const first = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(first, 'cli.js'), "console.log('ready'); setInterval(() => {}, 1000);");
  await publishBuild(root, first);
  const children = [0, 1].map(() => spawn(process.execPath, [join(root, 'bin/fam.mjs')], {stdio: ['ignore', 'pipe', 'pipe']}));
  t.after(() => children.forEach(child => child.kill()));
  await Promise.all(children.map(waitForReady));
  const second = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(second, 'cli.js'), "console.log('current');");
  await publishBuild(root, second);
  await stop(children[0]);
  assert.ok(!(await cleanupBuilds(root)).removed.includes(first.split('/').at(-1)));
  await stop(children[1]);
  assert.ok((await cleanupBuilds(root)).removed.includes(first.split('/').at(-1)));
  assert.ok((await readdir(root)).includes(second.split('/').at(-1)!));
});

test('cleanup retains uncertain ownership, active compilers and symlinks; reclaims legacy and interrupted builds', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-cleanup-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const legacy = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(legacy, 'cli.js'), 'legacy');
  await writeFile(join(legacy, 'build-info.json'), '{}');
  const uncertain = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(uncertain, '.fam-published.json'), '{}');
  await writeFile(join(uncertain, '.fam-lease-invalid.json'), '{');
  const foreign = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(foreign, '.fam-published.json'), '{}');
  await writeFile(join(foreign, '.fam-lease-foreign.json'), JSON.stringify({pid: process.pid, host: 'another-host.invalid'}));
  const building = await mkdtemp(join(root, '.fam-build-'));
  await markBuilding(building);
  const aborted = await mkdtemp(join(root, '.fam-build-'));
  const child = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"]);
  t.after(() => child.kill()); await waitForReady(child);
  await writeFile(join(aborted, '.fam-building.json'), JSON.stringify({pid: child.pid, host: hostname()}));
  await stop(child);
  await symlink(legacy, join(root, '.fam-build-symlink'));
  const result = await cleanupBuilds(root);
  for (const directory of [legacy, aborted]) assert.ok(result.removed.includes(directory.split('/').at(-1)));
  for (const directory of [uncertain, foreign, building]) assert.ok(result.retained.includes(directory.split('/').at(-1)));
  assert.ok((await readdir(root)).includes('.fam-build-symlink'));
  // A stale operation lock can be reclaimed by concurrent callers safely.
  await mkdir(join(root, '.fam-update.lock'));
  await writeFile(join(root, '.fam-update.lock/owner.json'), JSON.stringify({pid: child.pid, host: hostname()}));
  let active = 0, maximum = 0;
  const work = async () => {maximum = Math.max(maximum, ++active); await new Promise(r => setTimeout(r, 30)); active--;};
  await Promise.all([withProcessLock(root, '.fam-update.lock', work), withProcessLock(root, '.fam-update.lock', work)]);
  assert.equal(maximum, 1);
});

test('legacy launchers without leases defer cleanup until they exit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-legacy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const legacy = await mkdtemp(join(root, '.fam-build-'));
  await writeFile(join(legacy, 'cli.js'), 'legacy');
  await writeFile(join(legacy, 'build-info.json'), '{}');
  const launcher = join(root, 'fam.mjs');
  await writeFile(launcher, "console.log('ready'); setInterval(() => {}, 1000);");
  const child = spawn(process.execPath, [launcher]);
  t.after(() => child.kill()); await waitForReady(child);
  assert.deepEqual((await cleanupBuilds(root)).removed, []);
  await stop(child);
  assert.ok((await cleanupBuilds(root)).removed.includes(legacy.split('/').at(-1)));
});

test('a failed compiler does not replace the previous build or leave partial snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-build-failed-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'bin'));
  await mkdir(join(root, 'node_modules/typescript/bin'), {recursive: true});
  await copyFile(new URL('../scripts/build.mjs', import.meta.url), join(root, 'scripts/build.mjs'));
  await copyFile(new URL('../bin/build-state.mjs', import.meta.url), join(root, 'bin/build-state.mjs'));
  await writeFile(join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(1);');
  await writeFile(join(root, '.fam-build.json'), '{"directory":".fam-build-previous"}\n');
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/cli.js'), 'previous build');
  await assert.rejects(run(process.execPath, [join(root, 'scripts/build.mjs')]));
  assert.equal(await readFile(join(root, 'dist/cli.js'), 'utf8'), 'previous build');
  assert.equal(await readFile(join(root, '.fam-build.json'), 'utf8'), '{"directory":".fam-build-previous"}\n');
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.fam-build-')), []);
});
