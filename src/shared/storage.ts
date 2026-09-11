import { chmod, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {chmodSync, closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, writeSync} from 'node:fs';
import {reportDiagnostic} from './diagnostics.js';

export function credentialDirectory(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()): string {
  const setting = env.FAM_CONFIG_DIR !== undefined ? 'FAM_CONFIG_DIR' : 'FAMILYSEARCH_CONFIG_DIR';
  const override = env[setting];
  if (override !== undefined) {
    if (!isAbsolute(override)) throw new Error(`${setting} must be an absolute path.`);
    return resolve(override);
  }
  const base = platform === 'win32' ? env.APPDATA : env.XDG_CONFIG_HOME;
  return join(base && isAbsolute(base) ? base : join(home, '.config'), 'fam');
}

export const CREDENTIAL_DIR = credentialDirectory();

function credentialPath(name: string): string {
  const path = resolve(CREDENTIAL_DIR, name), part = relative(CREDENTIAL_DIR, path);
  if (!part || part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part) || isAbsolute(name)) {
    throw new Error('Credential filenames must stay within the configuration directory.');
  }
  return path;
}

/** One O_APPEND write per record keeps concurrent CLI writers from overwriting each other.
 * Synchronous writes also work from Node's exit handler. History is local, private storage. */
export function appendPrivateJsonl(name: string, value: unknown, options: {separate?: boolean} = {}): void {
  const path = credentialPath(name);
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    chmodSync(directory, 0o700);
    if (directory === CREDENTIAL_DIR) break;
  }
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1) throw new Error('History must be a regular private file.');
    fchmodSync(fd, 0o600);
    // A leading separator lets a control journal recover after an interrupted prior append.
    const line = Buffer.from(`${options.separate ? '\n' : ''}${JSON.stringify(value)}\n`);
    if (writeSync(fd, line) !== line.length) throw new Error('Incomplete history write.');
  } finally {closeSync(fd);}
}

export async function readPrivateJson<T>(name: string): Promise<T | undefined> {
  const path = credentialPath(name);
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read credential file ${name}.`);
  }
}

export async function historyFiles(): Promise<string[]> {
  try {
    return (await readdir(credentialPath('history'), {withFileTypes: true}))
      .filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .map(entry => `history/${entry.name}`).sort().reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error('Cannot list command history in the active profile.');
  }
}

/** Read a fixed-size snapshot so concurrent appends cannot prolong a query. */
export async function* readPrivateJsonl(name: string): AsyncGenerator<{line: number; value?: unknown; issue?: string}> {
  const file = await open(credentialPath(name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('History must be a regular file.');
    if (!info.size) return;
    const stream = file.createReadStream({start: 0, end: info.size - 1, encoding: 'utf8', autoClose: false});
    let pending = '', oversized = false, line = 0;
    const maximum = 16 * 1024 * 1024;
    try {
      for await (const chunk of stream) {
        const parts = String(chunk).split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (!oversized) {
            pending += parts[i];
            if (pending.length > maximum) {oversized = true; pending = '';}
          }
          if (i === parts.length - 1) continue;
          line++;
          if (oversized) yield {line, issue: 'Record exceeded the 16 MiB character limit.'};
          else if (pending.trim()) {
            try {yield {line, value: JSON.parse(pending)};}
            catch {yield {line, issue: 'Invalid JSON record.'};}
          }
          pending = ''; oversized = false;
        }
      }
      if (pending.trim() || oversized) yield {line: line + 1, issue: 'Unfinished final record; a writer may still be active.'};
    } finally {stream.destroy();}
  } finally {await file.close();}
}

/** Write exact bytes with private permissions and atomic replacement. */
export async function writePrivateFile(name: string, data: string | Uint8Array): Promise<string> {
  const path = credentialPath(name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    await chmod(directory, 0o700);
    if (directory === CREDENTIAL_DIR) break;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(data); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
  return path;
}

/** Atomic replacement prevents a partially written refresh token after interruption. */
export async function writePrivateJson(name: string, value: unknown): Promise<void> {
  await writePrivateFile(name, `${JSON.stringify(value, null, 2)}\n`);
  const changed = /^(?:(ancestry|myheritage|findmypast|findagrave|geneanet|storied|newspapers|americanancestors)\/)?(?:login|session|device)\.json$/.exec(name);
  if (changed) {
    const {syncCredentials} = await import('./credential-sync.js');
    try {await syncCredentials(changed[1] ?? 'familysearch', CREDENTIAL_DIR, name);}
    catch (error) {
      reportDiagnostic('CREDENTIAL_SYNC_FAILED', 'Credential sync failed; local credentials were saved.', error);
      process.stderr.write(`${(error as Error).message}\n`);
    }
  }
}
