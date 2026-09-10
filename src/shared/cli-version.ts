import {lstat, readFile, realpath} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export interface CliVersion {
  version: string;
  revision: string | null;
  dirty: boolean | null;
  installation: {type: 'git' | 'npm' | 'directory'; path: string};
  runtime: {type: 'source' | 'build'; path: string};
}

/** Read the executing module's metadata, never the mutable current-build pointer. */
export async function cliVersion(moduleUrl = import.meta.url): Promise<CliVersion> {
  const runtime = await realpath(fileURLToPath(new URL('../', moduleUrl)));
  const root = dirname(runtime);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {version: string};
  let build: {version?: string; revision?: string | null; dirty?: boolean | null} = {};
  if (basename(runtime) !== 'src') {
    try {build = JSON.parse(await readFile(join(runtime, 'build-info.json'), 'utf8'));}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  }
  let type: CliVersion['installation']['type'] = basename(dirname(dirname(root))) === 'node_modules' ? 'npm' : 'directory';
  try {await lstat(join(root, '.git')); type = 'git';}
  catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  return {version: build.version ?? pkg.version, revision: build.revision ?? null, dirty: build.dirty ?? null,
    installation: {type, path: root}, runtime: {type: basename(runtime) === 'src' ? 'source' : 'build', path: runtime}};
}

export function formatCliVersion(info: CliVersion) {
  const revision = info.revision ? ` (${info.revision.slice(0, 12)}${info.dirty ? ', modified' : ''})` : '';
  return [`fam ${info.version}${revision}`,
    `Installed from: ${info.installation.type === 'git' ? 'Git checkout' : info.installation.type === 'npm' ? 'npm package' : 'Directory'}`,
    `Installation: ${info.installation.path}`,
    `Running ${info.runtime.type}: ${info.runtime.path}`].join('\n') + '\n';
}
