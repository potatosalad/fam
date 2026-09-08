import {loadProviderSession} from '../shared/browser-config.js';
import {MyHeritageDocuments} from './documents.js';
import {MyHeritageResearch, type RecordSearchOptions, type CatalogOptions} from './research.js';
import {MyHeritageBrowser} from './browser.js';
import {parse} from 'graphql';
import { readPrivateJson } from '../shared/storage.js';
import { isGraphQLAuthenticationFailure, withSessionRefresh } from '../shared/session-refresh.js';
import type { ApiRequest, ApiResponse, Query } from '../familysearch/transport-types.js';
import { MyHeritageHttp, MyHeritageHttpError, FAMILYGRAPH, GRAPHQL, transferMyHeritage, checkMyHeritageUrl } from './http.js';
import { authenticateMyHeritage, refreshMyHeritage, saveMyHeritageSession, type MyHeritageSession } from './auth.js';
import { graphqlOperation, validateVariables, prepareRest, type GraphQLId, type Variables, type RestArguments } from './catalog.js';
export interface GraphQLResult<T = unknown> {data?: T | null; errors?: {message?: string; path?: (string | number)[]; extensions?: Record<string, unknown>}[];}
export class MyHeritageGraphQLError extends Error {
  constructor(readonly operation: string, readonly result: GraphQLResult) {super(`MyHeritage GraphQL ${operation} returned ${result.errors?.length ?? 0} error(s); inspect error.result in TypeScript.`);}
}
export interface Connection<T = Record<string, unknown>> {data: T[]; count?: number | bigint; paging?: {next?: string; previous?: string; [key: string]: unknown};}
interface Hooks {refresh?: (session: MyHeritageSession) => Promise<MyHeritageSession>; save?: (session: MyHeritageSession) => Promise<void>; browserLogin?: (session: MyHeritageSession) => Promise<MyHeritageSession>;}
export class MyHeritageClient {
  private refreshing?: Promise<void>;
  private browser?: MyHeritageBrowser;
  private documentsClient?: MyHeritageDocuments;
  private documents() {return this.documentsClient ??= new MyHeritageDocuments(this.session, this.http, async () => {
    if (this.hooks.save) await this.hooks.save(this.session);
    else Object.assign(this.session, await saveMyHeritageSession(this.http as MyHeritageHttp, this.session));
  });}
  document(value: string, relatedKey?: string) {return this.documents().document(value, relatedKey);}
  downloadDocument(value: string, output: string, page = 1, relatedKey?: string) {return this.documents().download(value, output, page, relatedKey);}
  private researchClient?: MyHeritageResearch;
  private research() {return this.researchClient ??= new MyHeritageResearch(this.session, this.http, async () => {
    if (this.hooks.save) await this.hooks.save(this.session);
    else Object.assign(this.session, await saveMyHeritageSession(this.http as MyHeritageHttp, this.session));
  }, this.session.browserInstance ? () => this.renewBrowser() : undefined);}
  searchRecords(options: RecordSearchOptions) {return this.research().search(options);}
  researchCatalog(options: CatalogOptions = {}) {return this.research().catalog(options);}
  searchFields(id: string) {return this.research().searchFields(id);}
  collection(id: string) {return this.research().collection(id);}
  record(value: string, related = false) {return this.research().record(value, related);}

  private web() {return this.browser ??= new MyHeritageBrowser(this.session, this.http, async () => {
    if (this.hooks.save) await this.hooks.save(this.session);
    else Object.assign(this.session, await saveMyHeritageSession(this.http as MyHeritageHttp, this.session));
  }, this.session.browserInstance ? () => this.renewBrowser() : undefined);}
  private async renewBrowser() {
    this.refreshing ??= (async () => {
      const next = this.hooks.browserLogin ? await this.hooks.browserLogin(this.session)
        : await (await import('./browser-login.js')).loginMyHeritage({treeUrl: this.session.browser?.pageUrl});
      Object.assign(this.session, next);
    })().finally(() => {this.refreshing = undefined;});
    await this.refreshing;
  }
  private native() {if (this.session.mode === 'browser') throw new Error('This operation requires a native MyHeritage API session. The imported browser session supports me, sites, trees, tree, people, find, person, facts, events, timeline, media, insights, match counts and historical record research; see docs/myheritage/README.md.');}
  constructor(private session: MyHeritageSession, private readonly http: Pick<MyHeritageHttp, 'exchange' | 'jar'> = new MyHeritageHttp(session.cookies), private readonly hooks: Hooks = {}) {}
  static async open() {
    const session = await loadProviderSession<MyHeritageSession>('myheritage') ?? await (await import('./browser-login.js')).loginMyHeritage();
    if (!session.accessToken) throw new Error('Invalid session; run fam myheritage.session login.');
    return new MyHeritageClient(session);
  }
  status() {return {authenticated: true, savedAt: this.session.savedAt, mode: this.session.mode ?? 'native'};}
  async refresh() {
    if (this.session.mode === 'browser') {await this.web().refresh(); return;}
    this.refreshing ??= (async () => {
      const next = this.hooks.refresh ? await this.hooks.refresh(this.session) : await refreshMyHeritage(this.http as MyHeritageHttp, this.session);
      if (this.hooks.refresh && this.hooks.save) await this.hooks.save(next);
      this.session = next;
    })().finally(() => {this.refreshing = undefined;});
    await this.refreshing;
  }
  async request<T = unknown>(path: string, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    this.native();
    const url = new URL(path, `${FAMILYGRAPH}/`); checkMyHeritageUrl(url);
    // Never attach bearer credentials to signed media URLs or unapproved origins.
    const access = this.session.accessToken;
    const send = async () => {const headers = new Headers(options.headers); headers.set('Authorization', `Bearer ${this.session.accessToken}`);
      const result = await this.http.exchange<T>(url, {...options, query: {lang: 'EN', app_version: '7.5.44', ...options.query}, headers: Object.fromEntries(headers)});
      if (url.origin === GRAPHQL && isGraphQLAuthenticationFailure(result.data)) throw new MyHeritageHttpError(401, url.pathname);
      return result;
    };
    const response = await withSessionRefresh(send, async () => {
      if (this.session.accessToken === access) await this.refresh();
    });
    if (this.hooks.save) await this.hooks.save(this.session);
    else this.session = await saveMyHeritageSession(this.http as MyHeritageHttp, this.session);
    return response;
  }
  async graphql<T = unknown, I extends GraphQLId = GraphQLId>(id: I, variables: Variables<I>): Promise<T> {
    const operation = graphqlOperation(id); validateVariables(operation, variables as Record<string, unknown>);
    return this.query<T>(operation.document, variables, operation.route!, operation.name);
  }
  async query<T = unknown>(document: string, variables: Record<string, unknown> = {}, route = '/', operationName?: string): Promise<T> {
    parse(document);
    const url = new URL(route, `${GRAPHQL}/`);
    if (url.origin !== GRAPHQL) throw new Error('GraphQL route must remain on the MyHeritage GraphQL origin.');
    const result = (await this.request<GraphQLResult<T>>(url.href, {method: 'POST', body: {query: document, variables, ...(operationName ? {operationName} : {})}})).data;
    if (result.errors?.length) throw new MyHeritageGraphQLError(operationName ?? 'custom', result);
    if (result.data == null) throw new Error('MyHeritage GraphQL returned no data.');
    return result.data;
  }
  async call<T = unknown>(name: string, args: RestArguments = {}): Promise<T> {
    const request = prepareRest(name, args);
    if (request.anonymous) return (await transferMyHeritage<T>(request.url, request.options)).data;
    return (await this.request<T>(request.url, request.options)).data;
  }
  me(query: Query = {}) {if (this.session.mode === 'browser') return this.web().me(); return this.call('me', {query: {fields: 'id,name,first_name,last_name,default_site.(id,name,default_tree.(id,root_individual.(id))),default_individual.(id,tree.(id))', ...query}});}
  sites(query: Query = {}) {if (this.session.mode === 'browser') return this.web().sites(); return this.call('me', {query: {fields: 'id,default_site.(id),memberships.(is_manager,visit_count,site.(id,name,plan,default_tree.(id),trees.(id,name,individual_count,root_individual.(id))))', ...query}});}
  trees(siteId: string, query: Query = {}) {if (this.session.mode === 'browser') return this.web().trees(siteId); return this.call('site', {path: {siteId}, query: {fields: 'id,name,trees.(id,name,is_public,individual_count,root_individual.(id))', ...query}});}
  tree(treeId: string, query: Query = {}) {if (this.session.mode === 'browser') return this.web().tree(treeId); return this.call('tree', {path: {treeId}, query: {fields: 'id,name,is_public,individual_count,root_individual.(id),site.(id)', ...query}});}
  person(individualId: string) {if (this.session.mode === 'browser') return this.web().person(individualId); return this.graphql('graphql.embedded.getIndividualDetails', {individualId, lang: 'EN'});}
  people(treeId: string, offset = 0, limit = 20) {
    if (this.session.mode === 'browser') return this.web().people(treeId, offset, limit);
    // Curated combination of APK getIndividualsIndexesForTree paging and searchIndividuals fields.
    return this.query(`query cliPeople($treeId: String!, $offset: BigInt!, $limit: BigInt!) {
      tree(id: $treeId) {individuals(offset: $offset, limit: $limit) {count data {
        id name first_name last_name gender is_alive birth_date {date gedcom} death_date {date gedcom}
      }}}
    }`, {treeId, offset, limit});
  }
  find(treeId: string, query: string) {if (this.session.mode === 'browser') return this.web().find(treeId, query); return this.graphql('graphql.embedded.treeQuickActionsSearchIndividual', {treeID: treeId, lang: 'EN', query});}
  events(individualId: string, query: Query = {}) {if (this.session.mode === 'browser') return this.web().person(individualId).then(p => ({data: p.facts ?? []})); return this.call('events', {path: {individualId}, query});}
  timeline(individualID: string) {if (this.session.mode === 'browser') return this.web().person(individualID).then(p => ({data: p.facts ?? []})); return this.graphql('graphql.individual.get_timeline_events', {individualID, lang: 'EN'});}
  facts(individualId: string) {if (this.session.mode === 'browser') return this.web().person(individualId).then(p => ({data: p.facts ?? []})); return this.graphql('graphql.embedded.getExistingFactsForIndividual', {individualId, lang: 'EN'});}
  matches(individualId: string, query: Query = {}) {if (this.session.mode === 'browser') return this.web().matches(individualId); return this.call('matches', {path: {individualId}, query});}
  records(individualId: string, offset = 0, limit = 20, match_status = 'confirmed') {return this.graphql('graphql.embedded.getIndividualRecords', {individualId, match_status, offset, limit, lang: 'EN'});}
  media(parentId: string, query: Query = {}) {if (this.session.mode === 'browser') return this.web().person(parentId).then(p => ({scope: 'person', ...Object.fromEntries(Object.entries(p).filter(([key]) => /photo|album|video/i.test(key)))})); return this.call('media', {path: {parentId}, query});}
  insights(individualId: string) {if (this.session.mode !== 'browser') throw new Error('insights uses a browser session; native sessions can use person.'); return this.web().insights(individualId);}
  albums(siteID: string) {return this.graphql('graphql.photos.get_albums', {siteID});}
  consistency(treeId: string, offset = 0, limit = 20) {return this.graphql('graphql.embedded.getTreeConsistencyCheckerCachedIssues', {treeId, lang: 'EN', offset, limit});}
}
