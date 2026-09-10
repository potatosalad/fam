import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {planUpdate, updateCli} from '../src/shared/cli-update.js';

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
  await writeFile(join(upstream, '.gitignore'), '.fam-update.lock*\n');
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
