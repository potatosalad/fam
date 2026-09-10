import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {cliVersion, formatCliVersion} from '../src/shared/cli-version.js';

test('version identifies the pinned build even after the package and current pointer change', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fam-version-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const build = join(root, '.fam-build-original');
  await mkdir(join(build, 'shared'), {recursive: true});
  // Worktrees use a .git file instead of a directory.
  await writeFile(join(root, '.git'), 'gitdir: fixture');
  await writeFile(join(root, 'package.json'), '{"version":"2.0.0"}');
  await writeFile(join(root, '.fam-build.json'), '{"directory":".fam-build-newer"}');
  const revision = '1234567890abcdef1234567890abcdef12345678';
  await writeFile(join(build, 'build-info.json'), JSON.stringify({version: '1.0.0', revision, dirty: true}));
  const info = await cliVersion(pathToFileURL(join(build, 'shared/cli-version.js')).href);
  assert.equal(info.version, '1.0.0'); assert.equal(info.revision, revision); assert.equal(info.dirty, true);
  assert.deepEqual(info.installation, {type: 'git', path: root});
  assert.deepEqual(info.runtime, {type: 'build', path: build});
  assert.match(formatCliVersion(info), /^fam 1\.0\.0 \(1234567890ab, modified\)\nInstalled from: Git checkout/);
});

test('version identifies npm packages and source execution without Git or build metadata', async t => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'fam-version-npm-')));
  t.after(() => rm(temp, {recursive: true, force: true}));
  const root = join(temp, 'node_modules/@potatosalad/fam');
  await mkdir(join(root, 'dist/shared'), {recursive: true});
  await writeFile(join(root, 'package.json'), '{"version":"3.0.0"}');
  const info = await cliVersion(pathToFileURL(join(root, 'dist/shared/cli-version.js')).href);
  assert.equal(info.version, '3.0.0'); assert.equal(info.revision, null);
  assert.equal(info.installation.type, 'npm');
  assert.match(formatCliVersion(info), /Installed from: npm package/);
  await mkdir(join(temp, 'src/shared'), {recursive: true});
  await writeFile(join(temp, 'package.json'), '{"version":"4.0.0"}');
  const source = await cliVersion(pathToFileURL(join(temp, 'src/shared/cli-version.js')).href);
  assert.equal(source.runtime.type, 'source'); assert.equal(source.revision, null);
  assert.equal(source.installation.type, 'directory');
});
