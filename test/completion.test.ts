import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, completionScript, installCompletion, type CompletionNode } from '../src/shared/completion.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'bin/fam.mjs');
// Refresh the catalog for source tests, including provider changes since the build.
await run(process.execPath, [join(root, 'scripts/generate-completions.mjs')]);
const catalog = JSON.parse(await readFile(join(root, 'dist/shared/completion-data.json'), 'utf8')) as CompletionNode;
const query = (...words: string[]) => complete(catalog, words);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

test('completion covers every provider, nested commands, flags and option values', () => {
  assert.deepEqual(query('fam').candidates, ['familysearch']);
  for (const provider of ['familysearch', 'ancestry', 'myheritage', 'findmypast', 'findagrave', 'geneanet']) {
    assert.ok(query('').candidates.includes(provider));
    assert.ok(query(provider, '').candidates.includes('credentials'));
    assert.ok(query(provider, '--').candidates.includes('--out'));
    assert.ok(query('help', provider.slice(0, 4)).candidates.includes(provider));
  }
  assert.deepEqual(query('familysearch', 'image', '').candidates, ['download', 'info', 'transcript']);
  assert.deepEqual(query('familysearch', 'film', 'im').candidates, ['image', 'images']);
  assert.deepEqual(query('ancestry', 'search', '--birth-').candidates, ['--birth-place', '--birth-year']);
  assert.deepEqual(query('findagrave', '--anonymous', 'sea').candidates, ['search']);
  assert.deepEqual(query('ancestry', '--out', 'some file.json', 'sea').candidates, ['search']);
  assert.deepEqual(query('geneanet', 'search', '--event', 'b').candidates, ['birth']);
  assert.deepEqual(query('myheritage', 'search', '--gender', '').candidates, ['F', 'M']);
  assert.deepEqual(query('geneanet', 'search', '--event=b').candidates, ['--event=birth']);
  assert.deepEqual(query('geneanet', 'search', '--event', '=', 'b').candidates, ['birth']);
  assert.deepEqual(query('findagrave', 'requests', 'v').candidates, ['volunteer']);
  assert.deepEqual(query('completion', 'install', '').candidates, ['bash', 'zsh']);
  for (const words of [['ancestry', 'search', '--given', ''], ['ancestry', 'search', '--', '--'], ['toString', ''], ['ancestry', '--unknown', ''], ['ancestry', 'person', '']]) {
    assert.equal(query(...words).kind, 'none', words.join(' '));
  }
});

test('file completion is limited to file arguments and preserves whitespace and metacharacters', () => {
  for (const words of [['ancestry', 'trees', '--out', 'a b'], ['myheritage', 'auth', '--har', 'a b'],
    ['familysearch', 'call', 'operation', 'a b'], ['findmypast', 'query', 'a b'],
    ['geneanet', 'search', '--input', 'a b'], ['geneanet', 'search', '--out=a b']]) {
    const result = query(...words);
    assert.equal(result.kind, 'files', words.join(' '));
    assert.equal(result.prefix, 'a b');
  }
  const literal = '$(must-not-run); `also-not`';
  assert.equal(query('ancestry', '--out', literal).prefix, literal);
});

test('completion CLI runs outside the checkout without accessing credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-completion-'));
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, '__complete', 'familysearch', 'image', 'd'], {
      cwd: directory, env: { ...process.env, FAM_CONFIG_DIR: join(directory, 'no-profile'), FAM_CREDENTIALS_COMMAND: '["must-not-run"]' },
    });
    assert.equal(stdout, 'words\nd\ndownload\n');
    assert.equal(stderr, '');
    await assert.rejects(stat(join(directory, 'no-profile')), { code: 'ENOENT' });
    for (const shell of ['bash', 'zsh']) assert.equal((await run(process.execPath, [cli, 'completion', shell])).stdout, completionScript(shell));
    await assert.rejects(run(process.execPath, [cli, 'completion', 'fish']));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('installer preserves startup files, handles both bash startup modes and honors ZDOTDIR', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-completion-install-'));
  try {
    const profile = join(directory, '.profile');
    await writeFile(profile, '# keep this\nexport EXAMPLE=1', { mode: 0o640 });
    assert.deepEqual(await installCompletion('bash', directory), [join(directory, '.bashrc'), profile]);
    const before = await readFile(profile, 'utf8');
    await installCompletion('bash', directory);
    assert.equal(await readFile(profile, 'utf8'), before);
    assert.ok(before.startsWith('# keep this\nexport EXAMPLE=1\n'));
    assert.equal((await stat(profile)).mode & 0o777, 0o640);
    const zdir = join(directory, 'zsh config');
    await installCompletion('zsh', directory, zdir);
    const rc = await readFile(join(zdir, '.zshrc'), 'utf8');
    await installCompletion('zsh', directory, zdir);
    assert.equal(await readFile(join(zdir, '.zshrc'), 'utf8'), rc);
    await assert.rejects(installCompletion('fish', directory));
    // A shared POSIX profile must remain valid when sourced by sh.
    await run('/bin/sh', ['-c', `. ${quote(profile)}`]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const shell of ['/bin/bash', 'bash']) test(`${shell} completion function returns intact words and file paths`, async t => {
  try { await run(shell, ['--version']); } catch { t.skip('bash unavailable'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'fam-completion-shell-'));
  try {
    await writeFile(join(directory, 'a space.json'), '{}');
    const invoke = async (words: string[]) => (await run(shell, ['--noprofile', '--norc', '-c', `${completionScript('bash')}\nCOMP_WORDS=(${[cli, ...words].map(quote).join(' ')})\nCOMP_CWORD=${words.length}\n_fam_complete\nprintf '%s\\n' "\${COMPREPLY[@]}"`], { cwd: directory })).stdout;
    assert.equal(await invoke(['fam']), 'familysearch\n');
    assert.equal(await invoke(['familysearch', 'image', 'd']), 'download\n');
    assert.equal(await invoke(['ancestry', 'trees', '--out', 'a']), 'a space.json\n');
    assert.equal(await invoke(['ancestry', 'trees', '--out=a']), 'a space.json\n');
    assert.equal(await invoke(['geneanet', 'search', '--event', '=', 'b']), 'birth\n');
    assert.equal(await invoke(['geneanet', 'search', '--event=b']), 'birth\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native zsh completion passes candidates to compadd and delegates filenames', async t => {
  try { await run('zsh', ['--version']); } catch { t.skip('zsh unavailable'); return; }
  const script = `compdef() { :; }\n${completionScript('zsh')}\ncompadd() { shift 2; print -rl -- "$@"; }\n_files() { print -r -- FILES; }\nwords=(${quote(cli)} familysearch image d)\nCURRENT=4\n_fam_complete\nwords=(${quote(cli)} ancestry trees --out a)\nCURRENT=5\nPREFIX=a\n_fam_complete`;
  assert.equal((await run('zsh', ['-f', '-c', script])).stdout, 'download\nFILES\n');
});
