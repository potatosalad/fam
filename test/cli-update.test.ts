import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {promisify} from 'node:util';
import {autoUpdateCli, newerVersion, planUpdate, setAutoUpdate, updateCli, type Step} from '../src/shared/cli-update.js';
// @ts-expect-error Launcher tooling runs before TypeScript is built.
import {autoUpdateEnabled, installationBusy, readUpdateState, updateDue, updateInterval, withUpdateLock, writeUpdateState} from '../bin/update-state.mjs';

const execute = promisify(execFile);
const name = '@potatosalad/fam';
const pkg = {name, version: '1.0.0'};
async function temporary(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fam-update test-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}
async function packageAt(root: string) {
  await mkdir(root, {recursive: true});
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
}
async function repository(t: TestContext) {
  const parent = await temporary(t), upstream = join(parent, 'upstream'), root = join(parent, 'checkout');
  await packageAt(upstream);
  const git = (cwd: string, ...args: string[]) => execute('git', args, {cwd});
  await git(upstream, 'init', '-b', 'main');
  await git(upstream, 'config', 'user.name', 'Fixture');
  await git(upstream, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(upstream, '.gitignore'), '.fam-update.lock*\n.fam-update/\n');
  await git(upstream, 'add', '.');
  // Disposable synthetic histories need no user key or network.
  await git(upstream, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  await git(parent, 'clone', upstream, root);
  return {root, upstream, git};
}

test('Git updates select the installed checkout and fast-forward before reinstalling', async t => {
  const {root, upstream, git} = await repository(t);
  await writeFile(join(upstream, 'package.json'), JSON.stringify({...pkg, version: '1.1.0'}));
  await git(upstream, 'add', '.');
  await git(upstream, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Update fixture');
  const plan = await planUpdate(root);
  assert.equal(plan.method, 'git');
  assert.deepEqual(plan.steps.map(s => [s.command, ...s.args]), [
    ['git', 'pull', '--ff-only', '--no-rebase', '--no-autostash'], ['npm', 'ci', '--include=dev', '--ignore-scripts=false'],
  ]);
  const preview = await updateCli({root, dryRun: true, run: async () => {assert.fail('dry run executed');}});
  assert.equal(preview.dryRun, true);
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '1.0.0');
  let installs = 0;
  const result = await updateCli({root, run: async step => {
    assert.equal(step.cwd, root);
    if (step.command === 'git') await execute('git', step.args, {cwd: step.cwd});
    else {
      assert.equal(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, '1.1.0');
      installs++;
    }
  }});
  assert.equal(installs, 1); assert.equal(result.version, '1.1.0');
  assert.equal(result.previousVersion, '1.0.0');
});

test('dirty, detached, and untracked Git branches fail before any install', async t => {
  const {root, git} = await repository(t);
  await writeFile(join(root, 'private-untracked.txt'), 'fixture');
  await assert.rejects(planUpdate(root), /uncommitted/);
  await rm(join(root, 'private-untracked.txt'));
  await git(root, 'checkout', '--detach');
  await assert.rejects(planUpdate(root), /detached HEAD/);
  await git(root, 'checkout', 'main');
  await git(root, 'branch', '--unset-upstream');
  await assert.rejects(planUpdate(root), /no upstream/);
});

test('failed pulls stop installation and release the update lock', async t => {
  const {root} = await repository(t);
  const calls: string[] = [];
  await assert.rejects(updateCli({root, run: async step => {calls.push(step.command); throw new Error('pull failed');}}), /pull failed/);
  assert.deepEqual(calls, ['git']);
  await assert.rejects(readFile(join(root, '.fam-update.lock/owner.json')), {code: 'ENOENT'});
  await assert.rejects(updateCli({root, run: async step => {if (step.command === 'npm') throw new Error('install failed');}}), /install failed/);
});

test('npm updates preserve a custom global prefix or local dependency project', async t => {
  const parent = await temporary(t), prefix = join(parent, 'custom prefix');
  const globalRoot = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', name);
  await packageAt(globalRoot);
  const global = await planUpdate(globalRoot);
  assert.equal(global.method, 'npm');
  assert.deepEqual(global.steps[0], {command: 'npm', args: ['install', '--global', '--prefix', prefix, `${name}@latest`], cwd: prefix});
  const project = join(parent, 'project'), localRoot = join(project, 'node_modules', name);
  await packageAt(localRoot);
  await writeFile(join(project, 'package.json'), JSON.stringify({devDependencies: {[name]: '^1.0.0'}}));
  // An enclosing Git repo must not turn an npm dependency into a checkout update.
  await execute('git', ['init'], {cwd: project});
  const local = await planUpdate(localRoot);
  assert.deepEqual(local.steps[0], {command: 'npm', args: ['install', '--prefix', project, `${name}@latest`], cwd: project});
  const result = await updateCli({root: localRoot, run: async () => {
    // npm replaces the package, so the updater's lock must live outside it.
    await rm(localRoot, {recursive: true});
    await packageAt(localRoot);
    await writeFile(join(localRoot, 'package.json'), JSON.stringify({...pkg, version: '2.0.0'}));
  }});
  assert.equal(result.version, '2.0.0');
  await writeFile(join(project, 'package.json'), '{}');
  await assert.rejects(planUpdate(localRoot), /not a direct dependency/);
  await assert.rejects(planUpdate(project), /Cannot identify/);
});

test('concurrent updates serialize their install steps', async t => {
  const {root} = await repository(t);
  let active = 0, maximum = 0, installs = 0;
  const run = async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 25));
    active--; installs++;
  };
  await Promise.all([updateCli({root, run}), updateCli({root, run})]);
  assert.equal(maximum, 1); assert.equal(installs, 4);
});

function enableAutomatic(t: TestContext) {
  const previous = process.env.FAM_AUTO_UPDATE;
  delete process.env.FAM_AUTO_UPDATE;
  t.after(() => {if (previous === undefined) delete process.env.FAM_AUTO_UPDATE; else process.env.FAM_AUTO_UPDATE = previous;});
}

test('automatic Git updates discover commits without a version bump and check only once per rolling day', async t => {
  enableAutomatic(t);
  const {root, upstream, git} = await repository(t);
  await writeFile(join(upstream, 'change.txt'), 'new implementation, unchanged version');
  await git(upstream, 'add', '.');
  await git(upstream, '-c', 'commit.gpgsign=false', 'commit', '-m', 'New implementation');
  const calls: string[] = [], now = Date.now();
  const run = async (step: Step) => {
    assert.equal(Number(await readUpdateState(root, 'checked')), now);
    calls.push([step.command, ...step.args].join(' '));
    if (step.command === 'git') return (await execute('git', step.args, {cwd: step.cwd})).stdout.trim();
    assert.equal((await git(root, 'rev-parse', 'HEAD')).stdout, (await git(upstream, 'rev-parse', 'HEAD')).stdout);
    return '';
  };
  await Promise.all([autoUpdateCli({root, now, run}), autoUpdateCli({root, now, run})]);
  assert.equal(calls.length, 3);
  assert.match(calls[0], /^git fetch /); assert.match(calls[1], /^git merge --ff-only /);
  assert.match(calls[2], /^npm ci /);
  await autoUpdateCli({root, now: now + updateInterval - 1, run});
  assert.equal(calls.length, 3);
  const next: string[] = [];
  await autoUpdateCli({root, now: now + updateInterval, run: async step => {
    next.push(step.command); return (await execute(step.command, step.args, {cwd: step.cwd})).stdout.trim();
  }});
  assert.deepEqual(next, ['git']); // Up to date: no merge or reinstall.
});

test('offline failures are silent and consume the daily check; failed Git installs retry the next day', async t => {
  enableAutomatic(t);
  const {root, upstream, git} = await repository(t);
  const now = Date.now();
  let checks = 0;
  const offline = async () => {checks++; throw new Error('offline');};
  await autoUpdateCli({root, now, run: offline});
  await autoUpdateCli({root, now: now + 1000, run: offline});
  assert.equal(checks, 1);
  await writeFile(join(upstream, 'change.txt'), 'next');
  await git(upstream, 'add', '.');
  await git(upstream, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Next');
  const run = async (step: Step) => {
    if (step.command === 'git') return (await execute('git', step.args, {cwd: step.cwd})).stdout.trim();
    throw new Error('npm ci interrupted');
  };
  await autoUpdateCli({root, now: now + updateInterval, run});
  assert.equal((await readUpdateState(root, 'pending')).trim(), 'true');
  let repaired = 0;
  await autoUpdateCli({root, now: now + 2 * updateInterval, run: async step => {
    if (step.command === 'git') return run(step);
    repaired++; return '';
  }});
  assert.equal(repaired, 1);
  assert.equal((await readUpdateState(root, 'pending')).trim(), 'false');
});

test('automatic updates preserve dirty, detached, untracked, ahead and diverged branches', async t => {
  enableAutomatic(t);
  const {root, upstream, git} = await repository(t);
  let now = Date.now();
  let unsafeCalls = 0;
  const forbidden = async () => {unsafeCalls++; return '';};
  await writeFile(join(root, 'untracked.txt'), 'local');
  await autoUpdateCli({root, now, run: forbidden});
  await rm(join(root, 'untracked.txt'));
  await writeFile(join(root, 'package.json'), JSON.stringify({...pkg, version: '1.1.0'}));
  await autoUpdateCli({root, now: now += updateInterval, run: forbidden});
  await git(root, 'restore', 'package.json');
  await git(root, 'checkout', '--detach');
  await autoUpdateCli({root, now: now += updateInterval, run: forbidden});
  await git(root, 'checkout', 'main');
  await git(root, 'branch', '--unset-upstream');
  await autoUpdateCli({root, now: now += updateInterval, run: forbidden});
  assert.equal(unsafeCalls, 0);
  await git(root, 'branch', '--set-upstream-to=origin/main');
  await git(root, 'config', 'user.name', 'Fixture');
  await git(root, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(root, 'local.txt'), 'local commit');
  await git(root, 'add', '.');
  await git(root, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Local');
  const before = (await git(root, 'rev-parse', 'HEAD')).stdout;
  const attempts: string[] = [];
  const fetchOnly = async (step: Step) => {
    attempts.push(`${step.command} ${step.args[0]}`);
    if (attempts.at(-1) !== 'git fetch') return '';
    return (await execute('git', step.args, {cwd: step.cwd})).stdout;
  };
  await autoUpdateCli({root, now: now += updateInterval, run: fetchOnly});
  await writeFile(join(upstream, 'upstream.txt'), 'diverged');
  await git(upstream, 'add', '.');
  await git(upstream, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Diverged');
  await autoUpdateCli({root, now: now += updateInterval, run: fetchOnly});
  assert.deepEqual(attempts, ['git fetch', 'git fetch']);
  assert.equal((await git(root, 'rev-parse', 'HEAD')).stdout, before);
});

test('npm auto-updates install only a newer published version in the existing prefix', async t => {
  enableAutomatic(t);
  const prefix = join(await temporary(t), 'custom prefix');
  const root = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', name);
  await packageAt(root);
  let latest = '1.0.0', now = Date.now();
  const installs: Step[] = [];
  const run = async (step: Step) => {
    assert.equal(step.cwd, prefix);
    if (step.args[0] === 'view') return JSON.stringify(latest);
    installs.push(step); return '';
  };
  await autoUpdateCli({root, now, run});
  latest = '0.9.0'; await autoUpdateCli({root, now: now += updateInterval, run});
  latest = '1.0.0+repacked'; await autoUpdateCli({root, now: now += updateInterval, run});
  assert.equal(installs.length, 0);
  latest = '1.2.0'; await autoUpdateCli({root, now: now += updateInterval, run});
  assert.deepEqual(installs.map(step => step.args), [['install', '--global', '--prefix', prefix, `${name}@1.2.0`]]);
});

test('automatic updates default on, explicit disable survives manual updates, and dry-run changes no settings', async t => {
  enableAutomatic(t);
  const {root} = await repository(t);
  assert.equal(await autoUpdateEnabled(root), true);
  await updateCli({root, dryRun: true});
  assert.equal(await readUpdateState(root, 'checked'), undefined);
  await updateCli({root, run: async () => {}});
  assert.equal(await autoUpdateEnabled(root), true);
  await setAutoUpdate(false, root);
  await updateCli({root, run: async () => {}});
  assert.equal(await autoUpdateEnabled(root), false);
  const checked = await readUpdateState(root, 'checked');
  await autoUpdateCli({root, now: Date.now() + updateInterval, run: async () => {assert.fail('disabled'); return '';}});
  assert.equal(await readUpdateState(root, 'checked'), checked);
  await setAutoUpdate(true, root);
  assert.equal(await autoUpdateEnabled(root), true);
  process.env.FAM_AUTO_UPDATE = '0';
  assert.equal(await autoUpdateEnabled(root), false);
  delete process.env.FAM_AUTO_UPDATE;
  assert.equal(await autoUpdateEnabled(root), true);
});

test('SemVer comparison follows prerelease precedence and rejects malformed versions', () => {
  const order = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
  for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) assert.equal(newerVersion(order[i], order[j]), i > j);
  assert.equal(newerVersion('1.0.0+build.2', '1.0.0+build.1'), false);
  for (const value of ['latest', '1.2', '01.2.3', '1.2.3-01', '1.2.3; echo bad']) assert.throws(() => newerVersion(value, '1.0.0'));
});

test('active commands defer checks, dead readers are reclaimed, and launchers wait for installation', async t => {
  enableAutomatic(t);
  const {root, git} = await repository(t);
  await mkdir(join(root, 'bin'));
  for (const file of ['fam.mjs', 'build-state.mjs', 'update-state.mjs']) await copyFile(new URL(`../bin/${file}`, import.meta.url), join(root, 'bin', file));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist/cli.js'), "console.log('ready'); if (!process.argv.includes('--once')) process.stdin.resume();");
  await git(root, 'add', '.');
  await git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Launcher fixture');
  const child = spawn(process.execPath, [join(root, 'bin/fam.mjs')], {env: {...process.env, FAM_AUTO_UPDATE: '0'}, stdio: ['pipe', 'pipe', 'pipe']});
  t.after(() => {child.kill('SIGKILL');});
  await new Promise<void>((resolve, reject) => {child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', () => reject(new Error('Reader failed to start')));});
  assert.equal(await installationBusy(root), true);
  await autoUpdateCli({root, run: async () => {assert.fail('active reader'); return '';}});
  assert.equal(await readUpdateState(root, 'checked'), undefined);
  await assert.rejects(updateCli({root, run: async () => {}}), /Other fam commands/);
  const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await stopped;
  assert.equal(await installationBusy(root), false);
  let started = false;
  let pending!: ReturnType<typeof execute>;
  await withUpdateLock(root, async () => {
    pending = execute(process.execPath, [join(root, 'bin/fam.mjs'), '--once'], {env: {...process.env, FAM_AUTO_UPDATE: '0'}});
    pending.then(() => {started = true;});
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(started, false);
  });
  assert.equal((await pending).stdout, 'ready\n');
  await writeUpdateState(root, 'reader-unknown', JSON.stringify({host: 'another-host.invalid', pid: 123}));
  assert.equal(await installationBusy(root), true);
  await writeUpdateState(root, 'checked', String(Date.now() + updateInterval));
  assert.equal(await updateDue(root), false); // Clock rollback never causes rapid retries.
});

test('launcher detaches a silent worker after exit without changing output or exit status', async t => {
  enableAutomatic(t);
  const root = await temporary(t);
  await packageAt(root);
  await mkdir(join(root, 'bin'));
  for (const file of ['fam.mjs', 'build-state.mjs', 'update-state.mjs', 'auto-update.mjs']) await copyFile(new URL(`../bin/${file}`, import.meta.url), join(root, 'bin', file));
  await mkdir(join(root, 'dist/shared'), {recursive: true});
  await writeFile(join(root, 'dist/cli.js'), "console.log('normal output'); process.exitCode = 7;");
  await writeFile(join(root, 'dist/shared/cli-update.js'), `
    import {readFile, writeFile} from 'node:fs/promises';
    import {join} from 'node:path';
    export async function autoUpdateCli({root}) {
      console.log('must not reach stdout'); console.error('must not reach stderr');
      await writeFile(join(root, 'worker-started'), 'yes');
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {await readFile(join(root, 'worker-release')); break;} catch {}
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await writeFile(join(root, 'worker-finished'), 'yes');
    }
  `);
  const result = await execute(process.execPath, [join(root, 'bin/fam.mjs')], {cwd: tmpdir(), timeout: 3000}).then(
    () => assert.fail('exit status was changed'), error => error);
  assert.equal(result.code, 7);
  assert.equal(result.stdout, 'normal output\n'); assert.equal(result.stderr, '');
  // The command already returned although its detached worker is still waiting.
  const waitFor = async (name: string) => {
    for (let i = 0; i < 150; i++) {
      try {await readFile(join(root, name)); return;} catch {}
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail(`Worker never wrote ${name}`);
  };
  await waitFor('worker-started');
  await writeFile(join(root, 'worker-release'), 'yes');
  await waitFor('worker-finished');
  await rm(join(root, 'worker-started'));
  for (const args of [['cli.update', 'disable'], ['--completions=zsh'], ['cli.completion', 'query'], ['--offline'], ['--dry-run']]) {
    await execute(process.execPath, [join(root, 'bin/fam.mjs'), ...args]).catch(error => {assert.equal(error.code, 7);});
  }
  await assert.rejects(readFile(join(root, 'worker-started')), {code: 'ENOENT'});
});

test('the real background runner uses noninteractive subprocesses and retains failed-install retry state', {skip: process.platform === 'win32'}, async t => {
  enableAutomatic(t);
  const {root, upstream, git} = await repository(t);
  await writeFile(join(upstream, 'change.txt'), 'new upstream');
  await git(upstream, 'add', '.');
  await git(upstream, '-c', 'commit.gpgsign=false', 'commit', '-m', 'Update');
  const fakeBin = await temporary(t), npm = join(fakeBin, 'npm');
  await writeFile(npm, `#!/usr/bin/env node
    const {writeFileSync} = require('node:fs');
    writeFileSync('.fam-update/subprocess.json', JSON.stringify({
      args: process.argv.slice(2), autoUpdate: process.env.FAM_AUTO_UPDATE,
      prompts: process.env.GIT_TERMINAL_PROMPT, interactive: process.env.GCM_INTERACTIVE,
      yes: process.env.npm_config_yes, retries: process.env.npm_config_fetch_retries,
    }));
    console.log('hidden install progress'); console.error('hidden install failure');
    process.exitCode = 1;
  `);
  await chmod(npm, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${delimiter}${previousPath}`;
  t.after(() => {process.env.PATH = previousPath;});
  await autoUpdateCli({root});
  assert.deepEqual(JSON.parse(await readUpdateState(root, 'subprocess.json')), {
    args: ['ci', '--include=dev', '--ignore-scripts=false'], autoUpdate: '0', prompts: '0', interactive: 'never', yes: 'true', retries: '0',
  });
  assert.equal(await readUpdateState(root, 'pending'), 'true');
  assert.equal((await git(root, 'rev-parse', 'HEAD')).stdout, (await git(upstream, 'rev-parse', 'HEAD')).stdout);
});
