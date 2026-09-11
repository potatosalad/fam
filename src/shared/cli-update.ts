import {spawn, execFile} from 'node:child_process';
import {lstat, readFile, realpath} from 'node:fs/promises';
import {basename, delimiter, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
// @ts-expect-error The launcher helper also runs before TypeScript is built.
import {autoUpdateEnabled, installationBusy, readUpdateState, updateDue, withUpdateLock, writeUpdateState} from '../../bin/update-state.mjs';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
export type Step = {command: string; args: string[]; cwd: string};
export type UpdatePlan = {method: 'git' | 'npm'; directory: string; version: string; steps: Step[]};

async function exists(path: string) {
  try {await lstat(path); return true;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error;}
}

async function git(root: string, args: string[]) {
  return (await execute('git', args, {cwd: root, encoding: 'utf8', timeout: 20_000, maxBuffer: 4 * 1024 * 1024})).stdout.trim();
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

async function runCommand(step: Step, {quiet = false, timeout = 0} = {}): Promise<string> {
  if (!quiet) process.stderr.write(`Updating fam: ${step.command} ${step.args.join(' ')}\n`);
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
  return new Promise<string>((accept, reject) => {
    const env = quiet ? {...process.env, FAM_AUTO_UPDATE: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
      GIT_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never',
      ...(!process.env.GIT_SSH_COMMAND && !process.env.GIT_SSH ? {GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oConnectTimeout=10'} : {}),
      npm_config_yes: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_progress: 'false',
      npm_config_fetch_retries: '0', npm_config_fetch_timeout: '20000'} : process.env;
    const child = spawn(executable, args,
      {cwd: step.cwd, env, stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 2, 2],
        detached: quiet && process.platform !== 'win32', windowsHide: quiet});
    let output = '', expired = false;
    // Registry responses are tiny; discard excess install chatter without
    // allowing buffered output to consume unbounded memory.
    child.stdout?.on('data', chunk => {if (output.length < 1024 * 1024) output += chunk;});
    const timer = timeout ? setTimeout(() => {
      expired = true;
      try {
        if (quiet && process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    }, timeout) : undefined;
    const cleanup = () => {if (timer) clearTimeout(timer);};
    child.once('error', cleanup);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      cleanup();
      if (!expired && code === 0) accept(output.trim());
      else reject(new Error(`fam update failed: ${step.command} ${expired ? 'timed out' : `exited with ${signal ?? code}`}.`));
    });
  });
}

export async function updateCli({dryRun = false, root = packageRoot, run = async step => {await runCommand(step);}}:
  {dryRun?: boolean; root?: string; run?: (step: Step) => Promise<void>} = {}) {
  if (dryRun) {
    const plan = await planUpdate(root);
    return {...plan, dryRun: true, text: `Update from ${plan.method}: ${plan.directory}\n${plan.steps.map(s => `${s.command} ${s.args.join(' ')}`).join('\n')}`};
  }
  // Keep the lock outside the package: npm replaces the package directory.
  const canonical = await realpath(root);
  await planUpdate(canonical);
  return withUpdateLock(canonical, async () => {
    if (await installationBusy(canonical)) throw new Error('Other fam commands are still running. Retry the update after they finish.');
    const plan = await planUpdate(canonical);
    await writeUpdateState(canonical, 'checked', String(Date.now()));
    await writeUpdateState(canonical, 'pending', 'true');
    for (const step of plan.steps) await run(step);
    await writeUpdateState(canonical, 'pending', 'false');
    const pkg = JSON.parse(await readFile(join(canonical, 'package.json'), 'utf8')) as {version: string};
    return {...plan, previousVersion: plan.version, version: pkg.version, updated: true,
      text: `Updated fam ${pkg.version} from ${plan.method}.\nInstallation: ${canonical}`};
  });
}

export async function setAutoUpdate(enabled: boolean, root = packageRoot) {
  const canonical = await realpath(root);
  await withUpdateLock(canonical, () => writeUpdateState(canonical, 'enabled', String(enabled)));
  return {enabled, text: `Automatic updates ${enabled ? 'enabled' : 'disabled'} for this installation.`};
}

// SemVer precedence, including prerelease identifiers; build metadata is ignored.
// This worker uses only Node built-ins so it can retry an interrupted npm ci.
export function newerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(version);
    if (!match || match[4]?.split('.').some(id => /^0\d+$/.test(id))) throw new Error('Invalid package version.');
    return {core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') ?? []};
  };
  const a = parse(candidate), b = parse(current);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  if (!a.pre.length || !b.pre.length) return !!b.pre.length && !a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return y === undefined;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    return nx && ny ? BigInt(x) > BigInt(y) : nx !== ny ? ny : x > y;
  }
  return false;
}

/** One silent attempt per installation per rolling 24 hours, including failures. */
export async function autoUpdateCli({root = packageRoot, now = Date.now(),
  run = (step: Step, timeout: number) => runCommand(step, {quiet: true, timeout})}:
  {root?: string; now?: number; run?: (step: Step, timeout: number) => Promise<string>} = {}) {
  try {
    root = await realpath(root);
    return await withUpdateLock(root, async () => {
      if (!await autoUpdateEnabled(root) || !await updateDue(root, now) || await installationBusy(root)) return;
      // Persist before any network work. Concurrent workers and offline launches
      // cannot retry repeatedly, even when the check or install crashes.
      await writeUpdateState(root, 'checked', String(now));
      let plan = await planUpdate(root);
      const query = (command: string, args: string[], cwd = root) => run({command, args, cwd}, 20_000);
      let steps: Step[];
      if (plan.method === 'git') {
        const branch = await git(root, ['branch', '--show-current']);
        const remote = await git(root, ['config', '--get', `branch.${branch}.remote`]);
        const ref = await git(root, ['config', '--get', `branch.${branch}.merge`]);
        await query('git', ['fetch', '--quiet', '--no-tags', '--', remote, ref]);
        const head = await git(root, ['rev-parse', 'HEAD']), target = await git(root, ['rev-parse', 'FETCH_HEAD']);
        if (head === target && (await readUpdateState(root, 'pending'))?.trim() !== 'true') return;
        // Refuse divergence and never rewind a branch that is ahead of upstream.
        await git(root, ['merge-base', '--is-ancestor', head, target]);
        plan = await planUpdate(root); // Recheck for local edits made during fetch.
        steps = [{command: 'git', args: ['merge', '--ff-only', '--no-edit', target], cwd: root}, plan.steps[1]];
      } else {
        const latest: unknown = JSON.parse(await query('npm', ['view', '@potatosalad/fam@latest', 'version', '--json'], plan.steps[0].cwd));
        if (typeof latest !== 'string' || !newerVersion(latest, plan.version)
          && !(latest === plan.version && (await readUpdateState(root, 'pending'))?.trim() === 'true')) return;
        steps = plan.steps.map(step => ({...step, args: step.args.map(arg => arg === '@potatosalad/fam@latest' ? `@potatosalad/fam@${latest}` : arg)}));
      }
      await writeUpdateState(root, 'pending', 'true');
      for (const step of steps) await run(step, 5 * 60_000);
      await writeUpdateState(root, 'pending', 'false');
      return {updated: true};
    });
  } catch {} // No diagnostics, prompts, exit-status changes, or same-day retry.
}
