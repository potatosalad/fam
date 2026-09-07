import { authenticateChurch, CHURCH_CLIENT_ID, loadCredentials, validateTokens, type SavedSession, type Tokens } from './auth.js';
import { FS_ORIGIN, HttpError, HttpSession, MOBILE_USER_AGENT } from './http.js';
import { readPrivateJson, writePrivateJson } from '../shared/storage.js';
import type { FamilySearchUser, GedcomX, MobileDocument, MobileLogin } from './types.js';
import type { ApiRequest, ApiResponse, Query } from './transport-types.js';
import { createGenealogyApi, decodeOperationResponse, prepareOperation } from './operations.js';
import type { GenealogyApi, OperationArgs, OperationName, OperationOutput } from './generated/operations.js';
import { ResearchClient } from './research.js';
import { ResearchTransport, isResearchPath, researchUrl } from './research-transport.js';
import { refreshFamilySearchTokens } from './session.js';

export function apiUrl(path: string, query: Query = {}): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error('Supply an absolute API path, not a URL.');
  const url = new URL(path, FS_ORIGIN);
  if (url.origin !== FS_ORIGIN || (!url.pathname.startsWith('/platform/') && !url.pathname.startsWith('/service/mobile/api/'))) {
    throw new Error('Requests must stay within the FamilySearch API paths.');
  }
  for (const [name, value] of Object.entries(query)) if (value !== undefined) {
    url.searchParams.delete(name);
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
  }
  if ([...url.searchParams.keys()].some(key => ['access_token', 'sessionid', 'fssessionid', 'refresh_token'].includes(key.toLowerCase()))) throw new Error('Send authentication in headers, not URL parameters.');
  return url;
}
function personId(id: string): string {
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{3,4}$/i.test(id)) throw new Error('Expected a FamilySearch person ID such as XXXX-XXX.');
  return id.toUpperCase();
}
function generations(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error('Generations must be an integer from 1 through 8.');
  return value;
}

export class FamilySearchClient {
  readonly genealogy: GenealogyApi;
  readonly research: ResearchClient;
  private http: HttpSession;
  private session?: SavedSession;
  private authenticating?: Promise<void>;
  private constructor(session?: SavedSession) {
    this.session = session;
    this.http = new HttpSession(session?.cookies);
    this.genealogy = createGenealogyApi(this);
    this.research = new ResearchClient(new ResearchTransport(async action => {
      const renewed = await this.ensureSession();
      const accessToken = this.session!.tokens.access_token;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await action(this.http, this.headers());
          await this.persist();
          return result;
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 401 || attempt !== 0 || renewed) throw error;
          if (this.session!.tokens.access_token === accessToken) await this.renew();
        }
      }
      throw new Error('Document request remained unauthorized after renewal.');
    }));
  }

  static async open(): Promise<FamilySearchClient> {
    const session = await readPrivateJson<SavedSession>('session.json');
    if (session) {
      if (session.version !== 1 || session.clientId !== CHURCH_CLIENT_ID || !Number.isFinite(Date.parse(session.obtainedAt))) throw new Error('Unsupported or invalid saved session.');
      validateTokens(session.tokens);
    }
    return new FamilySearchClient(session);
  }

  status() {
    return { authenticated: !!this.session, hasRefreshToken: !!this.session?.tokens.refresh_token, obtainedAt: this.session?.obtainedAt };
  }

  async login(): Promise<void> {
    if (!this.authenticating) {
      this.authenticating = (async () => {
        this.http = new HttpSession();
        this.session = await authenticateChurch(this.http, await loadCredentials());
      })().finally(() => { this.authenticating = undefined; });
    }
    await this.authenticating;
  }

  private headers(accept = 'application/json'): Record<string, string> {
    if (!this.session) throw new Error('Not authenticated.');
    return { Accept: accept, Authorization: `Bearer ${this.session.tokens.access_token}`, 'User-Agent': MOBILE_USER_AGENT, 'FS-User-Agent-Chain': MOBILE_USER_AGENT };
  }

  private async persist(tokens?: Tokens) {
    if (!this.session) throw new Error('Not authenticated.');
    if (tokens) {
      validateTokens(tokens);
      this.session.tokens = tokens;
      this.session.obtainedAt = new Date().toISOString();
    }
    this.session.cookies = this.http.jar.serializeSync();
    await writePrivateJson('session.json', this.session);
  }

  async refresh(): Promise<void> {
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      if (!this.session) throw new Error('No FamilySearch session; run fam familysearch.session login.');
      await this.persist(await refreshFamilySearchTokens(this.http, this.session));
    })().finally(() => { this.authenticating = undefined; });
    await this.authenticating;
  }

  private async ensureSession(): Promise<boolean> {
    if (this.authenticating) {await this.authenticating; return true;}
    if (!this.session) {await this.login(); return true;}
    if (this.session.tokens.refresh_token && this.session.tokens.expires_in !== undefined
      && Date.now() >= Date.parse(this.session.obtainedAt) + this.session.tokens.expires_in * 1000 - 30_000) {
      await this.renew(); return true;
    }
    return false;
  }

  private async renew(): Promise<void> {
    await this.refresh();
  }

  async get<T = unknown>(path: string, query: Record<string, string | number | boolean | undefined> = {}, accept = 'application/json'): Promise<T> {
    if (path.startsWith('/') && isResearchPath(new URL(path, FS_ORIGIN).pathname)) {
      const url = researchUrl(path);
      for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
      return this.research.transport.json<T>(url.href, { accept });
    }
    // Validate before loading credentials or making an authentication request.
    const url = apiUrl(path, query);
    return this.authenticatedJson<T>(url, undefined, accept);
  }

  /** Authenticated raw API access; typed genealogy methods validate their input first. */
  async request<T = unknown>(path: string, options: ApiRequest = {}): Promise<T> {
    return (await this.requestDetailed<T>(path, options)).data;
  }

  async requestDetailed<T = unknown>(path: string, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const url = apiUrl(path, options.query);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (/^(authorization|cookie|host|user-agent|fs-user-agent-chain|content-length)$/i.test(name)) throw new Error('Authentication and transport headers are managed by the client.');
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error('Invalid API header.');
    }
    if (options.body !== undefined && (options.method ?? 'GET') === 'GET') throw new Error('GET requests cannot have a body.');
    if (options.encoding === 'raw' && options.body !== undefined && !(typeof options.body === 'string' || options.body instanceof FormData || options.body instanceof Blob || options.body instanceof Uint8Array)) throw new Error('Raw request bodies must be replayable text, bytes, Blob, or FormData.');
    const renewed = await this.ensureSession();
    const accessToken = this.session!.tokens.access_token;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const headers = new Headers(this.headers());
        for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
        const result = await this.http.exchange<T>(url, { ...options, headers: Object.fromEntries(headers) });
        await this.persist();
        return result;
      } catch (error) {
        // Only a definitive authentication rejection is retried; network errors and 5xx
        // are ambiguous for writes and are returned without replaying the mutation.
        if (!(error instanceof HttpError) || error.status !== 401 || attempt !== 0 || renewed) throw error;
        if (this.session!.tokens.access_token === accessToken) await this.renew();
      }
    }
    throw new Error('Request remained unauthorized after session renewal.');
  }

  async operation<K extends OperationName>(name: K, ...args: OperationArgs<K>): Promise<OperationOutput<K>> {
    return (await this.operationDetailed(name, ...args)).data;
  }

  async operationDetailed<K extends OperationName>(name: K, ...args: OperationArgs<K>): Promise<ApiResponse<OperationOutput<K>>> {
    const { path, options } = prepareOperation(name, args[0]);
    const result = await this.requestDetailed(path, options);
    return { ...result, data: decodeOperationResponse(name, result.data) as OperationOutput<K> };
  }

  private async authenticatedJson<T>(url: URL, body?: unknown, accept = 'application/json'): Promise<T> {
    const renewed = await this.ensureSession();
    const accessToken = this.session!.tokens.access_token;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.http.json<T>(url, body, this.headers(accept));
        await this.persist();
        return result;
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 401 || attempt !== 0 || renewed) throw error;
        // Another concurrent request may already have renewed this token.
        if (this.session!.tokens.access_token === accessToken) await this.renew();
      }
    }
    throw new Error('Request remained unauthorized after session renewal.');
  }

  async currentUser(): Promise<FamilySearchUser> {
    const result = await this.get<{ users: FamilySearchUser[] }>('/platform/users/current', {}, 'application/x-fs-v1+json');
    if (!result.users?.[0]) throw new Error('Current-user response did not include a user.');
    return result.users[0];
  }
  person(id: string): Promise<GedcomX> {
    return this.get(`/platform/tree/persons/${personId(id)}`, {}, 'application/x-gedcomx-v1+json');
  }
  ancestry(id: string, depth = 2): Promise<GedcomX> {
    return this.get('/platform/tree/ancestry', { person: personId(id), generations: generations(depth) }, 'application/x-gedcomx-v1+json');
  }
  mobilePerson(id: string): Promise<MobileDocument> {
    return this.get(`/service/mobile/api/v2/tree/person/${personId(id)}`);
  }
  mobilePedigree(id: string, depth = 2): Promise<MobileDocument> {
    return this.get(`/service/mobile/api/v2/pedigree/ancestry/${personId(id)}/portrait`, { numGenerations: generations(depth), includeGoldenHints: false });
  }
  treeStatus(): Promise<MobileDocument> {
    return this.get('/service/mobile/api/v1/user/tree/status');
  }

  async loginMetadata(): Promise<Omit<MobileLogin, 'access_token' | 'refresh_token'>> {
    const result = await this.authenticatedJson<MobileLogin>(new URL(`${FS_ORIGIN}/service/mobile/api/v1/login?includeScopes=true`), {
      grant_type: 'password', deviceRegistrationToken: '', appId: 'org.familysearch.mobile', currentTreeId: '',
    });
    if (result.access_token) await this.persist({ ...this.session!.tokens, access_token: result.access_token, refresh_token: result.refresh_token ?? this.session!.tokens.refresh_token });
    const { access_token: _access, refresh_token: _refresh, ...metadata } = result;
    return metadata;
  }
}
