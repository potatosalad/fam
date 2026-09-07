import { readPrivateJson } from '../shared/storage.js';
import { isGraphQLAuthenticationFailure, withSessionRefresh } from '../shared/session-refresh.js';
import type { ApiRequest, ApiResponse } from '../familysearch/transport-types.js';
import { AUTH, CONTENT, GRAPHQL, TITAN, FindmypastHttp, FindmypastHttpError, checkFindmypastUrl } from './http.js';
import { refreshFindmypast, saveFindmypastSession, sessionStatus, isBrowserSession, type SavedFindmypastSession, type FindmypastSession } from './auth.js';
import { graphqlOperation, prepareRest, validateDocument, type RestArguments } from './catalog.js';
export class FindmypastGraphQLError extends Error {
  constructor(readonly result: {data?: unknown; errors: unknown[]}) { super('Findmypast returned GraphQL errors; operation was not successful.'); this.name = 'FindmypastGraphQLError'; }
}
type Http = Pick<FindmypastHttp, 'exchange'> & Partial<Pick<FindmypastHttp, 'jar'>>;
export class FindmypastClient {
  private refreshing?: Promise<void>;
  constructor(private session?: SavedFindmypastSession, private readonly http: Http = new FindmypastHttp(isBrowserSession(session) ? session.cookies : undefined),
    private readonly hooks: {refresh: typeof refreshFindmypast; save: (session: SavedFindmypastSession) => Promise<void>} = {refresh: refreshFindmypast, save: saveFindmypastSession}) {}
  static async open(anonymous = false): Promise<FindmypastClient> {
    if (anonymous) return new FindmypastClient();
    const session = await readPrivateJson<SavedFindmypastSession>('findmypast/session.json');
    if (!session || !isBrowserSession(session) && !session.tokens.access_token) throw new Error('No Findmypast session; run fam findmypast.session login.');
    return new FindmypastClient(session);
  }
  status() { return sessionStatus(this.session); }
  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (!this.session) throw new Error('No Findmypast session; run fam findmypast.session login.');
    if (isBrowserSession(this.session)) {
      const profile = await this.graphql<{currentUserProfile?: {id?: string}}>('GetCurrentUserProfile');
      if (!profile.currentUserProfile?.id) throw new Error('Browser session expired; import a fresh HAR.');
      await this.saveBrowserCookies(); return;
    }
    const previous = this.session;
    this.refreshing = (async () => {
      const next = await this.hooks.refresh(previous);
      await this.hooks.save(next); this.session = next;
    })();
    try { await this.refreshing; } finally { this.refreshing = undefined; }
  }
  private async saveBrowserCookies() {
    if (isBrowserSession(this.session) && this.http.jar) {
      this.session = {...this.session, cookies:this.http.jar.serializeSync(), savedAt:new Date().toISOString()};
      await this.hooks.save(this.session);
    }
  }
  async request<T = unknown>(path: string, options: ApiRequest = {}, anonymous = false): Promise<ApiResponse<T>> {
    const url = new URL(path.startsWith('/') ? `${TITAN}${path}` : path); checkFindmypastUrl(url);
    if (url.origin === AUTH) throw new Error('Auth routes are managed by fam findmypast.session login/refresh.');
    const browser = isBrowserSession(this.session) ? this.session : undefined;
    if (browser && url.pathname.startsWith('/titan/marshal/')) {
      if (!['https://www.findmypast.co.uk/titan/marshal', 'https://www.findmypast.com/titan/marshal'].includes(browser.apiBase)) throw new Error('Invalid browser API base.');
      url.host = new URL(browser.apiBase).host;
    }
    if (browser && url.origin === 'https://tree.findmypast.co.uk') throw new Error('The legacy asset service requires native authentication; use media for browser sessions.');
    const authorized = !anonymous && url.origin !== new URL(CONTENT).origin && Boolean(this.session) && !browser;
    const token = authorized ? (this.session as FindmypastSession).tokens.access_token : undefined;
    const send = async () => {
      const result = await this.http.exchange<T>(url, {...options, headers: {...options.headers,
      ...(browser && url.pathname.startsWith('/titan/marshal/') ? browser.headers : {}),
      ...(authorized ? {Authorization: `Bearer ${(this.session as FindmypastSession).tokens.access_token}`} : {})}});
      if (url.pathname.endsWith('/graphql') && isGraphQLAuthenticationFailure(result.data)) throw new FindmypastHttpError(401, url.pathname);
      return result;
    };
    const result = await withSessionRefresh(send, authorized ? async () => {
      if (token === (this.session as FindmypastSession).tokens.access_token) await this.refresh();
    } : undefined, authorized && (this.session as FindmypastSession).expiresAt <= Date.now() + 30_000);
    if (browser) await this.saveBrowserCookies();
    return result;
  }
  async query<T = unknown>(document: string, variables: Record<string, unknown> = {}, name?: string): Promise<T> {
    const operationName = validateDocument(document, variables, name);
    const {data} = await this.request<{data?: T; errors?: unknown[]}>(GRAPHQL, {method: 'POST',
      headers: {'apollographql-client-name': 'fmp-mobile-app-android', 'apollographql-client-version': '2.59.0'},
      body: {operationName, query: document, variables}});
    if (data.errors?.length) throw new FindmypastGraphQLError({...data, errors: data.errors});
    if (!Object.hasOwn(data, 'data')) throw new Error('Findmypast response has no GraphQL data.');
    return data.data as T;
  }
  graphql<T = unknown>(name: string, variables: Record<string, unknown> = {}): Promise<T> {
    const op = graphqlOperation(name); return this.query(op.document, variables, op.name);
  }
  async call(name: string, args: RestArguments = {}) { const request = prepareRest(name, args); return (await this.request(request.url, request.options, request.anonymous)).data; }
  me() { return this.graphql('GetCurrentUserProfile'); }
  trees(limit = 20, offset = 0) { return this.graphql('GetListOfTrees', {offset, limit}); }
  tree(treeId: string) { return this.graphql('GetTreeSettings', {treeId}); }
  people(treeId: string) { return this.graphql('GetPeopleInTree', {treeId}); }
  async person(treeId: string, personId: string) {
    const result = await this.graphql<{familyTree: {familyView: {nodes: {person?: {id: string}}[]}}}>('GetFamilyViewForNode', {treeId, nodeId: personId});
    const person = result.familyTree?.familyView?.nodes.find(n => String(n.person?.id) === personId)?.person;
    if (!person) throw new Error('Person was not returned in this tree family view.');
    return person;
  }
  relatives(treeId: string, nodeId: string) { return this.graphql('GetFamilyViewForNode', {treeId, nodeId}); }
  facts(personId: string) { return this.graphql('GetFactsForPerson', {personId}); }
  hints(familyTreeId: string, personId: string, limit = 20, offset = 0) { return this.graphql('GetHintsForPerson', {familyTreeId, personId, limit, offset}); }
  media(id: string, limit = 20, offset = 0) { return this.graphql('GetPersonMedia', {id, limit, offset}); }
  search(filter: SearchFilter[], page = 1, orderBy?: {by: string; direction: 'ASCENDING' | 'DESCENDING'}) {
    return orderBy ? this.graphql('GetSearchResultsWithSort', {filter, page, orderBy}) : this.graphql('GetSearchResults', {filter, page});
  }
  collections(query = '', rows = 20, startFrom = 0) { return this.graphql('SearchRecordSets', {query, categories: [], subcategories: [], startFrom, rows}); }
  async record(recordId: string) {
    // The app hardcodes confirmedPurchase:true. CLI reads never silently confirm a credit purchase.
    const op = graphqlOperation('GetTranscriptById');
    return this.query(op.document.replace('confirmedPurchase: true', 'confirmedPurchase: false'), {recordId}, op.name);
  }
}
export interface SearchFilter { field: string; values: string[]; offset?: number; proximity?: number; variants?: boolean; }
export function searchFilters(options: {firstName?: string; lastName?: string; birthYear?: number; deathYear?: number; year?: number; yearRange?: number; country?: string; collection?: string; keywords?: string; exact?: boolean; filters?: SearchFilter[]}): SearchFilter[] {
  if (options.yearRange !== undefined && (!Number.isSafeInteger(options.yearRange) || options.yearRange < 0)) throw new Error('Year range must be a nonnegative integer.');
  if (options.yearRange !== undefined && options.birthYear === undefined && options.deathYear === undefined && options.year === undefined) throw new Error('--year-range requires --year, --birth-year, or --death-year.');
  const result = [...options.filters ?? []];
  for (const [field, value] of Object.entries({FirstName: options.firstName, LastName: options.lastName, YearOfBirth: options.birthYear,
    YearOfDeath: options.deathYear, EventYear: options.year, DatasetName: options.collection, Keywords: options.keywords, SourceCountry: options.country})) {
    if (value === undefined) continue;
    result.push({field, values: [String(value)], ...(['FirstName', 'LastName'].includes(field) ? {variants: !options.exact} : {}),
      ...(['YearOfBirth', 'YearOfDeath', 'EventYear'].includes(field) ? {offset: options.yearRange ?? 0} : {})});
  }
  if (!result.length) throw new Error('Provide a search name, date, collection, keyword, or filter.');
  for (const filter of result) {
    if (!filter || typeof filter.field !== 'string' || !filter.field || !Array.isArray(filter.values) || !filter.values.every(v => typeof v === 'string')) throw new Error('Search filters require field and string values[].');
  }
  return result;
}
