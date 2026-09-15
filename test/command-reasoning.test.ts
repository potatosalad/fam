import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {commands} from '../src/shared/command-registry.js';
import {extractReasoning} from '../src/shared/command-reasoning.js';
import {parseInvocation, parseNamespaceHelp, describe, help} from '../src/shared/command-runtime.js';
import {complete, completionCatalog} from '../src/shared/completion.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (directory: string, args: string[], env = {}) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: directory, timeout: 15_000, env: {...process.env, FAM_CONFIG_DIR: directory, ...env},
});

test('reasoning can occur at every argument boundary and never reaches provider bindings', () => {
  const args = ['ancestry.person', 'get', '--tree-id', 'fixture-tree', '--person-id', 'fixture-person', '--json'];
  const expected = parseInvocation(args);
  for (let index = 0; index <= args.length; index++) for (const option of [['--reasoning', '  Compare birthplace.\nThen choose a census.  '], ['--reasoning=Compare birthplace.']]) {
    const input = [...args.slice(0, index), ...option, ...args.slice(index)];
    const parsed = parseInvocation(input);
    assert.deepEqual(parsed.args, expected.args);
    assert.equal(parsed.command, expected.command);
    assert.deepEqual({...parsed.values}, {...expected.values, reasoning: [option.length === 2 ? option[1] : 'Compare birthplace.']});
    assert.deepEqual(input, [...args.slice(0, index), ...option, ...args.slice(index)]);
  }
  for (const command of commands) {
    const parsed = parseInvocation([...command.id.split(' '), '--help', '--reasoning', 'Inspect command inputs.']);
    assert.deepEqual(parsed.values.reasoning, ['Inspect command inputs.']);
    assert.ok(!parsed.args.includes('--reasoning'), command.id);
    assert.ok(describe(command).flags.some(flag => flag.name === 'reasoning' && flag.multiple), command.id);
    assert.match(help(command), /--reasoning/);
  }
});

test('repeated reasoning preserves all values in order, including duplicates and literal option text', () => {
  const parsed = parseInvocation(['--reasoning', 'First', 'cli.version', '--reasoning=Second', 'get', '--reasoning', 'First', '--reasoning=--json']);
  assert.deepEqual(parsed.values.reasoning, ['First', 'Second', 'First', '--json']);
  assert.deepEqual(parsed.args, ['version']);
  assert.deepEqual(extractReasoning(['--reasoning', 'why', '--', '--reasoning', 'literal']), {args: ['--', '--reasoning', 'literal'], reasoning: ['why']});
  const words = ['cli.completion', 'query', '--word=--reasoning', '--word=--reasoning=literal'];
  assert.deepEqual(extractReasoning(words), {args: words, reasoning: []});
  assert.deepEqual(parseInvocation(words).values.word, ['--reasoning', '--reasoning=literal']);
});

test('reasoning is available on namespace help and completion at any depth', () => {
  const catalog = completionCatalog();
  assert.match(help(), /--reasoning/);
  for (const name of ['cli', 'ancestry', 'ancestry.person', 'cli.history.failures']) {
    assert.equal(parseNamespaceHelp(['--reasoning', 'Inspect namespace.', name])?.namespace.name, name);
    assert.equal(parseNamespaceHelp([name, '--json', '--reasoning=Inspect namespace.'])?.json, true);
    assert.ok(complete(catalog, [name, '--rea']).candidates.includes('--reasoning'));
  }
  assert.ok(complete(catalog, ['--rea']).candidates.includes('--reasoning'));
  assert.ok(complete(catalog, ['ancestry.person', 'get', '--rea']).candidates.includes('--reasoning'));
  assert.ok(complete(catalog, ['--reasoning', 'why', 'ancestry.person', '--reasoning=again', 'g']).candidates.includes('get'));
  assert.equal(complete(catalog, ['cli.version', 'get', '--reasoning', '']).kind, 'none');
});

test('entry point handles reasoning before, within and after commands, help and shortcuts', async () => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'reasoning-dispatch-'));
  const cases = [
    [], ['--help'], ['--version', '--json'], ['--completions', 'bash'], ['--completions=zsh'],
    ['ancestry'], ['ancestry.person', '--json'], ['ancestry.person', 'get', '--help'],
    ['doctor', '--provider', 'ancestry', '--offline', '--dry-run', '--json'],
    ['update', '--help'], ['browser', 'use', 'local', '--dry-run', '--json'],
    ['browser.transport', 'list', '--help'],
  ];
  for (const args of cases) {
    // Inserting at every boundary also covers between --completions and its shell,
    // between provider flags and values, and the positional browser shorthand.
    const input = args.flatMap((arg, index) => ['--reasoning', `Boundary ${index}`, arg]);
    input.push('--reasoning=Last boundary');
    const result = await invoke(directory, input, {FAM_HISTORY: '0'});
    assert.equal(result.stderr, '', args.join(' '));
    assert.ok(result.stdout.length > 0);
    if (args.includes('--dry-run')) assert.deepEqual(JSON.parse(result.stdout).data.flags.reasoning,
      [...args.map((_, index) => `Boundary ${index}`), 'Last boundary']);
  }
});

test('history records all reasons verbatim on start and finish, including later usage errors', async () => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'reasoning-history-'));
  const reasoning = ['  First purpose.\nWith context.  ', 'Second purpose', 'First purpose.'];
  const args = ['--reasoning', reasoning[0], 'cli.version', '--reasoning=' + reasoning[1], 'get', '--json', '--reasoning', reasoning[2]];
  assert.equal(JSON.parse((await invoke(directory, args)).stdout).ok, true);
  await assert.rejects(invoke(directory, ['ancestry.person', '--reasoning', 'Explain a failing lookup.', 'get', '--json']), (error: any) => {
    assert.equal(error.code, 2); assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_ARGUMENT'); return true;
  });
  await invoke(directory, ['--version']);
  const history = join(directory, 'history');
  const records = (await Promise.all((await readdir(history)).filter(name => name.endsWith('.jsonl')).map(name => readFile(join(history, name), 'utf8'))))
    .join('').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(records.map(row => row.reasoning), [reasoning, reasoning, ['Explain a failing lookup.'], ['Explain a failing lookup.'], [], []]);
  assert.deepEqual(records[0].argv, args); assert.deepEqual(records[1].argv, args);
  assert.equal(records[3].command, 'ancestry.person get'); assert.equal(records[3].outcome, 'hard_failure');
  const list = JSON.parse((await invoke(directory, ['cli.history', 'list', '--query', 'Second purpose', '--json', '--reasoning', 'Review purpose capture.'])).stdout);
  assert.deepEqual(list.data.entries.map((row: any) => row.reasoning), [reasoning]);
});

test('missing and blank reasoning are usage errors with structured errors and history', async () => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'reasoning-invalid-'));
  for (const option of [['--reasoning'], ['--reasoning='], ['--reasoning', ' \n\t '], ['--reasoning', '--json']]) {
    await assert.rejects(invoke(directory, ['cli.version', 'get', '--json', ...option]), (error: any) => {
      assert.equal(error.code, 2);
      const result = JSON.parse(error.stderr);
      assert.equal(result.error.code, 'INVALID_ARGUMENT'); assert.match(result.error.message, /--reasoning requires non-empty text/);
      return true;
    });
  }
  await assert.rejects(invoke(directory, ['--reasoning=--json', 'not-a-command']), (error: any) => {
    assert.equal(error.code, 2); assert.match(error.stderr, /^Error:/); return true;
  });
});
