import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { complete, completionScript, installCompletion, completionCatalog } from '../src/shared/completion.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceCli = join(root, 'src/cli.ts');
const sourceArgs = ['--import', import.meta.resolve('tsx'), sourceCli];
const catalog = completionCatalog();
const query = (...words: string[]) => complete(catalog, words);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

// Shell adapters invoke an executable. Use a disposable launcher for the source
// CLI so npm test does not depend on a previous build of dist/cli.js.
const launcherDirectory = await mkdtemp(join(tmpdir(), 'fam completion-'));
after(() => rm(launcherDirectory, { recursive: true, force: true }));
const cli = join(launcherDirectory, 'fam');
await writeFile(cli, `#!/bin/sh\nexec ${[process.execPath, ...sourceArgs].map(quote).join(' ')} "$@"\n`, { mode: 0o700 });

test('completion covers dotted objects, actions, flags and option values from the registry', () => {
  assert.deepEqual(query('familysearch.im').candidates, ['familysearch.image']);
  for (const provider of ['familysearch', 'ancestry', 'myheritage', 'findmypast', 'findagrave', 'geneanet', 'storied', 'newspaperarchive']) {
    assert.ok(query('').candidates.includes(`${provider}.session`));
    assert.ok(query(`${provider}.session`, '').candidates.includes('login'));
    assert.ok(query(`${provider}.session`, 'get', '--').candidates.includes('--out'));
  }
  assert.deepEqual(query('familysearch.image', '').candidates, ['download', 'get', 'transcript']);
  assert.deepEqual(query('familysearch.film', 'im').candidates, ['image', 'images']);
  assert.deepEqual(query('ancestry.record', 'search', '--birth-').candidates, ['--birth-place', '--birth-year']);
  assert.deepEqual(query('geneanet.record', 'search', '--event', 'b').candidates, ['birth']);
  assert.deepEqual(query('myheritage.record', 'search', '--gender', '').candidates, ['F', 'M']);
  assert.deepEqual(query('geneanet.record', 'search', '--event=b').candidates, ['--event=birth']);
  assert.deepEqual(query('geneanet.record', 'search', '--event', '=', 'b').candidates, ['birth']);
  assert.deepEqual(query('findagrave.photo.request', 'list', '--scope', 'v').candidates, ['volunteer']);
  assert.deepEqual(query('cli.completion', 'install', '--shell', '').candidates, ['bash', 'zsh']);
  for (const words of [['ancestry.record', 'search', '--first-name', ''], ['ancestry.record', 'search', '--', '--'], ['toString', ''], ['ancestry.record', 'search', '--unknown', '']]) assert.equal(query(...words).kind, 'none', words.join(' '));

  for (const words of [['ancestry.tree', 'list', '--out', 'a b'], ['myheritage.session', 'login', '--har', 'a b'],
    ['familysearch.api', 'call', '--input', 'a b'], ['findmypast.api.gql', 'execute', '--document', 'a b'],
    ['geneanet.record', 'search', '--input', 'a b'], ['geneanet.record', 'search', '--out=a b']]) {
    const result = query(...words);
    assert.equal(result.kind, 'files', words.join(' '));
    assert.equal(result.prefix, 'a b');
  }
  const literal = '$(must-not-run); `also-not`';
  assert.equal(query('ancestry.tree', 'list', '--out', literal).prefix, literal);

  const flags = query('myheritage.record', 'search', '--').candidates;
  assert.ok(flags.includes('--first-name'));
  assert.deepEqual(query('myheritage.record', 'search', '').candidates.filter(flag => flag.startsWith('--')), flags);
  assert.ok(query('myheritage.record', 'search', '--first-name', 'Ada', '').candidates.includes('--last-name'));
  assert.ok(query('myheritage.record', 'search', '--exact', '').candidates.includes('--first-name'));
  assert.equal(query('myheritage.record', 'search', '--first-name', '').kind, 'none');
  assert.equal(query('myheritage.record', 'search', '--', '').kind, 'none');
  assert.equal(query('myheritage.record', 'search', 'Ada').kind, 'none');
  assert.equal(query('myheritage.record', 'search', 'Ada', '').kind, 'none');
  assert.equal(query('myheritage.record', 'unknown', '').kind, 'none');
  assert.deepEqual(query('myheritage.record', 'search', '--gender', '').candidates, ['F', 'M']);
  assert.equal(query('myheritage.record', 'search', '--out', '').kind, 'files');
  assert.ok(query('myheritage.record', '').candidates.includes('search'));
  assert.ok(query('myheritage.record', '').candidates.every(candidate => !candidate.startsWith('-')));
  for (const argument of ['value', 'file', ['one', 'two']] as ('value' | 'file' | string[])[]) {
    const result = complete({commands: {}, options: {'--help': {value: false}}, arguments: [argument]}, ['']);
    assert.ok(!result.candidates.includes('--help'));
  }
});

test('completion CLI runs outside the checkout without a profile when history is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-completion-'));
  try {
    const { stdout, stderr } = await run(process.execPath, [...sourceArgs, 'cli.completion', 'query', '--format', 'text', '--word=familysearch.image', '--word=d'], {
      cwd: directory, env: { ...process.env, FAM_CONFIG_DIR: join(directory, 'no-profile'), FAM_HISTORY: '0', FAM_CREDENTIALS_COMMAND: '["must-not-run"]' },
    });
    assert.equal(stdout, 'words\nd\ndownload\n');
    assert.equal(stderr, '');
    await assert.rejects(stat(join(directory, 'no-profile')), { code: 'ENOENT' });
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
    // The registry matrix above covers command variants; these exercise shell
    // boundaries: empty words, filenames containing spaces, and Readline's '='.
    assert.ok((await invoke(['myheritage.record', 'search', ''])).split('\n').includes('--first-name'));
    assert.equal(await invoke(['ancestry.tree', 'list', '--out=a']), 'a space.json\n');
    assert.equal(await invoke(['geneanet.record', 'search', '--event=b']), 'birth\n');
    const registration = (await run(shell, ['--noprofile', '--norc', '-c', `${completionScript('bash')}\nprintf '%s.%s\\n' "\${BASH_VERSINFO[0]}" "\${BASH_VERSINFO[1]}"\ncomplete -p fam`])).stdout;
    const [major, minor] = registration.split('\n')[0].split('.').map(Number);
    assert.equal(registration.includes('-o nosort'), major > 4 || (major === 4 && minor >= 4));
    assert.equal((await invoke(['cli.command', 'list', '--provider', ''])).split('\n')[0], 'familysearch');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native zsh completion passes candidates to compadd and delegates filenames', async t => {
  try { await run('zsh', ['--version']); } catch { t.skip('zsh unavailable'); return; }
  const script = `compdef() { :; }\n${completionScript('zsh')}\ncompadd() { print -rl -- "$@"; }\n_files() { print -r -- FILES; }\nwords=(${quote(cli)} familysearch.image d)\nCURRENT=3\n_fam_complete\nwords=(${quote(cli)} ancestry.tree list --out a)\nCURRENT=5\nPREFIX=a\n_fam_complete`;
  assert.equal((await run('zsh', ['-f', '-c', script])).stdout, '-Q\n-V\nfam\n--\ndownload\nFILES\n');
});
