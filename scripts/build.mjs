import {spawn} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cleanupBuilds, markBuilding, withProcessLock} from '../bin/build-state.mjs';

async function files(directory, prefix = '') {
  let entries;
  try {entries = await readdir(join(directory, prefix), {withFileTypes: true});}
  catch (error) {if (error.code === 'ENOENT') return []; throw error;}
  const result = [];
  for (const entry of entries) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(directory, name));
    else if (entry.isFile() && !entry.name.startsWith('.fam-')) result.push(name);
    else if (entry.isFile()) continue;
    else throw new Error(`Unexpected build output: ${name}`);
  }
  return result.sort();
}

async function atomic(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {await writeFile(temporary, value); await rename(temporary, path);}
  finally {await rm(temporary, {force: true});}
}

/** Switch the CLI only after a complete build; old processes keep their module paths. */
export async function publishBuild(root, directory) {
  if (dirname(directory) !== root || !/^\.fam-build-[A-Za-z0-9]+$/.test(basename(directory))) throw new Error('Invalid build directory.');
  return withProcessLock(root, '.fam-build-publish.lock', () => publishLocked(root, directory));
}

async function publishLocked(root, directory) {
  const emitted = await files(directory), dist = join(root, 'dist');
  const obsolete = (await files(dist)).filter(name => name !== '.npmignore' && !emitted.includes(name));
  // dist remains a real directory for library exports and npm packaging. Atomic file
  // replacement also avoids the deletion gap for entry points predating snapshots.
  for (const name of emitted) {
    const destination = join(dist, name), temporary = `${destination}.${randomUUID()}.tmp`;
    await mkdir(dirname(destination), {recursive: true});
    try {await copyFile(join(directory, name), temporary); await rename(temporary, destination);}
    finally {await rm(temporary, {force: true});}
  }
  // Retain removed modules for legacy in-flight imports, but never ship them.
  const escape = name => name.replace(/[\\*?\[\]!# ]/g, '\\$&');
  await atomic(join(dist, '.npmignore'), `${obsolete.map(name => `/${escape(name)}`).join('\n')}\n*.tmp\n`);
  await writeFile(join(directory, '.fam-published.json'), '{"schemaVersion":1}\n');
  await rm(join(directory, '.fam-building.json'), {force: true});
  await atomic(join(root, '.fam-build.json'), `${JSON.stringify({directory: basename(directory)})}\n`);
  // Cleanup failure must not turn a successfully published build into a failed
  // build (whose finally block would delete the active snapshot).
  try {return await cleanupBuilds(root);}
  catch (error) {process.stderr.write(`fam: build cleanup skipped: ${error.message}\n`);}
}

async function run(root, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {cwd: root, stdio: 'inherit'});
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Build step failed (${signal ?? code}).`)));
  });
}

export async function build(root) {
  const directory = await mkdtemp(join(root, '.fam-build-'));
  let published = false;
  try {
    await markBuilding(directory);
    await run(root, ['node_modules/typescript/bin/tsc', '--outDir', directory, '--noEmitOnError']);
    await run(root, ['scripts/build-info.mjs', directory]);
    await run(root, ['scripts/build-docs.mjs', directory]);
    await run(root, ['scripts/generate-completions.mjs', directory]);
    await publishBuild(root, directory);
    published = true;
  } finally {
    if (!published) await rm(directory, {recursive: true, force: true});
  }
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build(fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''));
}
