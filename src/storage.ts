import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export function credentialDirectory(env: NodeJS.ProcessEnv = process.env, platform = process.platform, home = homedir()): string {
  const override = env.FAMILYSEARCH_CONFIG_DIR;
  if (override !== undefined) {
    if (!isAbsolute(override)) throw new Error('FAMILYSEARCH_CONFIG_DIR must be an absolute path.');
    return resolve(override);
  }
  const base = platform === 'win32' ? env.APPDATA : env.XDG_CONFIG_HOME;
  return join(base && isAbsolute(base) ? base : join(home, '.config'), 'familysearch');
}

export const CREDENTIAL_DIR = credentialDirectory();

function credentialPath(name: string): string {
  const path = resolve(CREDENTIAL_DIR, name), part = relative(CREDENTIAL_DIR, path);
  if (!part || part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part) || isAbsolute(name)) {
    throw new Error('Credential filenames must stay within the configuration directory.');
  }
  return path;
}

export async function readPrivateJson<T>(name: string): Promise<T | undefined> {
  const path = credentialPath(name);
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Cannot read credential file ${name}.`);
  }
}

/** Atomic replacement prevents a partially written refresh token after interruption. */
export async function writePrivateJson(name: string, value: unknown): Promise<void> {
  const path = credentialPath(name);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let directory = dirname(path); ; directory = dirname(directory)) {
    await chmod(directory, 0o700);
    if (directory === CREDENTIAL_DIR) break;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(`${JSON.stringify(value, null, 2)}\n`); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
