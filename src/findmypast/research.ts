import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { FindmypastClient } from './client.js';

const recordSortFields: Record<string, string> = {
  'first-name': 'FirstName', 'last-name': 'LastName', birth: 'YearOfBirth', death: 'YearOfDeath', year: 'EventYear', collection: 'DatasetName',
};
export function recordOrder(sort = 'relevance', descending = false) {
  if (sort === 'relevance') {
    if (descending) throw new Error('--descending requires a field sort for record search.');
    return undefined;
  }
  const by = recordSortFields[sort];
  if (!by) throw new Error('Record --sort must be relevance, first-name, last-name, birth, death, year, or collection.');
  return {by, direction: descending ? 'DESCENDING' as const : 'ASCENDING' as const};
}

export interface NewspaperOptions {
  names?: string[]; keywords?: string; exact?: boolean; publications?: string[];
  country?: string; county?: string; place?: string; from?: string; to?: string;
  sort?: string; descending?: boolean; limit?: number; offset?: number;
}
export function newspaperVariables(options: NewspaperOptions) {
  const {names = [], keywords = '', publications = [], country, county, place, from, to, sort = 'relevance', descending = false, limit = 20, offset = 0} = options;
  if (!names.length && !keywords && !publications.length && !country && !county && !place && !from && !to) throw new Error('Provide a newspaper name, keyword, publication, location, or date filter.');
  if (Boolean(from) !== Boolean(to)) throw new Error('Newspaper dates require both --from and --to (YYYY-MM-DD).');
  for (const date of [from, to]) {
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date)) throw new Error('Dates must be valid YYYY-MM-DD dates.');
  }
  if (from && to && from > to) throw new Error('--from must be on or before --to.');
  if (!['relevance', 'date'].includes(sort)) throw new Error('Newspaper --sort must be relevance or date.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Newspaper --limit must be 1–100 and --offset must be nonnegative.');
  return {names, keywords, exactNames: options.exact ?? false, exactKeywords: options.exact ?? false,
    newspaperTitle: publications, publicationPlace: country || county || place ? [{...(country ? {country} : {}), ...(county ? {county} : {}), ...(place ? {place} : {})}] : [],
    ...(from ? {date: {from, to}} : {}), sort: {by: sort === 'date' ? 'PUBLICATION_DATE' : 'RELEVANCE', direction: sort === 'relevance' || descending ? 'DESC' : 'ASC'}, offset, pageSize: limit};
}
export async function searchNewspapers(client: FindmypastClient, options: NewspaperOptions) {
  const result = await client.graphql<{articleSearch: unknown}>('GetNewspaperSearchResults', newspaperVariables(options));
  return result.articleSearch;
}

interface Media {id: string; recordMetadataId: string; creditCost: number; mediaSource?: string;}
interface SearchRecord {id: string; image?: Media; pdf?: Media; fields: {fieldId: string; value: string}[];}
/** A full-resolution IIIF image; no thumbnail fallback or credit purchase. */
export async function downloadRecordImage(client: FindmypastClient, recordId: string) {
  const result = await client.search([{field: 'Id', values: [recordId]}]) as {root?: {search?: {recordSearch?: {records?: SearchRecord[]}}}};
  const record = result.root?.search?.recordSearch?.records?.find(r => r.id === recordId);
  if (!record) throw new Error('Record was not found by its exact record ID.');
  const media = record.image;
  if (!media) throw new Error(record.pdf ? 'This record has a PDF; original PDF downloading is not supported yet.' : 'This record has no downloadable image.');
  if (media.mediaSource === 'newspaper') throw new Error('Use newspapers to find article/page references; newspaper page downloading is not supported yet.');
  if (typeof media.id !== 'string' || !media.id || typeof media.recordMetadataId !== 'string' || !media.recordMetadataId) throw new Error('Record image metadata is incomplete.');
  if (media.creditCost !== 0) {
    const fulfilled = await client.graphql<{fulfillableItems: {id: string; isFulfilled: boolean}[]}>('GetRecordFulfillment', {records: [{id: media.id, recordMetadataId: media.recordMetadataId}]});
    if (!fulfilled.fulfillableItems?.some(item => item.id === media.id && item.isFulfilled)) throw new Error('This image is not marked free or already unlocked. Open it on Findmypast first, then retry; the CLI does not spend credits.');
  }
  const base = `/record-gateway/image/${encodeURIComponent(media.id)}`;
  const query = {recordMetadataId: media.recordMetadataId, parentRecordId: recordId, confirmedPurchase: false};
  const {data: info} = await client.request<{width: number; height: number}>(`${base}/info.json`, {query});
  if (!Number.isSafeInteger(info.width) || info.width <= 0 || !Number.isSafeInteger(info.height) || info.height <= 0) throw new Error('Image service did not return valid full-resolution dimensions.');
  const response = await client.request<Uint8Array>(`${base}/full/max/0/default.jpg`, {query, response: 'binary'});
  const bytes = response.data;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('Image download did not return a JPEG.');
  let decoded;
  try { decoded = await sharp(bytes, {failOn: 'warning'}).raw().toBuffer({resolveWithObject: true}); }
  catch { throw new Error('Downloaded image is incomplete or cannot be decoded.'); }
  if (decoded.info.width !== info.width || decoded.info.height !== info.height) throw new Error('Downloaded image dimensions do not match the full-resolution metadata.');
  const source = new URL('https://www.findmypast.com/transcript');
  source.searchParams.set('id', recordId);
  return {bytes, metadata: {recordId, imageId: media.id, recordMetadataId: media.recordMetadataId,
    sourceUrl: source.href, collection: record.fields.find(f => f.fieldId === 'DatasetName')?.value,
    retrievedAt: new Date().toISOString(), mediaType: 'image/jpeg', width: info.width, height: info.height,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}};
}
