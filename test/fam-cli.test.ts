import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {commands, providerNames, authenticatedProviderNames} from '../src/shared/command-registry.js';
import {parseInvocation, parseNamespaceHelp} from '../src/shared/command-runtime.js';
import {lookupFailure, namespaceInfo} from '../src/shared/command-navigation.js';
import {searchCommands, resolveContext} from '../src/shared/command-search.js';
import {renderData} from '../src/shared/command-output.js';
import {complete, completionCatalog, completionScript} from '../src/shared/completion.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR, maxBuffer: 8 * 1024 * 1024, timeout: 15000,
  env: {...process.env, FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]'},
});
const data = (stdout: string) => JSON.parse(stdout).data;

test('--version reports the running version and installation outside the checkout', async () => {
  const version = await invoke('--version');
  assert.equal(version.stdout, (await invoke('cli.version', 'get')).stdout);
  assert.match(version.stdout, /^fam \d+\.\d+\.\d+\nInstalled from: Git checkout\nInstallation: .+\nRunning source: .+\/src\n$/);
  const result = JSON.parse((await invoke('--version', '--json')).stdout);
  assert.equal(result.command, 'cli.version get');
  assert.equal(result.data.installation.type, 'git');
  assert.equal(result.data.runtime.type, 'source');
  assert.ok(complete(completionCatalog(), ['--v']).candidates.includes('--version'));
  await assert.rejects(invoke('--version', 'extra'), error => (error as {code: number}).code === 2);
});

test('cli.update shorthand exposes the registered update help and completion', async () => {
  const help = (await invoke('cli.update', '--help')).stdout;
  assert.equal(help, (await invoke('cli.update', 'run', '--help')).stdout);
  assert.match(help, /npm|Git/);
  assert.equal(data((await invoke('cli.command', 'describe', '--command', 'cli.update run', '--json')).stdout).id, 'cli.update run');
  assert.ok(complete(completionCatalog(), ['cli.update', '']).candidates.includes('run'));
  await assert.rejects(invoke('cli.update', '--invalid'), error => (error as {code: number}).code === 2);
});

test('bare fam and --help show a task-oriented overview; completion shortcuts print shell scripts', async () => {
  const overview = (await invoke()).stdout;
  assert.equal(overview, (await invoke('--help')).stdout);
  for (const text of ['fam - Genealogy CLI', 'Available providers:', 'Common tasks:', 'Global options', 'Find a command:',
    'Inspect command options:', 'fam cli.provider list', '--completions <SHELL>']) assert.ok(overview.includes(text), text);
  for (const provider of providerNames) assert.match(overview, new RegExp(`^  ${provider} +\\S`, 'm'));
  for (const shell of ['bash', 'zsh']) {
    const script = (await invoke('--completions', shell)).stdout;
    assert.equal(script, completionScript(shell));
  }
  assert.equal((await invoke('--completions=zsh')).stdout, completionScript('zsh'));
  assert.deepEqual(complete(completionCatalog(), ['--completions', '']).candidates, ['bash', 'zsh']);
  await assert.rejects(invoke('--completions', 'fish'), error => {
    const e = error as {code: number; stderr: string};
    assert.equal(e.code, 2); assert.match(e.stderr, /Use --completions bash or --completions zsh/); return true;
  });
});

test('discovery is readable by default even in a pipe; --json preserves the machine contract', async () => {
  const list = (await invoke('cli.command', 'list', '--provider', 'ancestry')).stdout;
  assert.match(list, /Ancestry \(\d+\)/); assert.match(list, /ancestry\.record search/);
  assert.doesNotMatch(list, /"schemaVersion"|"description":/);
  const json = JSON.parse((await invoke('cli.command', 'list', '--provider', 'ancestry', '--json')).stdout);
  assert.equal(json.ok, true); assert.equal(json.schemaVersion, 1);
  assert.ok(json.data.every((item: {command: string}) => item.command.startsWith('ancestry.')));
  const search = (await invoke('cli.command', 'search', '--lexical', '--format', 'text', '--query', 'download original image', '--provider', 'familysearch', '--limit', '1')).stdout;
  assert.match(search, /fam familysearch\.image download/); assert.match(search, /Needs: --ark, --out/); assert.match(search, /More: fam cli\.command search/);
  const description = (await invoke('cli.command', 'describe', '--command', 'familysearch.image download')).stdout;
  assert.match(description, /^command: familysearch\.image download\n/);
  assert.match(description, /  provider: familysearch\n  object_type: image\n  action: download/);
  assert.match(description, /  operation_type: READ/); assert.match(description, /  confirmation_requirement: NONE/);
  assert.match(description, /  options:\n/); assert.match(description, /--ark <string>\s+Required\./); assert.match(description, /  examples:\n/);
  assert.match((await invoke('cli.provider', 'list')).stdout, /Available providers/);
  assert.match((await invoke('cli.version', 'get')).stdout, /^fam \d+\.\d+\.\d+\nInstalled from: Git checkout\nInstallation: /);
  await assert.rejects(invoke('ancestry.person', 'get'), error => {
    const e = error as {code: number; stderr: string};
    assert.equal(e.code, 2); assert.match(e.stderr, /^Error: Missing required flag/); assert.match(e.stderr, /Try: fam ancestry\.person get/); return true;
  });
});

test('provider and object prefixes show local help, including nested groups and JSON inspection', async () => {
  const overview = (await invoke('ancestry')).stdout;
  assert.equal(overview, (await invoke('ancestry', '--help')).stdout);
  for (const expected of ['ancestry - Ancestry', 'Usage: fam ancestry.<object> <action> [options]',
    'Available object types (', 'ancestry.person', 'ancestry.api.gql', 'Documentation:', 'Suggested next commands']) assert.ok(overview.includes(expected), expected);
  const object = (await invoke('ancestry.person', '--help')).stdout;
  assert.equal(object, (await invoke('ancestry.person')).stdout);
  assert.match(object, /Available actions/); assert.match(object, /ancestry\.person get/); assert.match(object, /--tree-id \(required\)/);
  const nested = data((await invoke('ancestry.api', '--json')).stdout);
  assert.equal(nested.kind, 'object'); assert.ok(nested.objects.some((o: {name: string}) => o.name === 'ancestry.api.gql'));
  assert.ok(nested.actions.some((c: {command: string}) => c.command === 'ancestry.api list'));
  assert.match((await invoke('ancestry.api.gql', '-h')).stdout, /ancestry\.api\.gql query/);
  for (const provider of [...providerNames, 'cli']) {
    assert.equal(namespaceInfo(provider)?.kind, 'provider');
    for (const object of namespaceInfo(provider)!.objects) assert.ok(namespaceInfo(object.name));
  }
  assert.deepEqual(complete(completionCatalog(), ['ancestry.person', '--']).candidates, ['--help', '--json']);
  assert.throws(() => parseNamespaceHelp(['ancestry', '--capture']), /Unknown option/);
  assert.throws(() => parseNamespaceHelp(['ancestry', '--help', 'tree']), /Unexpected argument/);
});

test('unknown providers, objects, actions and describe targets suggest registered commands without execution', async () => {
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
  await assert.rejects(invoke('ancestry.perosn', 'get'), error => {
    const e = error as {code: number; stdout: string; stderr: string};
    assert.equal(e.code, 2); assert.equal(e.stdout, '');
    for (const expected of ['"perosn" is not a valid object type for provider "ancestry"', 'Available object types', 'ancestry.person', 'Did you mean?', 'fam ancestry.person get']) assert.ok(e.stderr.includes(expected), expected);
    return true;
  });
  for (const args of [['ancestry.person', 'gte'], ['cli.command', 'describe', '--command', 'ancestry.person gte']]) {
    await assert.rejects(invoke(...args, '--json'), error => {
      const e = error as {code: number; stdout: string; stderr: string};
      assert.equal(e.code, 2); assert.equal(e.stdout, '');
      const result = JSON.parse(e.stderr);
      assert.equal(result.ok, false); assert.equal(result.error.suggestions[0].command, 'ancestry.person get');
      assert.ok(result.error.available.some((a: {name: string}) => a.name === 'ancestry.person get'));
      return true;
    });
  }
});

test('human provider output retains nested results and exact IDs', async () => {
  const result = (await invoke('ancestry.session', 'get')).stdout;
  assert.ok(result.includes(`Credential Directory: ${CREDENTIAL_DIR}`));
  assert.doesNotMatch(result, /"schemaVersion"/);
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

test('browser capture remains discoverable and rejects invalid modes before launch', async () => {
  for (const provider of ['myheritage', 'findmypast']) {
    assert.match((await invoke(`${provider}.session`, 'login', '--help')).stdout, /--capture/);
    assert.equal(data((await invoke(`${provider}.session`, 'login', '--capture', '--capture-timeout', '0', '--dry-run', '--json')).stdout).flags['capture-timeout'], 0);
    for (const args of [['get', '--capture'], ['login', '--capture', '--har', 'missing.har'],
      ['login', '--browser-channel', 'chrome'], ['login', '--capture', '--capture-timeout', '-1'],
      ['login', '--capture', '--browser-channel', 'invalid']]) await assert.rejects(invoke(`${provider}.session`, ...args));
  }
  await assert.rejects(invoke('findmypast.session', 'login', '--capture', '--browser'), /one at a time/);
  await assert.rejects(invoke('myheritage.session', 'login', '--capture', '--code', '123456'), /one at a time/);
  await assert.rejects(invoke('myheritage.session', 'login', '--capture', '--tree-url', 'https://evil.example/family-trees/fixture'), /family-tree/);
});

test('offline provider status and catalogs work outside the checkout without credential lookup', async () => {
  assert.match((await invoke('--help')).stdout, /fam <provider>\.<object>/);
  assert.match(data((await invoke('cli.version', 'get', '--json')).stdout).version, /^\d+\.\d+\.\d+$/);
  for (const provider of authenticatedProviderNames) {
    assert.equal(data((await invoke(`${provider}.session`, 'get', '--json')).stdout).credentialDirectory, CREDENTIAL_DIR);
    assert.ok(data((await invoke(`${provider}.api`, 'list', '--json')).stdout).length > 0);
  }
  const file = join(CREDENTIAL_DIR, 'status-output.json');
  assert.equal(data((await invoke('ancestry.session', 'get', '--out', file, '--json')).stdout).saved, file);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).credentialDirectory, CREDENTIAL_DIR);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('discovery and dry-run need no profile; usage errors are structured and actionable', async () => {
  const schema = data((await invoke('cli.command', 'describe', '--command', 'familysearch.image download', '--json')).stdout);
  assert.equal(schema.flags.find((f: any) => f.name === 'ark').required, true);
  assert.equal(schema.schemaMode, 'advisory');
  const plan = data((await invoke('ancestry.api.gql', 'query', '--operation', 'UnknownMutation', '--dry-run', '--json')).stdout);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.risk.level, 'operation-dependent');
  for (const args of [['ancestry', 'trees'], ['ancestry.person', 'get'], ['ancestry.record', 'search', '--limit', 'oops'],
    ['familysearch.image', 'download', '--ark', '3:1:TEST'], ['toString', 'get']]) {
    await assert.rejects(invoke(...args, '--json'), error => {
      const e = error as {code: number; stdout: string; stderr: string};
      assert.equal(e.code, 2); assert.equal(e.stdout, '');
      const failure = JSON.parse(e.stderr); assert.equal(failure.ok, false); assert.ok(failure.error.suggestedInvocation);
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
  ]) assert.ok((await searchCommands(query, {provider, lexical: true})).results.some(r => r.command === expected), `${query}: ${(await searchCommands(query, {provider, lexical: true})).results.map(r => r.command)}`);
  const found = await searchCommands('download original image', {lexical: true, context: 'https://www.familysearch.org/ark:/61903/3:1:TEST'});
  const download = found.results.find(r => r.command === 'familysearch.image download')!;
  assert.equal(download.prefilledFlags.ark, '3:1:TEST'); assert.deepEqual(download.missingFlags, ['out']); assert.equal(download.ready, false);
  assert.deepEqual(resolveContext('9223372036854775807').flags, {});
  assert.deepEqual(resolveContext('https://www.familysearch.org.evil.example/ark:/61903/3:1:TEST').flags, {});
  assert.deepEqual(await searchCommands('download original image', {lexical: true}), await searchCommands('download original image', {lexical: true}));
});
