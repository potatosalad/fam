import { writePrivateJson } from '../src/shared/storage.js';
/** Uses the saved session and a public historical example; never logs in or edits genealogy data. */
import assert from 'node:assert/strict';
import {MyHeritageResearchVerificationError} from '../src/myheritage/research.js';
import {MyHeritageClient} from '../src/myheritage/client.js';
import {readPrivateJson} from '../src/shared/storage.js';
import type {MyHeritageSession} from '../src/myheritage/auth.js';

async function main() {
  const session = await readPrivateJson<MyHeritageSession>('myheritage/session.json');
  if (!session?.accessToken) throw new Error('An existing MyHeritage session is required; no login attempted.');
  const c = new MyHeritageClient(session);
  const checks: {operation: string; status: 'passed' | 'failed' | 'skipped'; evidence?: Record<string, unknown>; error?: string}[] = [];
  let verificationRequired = false;
  async function check<T>(operation: string, run: () => Promise<{value: T; evidence: Record<string, unknown>}>) {
    if (verificationRequired) {checks.push({operation, status: 'skipped', error: 'Website verification required'}); console.log(`${operation}: skipped after verification challenge`); return undefined;}
    try {const {value, evidence} = await run(); checks.push({operation, status: 'passed', evidence}); console.log(`${operation}: passed`); return value;}
    catch (error) {if (error instanceof MyHeritageResearchVerificationError) verificationRequired = true; checks.push({operation, status: 'failed', error: error instanceof Error ? error.name : 'Error'}); console.log(`${operation}: failed${verificationRequired ? ' (HTTP 406 website verification required; stopping)' : ''}`); return undefined;}
  }
  const criteria = {firstName: 'Abraham', lastName: 'Lincoln', exact: true, limit: 20};
  const first = await check('search names, birth year and birthplace', async () => {
    const value = await c.searchRecords({...criteria, events: [{type: 'birth', year: 1809, place: 'Kentucky'}]});
    assert(value.data.length > 0); assert(value.data.every((d: any) => d.id && d.link && d.collection.id && d.record_type === 'record'));
    return {value, evidence: {returned: value.returned, structuredFields: value.data.some((d: any) => d.display_fields?.length)}};
  });
  if (first?.nextOffset !== null && first?.nextOffset !== undefined) await check('search next page without duplicate IDs', async () => {
    const value = await c.searchRecords({...criteria, events: [{type: 'birth', year: 1809, place: 'Kentucky'}], offset: first.nextOffset!});
    const ids = new Set(first.data.map((r: any) => r.id)); assert(value.data.length > 0); assert(value.data.every((r: any) => !ids.has(r.id)));
    return {value, evidence: {returned: value.returned, overlap: 0}};
  });
  const scoped = await check('collection search is constrained on the server', async () => {
    const value = await c.searchRecords({...criteria, collection: '10826'});
    assert(value.data.length > 0); assert(value.data.every((r: any) => r.collection.id === 'collection-10826'));
    return {value, evidence: {collection: '10826', returned: value.returned, allResultsInCollection: true}};
  });
  await check('category search is constrained on the server', async () => {
    const value = await c.searchRecords({...criteria, category: '1000', limit: 10}); assert(value.data.length > 0);
    const ids = [...new Set<string>(value.data.map((r: any) => r.collection.id))];
    // Validate collection ancestry, not just a smaller result count.
    for (const id of ids) {
      const detail = await c.collection(id);
      assert([...(detail.parentCategories ?? []), ...(detail.categories ?? [])].some((category: any) => category.id === 'category-1000' || category.id === 'searchcategory-1000'));
    }
    return {value, evidence: {category: '1000', returned: value.returned, collectionAncestorsChecked: ids.length}};
  });
  await check('family-tree record-type filter', async () => {
    const value = await c.searchRecords({...criteria, recordType: 'family-trees', limit: 10});
    assert(value.data.length > 0); assert(value.data.every((r: any) => r.record_type === 'family-tree'));
    return {value, evidence: {returned: value.returned, allResultsFamilyTrees: true}};
  });
  await check('collection catalog text search', async () => {
    const value = await c.researchCatalog({text: 'census', limit: 5}); assert(value.data.length > 0);
    assert(value.data.every((r: any) => /census/i.test(`${r.name} ${r.description} ${r.short_description}`)));
    return {value, evidence: {returned: value.data.length}};
  });
  await check('collection catalog category and images', async () => {
    const value = await c.researchCatalog({category: '1000', images: true, limit: 5}); assert(value.data.length > 0);
    assert(value.data.every((r: any) => r.has_images === true));
    return {value, evidence: {returned: value.data.length, allHaveImages: true}};
  });
  await check('collection metadata and search form', async () => {
    const value = await c.collection('10826'); assert(value.id === 'collection-10826'); assert(value.formConfig && value.formComponents);
    return {value, evidence: {collection: '10826', searchFormPresent: true}};
  });
  const link = first?.data[0]?.link ?? scoped?.data[0]?.link;
  if (link) await check('record fields and source citations', async () => {
    const value = await c.record(link); assert(value.fieldsVisible && value.fields.length > 0 && value.title); assert(value.citations.length > 0);
    return {value, evidence: {fields: value.fields.length, citations: value.citations.length}};
  });
  const report = {date: new Date().toISOString(), mode: session.mode ?? 'native', checks, genealogyEdits: 0,
    note: 'Live semantic checks using a public historical search. Search mutations can affect recent-search history. Account IDs, returned records and session credentials are excluded. Counts and entitlements can change.'};
  await writePrivateJson('myheritage/verification/research.json', report);
  if (checks.some(c => c.status === 'failed') || checks.length !== 9) process.exitCode = 1;
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1;});
