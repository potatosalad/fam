import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Packaged builds retain their revision even when run outside a Git checkout.
let revision = null, dirty = null;
try {
  const cwd = new URL('../', import.meta.url);
  revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  dirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
} catch {}
const directory = process.argv[2] ? pathToFileURL(`${process.argv[2]}/`) : new URL('../dist/', import.meta.url);
await writeFile(new URL('build-info.json', directory), `${JSON.stringify({revision, dirty})}\n`);
