/** Opt-in live reads. Saves only operation names/status/schema results, never genealogy data. */
import { writePrivateJson } from '../src/storage.js';
import { FamilySearchClient, operationContract, validateOperationResponse, type OperationName } from '../src/index.js';
import { HttpError } from '../src/http.js';

const client = await FamilySearchClient.open();
const me = await client.currentUser();
if (!me.personId) throw new Error('Current user has no tree person.');
const pedigree = await client.ancestry(me.personId, 3);
const ancestor = pedigree.persons?.find(p => !p.living && p.id !== me.personId)?.id ?? me.personId;
const checks: Array<{ operation: string; status: number | string; schema?: string; note?: string }> = [];
async function check(name: OperationName, input?: any): Promise<any> {
  const op = operationContract(name);
  if (op.method !== 'GET' && !['search.results','search.categories'].includes(name)) throw new Error('Live verifier only permits reads.');
  try {
    const result = await client.operationDetailed(name, input);
    let schema = 'valid';
    try { validateOperationResponse(name, result.data); }
    catch (error) { schema = error instanceof Error ? error.message : 'schema mismatch'; }
    checks.push({ operation: name, status: result.status, schema });
    console.log(`${name}: ${result.status}, ${schema}`);
    return result.data;
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 'client-error';
    // Only fixed messages: an HTTP error's path may contain a private person identifier.
    checks.push({ operation: name, status });
    console.log(`${name}: ${status}`);
    if (status === 429) throw new Error('Rate limited; stopped the live read verifier.');
  }
}

const person = await check('persons.get', { pid: ancestor, query: { oneHops: 'summaries' } });
await check('sources.forPerson', { pid: ancestor });
const notes = await check('persons.notes', { pid: ancestor });
if (notes?.notes?.[0]?.noteId) await check('persons.note', { pid: ancestor, noteId: notes.notes[0].noteId });
await check('history.changes', { pid: ancestor });
await check('hints.recordMatches', { pid: ancestor });
await check('hints.duplicates', { personId: ancestor });
await check('hints.matchById', { personId: ancestor });
await check('persons.deleteConstraints', { person_id: ancestor });
await check('pedigree.portrait', { person_id: ancestor, query: { numGenerations: 2, includeGoldenHints: false } });
await check('pedigree.siblings', { personId: ancestor, query: { numGenerations: 2, includeGoldenHints: false } });
await check('pedigree.expandSiblings', { personId: ancestor });
await check('pedigree.ancestorCount', { personId: ancestor, query: { generations: 2 } });
await check('portraits.get', { pid: ancestor });
await check('portraits.lastPublicEvent', { pid: ancestor });
await check('following.status', { personId: ancestor });
const memories = await check('memories.forPerson', { pid: ancestor, query: { includeAssociatedArtifacts: true, includeDatesPlaces: true, community: true } });
const artifactId = memories?.artifact?.[0]?.id;
if (typeof artifactId === 'number') {
  await check('memories.get', { artifactId, query: { includeAssociatedArtifacts: true, includeDatesPlaces: true } });
  await check('memories.tags', { artifactId });
  await check('memories.comments', { artifactId, query: { includeContactNames: true } });
  await check('memories.topics', { artifactId });
}
const parentChild = person?.parentChildRelationshipsAsChild?.[0]?.id;
if (parentChild) { await check('parentChildren.get', { relationshipId: parentChild }); await check('parentChildren.notes', { id: parentChild }); }
const couple = person?.coupleRelationships?.[0]?.id;
if (couple) { await check('couples.get', { relationshipId: couple }); await check('couples.notes', { id: couple }); }
await check('trees.status');
await check('persons.stats');
await check('persons.privatePersons');
await check('persons.contributions');
await check('history.list', { cisId: me.id });
await check('groups.list');
await check('groups.limits');
await check('helpers.helpees');
await check('helpers.statistics');
await check('tasks.list', { query: { includeNeedsPermission: false } });
await check('hints.opportunities', { cisId: me.id });
await check('ordinances.forPerson', { personId: ancestor });
await check('authorities.dates', { query: { text: '1 January 1900', includeNoneAboveRow: false } });
await check('authorities.places', { query: { name: 'London, England', includeNoneAboveRow: false } });
await check('authorities.countries');
await check('search.countries');
await check('search.subcountries', { countryName: 'United States' });
await check('search.locationMap');
const search = { searchType: 'TREE', focusPerson: { givenName: { value: 'John' }, surname: { value: 'Smith' } } };
await check('search.categories', { body: search });
await check('search.results', { body: search, query: { from: 0, size: 2 } });

const report = { verifiedAt: new Date().toISOString(), apkVersion: '5.4.4 (43530)',
  policy: 'Authenticated reads on the account and an ancestor; read-only search POSTs. No writes, uploads, deletions, merges, invitations, or messages.',
  checks, successful: checks.filter(c => typeof c.status === 'number' && c.status < 300).length,
  schemaValid: checks.filter(c => c.schema === 'valid').length };
await writePrivateJson('verification/genealogy.json', report);
console.log(`Verified ${report.successful}/${checks.length} reads; ${report.schemaValid} response contracts valid.`);
