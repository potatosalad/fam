import { StoriedClient, type CallInput } from '../storied/client.js';
import { operation } from '../storied/catalog.js';
import { WEB, checkUrl, NewspaperArchiveHttp, NewspaperArchiveError } from './http.js';
import { pageDetails } from './parse.js';

const base = 'GET /api/v2/NewsPaperSearch/';
export const operations: Record<string, string> = {
  search: `${base}newspapersearch`, countries: `${base}countries`, states: `${base}statebycountryid/{countryId}`,
  cities: `${base}citiesbystateid/{stateId}`, publications: `${base}pubtitlebycityid/{stateId}/{cityId}`,
  'find-publications': `${base}publicationlocations`, 'publication-years': `${base}publicationyears/{pubId}`,
  'publication-months': `${base}publicationmonths/{pubId}/{year}`, 'publication-dates': `${base}publicationdates/{pubId}/{year}/{month}`,
  publication: `${base}getpubtitlebypubtitleurl/{pubTitleUrl}`, ocr: `${base}ocr/{imageId}`,
  'year-range': `${base}yearsrangebylocation`, 'required-subscriptions': `${base}required-subscription-types/{imageId}`,
};
export interface SearchOptions {
  firstName?: string; lastName?: string; keyword?: string; phrase?: string; anyWords?: string; excludeWords?: string;
  countryId?: string; stateId?: string; cityId?: string; publicationId?: string;
  from?: string; to?: string; page?: number; limit?: number;
}
export function id(value: string): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('NewspaperArchive IDs must be positive safe integers.');
  return Number(value);
}
export function integer(value: number, min = 1, max = 100): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Numeric option must be an integer between ${min} and ${max}.`);
  return value;
}
function date(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || Number(match[1]) < 1600 || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Dates must be real calendar dates in YYYY-MM-DD form, from 1600 onward.');
  return [match[1], String(Number(match[2])), String(Number(match[3]))];
}
export function searchQuery(options: SearchOptions = {}): Record<string, string | number> {
  if (![options.firstName, options.lastName, options.keyword, options.phrase, options.anyWords, options.publicationId].some(v => v?.trim())) throw new Error('Supply a name, keyword, phrase, or publication ID.');
  const limit = options.limit ?? 20;
  if (![10,20,30,50].includes(limit)) throw new Error('Search limit must be 10, 20, 30, or 50; the provider uses fixed page sizes.');
  const query: Record<string, string | number> = {PN: integer(options.page ?? 1, 1, 1_000_000), PS: limit};
  for (const [key, value] of Object.entries({FN: options.firstName, LN: options.lastName, 'K.AL': options.keyword, 'K.EX': options.phrase, 'K.AN': options.anyWords, 'K.WO': options.excludeWords})) if (value?.trim()) query[key] = value.trim();
  for (const [key, value] of Object.entries({'L.CU': options.countryId, 'L.ST': options.stateId, 'L.CI': options.cityId, 'L.PID': options.publicationId})) if (value !== undefined) {id(value); query[key] = value;}
  if (!!options.from !== !!options.to) throw new Error('Use --from and --to together for a publication date range.');
  if (options.from && options.to) {
    const [y,m,d] = date(options.from), [ey,em,ed] = date(options.to);
    if (options.from > options.to) throw new Error('--from must be on or before --to.');
    Object.assign(query, {'DT.DFT': 'between', 'DT.Y': y, 'DT.M': m, 'DT.D': d, 'DT.EY': ey, 'DT.EM': em, 'DT.ED': ed});
  }
  return query;
}
function unwrap(value: unknown): any {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'data')) throw new NewspaperArchiveError('api-changed');
  const result = value as {data: unknown; error?: unknown};
  if (result.error != null || result.data == null) throw new NewspaperArchiveError('api-changed');
  return result.data;
}
export function sourceUrl(record: {thumbnailUrl?: unknown; pageNumber?: unknown}): string | null {
  if (typeof record.thumbnailUrl !== 'string' || !Number.isSafeInteger(record.pageNumber) || Number(record.pageNumber) < 1) return null;
  try {
    const thumbnail = checkUrl(record.thumbnailUrl);
    const match = thumbnail.pathname.match(/\/([a-z0-9-]+)\/(\d{4})\/(\d{2})-(\d{2})\/\d+-thumbnail\.jpg$/i);
    if (!match) return null;
    date(`${match[2]}-${match[3]}-${match[4]}`);
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][Number(match[3])-1];
    return `${WEB}/${match[1]}-${month}-${match[4]}-${match[2]}-p-${record.pageNumber}/`;
  } catch {return null;}
}

/** NewspaperArchive's dedicated API, served by Storied, uses the existing Storied account/session. */
export class NewspaperArchiveClient {
  constructor(private api: Pick<StoriedClient, 'call' | 'me' | 'refresh'>, private http = new NewspaperArchiveHttp()) {}
  static async open(anonymous = false) {return new NewspaperArchiveClient(await StoriedClient.open(anonymous));}
  call(name: string, input: CallInput = {}) {
    const op = operations[name] ?? Object.values(operations).find(value => value === name);
    if (!op) throw new Error('Unknown NewspaperArchive read operation. Run fam newspaperarchive.api list.');
    return this.api.call(op, input);
  }
  me() {return this.api.me();}
  refresh() {return this.api.refresh();}
  async verify() {
    await this.me();
    const result = await this.call('countries');
    if (!Array.isArray(unwrap(result))) throw new NewspaperArchiveError('api-changed');
    return {authenticated: true, checkedAt: new Date().toISOString(), check: 'Storied identity and NewspaperArchive country catalog', sessionProvider: 'storied'};
  }
  async search(options: SearchOptions = {}) {
    const query = searchQuery(options), result = unwrap(await this.call('search', {query}));
    if (result.resultCount === 0 && result.searchResults == null) result.searchResults = [];
    if (!Number.isSafeInteger(result.resultCount) || result.resultCount < 0 || !Array.isArray(result.searchResults)) throw new NewspaperArchiveError('api-changed');
    const searchResults = result.searchResults.map((record: Record<string, unknown>) => ({...record, sourceUrl: sourceUrl(record)}));
    return {...result, searchResults, page: query.PN, limit: query.PS, nextPage: result.resultCount > Number(query.PN) * Number(query.PS) ? Number(query.PN) + 1 : null,
      accessNote: 'isMasked is supplied by the provider. Search success does not establish subscription access to every record or scan.'};
  }
  async publications(name: string, page = 1, limit = 20) {
    if (!name.trim()) throw new Error('A newspaper title or place is required.');
    const result = unwrap(await this.call('find-publications', {query: {name, pageNo: integer(page,1,1_000_000), pageCount: integer(limit)}}));
    if (!Array.isArray(result)) throw new NewspaperArchiveError('api-changed');
    return {items: result, page, limit, note: 'Place and publication matches. IDs run from narrowest to broadest: publication (if present), city, state, country.'};
  }
  async locations(options: {countryId?: string; stateId?: string; cityId?: string} = {}) {
    let name = 'countries', path: Record<string, number> = {};
    if (options.cityId) {if (!options.stateId) throw new Error('--city-id requires --state-id.'); name = 'publications'; path = {stateId: id(options.stateId), cityId: id(options.cityId)};}
    else if (options.stateId) {name = 'cities'; path = {stateId: id(options.stateId)};}
    else if (options.countryId) {name = 'states'; path = {countryId: id(options.countryId)};}
    const result = unwrap(await this.call(name, {path}));
    if (!Array.isArray(result)) throw new NewspaperArchiveError('api-changed');
    return {kind: name, items: result};
  }
  async dates(publicationId: string, year?: string, month?: string) {
    if (year !== undefined && (!/^\d{4}$/.test(year) || Number(year) < 1600)) throw new Error('Year must have four digits, from 1600 onward.');
    if (month !== undefined && (!year || !/^\d{1,2}$/.test(month) || Number(month) < 1 || Number(month) > 12)) throw new Error('Month must be 1–12 and requires --year.');
    return unwrap(await this.call(month ? 'publication-dates' : year ? 'publication-months' : 'publication-years', {path: {pubId: id(publicationId), ...(year ? {year} : {}), ...(month ? {month: String(Number(month))} : {})}}));
  }
  async page(url: string) {
    const parsed = checkUrl(url);
    if (!/^\/[a-z0-9][a-z0-9-]*-p-\d+\/?$/i.test(parsed.pathname)) throw new Error('Use a NewspaperArchive newspaper page URL ending in -p-N/.');
    const result = await this.http.text(parsed);
    return pageDetails(result.text, result.url);
  }
  async ocr(imageId: string, articleId?: string) {
    const result = unwrap(await this.call('ocr', {path: {imageId: id(imageId)}, ...(articleId ? {query: {articleId: id(articleId)}} : {})}));
    if (result.succeeded !== true || typeof result.text !== 'string' || !result.text.trim()) throw new Error('NewspaperArchive did not return OCR for this image. Try fam newspaperarchive.page transcript --url with its public page URL, or check subscription access.');
    return {imageId, ...(articleId ? {articleId} : {}), text: result.text, note: 'Machine OCR may contain errors; verify names and dates against the scan.'};
  }
}
export const describeOperation = (name: string) => {
  const key = operations[name] ?? Object.values(operations).find(value => value === name);
  if (!key) throw new Error('Unknown NewspaperArchive operation.');
  return operation(key);
};
