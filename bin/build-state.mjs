import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import {mkdir, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {basename, isAbsolute, join, sep} from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {promisify} from 'node:util';

const execute = promisify(execFile);
export const buildName = /^\.fam-build-[A-Za-z0-9]+$/;
const owner = () => ({pid: process.pid, host: hostname()});

function alive(record) {
  // Unreadable records, other hosts, permission errors and reused PIDs all retain
  // the build. Only positive evidence of a dead process permits deletion.
  if (record?.host !== hostname() || !Number.isSafeInteger(record.pid) || record.pid <= 0) return true;
  try {process.kill(record.pid, 0); return true;}
  catch (error) {return error.code !== 'ESRCH';}
}

export async function currentBuild(root) {
  try {
    const {directory} = JSON.parse(await readFile(join(root, '.fam-build.json'), 'utf8'));
    if (!buildName.test(directory)) throw new Error('Invalid fam build snapshot.');
    return directory;
  } catch (error) {if (error.code === 'ENOENT') return 'dist'; throw error;}
}

/** Register before rechecking the pointer: cleanup cannot miss a pinned reader. */
export async function pinBuild(root) {
  for (;;) {
    const directory = await currentBuild(root);
    if (directory === 'dist') return directory;
    const lease = join(root, directory, `.fam-lease-${process.pid}-${randomUUID()}.json`);
    try {await writeFile(lease, JSON.stringify(owner()), {flag: 'wx', mode: 0o600});}
    catch (error) {
      if (error.code === 'ENOENT' && directory !== await currentBuild(root)) continue;
      // A user may run a checkout owned by someone else. Process inspection
      // treats this untracked launcher conservatively during cleanup.
      if (['EACCES', 'EROFS'].includes(error.code)) {
        if (directory !== await currentBuild(root)) continue;
        return directory;
      }
      throw error;
    }
    if (directory !== await currentBuild(root)) {await rm(lease, {force: true}); continue;}
    // Synchronous exit handlers also cover process.exit; SIGKILL leases are
    // reclaimed by checking their PID at the next build.
    process.once('exit', () => {try {unlinkSync(lease);} catch {}});
    return directory;
  }
}

export async function withProcessLock(root, name, action) {
  const lock = join(root, name), deadline = Date.now() + 60_000;
  for (;;) {
    try {await mkdir(lock); break;}
    catch (error) {if (error.code !== 'EEXIST') throw error;}
    let record;
    try {record = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));} catch {}
    if (record && !alive(record)) {
      // Serialize stale-lock recovery too: two waiters must not remove a new
      // owner's lock after both observed the previous owner's dead PID.
      const guard = `${lock}.reclaim`;
      let acquired = false;
      try {
        await mkdir(guard); acquired = true;
        const latest = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
        if (!alive(latest)) await rm(lock, {recursive: true, force: true});
      } catch (error) {if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error;}
      finally {if (acquired) await rm(guard, {recursive: true, force: true});}
    }
    if (Date.now() >= deadline) throw new Error(`Another fam operation holds ${name}; retry when it finishes.`);
    await setTimeout(100);
  }
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify(owner()), {flag: 'wx'});
    return await action();
  } finally {
    try {await rm(lock, {recursive: true, force: true});}
    catch (error) {process.stderr.write(`fam: could not release ${name}: ${error.message}\n`);}
  }
}

export async function markBuilding(directory) {
  await writeFile(join(directory, '.fam-building.json'), JSON.stringify(owner()), {flag: 'wx'});
}

async function couldUseInstallation(args, root) {
  const matches = [...args.matchAll(/(?:^|[\s/\\])fam(?:\.mjs)?(?=\s|$)/g)];
  if (!matches.length) return false;
  let identified = false;
  // ps does not quote argv. Try whitespace boundaries to resolve an absolute
  // launcher, including paths with spaces and symlinks from a custom bin dir.
  const starts = [0, ...[...args.matchAll(/\s/g)].map(match => match.index + 1)];
  for (const match of matches) {
    const end = match.index + match[0].length;
    for (const start of starts.filter(start => start < end).reverse()) {
      const candidate = args.slice(start, end);
      if (!isAbsolute(candidate)) continue;
      try {
        const path = await realpath(candidate);
        identified = true;
        if (path.startsWith(`${root}${sep}`)) return true;
      } catch {}
    }
  }
  return !identified;
}

/** Called with the publication lock held, after switching the current pointer. */
export async function cleanupBuilds(root) {
  const current = await currentBuild(root), removed = [], retained = [];
  const candidates = (await readdir(root, {withFileTypes: true})).filter(e => e.isDirectory() && buildName.test(e.name));
  const records = [], tracked = new Set();
  for (const entry of candidates) {
    const directory = join(root, entry.name);
    const names = await readdir(directory);
    let busy = false;
    for (const name of names.filter(n => n.startsWith('.fam-lease-') || n === '.fam-building.json')) {
      let record;
      try {record = JSON.parse(await readFile(join(directory, name), 'utf8'));}
      catch (error) {if (error.code === 'ENOENT') continue; busy = true; continue;}
      if (alive(record)) {busy = true; if (record.host === hostname()) tracked.add(record.pid);}
      else await rm(join(directory, name), {force: true});
    }
    records.push({name: entry.name, names, busy});
  }
  // Older/read-only launchers have no leases. Resolve their installation where
  // possible; an unidentifiable fam process conservatively defers cleanup.
  let processes;
  try {
    const {stdout} = await execute('ps', ['-ax', '-o', 'pid=', '-o', 'ucomm=', '-o', 'args='], {maxBuffer: 16 * 1024 * 1024});
    processes = stdout.split('\n').flatMap(line => {
      const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      // Shells can contain "fam" in completion scripts or command strings;
      // only Node processes can hold the CLI's JavaScript modules.
      return match && ['node', 'nodejs', 'MainThread', 'fam', basename(process.execPath), basename(process.execPath).slice(0, 15)].includes(match[2])
        ? [{pid: Number(match[1]), args: match[3]}] : [];
    });
  } catch {}
  let unknown = !processes;
  const canonical = await realpath(root);
  for (const p of processes ?? []) {
    if (p.pid !== process.pid && !tracked.has(p.pid) && await couldUseInstallation(p.args, canonical)
      && alive({pid: p.pid, host: hostname()})) {unknown = true; break;}
  }
  for (const entry of records) {
    const legacy = !entry.names.includes('.fam-published.json');
    // A concurrent compiler has no completed marker yet; its owner protects it.
    // Unrecognized/empty folders are never treated as disposable build output.
    if (entry.name === current || entry.busy || unknown
      || legacy && !entry.names.includes('.fam-building.json') && (!entry.names.includes('cli.js') || !entry.names.includes('build-info.json'))
      || processes.some(p => p.pid !== process.pid && p.args.includes(entry.name))) retained.push(entry.name);
    else {await rm(join(root, entry.name), {recursive: true, force: true}); removed.push(entry.name);}
  }
  return {removed, retained};
}
