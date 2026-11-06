import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat, mkdir, chmod, writeFile, symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {InputError} from '../src/shared/input-error.js';
import {prepareCall} from '../src/storied/client.js';
import {operation} from '../src/storied/catalog.js';
import {join} from 'node:path';
import {FamilySearchClient} from '../src/familysearch/client.js';
import {runProvider} from '../src/familysearch/cli.js';
import {parseInvocation, help} from '../src/shared/command-runtime.js';
import {commandById} from '../src/shared/command-registry.js';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {NewspapersClient} from '../src/newspapers/client.js';
import {runProvider as runNewspapers} from '../src/newspapers/cli.js';
import {saveDownload} from '../src/newspapers/download.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args, '--reasoning', 'Verify local CLI validation without provider requests'],
  {env: {...process.env, FAM_HISTORY: '0'}, timeout: 15000}).catch(error => error);

test('Storied schema and path validation use the shared local InputError', () => {
  for (const input of [{path: {personId: 'not-a-uuid'}}, {path: {}}, {path: {personId: '../person'}},
    {path: {personId: '00000000-0000-0000-0000-000000000000'}, query: {unknown: 'value'}}])
    assert.throws(() => prepareCall(operation('person'), input), InputError);
});

test('malformed FamilySearch and Storied IDs and fulltext years exit as invalid arguments', async () => {
  for (const args of [
    ['familysearch.person', 'get', '--person-id', 'bad'],
    ['familysearch.person', 'ancestry', '--person-id', 'bad'],
    ['familysearch.person.mobile', 'get', '--person-id', 'bad'],
    ['familysearch.person.mobile', 'pedigree', '--person-id', 'bad'],
    ['familysearch.image', 'get', '--ark', '1:1:BAD'],
    ['familysearch.image', 'get', '--ark', 'https://['],
    ['familysearch.film', 'images', '--dgs', 'bad'],
    ['familysearch.record', 'get', '--ark', 'bad'],
    ['familysearch.fulltext', 'search', '--name', 'Example', '--years', '1809-1865'],
    ['familysearch.fulltext', 'search', '--name', 'Example', '--years', ':'],
    ['familysearch.fulltext', 'search', '--name', 'Example', '--years', ''],
    ['familysearch.collection', 'browse', '--collection', 'not-a-collection'],
    ['familysearch.collection', 'browse', '--collection', 'https://['],
    ['familysearch.fulltext', 'search', '--name', 'Example', '--years', '1900:1800'],
    ['storied.person', 'get', '--person-id', 'not-a-uuid'],
  ]) {
    assert.ok(commandById.has(args.slice(0, 2).join(' ')));
    const result = await invoke([...args, '--json']);
    assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).error.code, 'INVALID_ARGUMENT');
  }
});

test('validation error envelopes retain recognized commands, including normalized aliases', async () => {
  for (const [args, command] of [
    [['familysearch.person', 'get', '--json'], 'familysearch.person get'],
    [['familysearch.person', 'get', '--wat', '--json'], 'familysearch.person get'],
    [['familysearch.film', 'images', '--dgs', '123', '--count', '0', '--json'], 'familysearch.film images'],
    [['familysearch.image', 'transcript', '--ark', '3:1:TEST', '--json', '--format', 'text'], 'familysearch.image transcript'],
    [['familysearch.image', 'transcript', '--ark', '3:1:TEST', '--format', 'xml', '--json'], 'familysearch.image transcript'],
    [['--version', '--unknown', '--json'], 'cli.version get'],
    [['familysearch.person', 'get', '--json', '--errors', 'stdout'], 'familysearch.person get'],
    [['familysearch.person', 'unknown', '--json'], null],
  ] as const) {
    const result = await invoke([...args]);
    assert.equal(result.code, 2);
    const stdout = args.some(arg => arg === 'stdout');
    const envelope = JSON.parse(stdout ? result.stdout : result.stderr);
    assert.equal(envelope.command, command);
    assert.equal(envelope.error.code, 'INVALID_ARGUMENT');
    assert.equal(stdout ? result.stderr : result.stdout, '');
  }
});

test('FamilySearch film help documents offset continuation without advertising resume', () => {
  const command = commandById.get('familysearch.film images')!;
  assert.equal(command.flags.some(flag => flag.name === 'resume'), false);
  assert.match(command.pagination!.description, /--offset.*nextOffset/);
  assert.doesNotMatch(help(command), /--resume/);
  for (const id of ['familysearch.collection browse', 'familysearch.fulltext search'])
    assert.ok(commandById.get(id)!.flags.some(flag => flag.name === 'resume'));
});

test('FamilySearch fulltext help uses native record types and explicit year-range syntax', () => {
  const command = commandById.get('familysearch.fulltext search')!;
  const type = command.flags.find(flag => flag.name === 'record-type')!;
  assert.match(type.description, /FamilySearch.*service.*value/);
  assert.doesNotMatch(type.description, /MyHeritage|family-trees/);
  assert.equal(type.choices, undefined);
  const years = command.flags.find(flag => flag.name === 'years')!;
  assert.match(years.description, /FROM:TO.*FROM:.*:TO/);
  assert.match(help(command), /FROM:TO/);
});

test('FamilySearch and shared CLI output create private parents without changing existing directory permissions', async t => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'output-'));
  await chmod(directory, 0o755);
  const data = {id: 'synthetic-user'};
  t.mock.method(FamilySearchClient, 'open', async () => ({currentUser: async () => data,
    research: {imageTranscript: async () => ({...data, available: true, text: 'Transcript'})}} as any));
  try {
    for (const [name, args] of [
      ['account', ['familysearch.account', 'get']],
      ['json-transcript', ['familysearch.image', 'transcript', '--ark', '3:1:TEST', '--format', 'json']],
      ['text-transcript', ['familysearch.image', 'transcript', '--ark', '3:1:TEST', '--format', 'text']],
    ] as const) {
      const output = join(directory, name, 'nested', 'result');
      await runProvider(parseInvocation([...args, '--out', output]).args);
      assert.equal((await stat(output)).mode & 0o777, 0o600);
      for (const parent of [join(directory, name), join(directory, name, 'nested')])
        assert.equal((await stat(parent)).mode & 0o777, 0o700);
      if (name === 'account') assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), data);
    }
    const output = join(directory, 'cli', 'nested', 'result.json');
    const result = await invoke(['cli.version', 'get', '--json', '--out', output]);
    assert.equal(result.code, undefined, result.stderr);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).command, 'cli.version get');
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'cli', 'nested'))).mode & 0o777, 0o700);
    assert.equal((await stat(directory)).mode & 0o777, 0o755);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('Newspapers download collisions reject before opening a provider client for every download kind', async t => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'download-'));
  let opened = 0;
  t.mock.method(NewspapersClient, 'open', async () => {
    opened++;
    throw new Error('Provider must not be contacted');
  });
  try {
    for (const collision of ['image', 'sidecar', 'directory', 'symlink']) {
      const output = join(directory, `${collision}.jpg`);
      const existing = collision === 'sidecar' ? `${output}.json` : output;
      if (collision === 'directory') await mkdir(existing);
      else if (collision === 'symlink') await symlink(join(directory, 'missing'), existing);
      else await writeFile(existing, 'Do not replace');
      for (const command of ['download', 'article-download', 'clipping-download'])
        await assert.rejects(runNewspapers([command, '123', '--out', output]), {code: 'EEXIST'});
      assert.equal(opened, 0);
      // The saver enforces the same collision policy independently of the CLI.
      const before = (await readdir(directory)).sort();
      await assert.rejects(saveDownload(output, {bytes: new Uint8Array([1]), metadata: {}} as any), {code: 'EEXIST'});
      assert.deepEqual((await readdir(directory)).sort(), before);
      if (collision === 'image' || collision === 'sidecar') assert.equal(await readFile(existing, 'utf8'), 'Do not replace');
    }
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('transcript output honors JSON and text formats without doubling the JSON extension', async t => {
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'transcript-'));
  const data = {available: true, text: 'First line\nSecond line', machineGenerated: true};
  t.mock.method(FamilySearchClient, 'open', async () => ({research: {imageTranscript: async () => data}} as any));
  try {
    for (const flags of [['--format', 'json'], ['--json'], ['--format', 'text'], []]) {
      const name = `transcript-${flags.join('-') || 'default'}${flags.includes('json') || flags.includes('--json') ? '.json' : '.txt'}`;
      const output = join(directory, name);
      const invocation = parseInvocation(['familysearch.image', 'transcript', '--ark', '3:1:TEST', '--out', output, ...flags]);
      const receipt = await runProvider(invocation.args) as any;
      assert.equal(receipt.saved, output);
      if (name.endsWith('.json')) {
        assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), data);
        assert.equal(receipt.metadata, undefined);
        assert.ok(!(await readdir(directory)).includes(`${name}.json`));
      } else {
        assert.equal(await readFile(output, 'utf8'), `${data.text}\n`);
        assert.deepEqual(JSON.parse(await readFile(`${output}.json`, 'utf8')), data);
      }
      const original = await readFile(output, 'utf8');
      await assert.rejects(runProvider(invocation.args), {code: 'EEXIST'});
      assert.equal(await readFile(output, 'utf8'), original);
    }
    t.mock.method(FamilySearchClient, 'open', async () => ({research: {imageTranscript: async () => ({...data, available: false, text: ''})}} as any));
    const output = join(directory, 'unavailable.json');
    await runProvider(parseInvocation(['familysearch.image', 'transcript', '--ark', '3:1:TEST', '--format', 'json', '--out', output]).args);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).available, false);
  } finally {await rm(directory, {recursive: true, force: true});}
});
