import {InputError} from '../shared/input-error.js';
import {parseArgs} from 'node:util';
import {FamilySearchClient} from './client.js';
import {prepareOperation} from './operations.js';
import type {OneSearchRequestDto, OneSearchRequestPersonNameDto, OneSearchResultsDto} from './generated/models.js';

export const recordSearchFlags = ['first-name', 'last-name', 'father-first-name', 'father-last-name', 'mother-first-name', 'mother-last-name', 'spouse-first-name', 'spouse-last-name',
  ...['birth', 'death', 'marriage', 'residence'].flatMap(event => [`${event}-year`, `${event}-year-range`, `${event}-place`]), 'collection-id', 'collection-type', 'limit', 'offset'];

export function prepareRecordSearch(args: string[]) {
  const {values} = parseArgs({args, allowPositionals: false, options: {
    ...Object.fromEntries(recordSearchFlags.map(key => [key, {type: 'string' as const}])), exact: {type: 'boolean'}, sort: {type: 'string'},
  }});
  const v = values as Record<string, string | boolean | undefined>;
  if (v.sort !== undefined && !['count-desc','count-asc','title'].includes(String(v.sort))) throw new InputError('--sort requires count-desc, count-asc, or title.');
  const integer = (key: string, fallback: number | undefined, min: number, max: number): number | undefined => {
    if (v[key] === undefined) return fallback;
    const n = Number(v[key]);
    if (!/^\d+$/.test(String(v[key])) || !Number.isSafeInteger(n) || n < min || n > max) throw new InputError(`--${key} requires an integer from ${min} to ${max}.`);
    return n;
  };
  const field = (key: string) => {
    if (v[key] === undefined) return undefined;
    const value = String(v[key]).trim();
    if (!value) throw new InputError(`--${key} must not be empty.`);
    return {value, ...(v.exact ? {exact: true} : {})};
  };
  const name = (prefix = ''): OneSearchRequestPersonNameDto | undefined => {
    const givenName = field(`${prefix}first-name`), surname = field(`${prefix}last-name`);
    return givenName || surname ? {...(givenName ? {givenName} : {}), ...(surname ? {surname} : {})} : undefined;
  };
  const body: OneSearchRequestDto = {searchType: 'RECORDS'};
  const focusPerson = name();
  if (focusPerson) body.focusPerson = focusPerson;
  for (const [prefix, key] of [['father', 'fathers'], ['mother', 'mothers'], ['spouse', 'spouses']] as const) {
    const relative = name(`${prefix}-`);
    if (relative) body[key] = [relative];
  }
  for (const eventType of ['birth', 'death', 'marriage', 'residence']) {
    const year = integer(`${eventType}-year`, undefined, 1, 9999);
    const range = integer(`${eventType}-year-range`, 0, 0, 9999);
    const place = field(`${eventType}-place`);
    if (v[`${eventType}-year-range`] !== undefined && year === undefined) throw new InputError(`--${eventType}-year-range requires --${eventType}-year.`);
    if (year !== undefined || place) (body.events ??= []).push({eventType,
      ...(year !== undefined ? {year: {value: String(year), range}} : {}), ...(place ? {place} : {})});
  }
  const collectionId = integer('collection-id', undefined, 1, Number.MAX_SAFE_INTEGER);
  const collectionType = integer('collection-type', undefined, 0, Number.MAX_SAFE_INTEGER);
  if (collectionId !== undefined) body.collectionId = collectionId;
  if (collectionType !== undefined) body.collectionType = collectionType;
  if (Object.keys(body).length === 1) throw new InputError('Provide a name, relative, event, or collection filter.');
  const query = {size: integer('limit', 20, 1, 100)!, from: integer('offset', 0, 0, Number.MAX_SAFE_INTEGER)!};
  const input = {body, query};
  // Validate the wire shape locally; the missing type is resolved before execution.
  prepareOperation('search.results', collectionId !== undefined && collectionType === undefined
    ? {...input, body: {...body, collectionType: 0}} : input);
  return input;
}

export function recordSearchPage(result: OneSearchResultsDto, input: ReturnType<typeof prepareRecordSearch>) {
  if (!Array.isArray(result?.results) || result.results.some(item => !item?.recordPerson || typeof item.recordPerson.id !== 'string'))
    throw new Error('FamilySearch record search returned an unexpected result shape. Inspect search.results through the API catalog.');
  const total = result.total == null ? null : result.total;
  if (total !== null && (!Number.isSafeInteger(total) || total < 0)) throw new Error('FamilySearch returned an invalid search total.');
  const end = input.query.from + result.results.length;
  if (!Number.isSafeInteger(end)) throw new Error('Search offset exceeded the supported integer range.');
  const complete = result.results.length === 0 || total !== null && end >= total;
  const requestedPlace = input.body.events?.find(event => event.eventType === 'residence')?.place?.value;
  let residencePlaceCheck: {requestedPlace: string; method: 'display-text-comparison'; unmatchedRecordIds: string[]; uncheckedRecordIds: string[]} | undefined;
  const warnings: string[] = [];
  if (requestedPlace) {
    // This is a display-text diagnostic, not geographic authority validation.
    // Do not discard fuzzy matches or mistake a birthplace for a residence.
    const normalize = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/\b(county|state|province)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const parts = requestedPlace.split(',').map(normalize).filter(Boolean);
    residencePlaceCheck = {requestedPlace, method: 'display-text-comparison', unmatchedRecordIds: [], uncheckedRecordIds: []};
    for (const {recordPerson} of result.results) {
      const places = recordPerson!.fields.filter(field => /\/(Residence|Census)$/.test(field.type) && field.value).map(field => ` ${normalize(field.value!)} `);
      if (!places.length) residencePlaceCheck.uncheckedRecordIds.push(recordPerson!.id);
      else if (!places.some(place => parts.every(part => place.includes(` ${part} `)))) residencePlaceCheck.unmatchedRecordIds.push(recordPerson!.id);
    }
    if (residencePlaceCheck.unmatchedRecordIds.length) warnings.push('Residence results appear outside the requested place by display-text comparison. FamilySearch can expand or misresolve place names; these results are not a reliable county-specific negative. Inspect residencePlaceCheck and the records; no results were removed.');
    if (residencePlaceCheck.uncheckedRecordIds.length) warnings.push('Some records have no displayed residence or census place to compare. Their geographic match is unverified.');
  }
  return {items: result.results.map(item => ({...item.recordPerson!, resultId: item.id ?? null, resultType: item.type, confidence: item.confidence ?? null})),
    total, offset: input.query.from, limit: input.query.size, complete, nextOffset: complete ? null : end, criteria: input.body,
    ...(residencePlaceCheck ? {residencePlaceCheck} : {}), ...(warnings.length ? {warnings} : {})};
}

export async function runRecordSearch(args: string[], action: 'search' | 'collections') {
  const input = prepareRecordSearch(args);
  const client = await FamilySearchClient.open();
  const searchedCollectionTypes: number[] = [];
  if (input.body.collectionId !== undefined && input.body.collectionType === undefined) {
    // Category buckets are not collection search types (e.g. a census under Other).
    // The service rejects collection-only probes: retain all supplied criteria,
    // test from offset zero, and never turn off the collection restriction.
    for (const collectionType of [0, 6, 1, 4, 5, 7]) {
      const probe = {body: {...input.body, collectionType}, query: {size: 1, from: 0}};
      const page = recordSearchPage(await client.operation('search.results', probe), probe);
      searchedCollectionTypes.push(collectionType);
      if (page.items.length) { input.body.collectionType = collectionType; break; }
    }
    if (input.body.collectionType === undefined) {
      const empty = action === 'search' ? recordSearchPage({results: [], total: 0}, input) : {items: [], criteria: input.body};
      return {...empty, searchedCollectionTypes, warnings: ['No matches across the supported collection search types. This does not establish collection availability or coverage. No unrestricted search was run.']};
    }
  }
  if (action === 'search') return {...recordSearchPage(await client.operation('search.results', input), input),
    ...(searchedCollectionTypes.length ? {searchedCollectionTypes} : {})};
  const data = await client.operation('search.categories', {body: input.body});
  if (!Array.isArray(data?.categoryFilters)) throw new Error('FamilySearch returned an unexpected collection catalog.');
  const items = data.categoryFilters.flatMap(category => (category.collectionFilters ?? []).flatMap(group =>
    (group.subCollections ?? []).map(collection => ({collectionId: collection.collectionId, categoryType: group.collectionType,
      title: collection.displayName, count: collection.count ?? null, category: group.displayName}))));
  const index=args.indexOf('--sort'), sort=index < 0 ? 'count-desc' : args[index+1];
  items.sort((a,b) => sort === 'title' ? (a.title ?? '').localeCompare(b.title ?? '') : (a.count == null ? (b.count == null ? 0 : 1) : b.count == null ? -1 : sort === 'count-asc' ? a.count-b.count : b.count-a.count) || (a.title ?? '').localeCompare(b.title ?? ''));
  return {items, sort, criteria: input.body};
}
