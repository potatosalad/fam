import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error This JavaScript compatibility shim runs inside Camofox.
import {patchReporter, patchServer} from '../browser/camofox-plugin/patch-server.mjs';

const source = `export function createReporter(enabled) {
  if (!enabled) {
    return {
      stop: () => {},
    };
  }
  function resetNativeMemBaseline() { return 'enabled'; }
  return {resetNativeMemBaseline};
}`;

test('disabled Camofox reporting supports browser recovery without enabling reporting', async () => {
  const patched = patchReporter(source);
  const {createReporter} = await import(`data:text/javascript,${encodeURIComponent(patched)}`);
  assert.equal(createReporter(false).resetNativeMemBaseline(), undefined);
  assert.equal(createReporter(true).resetNativeMemBaseline(), 'enabled');
  assert.equal(patchReporter(patched), patched);
  assert.throws(() => patchReporter('unrecognized reporter'), /no changes made/);
});

test('Camofox compatibility patch preserves the original and is repeatable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fam-recovery-'));
  try {
    const file = join(dir, 'reporter.js');
    await writeFile(file, source);
    await patchServer(file); await patchServer(file);
    assert.equal(await readFile(`${file}.before-fam-recovery`, 'utf8'), source);
    assert.equal(await readFile(file, 'utf8'), patchReporter(source));
  } finally {await rm(dir, {recursive: true, force: true});}
});
