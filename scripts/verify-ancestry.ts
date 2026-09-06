/** Read-only live smoke test. Personal responses stay in the ignored credentials directory. */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { AncestryClient, AncestryGraphQLError } from '../src/ancestry/client.js';
import { AncestryHttpError } from '../src/ancestry/http.js';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../src/storage.js';
import { stringifyJson } from '../src/json.js';

const client = await AncestryClient.open();
const report: {operation: string; ok: boolean; status?: number; error?: string}[] = [];
const directory = `${CREDENTIAL_DIR}/ancestry/verification`;
const selected = new Set(process.argv.slice(2));
await mkdir(directory, {recursive: true, mode: 0o700});
async function check<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
  if (selected.size && !selected.has(name)) {
    try { return JSON.parse(await readFile(`${directory}/${name}.json`, 'utf8')) as T; } catch { return undefined; }
  }
  try {
    const result = await run();
    await writeFile(`${directory}/${name.replace(/[^a-z0-9.-]/gi, '_')}.json`, stringifyJson(result ?? null, 2), {mode: 0o600});
    report.push({operation: name, ok: true}); console.log(`${name}: passed`);
    return result;
  } catch (error) {
    report.push({operation: name, ok: false, ...(error instanceof AncestryHttpError ? {status: error.status} : {}),
      error: error instanceof AncestryGraphQLError ? 'GraphQL errors' : error instanceof AncestryHttpError ? 'HTTP error' : 'Client error'});
    console.log(`${name}: failed (${report.at(-1)!.error}${report.at(-1)!.status ? ` ${report.at(-1)!.status}` : ''})`);
    if (error instanceof AncestryGraphQLError) await writeFile(`${directory}/${name}.errors.json`, stringifyJson(error.result, 2), {mode: 0o600});
    return undefined;
  }
}
await check('auth.refresh', async () => { await client.refresh(); return {refreshed: true}; });
const trees = await check('GetTreeList', () => client.trees(5));
const tree = trees?.trees.treeConnection.nodes[0];
if (!tree?.treeId || !tree.rootPersonId) throw new Error('Live verification needs an account tree with a root person.');
const treeId = String(tree.treeId), personId = String(tree.rootPersonId);
const path = {treeId, personId};
const queries = [
  ['GetTree', () => client.tree(treeId)],
  ['GetPersons', () => client.graphql('GetPersons', {treeId})],
  ['GetRecentlyModifiedPersons', () => client.graphql('GetRecentlyModifiedPersons', {treeId, limit: 5})],
  ['PersonNode', () => client.graphql('PersonNode', {treeId, personId})],
  ['persons.get', () => client.person(treeId, personId)],
  ['persons.relationships', () => client.relatives(treeId, personId)],
  ['persons.pedigree', () => client.call('persons.pedigree', {path, query: {genup: 2, gendown: 1, childLimit: 10}})],
  ['persons.research', () => client.research(treeId, personId)],
  ['persons.story', () => client.call('persons.story', {path})],
  ['persons.weblinks', () => client.call('persons.weblinks', {path})],
  ['trees.members', () => client.call('trees.members', {path})],
  ['GetPersonsHints', () => client.hints(treeId, personId, 5)],
  ['PersonMediaConnection', () => client.graphql('PersonMediaConnection', {treeId, personId})],
  ['media.forPerson', () => client.call('media.forPerson', {path: {treeid: treeId, personid: personId}, query: {limit: 5, page: 1}})],
  ['cache.citations', () => client.call('cache.citations', {path, query: {limit: 5, page: 1}})],
  ['cache.sources', () => client.call('cache.sources', {path, query: {limit: 5, page: 1}})],
  ['cache.persons', () => client.call('cache.persons', {path, query: {limit: 5, page: 1}})],
  ['citations.count', () => client.call('citations.count', {path})],
  ['places.search', () => client.call('places.search', {query: {prefix: 'Springfield', maxCount: 5, cultureId: 'en-US'}})],
  ['search.records', () => client.search({given: 'Abraham', surname: 'Lincoln', birthYear: 1809, limit: 5})],
] as const;
for (const [name, run] of queries) await check(name, run);
const search = JSON.parse(await readFile(`${directory}/search.records.json`, 'utf8'));
if (search.Status !== 'Successful' || !search.RecordView?.Records?.length) throw new Error('Search verification returned no successful historical records.');
const [recordId, collectionId] = String(search.RecordView.Records[0].Gid.Value).split(':');
if (!recordId || !collectionId) throw new Error('Unexpected record GID format.');
await check('records.get', () => client.record(collectionId, recordId));
if (selected.size) {
  const previous = await readPrivateJson<{results: typeof report}>('ancestry/verification/report.json') ?? {results: []};
  report.unshift(...previous.results.filter((entry: {operation: string}) => !selected.has(entry.operation)));
}
await writePrivateJson('ancestry/verification/report.json', {checkedAt: new Date().toISOString(), apkVersion: '18.16.3',
  scope: 'One signed-in account and its first tree/root person. Reads only; no genealogy mutations. Responses saved privately.', results: report});
console.log(`${report.filter(x => x.ok).length}/${report.length} passed`);
if (report.some(x => !x.ok)) process.exitCode = 1;
