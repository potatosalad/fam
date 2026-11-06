import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FamilySearchClient} from '../src/familysearch/client.js';
import {prepareRecordSearch, recordSearchPage, runRecordSearch} from '../src/familysearch/record-search.js';

test('automatic collection search checks every type before returning zero, and explicit zero skips probes', async t => {
  const calls: any[] = [];
  t.mock.method(FamilySearchClient, 'open', async () => ({operation: async (_name: string, input: any) => {
    calls.push(input); return {total: 0, results: []};
  }}));
  const empty = await runRecordSearch(['--collection-id', '1234567', '--last-name', 'Absent'], 'search');
  assert.equal('total' in empty && empty.total, 0);
  assert.deepEqual((empty as any).searchedCollectionTypes, [0, 6, 1, 4, 5, 7]);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.body.collectionId === 1234567 && call.body.collectionType !== undefined));
  calls.length = 0;
  await runRecordSearch(['--collection-id', '1234567', '--collection-type', '0'], 'search');
  assert.equal(calls.length, 1); assert.equal(calls[0].body.collectionType, 0);
});

test('residence place mismatches warn without filtering provider records or altering totals', () => {
  const input = prepareRecordSearch(['--last-name', 'Example', '--residence-place', 'Synthetic County, Georgia']);
  const results = ['1870, Other, Georgia, United States', '1870, District 1, Synthetic, Georgia, United States'].map((value, i) => ({type: 'RECORD',
    recordPerson: {id: `record-${i}`, fields: [{type: 'http://gedcomx.org/Census', label: 'Census', value}]}}));
  const page = recordSearchPage({total: 2, results}, input);
  assert.equal(page.items.length, 2); assert.equal(page.total, 2); assert.equal(page.complete, true);
  assert.match((page as any).warnings?.join(' ') ?? '', /residence.*outside.*requested place/i);
  assert.deepEqual((page as any).residencePlaceCheck.unmatchedRecordIds, ['record-0']);
  assert.equal((page as any).residencePlaceCheck.method, 'display-text-comparison');
  const stateOnly = recordSearchPage({total: 2, results}, prepareRecordSearch(['--residence-place', 'Georgia']));
  assert.equal((stateOnly as any).warnings, undefined);
  const noCensus = recordSearchPage({total: 1, results: [{type: 'RECORD', recordPerson: {id: 'unknown', fields: [
    {type: 'http://gedcomx.org/Birth', label: 'Birth', value: '1850, Synthetic, Georgia'}]}}]}, input);
  assert.deepEqual((noCensus as any).residencePlaceCheck.uncheckedRecordIds, ['unknown']);
  assert.deepEqual((noCensus as any).residencePlaceCheck.unmatchedRecordIds, []);
});

// Category buckets can disagree with the type accepted by a collection search.
test('collection discovery does not advertise a category bucket as a usable search type', async t => {
  t.mock.method(FamilySearchClient, 'open', async () => ({operation: async () => ({categoryFilters: [{collectionFilters: [
    {displayName: 'Other', collectionType: 7, subCollections: [{collectionId: 1234567, displayName: 'Synthetic census', count: 2}]},
  ]}]})}));
  const result = await runRecordSearch(['--last-name', 'Example'], 'collections');
  assert.deepEqual(result.items, [{collectionId: 1234567, categoryType: 7, category: 'Other', title: 'Synthetic census', count: 2}]);
});

test('automatic collection search resolves the actual type with the original criteria before paginating', async t => {
  const calls: any[] = [];
  t.mock.method(FamilySearchClient, 'open', async () => ({operation: async (name: string, input: any) => {
    assert.equal(name, 'search.results'); calls.push(input);
    assert.equal(input.body.collectionId, 1234567);
    assert.equal(input.body.focusPerson.surname.value, 'Example');
    return {total: input.body.collectionType === 6 ? 50 : 0, results: input.body.collectionType === 6
      ? [{type: 'RECORD', recordPerson: {id: 'synthetic', fields: []}}] : []};
  }}));
  const result = await runRecordSearch(['--collection-id', '1234567', '--last-name', 'Example', '--offset', '10'], 'search');
  assert.equal(result.criteria.collectionType, 6);
  assert.equal('total' in result && result.total, 50);
  assert.equal(calls.at(-1).query.from, 10);
  assert.ok(calls.slice(0, -1).every(call => call.query.size === 1 && call.query.from === 0));
  assert.equal(prepareRecordSearch(['--collection-id', '1234567']).body.collectionType, undefined);
});
