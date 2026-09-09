import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {discoverOperations, describeOperation, operationGroups} from '../src/familysearch/discovery.js';
import {listOperations, prepareOperation} from '../src/familysearch/operations.js';
import type {OperationName} from '../src/familysearch/generated/operations.js';
import {searchCommands} from '../src/shared/command-search.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {complete, completionCatalog} from '../src/shared/completion.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR, maxBuffer: 8 * 1024 * 1024, timeout: 15000,
  env: {...process.env, FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]'},
});
const data = (stdout: string) => JSON.parse(stdout).data;

test('lexical discovery finds genealogy operations and preserves executable command identities', async () => {
  assert.equal(((await searchCommands('memories.search', {provider: 'familysearch', lexical: true})).results[0] as {operation?: string}).operation, 'memories.search');
  for (const [query, expected] of [
    ['find memories', 'memories.search'], ['merge duplicate people', 'persons.merge'],
    ['undo merge', 'history.undoMerge'], ['attach source', 'sources.attach'],
    ['family groups', 'groups.list'], ['record hints', 'hints.recordMatches'],
  ]) {
    const result = await searchCommands(query, {provider: 'familysearch', lexical: true});
    const match = result.results.find(item => 'operation' in item && item.operation === expected);
    assert.ok(match, `${query}: ${result.results.map(item => 'operation' in item ? item.operation : item.command)}`);
    assert.equal(match.command, 'familysearch.api call');
    assert.equal(match.prefilledFlags.operation, expected);
    assert.equal(match.describe, `fam familysearch.api describe --operation ${expected}`);
    assert.equal(parseInvocation(match.argv).values.operation, expected);
  }
  const merge = (await searchCommands('persons.merge', {provider: 'familysearch', limit: 100, lexical: true})).results.find(item => 'operation' in item && item.operation === 'persons.merge')!;
  assert.equal(merge.risk.level, 'write');
  assert.equal(merge.ready, false);
  assert.ok(merge.missingFlags.includes('input'));
  assert.ok(discoverOperations('duplicate people').some(op => op.name === 'persons.merge'));
  assert.ok((await searchCommands('find memories', {provider: 'ancestry', lexical: true})).results.every(item => !('operation' in item)));
});

test('every implemented operation has discoverable descriptions, valid examples, and locally resolvable schemas', () => {
  const names = listOperations().map(op => op.name).sort();
  assert.deepEqual(discoverOperations().map(op => op.name).sort(), names);
  assert.equal(operationGroups.reduce((n, group) => n + group.count, 0), names.length);
  for (const name of names) {
    const description = describeOperation(name);
    assert.ok(description.description.length > 15, name);
    prepareOperation(name as OperationName, description.example);
    for (const schema of [description.inputSchema, description.outputSchema]) {
      const resolveRefs = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        if ('$ref' in value) {
          const pointer = String(value.$ref).replace(/^#\//, '').split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
          let target: any = schema;
          for (const key of pointer) target = target?.[key];
          assert.ok(target, `${name}: ${value.$ref}`);
        }
        for (const child of Object.values(value)) resolveRefs(child);
      };
      resolveRefs(schema);
    }
  }
  assert.equal(describeOperation('search.results').risk.level, 'read'); // POST search is a read.
  assert.equal(describeOperation('persons.merge').risk.level, 'write');
  assert.ok(describeOperation('memories.upload').limitations.some(note => /TypeScript/.test(note)));
  assert.ok(describeOperation('hints.recordMatches').responseOptional);
  const first = describeOperation('persons.get');
  first.inputSchema.properties.pid = {type: 'number'};
  assert.equal(describeOperation('persons.get').inputSchema.properties.pid.type, 'string');
});

test('provider help, operation help, search, and examples work outside the checkout without credentials', async () => {
  const provider = (await invoke('familysearch', '--help')).stdout;
  assert.match(provider, /Genealogy API operations \(212\)/);
  assert.match(provider, /memories \(32\)/);
  const help = (await invoke('familysearch.api', 'call', '--operation', 'persons.merge', '--help')).stdout;
  assert.match(help, /Effects: WRITE/);
  assert.match(help, /survivorId: string \(required\)/);
  assert.match(help, /Example input/);
  const result = data((await invoke('familysearch.api', 'describe', '--operation', 'memories.search', '--json')).stdout);
  assert.ok(result.outputSchema.$defs);
  assert.equal(result.inputSchema.properties.query.properties.searchTerms.type, 'string');
  assert.ok(result.example.query.searchTerms);
  const search = (await invoke('cli.command', 'search', '--lexical', '--format', 'text', '--query', 'find memories', '--provider', 'familysearch')).stdout;
  assert.match(search, /--operation memories.search/);
  assert.match(search, /Inspect: fam familysearch.api describe/);
  const file = join(CREDENTIAL_DIR, 'discovery-example.json');
  await invoke('familysearch.api', 'describe', '--operation', 'memories.search', '--example', '--out', file);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), result.example);
  const helpJson = JSON.parse((await invoke('familysearch.api', 'call', '--operation', 'persons.merge', '--help', '--json')).stdout);
  assert.equal(helpJson.name, 'persons.merge');
});

test('shell completion exposes every supported operation without inventing unavailable ones', () => {
  const catalog = completionCatalog();
  for (const action of ['call', 'describe']) {
    const all = complete(catalog, ['familysearch.api', action, '--operation', '']).candidates;
    assert.deepEqual(all, listOperations().map(op => op.name).sort());
    assert.ok(!all.includes('trees.switch'));
    assert.deepEqual(complete(catalog, ['familysearch.api', action, '--operation=memories.se']).candidates, ['--operation=memories.search', '--operation=memories.setDatePlace']);
  }
});
