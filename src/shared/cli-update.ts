import {spawn, execFile} from 'node:child_process';
import {lstat, readFile, realpath} from 'node:fs/promises';
import {basename, delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
// @ts-expect-error The launcher helper also runs before TypeScript is built.
import {withProcessLock} from '../../bin/build-state.mjs';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
type Step = {command: string; args: string[]; cwd: string};
export type UpdatePlan = {method: 'git' | 'npm'; directory: string; version: string; steps: Step[]};

async function exists(path: string) {
  try {await lstat(path); return true;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error;}
}

async function git(root: string, args: string[]) {
  return (await execute('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024})).stdout.trim();
}

/** Resolve the running package, never the caller's working directory. */
export async function planUpdate(root = packageRoot): Promise<UpdatePlan> {
  root = await realpath(root);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {name: string; version: string};
  if (pkg.name !== '@potatosalad/fam') throw new Error('Cannot identify this fam installation.');
  const step = (command: string, args: string[], cwd = root): Step => ({command, args, cwd});
  if (await exists(join(root, '.git'))) {
    if (await realpath(await git(root, ['rev-parse', '--show-toplevel'])) !== root)
      throw new Error('The fam package must be at the root of its Git checkout.');
    if (await git(root, ['status', '--porcelain', '--untracked-files=normal']))
      throw new Error('The fam checkout has uncommitted changes. Commit or stash them before updating.');
    if (!await git(root, ['branch', '--show-current'])) throw new Error('The fam checkout has a detached HEAD. Switch to a branch before updating.');
    try {await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);}
    catch {throw new Error('The fam branch has no upstream. Configure its tracking branch before updating.');}
    return {method: 'git', directory: root, version: pkg.version, steps: [
      step('git', ['pull', '--ff-only', '--no-rebase', '--no-autostash']),
      // prepare builds the updated runtime. Existing global/custom symlinks keep
      // pointing at this checkout; do not create or replace another installation.
      step('npm', ['ci', '--include=dev', '--ignore-scripts=false']),
    ]};
  }

  const modules = dirname(dirname(root)); // @potatosalad/fam is scoped.
  if (basename(modules) !== 'node_modules') throw new Error('This fam installation is neither a Git checkout nor an npm installation.');
  const parent = dirname(modules);
  // Global packages live in PREFIX/lib/node_modules on Unix and PREFIX/node_modules
  // on Windows. This preserves nondefault prefixes without consulting PATH's npm.
  let prefix: string | undefined;
  if (process.platform !== 'win32' && basename(parent) === 'lib' && !await exists(join(parent, 'package.json'))) prefix = dirname(parent);
  if (process.platform === 'win32' && !await exists(join(parent, 'package.json'))) prefix = parent;
  if (prefix) return {method: 'npm', directory: root, version: pkg.version, steps: [
    step('npm', ['install', '--global', '--prefix', prefix, `${pkg.name}@latest`], prefix),
  ]};
  let project: {dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string>};
  try {project = JSON.parse(await readFile(join(parent, 'package.json'), 'utf8'));}
  catch {throw new Error('Cannot identify the npm project that owns this fam installation.');}
  if (![project.dependencies, project.devDependencies, project.optionalDependencies].some(deps => deps?.[pkg.name]))
    throw new Error('fam is not a direct dependency of this npm project. Update it using the owning project.');
  return {method: 'npm', directory: root, version: pkg.version, steps: [
    step('npm', ['install', '--prefix', parent, `${pkg.name}@latest`], parent),
  ]};
}

async function runStep(step: Step) {
  process.stderr.write(`Updating fam: ${step.command} ${step.args.join(' ')}\n`);
  let executable = step.command, args = step.args;
  if (process.platform === 'win32' && step.command === 'npm') {
    // .cmd launchers require a shell; run npm's JS entry point with Node instead
    // so paths and arguments never become shell code.
    const paths = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)];
    let cli: string | undefined;
    for (const path of paths) {
      const candidate = join(path, 'node_modules/npm/bin/npm-cli.js');
      if (await exists(candidate)) {cli = candidate; break;}
    }
    if (!cli) throw new Error('Cannot locate npm-cli.js beside Node or on PATH. Install npm with Node before updating.');
    executable = process.execPath; args = [cli, ...args];
  }
  await new Promise<void>((accept, reject) => {
    const child = spawn(executable, args,
      {cwd: step.cwd, stdio: ['ignore', 2, 2]});
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`fam update failed: ${step.command} exited with ${signal ?? code}.`)));
  });
}

export async function updateCli({dryRun = false, root = packageRoot, run = runStep}:
  {dryRun?: boolean; root?: string; run?: (step: Step) => Promise<void>} = {}) {
  if (dryRun) {
    const plan = await planUpdate(root);
    return {...plan, dryRun: true, text: `Update from ${plan.method}: ${plan.directory}\n${plan.steps.map(s => `${s.command} ${s.args.join(' ')}`).join('\n')}`};
  }
  // Keep the lock outside the package: npm replaces the package directory.
  const canonical = await realpath(root);
  const initial = await planUpdate(canonical);
  const lockRoot = initial.method === 'git' ? canonical : dirname(canonical);
  return withProcessLock(resolve(lockRoot), '.fam-update.lock', async () => {
    const plan = await planUpdate(canonical);
    for (const step of plan.steps) await run(step);
    const pkg = JSON.parse(await readFile(join(canonical, 'package.json'), 'utf8')) as {version: string};
    return {...plan, previousVersion: plan.version, version: pkg.version, updated: true,
      text: `Updated fam ${pkg.version} from ${plan.method}.\nInstallation: ${canonical}`};
  });
}
