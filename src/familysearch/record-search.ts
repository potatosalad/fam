import {InputError} from '../shared/input-error.js';
import {parseArgs} from 'node:util';
import {FamilySearchClient} from './client.js';
import {prepareOperation} from './operations.js';
import type {OneSearchRequestDto, OneSearchRequestPersonNameDto, OneSearchResultsDto} from './generated/models.js';

export const recordSearchFlags = ['first-name', 'last-name', 'father-first-name', 'father-last-name', 'mother-first-name', 'mother-last-name', 'spouse-first-name', 'spouse-last-name',
  ...['birth', 'death', 'marriage', 'residence'].flatMap(event => [`${event}-year`, `${event}-year-range`, `${event}-place`]), 'collection-id', 'collection-type', 'limit', 'offset'];

export function prepareRecordSearch(args: string[]) {
  const {values} = parseArgs({args, allowPositionals: false, options: {
    ...Object.fromEntries(recordSearchFlags.map(key => [key, {type: 'string' as const}])), exact: {type: 'boolean'},
  }});
  const v = values as Record<string, string | boolean | undefined>;
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
  prepareOperation('search.results', input);
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
  return {items: result.results.map(item => ({...item.recordPerson!, resultId: item.id ?? null, resultType: item.type, confidence: item.confidence ?? null})),
    total, offset: input.query.from, limit: input.query.size, complete, nextOffset: complete ? null : end, criteria: input.body};
}

export async function runRecordSearch(args: string[], action: 'search' | 'collections') {
  const input = prepareRecordSearch(args);
  const client = await FamilySearchClient.open();
  if (action === 'search') return recordSearchPage(await client.operation('search.results', input), input);
  const data = await client.operation('search.categories', {body: input.body});
  if (!Array.isArray(data?.categoryFilters)) throw new Error('FamilySearch returned an unexpected collection catalog.');
  return {items: data.categoryFilters.flatMap(category => (category.collectionFilters ?? []).flatMap(group =>
    (group.subCollections ?? []).map(collection => ({collectionId: collection.collectionId, collectionType: group.collectionType,
      title: collection.displayName, count: collection.count ?? null, category: group.displayName})))), criteria: input.body};
}
