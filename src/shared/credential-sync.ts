import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Optional, user-configured post-save hook. The runtime knows no destinations or transports. */
export async function syncCredentials(provider: string, directory: string, file?: string): Promise<boolean> {
  if (process.env.FAM_CREDENTIALS_SYNC_DISABLED === '1') return false;
  let command: unknown;
  try {
    if (process.env.FAM_CREDENTIALS_SYNC_COMMAND !== undefined) command = JSON.parse(process.env.FAM_CREDENTIALS_SYNC_COMMAND);
    else {
      let settings;
      try {settings = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));}
      catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error;}
      command = settings?.credentialsSyncCommand;
    }
    if (command === undefined || command === null) return false;
    if (!Array.isArray(command) || !command.length || typeof command[0] !== 'string' || !command[0].trim() ||
      command.some(value => typeof value !== 'string' || value.includes('\0'))) throw new Error('Invalid hook.');
    const argv = command as string[];
    await new Promise<void>((resolve, reject) => {
      const child = execFile(argv[0]!, [...argv.slice(1), provider], {
        encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true,
        env: {...process.env, FAM_CONFIG_DIR: directory, FAM_CREDENTIALS_SYNC_DISABLED: '1'},
      }, error => error ? reject(error) : resolve());
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify({version: 1, provider, credentialDirectory: directory, file: file ?? null, reason: file ? 'save' : 'manual'}));
    });
    return true;
  } catch {
    // Helper arguments/output and parser errors may contain credentials.
    throw new Error(`Credential sync hook failed for ${provider}; output was suppressed. Local credentials are saved. Retry with fam ${provider}.credential sync.`);
  }
}
