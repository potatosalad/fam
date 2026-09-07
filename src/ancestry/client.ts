import { readPrivateJson } from '../shared/storage.js';
import type { ApiRequest, ApiResponse, Query } from '../familysearch/transport-types.js';
import { AncestryHttp, AncestryHttpError, GATEWAY, checkAncestryUrl } from './http.js';
import { authenticateAncestry, saveAncestrySession, tokenRequest, type AncestrySession } from './auth.js';
import { graphqlOperation, prepareRest, validateVariables, type GraphQLName, type Variables, type RestArguments } from './catalog.js';
import { recordSearchBody, type RecordSearchOptions } from './search.js';

export interface GraphQLResult<T = unknown> { data?: T | null; errors?: {message?: string; path?: (string | number)[]; extensions?: Record<string, unknown>}[]; extensions?: Record<string, unknown>; }
export class AncestryGraphQLError extends Error {
  constructor(readonly operation: string, readonly result: GraphQLResult) {
    super(`Ancestry GraphQL ${operation} returned ${result.errors?.length ?? 0} error(s). Inspect error.result in TypeScript for details or partial data.`);
  }
}
export interface TreeSummary { treeId: string; name: string; rootPersonId?: string | null; userPersonId?: string | null; personCount?: number; [field: string]: unknown; }
export interface TreeList { trees: {treeConnection: {nodes: TreeSummary[]; pageInfo: {hasNextPage: boolean; nextPageCursor?: string | null; [field: string]: unknown}}}; }
interface SessionHooks {
  refresh?: (session: AncestrySession) => Promise<AncestrySession>;
  save?: (session: AncestrySession) => Promise<void>;
}
export class AncestryClient {
  private refreshing?: Promise<void>;
  constructor(private session: AncestrySession, private readonly http: Pick<AncestryHttp, 'exchange' | 'jar'> = new AncestryHttp(session.cookies), private readonly hooks: SessionHooks = {}) {}
  static async open(): Promise<AncestryClient> {
    const session = await readPrivateJson<AncestrySession>('ancestry/session.json') ?? await authenticateAncestry();
    if (!session.tokens?.access_token || !session.tokens.refresh_token || !session.tokens.user_id) throw new Error('Invalid Ancestry session; run fam ancestry auth.');
    return new AncestryClient(session);
  }
  status() { return {authenticated: true, savedAt: this.session.savedAt, expiresAt: this.session.expiresAt ? new Date(this.session.expiresAt).toISOString() : null}; }
  async refresh(): Promise<void> {
    if (!this.refreshing) this.refreshing = (async () => {
      if (this.hooks.refresh) this.session = await this.hooks.refresh(this.session);
      else {
        const tokens = await tokenRequest(this.http as AncestryHttp, {grant_type: 'refresh_token', refresh_token: this.session.tokens.refresh_token}, true);
        tokens.user_id ??= this.session.tokens.user_id;
        this.session = await saveAncestrySession(this.http as AncestryHttp, tokens, this.session.deviceId);
      }
    })().finally(() => { this.refreshing = undefined; });
    await this.refreshing;
  }
  async request<T = unknown>(path: string, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const url = new URL(path, `${GATEWAY}/`);
    checkAncestryUrl(url); // Before refresh, so invalid requests never access credentials/network.
    if (this.session.expiresAt && this.session.expiresAt <= Date.now() + 30_000) await this.refresh();
    const access = this.session.tokens.access_token;
    const send = () => this.http.exchange<T>(url, {...options, headers: {
      'Ancestry-ClientPath': 'Mobile.AndroidApp', 'Ancestry-CultureId': 'en-US', 'X-PreferredCountry': 'US',
      ...options.headers, Authorization: `Bearer ${this.session.tokens.access_token}`, 'Ancestry-UserId': this.session.tokens.user_id!,
    }});
    let response;
    try { response = await send(); }
    catch (error) {
      if (!(error instanceof AncestryHttpError) || error.status !== 401) throw error;
      if (this.session.tokens.access_token === access) await this.refresh();
      response = await send(); // One retry only after a definitive 401, including read POSTs.
    }
    if (this.hooks.save) await this.hooks.save(this.session);
    else this.session = await saveAncestrySession(this.http as AncestryHttp, this.session.tokens, this.session.deviceId, this.session.expiresAt);
    return response;
  }
  async graphql<T = unknown, N extends GraphQLName = GraphQLName>(name: N, variables: Variables<N>): Promise<T> {
    const operation = graphqlOperation(name);
    validateVariables(operation, variables as Record<string, unknown>);
    const {data} = await this.request<GraphQLResult<T>>('/graphql/federation', {method: 'POST', body: {operationName: operation.name, query: operation.document, variables}});
    if (data.errors?.length) throw new AncestryGraphQLError(operation.name, data);
    if (data.data == null) throw new Error(`Ancestry GraphQL ${operation.name} returned no data.`);
    return data.data;
  }
  async call<T = unknown>(name: string, args: RestArguments = {}): Promise<T> {
    const request = prepareRest(name, args, this.session.tokens.user_id);
    return (await this.request<T>(request.url, request.options)).data;
  }
  trees(limit = 20, nextPageCursor?: string) { return this.graphql<TreeList, 'GetTreeList'>('GetTreeList', {limit, nextPageCursor}); }
  tree(treeId: string) { return this.graphql('GetTree', {treeId}); }
  person(treeId: string, personId: string) { return this.call('persons.get', {path: {treeId, personId}}); }
  relatives(treeId: string, personId: string, query: Query = {}) { return this.call('persons.relationships', {path: {treeId, personId}, query: {genup: 2, gendown: 1, siblings: true, spouses: true, childLimit: 20, ...query}}); }
  research(treeId: string, personId: string) { return this.call('persons.research', {path: {treeId, personId}}); }
  hints(treeId: string, personId: string, limit = 20) { return this.graphql('GetPersonsHints', {treeId, personIds: [personId], limit}); }
  search(options: RecordSearchOptions) { return this.call('search.records', {body: recordSearchBody(options, this.session.tokens.user_id!)}); }
  record(collectionId: string, recordId: string) {
    return this.call('records.get', {body: {RequestContext: {Data: {CultureId: 'en-US'}},
      Documents: [{CollectionId: collectionId, RecordId: recordId}],
      Features: [{Name: 'IncludeContentRights'}, {Name: 'IncludeCollectionMetadata'}, {Name: 'IncludeHouseholdMembers'},
        {Name: 'DisplayFields', Options: {IncludeEmptyFields: true, MarkEstimatedYearsWithAbt: true, ConvertNumericMonthsToAbbreviatedMonths: false}}]}});
  }
}
