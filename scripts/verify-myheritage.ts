import { writePrivateJson } from '../src/shared/storage.js';
/** Read-only smoke checks. Requires an existing session; never attempts password login. */
import {readPrivateJson} from '../src/shared/storage.js';
import {MyHeritageClient} from '../src/myheritage/client.js';
import type {MyHeritageSession} from '../src/myheritage/auth.js';

async function main() {
  const session = await readPrivateJson<MyHeritageSession>('myheritage/session.json');
  if (!session?.accessToken) throw new Error('No saved MyHeritage API session. Live verification is blocked; no login attempt was made.');
  const client = new MyHeritageClient(session);
  const checks: {operation: string; status: 'passed' | 'failed'; error?: string}[] = [];
  async function check(name: string, run: () => Promise<unknown>) {
    try {
      const value = await run(); if (value == null || typeof value !== 'object') throw new Error('Expected an object response.');
      checks.push({operation: name, status: 'passed'}); console.log(`${name}: passed`); return value;
    } catch (error) {checks.push({operation: name, status: 'failed', error: error instanceof Error ? error.name : 'Error'}); console.log(`${name}: failed`); return undefined;}
  }
  const me = await check('me', () => client.me()) as {id?: string; default_site?: {id?: string; default_tree?: {id?: string}}; default_individual?: {id?: string; tree?: {id?: string}}} | undefined;
  if (!me?.id) throw new Error('Account read failed; stopped before further calls.');
  await check('sites', () => client.sites());
  const siteId = me.default_site?.id, treeId = me.default_site?.default_tree?.id ?? me.default_individual?.tree?.id, personId = me.default_individual?.id;
  if (siteId) {
    await check('trees', () => client.trees(siteId));
    if (session.mode !== 'browser') await check('albums', () => client.albums(siteId));
  }
  if (treeId) {
    await check('tree', () => client.tree(treeId)); const people = await check('people', () => client.people(treeId, 0, 5)) as {data?: {name?: string}[]};
    if (session.mode === 'browser' && people?.data?.[0]?.name) await check('find', () => client.find(treeId, people.data![0]!.name!));
    if (session.mode !== 'browser') await check('consistency', () => client.consistency(treeId, 0, 5));
  }
  if (personId) {
    for (const [name, run] of Object.entries({person: () => client.person(personId), events: () => client.events(personId),
      timeline: () => client.timeline(personId), facts: () => client.facts(personId), matches: () => client.matches(personId, {limit: 5}),
      ...(session.mode === 'browser' ? {insights: () => client.insights(personId)} : {records: () => client.records(personId, 0, 5)}), media: () => client.media(personId, {limit: 5})})) await check(name, run);
  }
  if (session.mode !== 'browser') {
  await check('catalog', () => client.graphql('graphql.super_search.get_research_catalog', {searchID: 'search-0', facetType: 'searchcategory', withCollections: true, sortCollectionsBy: 'record_count', collectionsLimit: 5, lang: 'EN'}));
  await check('collections', () => client.graphql('graphql.super_search.search_collections', {searchID: 'search-0', query: 'census', sortBy: 'record_count', offset: 0, limit: 5, lang: 'EN'}));
  await check('historicalRecordCount', () => client.graphql('graphql.embedded.getHistoricalRecordsCount', {}));
  }
  const report = {mode: session.mode ?? 'native', date: new Date().toISOString(), apkVersion: '7.5.44', checks, writesExecuted: 0, nativeApiVerified: session.mode !== 'browser',
    note: 'Read-only account-dependent sample. Empty results count as successful responses, not content validation. IDs, names and tokens are excluded.'};
  await writePrivateJson('myheritage/verification/tree.json', report);
  if (checks.some(c => c.status === 'failed')) process.exitCode = 1;
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1;});
