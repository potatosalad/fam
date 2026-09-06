import {collectionSearchFields, encodeCollectionFields, type SearchFieldValue} from './advanced-search.js';
import {load} from 'cheerio';
import type {ApiResponse, Query} from '../transport-types.js';
import {stringifyJson} from '../json.js';
import {WEB, MyHeritageHttpError, type MyHeritageHttp} from './http.js';
import type {MyHeritageSession} from './auth.js';
import {pageJson} from './page-data.js';
import {historicalRecordsQuery, collectionPageQuery, collectionCatalogQuery} from './research-queries.js';

export interface ResearchEvent {type: 'birth' | 'death' | 'marriage' | 'residence' | 'immigration' | 'military' | 'any'; year?: number; month?: number; day?: number; place?: string; yearRange?: number;}
export interface ResearchRelative {type: 'father' | 'mother' | 'spouse' | 'child' | 'sibling' | 'any'; firstName?: string; lastName?: string;}
export interface RecordSearchOptions {
  firstName?: string; lastName?: string; gender?: 'M' | 'F';
  firstNameMatch?: 'exact' | 'similar' | 'initials' | 'prefix'; lastNameMatch?: 'exact' | 'similar' | 'soundex' | 'metaphone' | 'prefix';
  translations?: boolean; fields?: Record<string, SearchFieldValue>; events?: ResearchEvent[]; relatives?: ResearchRelative[];
  keywords?: string; exact?: boolean; collection?: string; category?: string;
  recordType?: 'historical' | 'family-trees' | 'all'; limit?: number; offset?: number; after?: string;
}
export interface CatalogOptions {text?: string; category?: string; location?: string; years?: string; images?: boolean; limit?: number; offset?: number;}
type ObjectData = Record<string, any>;
interface ResearchContext {token: string; guestId: string; siteId: string; lang: string; csrf: string;}
export function researchPage(limit = 20, offset = 0) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Research limit must be an integer from 1 to 100.');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Research offset must be a nonnegative integer.');
  return {limit, offset};
}
function keys(value: object, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter(k => !allowed.includes(k));
  if (unknown.length) throw new Error(`Unknown ${label} fields: ${unknown.join(', ')}.`);
}
function text(value: unknown, name: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\x00-\x1f\\]/.test(value))) throw new Error(`Invalid ${name}.`);
}
function integer(value: unknown, name: string, min: number, max: number) {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < min || Number(value) > max)) throw new Error(`Invalid ${name}; expected ${min}–${max}.`);
}
export function contextId(value: string, type: 'collection' | 'category') {
  const id = value.replace(/^searchcategory-/, '').replace(new RegExp(`^${type}-`), '');
  if (!/^\d+$/.test(id)) throw new Error(`Expected a numeric ${type} ID or ${type}-ID.`);
  return `${type}-${id}`;
}
/** Website SearchFormComponentsConverter escaping; values cannot inject extra filters. */
export function searchValue(value: string | number | boolean): string {
  const escapes: Record<string, string> = {q: '/0', '-': '/1', '.': '/2', ' ': '/3', '*': '/4'};
  return String(value).replace(/[q\-. *]/g, c => escapes[c]!);
}
export function buildRecordSearch(options: RecordSearchOptions) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Search requires an options object.');
  keys(options, ['firstName','lastName','gender','events','relatives','keywords','exact','collection','category','recordType','limit','offset','after','firstNameMatch','lastNameMatch','translations','fields'], 'search');
  for (const key of ['firstName','lastName','keywords','collection','category','after'] as const) text(options[key], key);
  if (options.firstNameMatch !== undefined && !['exact','similar','initials','prefix'].includes(options.firstNameMatch)) throw new Error('Unknown firstNameMatch.');
  if (options.lastNameMatch !== undefined && !['exact','similar','soundex','metaphone','prefix'].includes(options.lastNameMatch)) throw new Error('Unknown lastNameMatch.');
  if (options.firstNameMatch && !options.firstName || options.lastNameMatch && !options.lastName) throw new Error('Name matching modes require the corresponding firstName or lastName.');
  if (options.translations !== undefined && typeof options.translations !== 'boolean') throw new Error('translations must be boolean.');
  if (options.fields !== undefined && (!options.collection || !options.fields || typeof options.fields !== 'object' || Array.isArray(options.fields) || !Object.keys(options.fields).length || Object.keys(options.fields).length > 50)) throw new Error('fields requires a collection and a nonempty object of at most 50 fields.');
  if (options.exact !== undefined && typeof options.exact !== 'boolean') throw new Error('exact must be a boolean.');
  if (options.gender !== undefined && !['M','F'].includes(options.gender)) throw new Error('gender must be M or F.');
  if (options.collection && options.category) throw new Error('Choose a collection or a category, not both.');
  if (options.recordType !== undefined && !['all','historical','family-trees'].includes(options.recordType)) throw new Error('Unknown recordType.');
  if ((options.collection || options.category) && options.recordType && options.recordType !== 'all') throw new Error('recordType cannot be combined with collection/category: the service otherwise discards the scope. Use recordType all or omit it.');
  const page = researchPage(options.limit, options.offset);
  const webQuery: {key: string; value: string}[] = [];
  const component = (key: string, type: string, values: Record<string, string | number | boolean | undefined>) => {
    webQuery.push({key, value: [type, ...Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}.${searchValue(v!)}`)].join(' ')});
  };
  const name = (first?: string, last?: string) => ({fn: first, fnmo: first ? options.exact ? 1 : 2 : undefined, ln: last, lnmo: last ? options.exact ? 3 : 4 : undefined});
  const advancedName: Record<string, string | number | boolean | undefined> = {...name(options.firstName, options.lastName), g: options.gender};
  if (options.firstNameMatch) Object.assign(advancedName, {fnmo: options.firstNameMatch === 'exact' ? 1 : 2,
    fnmsvos: options.firstNameMatch === 'similar', fnmsmi: ['similar','initials'].includes(options.firstNameMatch), fnmsnswl: options.firstNameMatch === 'prefix'});
  if (options.lastNameMatch) Object.assign(advancedName, {lnmo: options.lastNameMatch === 'exact' ? 3 : 4,
    lnmsdm: options.lastNameMatch === 'similar', lnmsbm: false, lnmss: options.lastNameMatch === 'soundex', lnmsmg: false,
    lnmsmf3: options.lastNameMatch === 'similar', lnmsrs: options.lastNameMatch === 'similar',
    lnmsmf: options.lastNameMatch === 'metaphone', lnmsdmf: false, lnmsswl: options.lastNameMatch === 'prefix'});
  if (options.firstName || options.lastName || options.gender) component('qname', 'Name', advancedName);
  if (options.events !== undefined && (!Array.isArray(options.events) || options.events.length > 20)) throw new Error('events must be an array of at most 20 events.');
  for (const [index, event] of (options.events ?? []).entries()) {
    if (!event || typeof event !== 'object') throw new Error('Invalid event.');
    keys(event, ['type','year','month','day','place','yearRange'], 'event');
    if (!['birth','death','marriage','residence','immigration','military','any'].includes(event.type)) throw new Error('Unknown event type.');
    integer(event.year, 'event year', 1, 9999); integer(event.month, 'event month', 1, 12); integer(event.day, 'event day', 1, 31); integer(event.yearRange, 'event yearRange', 0, 100); text(event.place, 'event place');
    if (event.year === undefined && !event.place) throw new Error('An event needs a year or place.');
    if (event.yearRange !== undefined && event.year === undefined) throw new Error('yearRange requires a year.');
    component(index === 0 ? 'qevents-event1' : `qevents-any/1event_${index}`, 'Event', {et: event.type === 'residence' ? 'livedin' : event.type,
      ed: event.day, em: event.month, ey: event.year, me: event.yearRange !== undefined || options.exact ? true : undefined,
      mer: event.yearRange || undefined, ep: event.place, epmo: event.place ? options.exact ? 'exact' : 'similar' : undefined});
  }
  if (options.events?.length) component('qevents', 'List', {});
  if (options.relatives !== undefined && (!Array.isArray(options.relatives) || options.relatives.length > 20)) throw new Error('relatives must be an array of at most 20 relatives.');
  for (const [index, relative] of (options.relatives ?? []).entries()) {
    if (!relative || typeof relative !== 'object') throw new Error('Invalid relative.');
    keys(relative, ['type','firstName','lastName'], 'relative'); text(relative.firstName, 'relative firstName'); text(relative.lastName, 'relative lastName');
    if (!['father','mother','spouse','child','sibling','any'].includes(relative.type) || !relative.firstName && !relative.lastName) throw new Error('A relative needs a relationship type and name.');
    const relativeKey = index === 0 ? 'relative' : `addRelative_${index}`;
    const nameKey = index === 0 ? 'relative_relativeName' : `${relativeKey}_addRelativeName`;
    // The pointer is protocol syntax, and the referenced component is a separate entry.
    webQuery.push({key: `qrelatives-${relativeKey}`, value: `Relative rt.${relative.type} rn.*q${nameKey}`});
    component(`q${nameKey}`, 'Name', name(relative.firstName, relative.lastName));
  }
  if (options.relatives?.length) component('qrelatives', 'List', {});
  if (options.keywords) component('qkeywords', 'Keyword', {kw: options.keywords});
  if (!webQuery.length && !options.fields) throw new Error('Supply at least a name, event, relative or keyword to search records.');
  const hierarchy = options.collection ? contextId(options.collection, 'collection') : options.category ? contextId(options.category, 'category') : 'category-1';
  return {...page, webQuery, hierarchy, recordType: options.recordType ?? (options.collection || options.category ? 'all' : 'historical')};
}
export function recordUrl(value: string): URL {
  if (value.startsWith('record-')) throw new Error('Use the link URL returned by record search; a bare record ID does not resolve to a record page.');
  const url = new URL(value, WEB);
  if (url.origin !== WEB || url.username || url.password || !/^\/research\/record-[\w-]+(?:\/[^?#]*)?$/.test(url.pathname)) throw new Error('Expected a MyHeritage research record URL from the link field of search results.');
  return url;
}
function plainHtml(value: string) {const $ = load(value); $('script,style,noscript').remove(); $('br').replaceWith(' '); $('div,p,li').append(' '); return $.root().text().replace(/\s+/g, ' ').trim();}
export function parseRecordPage(html: string, url: string) {
  const $ = load(html), identity = pageJson<ObjectData>(html, 'recordData');
  if (!identity?.collectionId || !identity?.itemId) throw new Error('Record page is unavailable with this session or the page format changed.');
  const fields = $('.recordFieldsRow').toArray().flatMap(row => {
    const label = plainHtml($(row).find('.recordFieldLabel').html() ?? ''), cell = $(row).find('.recordFieldValue');
    if (!label || !cell.length) return [];
    const links = cell.find('a[href]').toArray().flatMap(a => {try {const u = new URL($(a).attr('href')!, url); return /^https?:$/.test(u.protocol) ? [{text: plainHtml($(a).html() ?? ''), url: u.href}] : [];} catch {return [];}});
    return [{name: $(row).attr('data-field-id'), label, value: plainHtml(cell.html() ?? ''), links}];
  });
  const images = [...new Set($('.recordImageContainer img[src], .recordImageBoxContainer img[src]').toArray().map(i => $(i).attr('src')!).filter(u => /^https:\/\//.test(u) && !/spacer|silhouette/i.test(u)))];
  return {id: `record-${identity.collectionId}-${identity.itemId}${identity.groupId ? `-${identity.groupId}` : ''}`, url,
    title: fields.find(f => f.name === 'NAME' || f.label === 'Name')?.value ?? plainHtml($('h1').first().html() ?? $('title').html() ?? ''), collectionId: String(identity.collectionId), itemId: String(identity.itemId), groupId: String(identity.groupId ?? ''),
    fields, images: images.map(url => ({url, kind: 'displayed-image' as const})), fieldsVisible: fields.length > 0,
    notices: $('.record_main_content .paywall, .record_main_content .recordPaywall').toArray().map(n => plainHtml($(n).html() ?? '')).filter(Boolean)};
}
export class MyHeritageResearchVerificationError extends Error {
  constructor() {super('MyHeritage requires website verification (HTTP 406). Search stopped without retries. Complete verification on the website, then import a fresh session with myheritage auth --har FILE.'); this.name = 'MyHeritageResearchVerificationError';}
}
export class MyHeritageResearch {
  private contextPromise?: Promise<ResearchContext>;
  constructor(private readonly session: MyHeritageSession, private readonly http: Pick<MyHeritageHttp, 'exchange' | 'jar'>, private readonly persist: () => Promise<void>) {}
  private headers(): Record<string, string> {return this.session.browser?.userAgent ? {'User-Agent': this.session.browser.userAgent} : {};}
  private context() {
    this.contextPromise ??= (async () => {
      const r = await this.http.exchange<string>(`${WEB}/research`, {headers: this.headers(), response: 'text'});
      const data = pageJson<ObjectData>(r.data, 'clientData'), csrf = pageJson<string>(r.data, 'mhXsrfToken');
      if (data?.user?.isLoggedIn !== true || typeof data.fgToken !== 'string' || !csrf) throw new Error('Record research needs a signed-in website session. Import a fresh HAR with myheritage auth --har FILE.');
      this.session.accessToken = data.fgToken; await this.persist();
      return {token: data.fgToken, guestId: String(data.user.guestId), siteId: String(data.user.siteId), lang: String(data.lang), csrf};
    })().catch(error => {this.contextPromise = undefined; throw error;});
    return this.contextPromise;
  }
  private async gql(document: string, description: string, variables: ObjectData = {}): Promise<ApiResponse<ObjectData>> {
    const c = await this.context(), cookie = this.http.jar.getCookiesSync(WEB).find(x => x.key === 'PHPSESSID')?.value;
    if (!cookie) throw new Error('Missing website session cookie; import a fresh HAR.');
    const query = document.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/\s*([{}():,])\s*/g, '$1').trim();
    const body = new URLSearchParams({bearer_token: c.token, query: JSON.stringify(query), operation: '', variables: stringifyJson(variables),
      description, guest_id: c.guestId, site_id: c.siteId, 'mhc#PHPSESSID': cookie});
    const r = await this.http.exchange<ObjectData>(`${WEB}/web-family-graphql/${description.replace(/['"]/g, '').toLowerCase().match(/[a-z0-9]+/g)!.join('_')}/`, {
      method: 'POST', headers: {...this.headers(), Origin: WEB, 'Content-Type': 'application/x-www-form-urlencoded'}, encoding: 'raw', body: body.toString(),
    }).catch(error => {if (error instanceof MyHeritageHttpError && error.status === 406) throw new MyHeritageResearchVerificationError(); throw error;});
    if (r.data.errors?.length || !r.data.data) throw new Error(`MyHeritage research ${description} returned GraphQL errors or no data; no login retry was attempted.`);
    await this.persist(); return r;
  }
  async search(options: RecordSearchOptions) {
    const built = buildRecordSearch(options);
    let formId = 'master';
    if (options.fields) {
      const meta = await this.collection(options.collection!);
      const extra = encodeCollectionFields(options.fields, collectionSearchFields(meta), searchValue);
      for (const field of extra) {const i = built.webQuery.findIndex(q=>q.key===field.key); if (i >= 0) throw new Error(`Field ${field.key} duplicates a standard search option.`); built.webQuery.push(field);}
      formId = meta.formConfig?.id ?? meta.formComponents?.id ?? formId;
    }
    const c = await this.context();
    const r = await this.gql(historicalRecordsQuery(c.lang, built.limit, options.after), 'search in historical records', {query: {
      response_fields: ['results','collection','summary'], offer_free_trial: false, offer_free_trial_reason: 'affiliates search',
      limit: built.limit, offset: built.offset, debug: false, dry_run: false,
      request: {web_query: built.webQuery, additional_options: {fallback_policy: 'supersearch', hierarchy_context: built.hierarchy,
        search_form_id: formId, search_form_mode: 'advanced',
        use_translations: options.translations ?? true, search_request_type: options.after ? 'complete' : 'initial',
        ...(built.recordType === 'all' ? {} : {record_type_filter: [built.recordType]})}}, additional_params: [],
    }});
    const response = r.data.data.search_query_upload?.response, results = response?.results;
    if (!Array.isArray(results?.data) || results.count === undefined) throw new Error('Record search returned no result connection.');
    if (options.collection && results.data.some((row: ObjectData) => row.record?.collection?.id !== built.hierarchy)) throw new Error('The service returned records outside the requested collection; refusing misleading scoped results.');
    const data = results.data.map((row: ObjectData) => ({...row.record, record_type: row.record_type, user_info: row.user_info, cursor: row.cursor}));
    return {query: options, count: results.count, returned: data.length, offset: built.offset, limit: built.limit,
      nextOffset: data.length && BigInt(built.offset + built.limit) < BigInt(results.count) ? built.offset + built.limit : null,
      lastCursor: data.at(-1)?.cursor ?? null, summary: response.summary, data, serviceStatus: r.status,
      ...(r.status !== 200 ? {notice: `The service returned status ${r.status} with results. Access to each full record still depends on the session.`} : {})};
  }
  async catalog(options: CatalogOptions = {}) {
    keys(options, ['text','category','location','years','images','limit','offset'], 'catalog');
    const page = researchPage(options.limit, options.offset);
    for (const key of ['text','category','location','years'] as const) text(options[key], key);
    if (options.images !== undefined && typeof options.images !== 'boolean') throw new Error('images must be a boolean.');
    const args: string[] = [];
    if (options.category) args.push(`category: ${JSON.stringify(contextId(options.category, 'category').replace(/^category-/, 'searchcategory-'))}`);
    if (options.location) args.push(`location: ${JSON.stringify(options.location.startsWith('searchlocation-') ? options.location : `searchlocation-${options.location}`)}`);
    if (options.years) args.push(`year_range: ${JSON.stringify(options.years.startsWith('searchyearrange-') ? options.years : `searchyearrange-${options.years}`)}`);
    if (options.images) args.push('only_with_images: true');
    if (options.text) args.push(`query: ${JSON.stringify(options.text)}`);
    const c = await this.context();
    const r = await this.gql(collectionCatalogQuery(c.lang, c.siteId, args.length ? `(${args.join(', ')})` : '', page.offset, page.limit), 'collection_catalog');
    const catalog = r.data.data.search?.catalog;
    if (!Array.isArray(catalog?.collections?.data)) throw new Error('Collection catalog returned no collection connection.');
    return {...catalog.collections, summary: catalog.summary, ...page, serviceStatus: r.status};
  }
  async searchFields(id: string) {const collection = await this.collection(id); return {collection: collection.id, title: collection.title, formId: collection.formConfig?.id ?? collection.formComponents?.id, fields: collectionSearchFields(collection)};}
  async collection(id: string) {
    const collection = contextId(id, 'collection'), c = await this.context();
    const r = await this.gql(collectionPageQuery, 'fetch collection page data', {collection, lang: c.lang});
    if (!r.data.data.collection) throw new Error('Collection not found or unavailable.');
    return r.data.data.collection;
  }
  private async api(path: string, query: Query, method: 'GET' | 'POST' = 'GET'): Promise<ObjectData> {
    const c = await this.context(), params = {s: c.siteId, lang: c.lang, csrf_token: c.csrf, ...query};
    const r = await this.http.exchange<ObjectData>(`${WEB}/FP/API/SuperSearch/${path}`, {method, headers: {...this.headers(), ...(method === 'POST' ? {'Content-Type': 'application/x-www-form-urlencoded'} : {})},
      ...(method === 'GET' ? {query: params} : {encoding: 'raw', body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()})});
    if (!r.data || typeof r.data !== 'object' || r.data.error || r.data.success === false || (r.data.status !== undefined && r.data.status !== 'success' && r.data.status !== 200)) throw new Error(`MyHeritage ${path} did not return success.`);
    await this.persist(); return r.data;
  }
  async record(value: string, related = false) {
    const url = recordUrl(value); await this.context();
    const r = await this.http.exchange<string>(url, {headers: this.headers(), response: 'text'});
    const record = parseRecordPage(r.data, url.href);
    const warnings: {operation: string; message: string}[] = [];
    const optional = async (operation: string, run: () => Promise<ObjectData>) => {
      try {return await run();} catch (error) {warnings.push({operation, message: error instanceof Error ? error.message : 'Request failed.'}); return undefined;}
    };
    const citation = await optional('citation', () => this.api('get-record-citation.php', {colId: record.collectionId, itemId: record.itemId}));
    const citations = Object.entries(citation?.data ?? {}).map(([label, value]) => ({label, text: plainHtml(String(value))}));
    let relatedRecords: unknown[] | undefined, relatedPeople: unknown[] | undefined;
    if (related) {
      const params = {collectionId: record.collectionId, itemId: record.itemId, groupId: record.groupId};
      const records = await optional('related records', () => this.api('get-record-strip.php', params, 'POST'));
      const people = await optional('related people', () => this.api('get-related-people-panel.php', params, 'POST'));
      relatedRecords = records?.tooltipContent; relatedPeople = people && 'relatedPeople' in people ? people.relatedPeople ?? [] : undefined;
      if (records && !Array.isArray(relatedRecords)) warnings.push({operation: 'related records', message: 'Unexpected related records response shape.'});
      if (people && !Array.isArray(relatedPeople)) warnings.push({operation: 'related people', message: 'Unexpected related people response shape.'});
    }
    await this.persist(); return {...record, citations, warnings, ...(related ? {relatedRecords, relatedPeople} : {})};
  }
}
