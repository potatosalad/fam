import { readPrivateJson } from '../storage.js';
import { Kind, parse } from 'graphql';
import { graphqlOperation, validateDocument } from './catalog.js';
import { FindagraveHttp, GRAPHQL, ORIGIN, checkUrl } from './http.js';
import { saveSession, sessionStatus, type FindagraveSession } from './auth.js';
import { prepareRest, type RestArguments } from './rest.js';
import type { ApiRequest, ApiResponse } from '../transport-types.js';

type Http = Pick<FindagraveHttp, 'exchange'> & Partial<Pick<FindagraveHttp, 'jar'>>;
export class FindagraveGraphQLError extends Error {
  constructor(readonly operationName: string, readonly codes: string[]) {
    super(`Find a Grave GraphQL operation ${operationName} failed${codes.length ? ` (${codes.join(', ')})` : ''}.`);
    this.name = 'FindagraveGraphQLError';
  }
}
export class FindagraveClient {
  constructor(private session?: FindagraveSession, private readonly http: Http = new FindagraveHttp(session?.cookies),
    private readonly save: (session: FindagraveSession) => Promise<void> = saveSession) {}
  static async open(anonymous = false) {
    const session = anonymous ? undefined : await readPrivateJson<FindagraveSession>('findagrave/session.json');
    if (!anonymous && (!session?.token || !session.contributorId)) throw new Error('No Find a Grave session; run findagrave credentials and findagrave auth, or use --anonymous for public reads.');
    return new FindagraveClient(session);
  }
  status() { return sessionStatus(this.session); }
  async request<T = unknown>(url: string, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const target = new URL(url, ORIGIN); checkUrl(target);
    if (Object.keys(options.headers ?? {}).some(k => /^(fgm|fgmseed|authorization|cookie|host|ak)$/i.test(k))) throw new Error('Account headers are managed by the client.');
    const headers = {...options.headers, ...(target.origin === ORIGIN && this.session ? {fgm: this.session.contributorId, fgmSeed: this.session.token} : {})};
    return this.http.exchange<T>(target, {...options, headers});
  }
  async query<T = unknown>(document: string, variables: Record<string,unknown> = {}, name?: string, headers?: Record<string,string>): Promise<T> {
    const operationName = validateDocument(document, variables, name);
    // Authentication can return session tokens; only auth handles/persists them.
    const ast = parse(document);
    const authFields = ['authenticate','authenticateOAuth','removeOAuthLink'];
    const hasAuth = (node: unknown): boolean => {
      if (!node || typeof node !== 'object') return false;
      if ('kind' in node && node.kind === Kind.FIELD && 'name' in node && authFields.includes((node.name as {value: string}).value)) return true;
      return Object.entries(node).some(([key,value]) => key !== 'loc' && (Array.isArray(value) ? value.some(hasAuth) : hasAuth(value)));
    };
    if (hasAuth(ast)) throw new Error('Authentication operations are managed by findagrave auth.');
    const {data} = await this.request<{data?: T; errors?: {extensions?: {code?: string}}[]}>(GRAPHQL,
      {method: 'POST', headers, body: {operationName, query: document, variables}});
    if (data.errors?.length) {
      const known = ['UNAUTHENTICATED','FORBIDDEN','BAD_USER_INPUT','GRAPHQL_VALIDATION_FAILED','INTERNAL_SERVER_ERROR'];
      throw new FindagraveGraphQLError(operationName, [...new Set(data.errors.map(e => e.extensions?.code).filter((c): c is string => !!c && known.includes(c)))]);
    }
    if (data.data == null) throw new Error(`Find a Grave ${operationName} returned no data.`);
    return data.data;
  }
  graphql<T = unknown>(name: string, variables: Record<string,unknown> = {}) {
    const op = graphqlOperation(name); return this.query<T>(op.document, variables, op.name, op.headers);
  }
  async call(name: string, input: RestArguments = {}) {
    const {url, options} = prepareRest(name, input); return (await this.request(url, options)).data;
  }
  async me(): Promise<Record<string,unknown>> {
    const result = await this.graphql<{signedInContributor?: Record<string,unknown>}>('SignedInContributor');
    const profile = result.signedInContributor;
    if (!profile?.id || this.session && String(profile.id) !== this.session.contributorId) throw new Error('Find a Grave session is invalid; run findagrave auth.');
    return profile;
  }
  async validateSession() {
    if (!this.session) throw new Error('No saved session to validate.');
    await this.me();
    this.session = {...this.session, validatedAt: new Date().toISOString(), cookies: this.http.jar?.serializeSync() ?? this.session.cookies};
    await this.save(this.session); return this.status();
  }
  async memorial(id: string): Promise<Record<string,unknown>> {
    const data = await this.graphql<{memorialsById: Record<string,unknown>[]}>('memorial', {ids: [id]});
    const memorial = data.memorialsById?.find(m => String(m.id) === id);
    if (!memorial) throw new Error('Memorial was not found.');
    return memorial;
  }
  search(input: Record<string,unknown>) {
    if (!input.bio) return this.graphql('MemorialSearch', {input});
    // The live API accepts bio although the APK's older input inventory omits it.
    // Return the biography with each hit so researchers can inspect the evidence.
    const op = graphqlOperation('MemorialSearch');
    const document = op.document.replace('memorials {', 'memorials {\n            bio { value language }');
    return this.query(document, {input}, op.name, op.headers);
  }
  cemeteries(search: Record<string,unknown>) { return this.graphql('SearchCemeteries', {search}); }
  cemetery(id: string) { return this.graphql('FindCemetery', {id}); }
  contributor(id: string) { return this.graphql('FindContributor', {id: [id], ...(this.session ? {contributorId: this.session.contributorId} : {})}); }
  locations(name: string, size = 20, from = 0) { return this.graphql('LocationTypeahead', {search: {name, size, from, autocomplete: 'location', categories: ['city','county','state','loc']}}); }
  myCemeteries(size = 20, from = 0) { return this.graphql('MyCemeteries', {size, from}); }
  virtualCemeteries(contributorId = this.session?.contributorId, size = 20, from = 0) {
    if (!contributorId) throw new Error('Provide a contributor ID or sign in.');
    return this.graphql('VirtualCemeterySearch', {search: {contributorId, size, from}});
  }
  virtualCemetery(id: string, size = 20, from = 0) { return this.graphql('ListMemorialsInVirtualCemetery', {id, size, from}); }
}
