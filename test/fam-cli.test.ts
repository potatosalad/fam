import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {commands, commandById, providerNames, authenticatedProviderNames} from '../src/shared/command-registry.js';
import {parseInvocation, parseNamespaceHelp, describe, help, UsageError} from '../src/shared/command-runtime.js';
import {lookupFailure, namespaceInfo} from '../src/shared/command-navigation.js';
import {searchCommands, resolveContext} from '../src/shared/command-search.js';
import {renderData, humanOutput, namespaceHelp, commandError, wantsJson} from '../src/shared/command-output.js';
import {complete, completionCatalog, completionScript} from '../src/shared/completion.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
// Keep process launches for entry-point shortcuts. Exercise detailed behavior directly.
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR, maxBuffer: 8 * 1024 * 1024, timeout: 15000,
  env: {...process.env, FAM_HISTORY: '0', FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]'},
});
const catalog = completionCatalog();
const command = (id: string) => commandById.get(id)!;
async function providerInvoke(...args: string[]) {
  const invocation = parseInvocation(args);
  const {runProvider} = await import(`../src/${invocation.command.provider}/cli.js`);
  return runProvider(invocation.args);
}

test('entry-point shortcuts work outside the checkout and preserve JSON output', async () => {
  const [version, update, completion] = await Promise.all([
    invoke('--version', '--json'), invoke('cli.update', '--help'), invoke('--completions=zsh'),
  ]);
  const result = JSON.parse(version.stdout);
  assert.equal(result.ok, true); assert.equal(result.schemaVersion, 1);
  assert.equal(result.command, 'cli.version get');
  assert.match(result.data.version, /^\d+\.\d+\.\d+$/);
  assert.equal(result.data.installation.type, 'git');
  assert.equal(result.data.runtime.type, 'source');
  assert.equal(update.stdout, help(command('cli.update run')));
  assert.equal(completion.stdout, completionScript('zsh'));
  for (const response of [version, update, completion]) assert.equal(response.stderr, '');
  assert.ok(complete(catalog, ['--v']).candidates.includes('--version'));
  assert.ok(complete(catalog, ['cli.update', '']).candidates.includes('run'));
});

test('doctor shorthand preserves health flags and canonical identity', async () => {
  const result = JSON.parse((await invoke('doctor', '--provider', 'ancestry', '--no-pretty', '--dry-run', '--json')).stdout);
  assert.equal(result.command, 'cli.health check');
  assert.equal(result.data.dryRun, true);
  assert.equal(result.data.flags.live, true);
  assert.equal(result.data.flags['no-pretty'], true);
  assert.match(help(command('cli.health check')), /--no-pretty/);
  assert.equal(parseInvocation(['cli.health', 'check', '--no-fix']).values['no-fix'], true);
  assert.match(help(command('cli.health check')), /--no-fix/);
  assert.ok(complete(catalog, ['doc']).candidates.includes('doctor'));
  assert.ok(complete(catalog, ['doctor', '']).candidates.includes('--no-pretty'));
  assert.ok(complete(catalog, ['doctor', '']).candidates.includes('--no-fix'));
  assert.deepEqual(complete(catalog, ['doctor', '--provider', 'anc']).candidates, ['ancestry']);
  for (const flag of ['--bogus', '--no-pretty=yes'])
    assert.throws(() => parseInvocation(['cli.health', 'check', flag]), UsageError);
});

test('overview presents providers, useful tasks, and completion shortcuts', () => {
  const overview = help();
  for (const text of ['fam - Genealogy CLI', 'Available providers:', 'Common tasks:', 'Global options', 'Find a command:',
    'Inspect command options:', 'fam cli.provider list', '--completions <SHELL>']) assert.ok(overview.includes(text), text);
  for (const provider of providerNames) assert.match(overview, new RegExp(`^  ${provider} +\\S`, 'm'));
  assert.deepEqual(complete(catalog, ['--completions', '']).candidates, ['bash', 'zsh']);
});

test('discovery renders readable results and actionable command details', async () => {
  const list = humanOutput(command('cli.command list'), commands.filter(c => c.provider === 'ancestry').map(c => ({command: c.id, description: c.description})), {});
  assert.match(list, /Ancestry \(\d+\)/); assert.match(list, /ancestry\.record search/);
  assert.doesNotMatch(list, /"schemaVersion"|"description":/);
  assert.equal(wantsJson({}), false); assert.equal(wantsJson({json: true}), true);
  assert.equal(wantsJson({format: 'json'}), true);
  const found = await searchCommands('download original image', {provider: 'familysearch', lexical: true, limit: 1});
  const search = humanOutput(command('cli.command search'), found, {format: 'text', limit: 1});
  assert.match(search, /fam familysearch\.image download/); assert.match(search, /Needs: --ark, --out/); assert.match(search, /More: fam cli\.command search/);
  const description = humanOutput(command('cli.command describe'), describe(command('familysearch.image download')), {});
  assert.match(description, /^command: familysearch\.image download\n/);
  assert.match(description, /  provider: familysearch\n  object_type: image\n  action: download/);
  assert.match(description, /  operation_type: READ/); assert.match(description, /  confirmation_requirement: NONE/);
  assert.match(description, /--ark <string>\s+Required\./); assert.match(description, /  examples:\n/);
});

test('provider and object prefixes expose local help and nested groups', () => {
  const provider = parseNamespaceHelp(['ancestry', '--help'])!;
  assert.deepEqual(provider, parseNamespaceHelp(['ancestry']));
  const overview = namespaceHelp(provider.namespace);
  for (const expected of ['ancestry - Ancestry', 'Usage: fam ancestry.<object> <action> [options]',
    'Available object types (', 'ancestry.person', 'ancestry.api.gql', 'Documentation:', 'Suggested next commands']) assert.ok(overview.includes(expected), expected);
  const object = namespaceHelp(parseNamespaceHelp(['ancestry.person'])!.namespace);
  assert.match(object, /Available actions/); assert.match(object, /ancestry\.person get/); assert.match(object, /--tree-id \(required\)/);
  const nested = parseNamespaceHelp(['ancestry.api', '--json'])!;
  assert.equal(nested.json, true); assert.equal(nested.namespace.kind, 'object');
  assert.ok(nested.namespace.objects.some(o => o.name === 'ancestry.api.gql'));
  assert.ok(nested.namespace.actions.some(c => c.command === 'ancestry.api list'));
  for (const provider of [...providerNames, 'cli']) {
    assert.equal(namespaceInfo(provider)?.kind, 'provider');
    for (const object of namespaceInfo(provider)!.objects) assert.ok(namespaceInfo(object.name));
  }
  assert.deepEqual(complete(catalog, ['ancestry.person', '--']).candidates, ['--help', '--json']);
  assert.throws(() => parseNamespaceHelp(['ancestry', '--capture']), /Unknown option/);
  assert.throws(() => parseNamespaceHelp(['ancestry', '--help', 'tree']), /Unexpected argument/);
});

test('unknown providers, objects and actions suggest registered commands without execution', () => {
  for (const [name, action, expected] of [
    ['ancesrty.person', 'get', 'ancestry.person get'], ['ancestry.perosn', 'get', 'ancestry.person get'],
    ['ancestry.person', 'gte', 'ancestry.person get'], ['ancestry.api.gq', 'query', 'ancestry.api.gql query'],
    ['ancestry', 'trees', 'ancestry.tree list'],
  ]) {
    const failure = lookupFailure(name, action);
    assert.equal(failure.suggestions[0].command, expected);
    for (const result of failure.suggestions) {
      const command = commands.find(c => c.id === result.command)!;
      assert.ok(command); assert.ok(result.options.every(f => command.flags.some(flag => flag.name === f.name)));
    }
  }
  assert.equal(namespaceInfo('toString'), undefined);
  assert.deepEqual(lookupFailure('nonsense').suggestions, []);
  const text = commandError(lookupFailure('ancestry.perosn', 'get'));
  for (const expected of ['"perosn" is not a valid object type for provider "ancestry"', 'Available object types', 'Did you mean?', 'fam ancestry.person get']) assert.ok(text.includes(expected), expected);
  assert.throws(() => parseInvocation(['ancestry.person', 'gte']), (error: unknown) => {
    assert.ok(error instanceof UsageError);
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.equal(error.navigation?.suggestions[0].command, 'ancestry.person get');
    assert.ok(error.navigation?.available.some(a => a.name === 'ancestry.person get'));
    return true;
  });
});

test('human provider output retains nested results and exact IDs', () => {
  const text = renderData({items: [{personId: 9223372036854775807n, alive: false}, {names: ['Ada', 'Lovelace']}], nextCursor: 'next-page'});
  for (const expected of ['Person Id: 9223372036854775807', 'Alive: no', 'Ada', 'Lovelace', 'Next Cursor: next-page']) assert.ok(text.includes(expected), text);
});

test('every old provider command has a unique registered mapping', async () => {
  const before = JSON.parse(await readFile(new URL('fixtures/cli-before-migration.json', import.meta.url), 'utf8'));
  assert.equal(new Set(commands.map(c => c.id)).size, commands.length);
  for (const command of commands) {
    assert.match(command.id, /^[a-z]+\.[a-z-]+(?:\.[a-z-]+)* [a-z-]+$/);
    assert.equal(new Set(command.flags.map(f => f.name)).size, command.flags.length, command.id);
    assert.ok(command.description && command.examples.length && command.outputSchema && command.risk);
    assert.ok(!command.flags.some(f => f.name === 'confirm'));
  }
  for (const provider of providerNames) for (const old of before[provider]?.commands ?? []) {
    assert.equal(commands.filter(c => c.provider === provider && c.binding.command.join(' ') === old).length, 1, `${provider} ${old}`);
  }
});

test('named flags preserve existing provider inputs, repeated values, and large IDs', () => {
  assert.deepEqual(parseInvocation(['ancestry.person', 'get', '--tree-id', '001', '--person-id', '9223372036854775807']).args,
    ['person', '001', '9223372036854775807']);
  assert.deepEqual(parseInvocation(['ancestry.api.gql', 'query', '--operation', 'GetTreeList', '--variables', '{"limit":20}']).args,
    ['gql', 'GetTreeList', '{"limit":20}']);
  assert.deepEqual(parseInvocation(['ancestry.record', 'search', '--first-name', 'Ada', '--last-name', 'Lovelace']).args,
    ['search', '--given', 'Ada', '--surname', 'Lovelace']);
  assert.deepEqual(parseInvocation(['findmypast.newspaper', 'search', '--name', 'Ada', '--name', 'Lovelace']).args,
    ['newspapers', '--name', 'Ada', '--name', 'Lovelace']);
});

test('browser capture rejects invalid modes through the parser and provider handlers', async () => {
  for (const provider of ['myheritage', 'findmypast']) {
    assert.match(help(command(`${provider}.session login`)), /--capture/);
    assert.equal(parseInvocation([`${provider}.session`, 'login', '--capture', '--capture-timeout', '0', '--dry-run']).values['capture-timeout'], 0);
    for (const args of [['get', '--capture'], ['login', '--capture', '--har', 'missing.har'],
      ['login', '--browser-channel', 'chrome'], ['login', '--capture', '--capture-timeout', '-1'],
      ['login', '--capture', '--browser-channel', 'invalid']]) await assert.rejects(providerInvoke(`${provider}.session`, ...args));
  }
  await assert.rejects(providerInvoke('findmypast.session', 'login', '--capture', '--browser'), /one at a time/);
  await assert.rejects(providerInvoke('myheritage.session', 'login', '--capture', '--code', '123456'), /one at a time/);
  await assert.rejects(providerInvoke('myheritage.session', 'login', '--capture', '--tree-url', 'https://evil.example/family-trees/fixture'), /family-tree/);
});

test('every provider exposes offline status and catalogs without credential lookup', async t => {
  const directory = process.cwd();
  const helper = process.env.FAM_CREDENTIALS_COMMAND;
  process.chdir(CREDENTIAL_DIR);
  process.env.FAM_CREDENTIALS_COMMAND = '["helper-must-never-run"]';
  t.after(() => {
    process.chdir(directory);
    if (helper === undefined) delete process.env.FAM_CREDENTIALS_COMMAND;
    else process.env.FAM_CREDENTIALS_COMMAND = helper;
  });
  for (const provider of authenticatedProviderNames) {
    assert.equal((await providerInvoke(`${provider}.session`, 'get')).credentialDirectory, CREDENTIAL_DIR);
    assert.ok((await providerInvoke(`${provider}.api`, 'list')).length > 0);
  }
  const file = join(CREDENTIAL_DIR, 'status-output.json');
  assert.equal((await providerInvoke('ancestry.session', 'get', '--out', file)).saved, file);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).credentialDirectory, CREDENTIAL_DIR);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('advisory schemas and usage errors retain required flags and actionable invocations', () => {
  const schema = describe(command('familysearch.image download'));
  assert.equal(schema.flags.find(f => f.name === 'ark')?.required, true);
  assert.equal(schema.schemaMode, 'advisory');
  const plan = parseInvocation(['ancestry.api.gql', 'query', '--operation', 'UnknownMutation', '--dry-run']);
  assert.equal(plan.values['dry-run'], true);
  assert.equal(plan.command.risk.level, 'operation-dependent');
  for (const args of [['ancestry', 'trees'], ['ancestry.person', 'get'], ['ancestry.record', 'search', '--limit', 'oops'],
    ['familysearch.image', 'download', '--ark', '3:1:TEST'], ['toString', 'get']]) {
    assert.throws(() => parseInvocation(args), (error: unknown) => {
      assert.ok(error instanceof UsageError);
      assert.ok(error.suggestedInvocation);
      return true;
    });
  }
});

test('lexical retrieval returns known commands and prefilled context without inventing arguments', async () => {
  for (const [query, provider, expected] of [
    ['download original image', 'familysearch', 'familysearch.image download'],
    ['OCR transcription of a scan', 'familysearch', 'familysearch.image transcript'],
    ['find a grave biography', 'findagrave', 'findagrave.memorial search'],
    ['authenticate session', 'myheritage', 'myheritage.session login'],
    ['historical newspapers', 'findmypast', 'findmypast.newspaper search'],
    ['inspect GraphQL contract', 'ancestry', 'ancestry.api describe'],
  ]) {
    const result = await searchCommands(query, {provider, lexical: true});
    assert.ok(result.results.some(r => r.command === expected), `${query}: ${result.results.map(r => r.command)}`);
  }
  const found = await searchCommands('download original image', {lexical: true, context: 'https://www.familysearch.org/ark:/61903/3:1:TEST'});
  const download = found.results.find(r => r.command === 'familysearch.image download')!;
  assert.equal(download.prefilledFlags.ark, '3:1:TEST'); assert.deepEqual(download.missingFlags, ['out']); assert.equal(download.ready, false);
  assert.deepEqual(resolveContext('9223372036854775807').flags, {});
  assert.deepEqual(resolveContext('https://www.familysearch.org.evil.example/ark:/61903/3:1:TEST').flags, {});
  assert.deepEqual(await searchCommands('download original image', {lexical: true}), await searchCommands('download original image', {lexical: true}));
});
