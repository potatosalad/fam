import {copyFile, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

/** Camofox's disabled crash reporter must implement the recovery callback too. */
export function patchReporter(source) {
  const start = source.indexOf('if (!enabled) {');
  const end = source.indexOf('\n  }', start);
  if (start < 0 || end < start) throw new Error('Unsupported Camofox reporter; no changes made.');
  const disabled = source.slice(start, end);
  if (/\bresetNativeMemBaseline\b/.test(disabled)) return source;
  const anchor = '      stop: () => {},';
  if (disabled.split(anchor).length !== 2 || !source.includes('function resetNativeMemBaseline()'))
    throw new Error('Unsupported Camofox reporter; no changes made.');
  return source.slice(0, start) + disabled.replace(anchor, `${anchor}\n      resetNativeMemBaseline: () => {},`) + source.slice(end);
}

export async function patchServer(path = '/app/lib/reporter.js') {
  const before = await readFile(path, 'utf8'), after = patchReporter(before);
  if (after === before) return;
  await copyFile(path, `${path}.before-fam-recovery`, 1).catch(error => {if (error.code !== 'EEXIST') throw error;});
  const temporary = `${path}.fam-${process.pid}.tmp`;
  try {await writeFile(temporary, after); await rename(temporary, path);}
  finally {await rm(temporary, {force: true});}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await patchServer();
