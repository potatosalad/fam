import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import {mkdir, readFile, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {alive, pinBuild, withProcessLock} from './build-state.mjs';

export const updateInterval = 24 * 60 * 60 * 1000;

// Keep state outside npm's replaceable package and independent of user profiles.
export function updateLocation(root) {
  const parent = basename(dirname(dirname(root))) === 'node_modules' ? dirname(root) : root;
  return {parent, state: join(parent, '.fam-update')};
}

export const withUpdateLock = (root, action) => withProcessLock(updateLocation(root).parent, '.fam-update.lock', action, 15 * 60_000, true);

export async function readUpdateState(root, name) {
  try {return await readFile(join(updateLocation(root).state, name), 'utf8');}
  catch (error) {if (error.code === 'ENOENT') return undefined; throw error;}
}

export async function writeUpdateState(root, name, value) {
  const {state} = updateLocation(root), path = join(state, name), temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(state, {recursive: true, mode: 0o700});
  try {await writeFile(temporary, value, {flag: 'wx', mode: 0o600}); await rename(temporary, path);}
  finally {await rm(temporary, {force: true});}
}

export async function autoUpdateEnabled(root) {
  return process.env.FAM_AUTO_UPDATE !== '0' && (await readUpdateState(root, 'enabled'))?.trim() !== 'false';
}

export async function updateDue(root, now = Date.now()) {
  const checked = Number(await readUpdateState(root, 'checked'));
  return !Number.isFinite(checked) || now - checked >= updateInterval;
}

/** Called under the update lock; dead readers do not block future updates. */
export async function installationBusy(root) {
  const {state} = updateLocation(root);
  let names;
  try {names = await readdir(state);} catch (error) {if (error.code === 'ENOENT') return false; throw error;}
  for (const name of names.filter(name => name.startsWith('reader-'))) {
    const path = join(state, name);
    let record;
    try {record = JSON.parse(await readFile(path, 'utf8'));}
    catch (error) {if (error.code === 'ENOENT') continue; return true;}
    if (record.host === hostname() && record.pid === process.pid) continue;
    if (alive(record)) return true;
    await rm(path, {force: true});
  }
  return false;
}

/** Register before loading the CLI, so an update cannot replace active dependencies. */
export async function enterInstallation(root, args = process.argv.slice(2)) {
  root = await realpath(root);
  try {
    return await withUpdateLock(root, async () => {
      const name = `reader-${process.pid}-${randomUUID()}`;
      await writeUpdateState(root, name, JSON.stringify({pid: process.pid, host: hostname()}));
      process.once('exit', () => {try {unlinkSync(join(updateLocation(root).state, name));} catch {}});
      const directory = await pinBuild(root);
      // Explicit update controls, completion, and offline/dry-run commands do no
      // automatic network work. Source execution is deliberately not a launcher.
      if (args[0] !== 'cli.update' && args[0] !== 'cli.completion'
        && !args.some(arg => arg.startsWith('--completions') || ['--dry-run', '--offline'].includes(arg))
        && await autoUpdateEnabled(root) && await updateDue(root)) {
        process.once('exit', () => {
          try {
            const child = spawn(process.execPath, [join(root, 'bin/auto-update.mjs')], {
              cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
            });
            child.on('error', () => {}); child.unref();
          } catch {} // Updating must never change the command's output or status.
        });
      }
      return directory;
    });
  } catch (error) {
    // Unwritable or damaged update state must not prevent ordinary CLI usage.
    if (typeof error.code === 'string') return pinBuild(root);
    throw error;
  }
}
