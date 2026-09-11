// Runs after the build: prove the npm artifact works without checkout documentation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const firstPackage = value => Array.isArray(value) ? value[0] : Object.values(value)[0];

test('packed documentation, search, and completion work with source files removed', {timeout: 30000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-doc-package-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const npm = async args => firstPackage(JSON.parse((await run('npm', args, {cwd: root, maxBuffer: 8 * 1024 * 1024})).stdout));
  const manifest = await npm(['pack', '--dry-run', '--json', '--ignore-scripts']);
  const names = manifest.files.map(file => file.path);
  for (const file of ['dist/docs/catalog.json', 'dist/docs/README.md', 'dist/docs/americanancestors/README.md', 'dist/docs/cli.md'])
    assert.ok(names.includes(file), file);
  assert.ok(!names.some(name => name.includes('.fam-build-')));
  assert.ok(names.includes('bin/auto-update.mjs'));
  assert.ok(names.includes('bin/update-state.mjs'));
  assert.ok(!names.some(name => name.startsWith('.fam-update/')));
  const archive = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory]);
  await run('tar', ['-xzf', join(directory, archive.filename), '-C', directory]);
  const installed = join(directory, 'package');
  for (const name of ['src', 'docs', 'README.md']) await rm(join(installed, name), {recursive: true, force: true});
  // Reuse the already-installed dependencies; never install or execute package lifecycle scripts.
  await symlink(join(root, 'node_modules'), join(installed, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const invoke = (...args) => run(process.execPath, [join(installed, 'bin/fam.mjs'), ...args], {
    cwd: tmpdir(), env: {...process.env, FAM_CONFIG_DIR: join(directory, 'no-profile'), FAM_HISTORY: '0', FAM_AUTO_UPDATE: '0', FAM_CREDENTIALS_COMMAND: '["must-not-run"]'},
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal((await invoke('cli.doc', 'read', '--provider', 'americanancestors', '--format', 'markdown')).stdout,
    await readFile(join(root, 'docs/americanancestors/README.md'), 'utf8'));
  assert.match((await invoke('americanancestors', '--help')).stdout, /Documentation: fam cli.doc read --provider americanancestors/);
  const search = JSON.parse((await invoke('cli.doc', 'search', '--query', 'Generation=5', '--provider', 'americanancestors', '--lexical', '--json')).stdout);
  assert.equal(search.data.results[0].section, 'family-members-and-collection-specific-fields');
  const completion = JSON.parse((await invoke('cli.completion', 'query', '--word=cli.doc', '--word=read', '--word=--provider', '--word=americanancestors', '--word=--section', '--word=family', '--json')).stdout);
  assert.ok(completion.data.candidates.includes('family-members-and-collection-specific-fields'));
  const disabled = await invoke('cli.update', 'disable', '--json');
  assert.equal(JSON.parse(disabled.stdout).data.enabled, false);
  assert.equal(disabled.stderr, '');
  assert.equal(await readFile(join(installed, '.fam-update/enabled'), 'utf8'), 'false');
  const enabled = await invoke('cli.update', 'enable');
  assert.equal(enabled.stdout, 'Automatic updates enabled for this installation.\n');
  assert.equal(enabled.stderr, '');
  assert.equal(await readFile(join(installed, '.fam-update/enabled'), 'utf8'), 'true');
});
