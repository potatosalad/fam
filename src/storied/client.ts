import {InputError} from '../shared/input-error.js';
import { operation, validate, type Operation } from './catalog.js';
import { StoriedHttp } from './http.js';
import { loadSession, saveSession, validSession, refreshStoried, type StoriedSession } from './auth.js';
import { withSessionRefresh } from '../shared/session-refresh.js';

export interface CallInput {path?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown}
export function prepareCall(op: Operation, input: CallInput = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['path', 'query', 'body'].includes(k))) throw new InputError('Call input accepts only path, query, and body.');
  for (const section of ['path', 'query'] as const) {
    const data = input[section] ?? {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError(`${section} must be an object.`);
    for (const key of Object.keys(data)) if (!op.parameters.some(p => p.in === section && p.name === key)) throw new InputError(`Unknown ${section} parameter. Run fam storied.api describe.`);
    for (const param of op.parameters.filter(p => p.in === section)) {
      const present = Object.hasOwn(data, param.name) && data[param.name] !== undefined;
      if (!present && param.required) throw new InputError(`${section}.${param.name} is required.`);
      if (present && param.schema) validate(data[param.name], param.schema, `${section}.${param.name}`);
    }
  }
  let path = op.path.replace(/\{([^}]+)\}/g, (_m, key: string) => {
    const value = input.path?.[key];
    if (!['string', 'number', 'bigint', 'boolean'].includes(typeof value) || String(value) === '.' || String(value) === '..' || String(value).includes('/')) throw new InputError('Invalid Storied path parameter.');
    return encodeURIComponent(String(value));
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined) continue;
      if (item === null || !['string', 'number', 'bigint', 'boolean'].includes(typeof item)) throw new InputError('Query values must be scalar values or arrays of scalars.');
      query.append(key, String(item));
    }
  }
  if (query.size) path += `?${query}`;
  if (input.body !== undefined) {
    if (!op.requestBody) throw new InputError('This operation has no request body.');
    if (!op.requestBody.contentType.startsWith('application/json')) throw new InputError('This operation requires a non-JSON body; it is catalog-only.');
    validate(input.body, op.requestBody.schema, 'body');
  } else if (op.requestBody) throw new InputError('Supply the request body shown by fam storied.api describe.');
  return {path, method: op.method, version: op.version, body: input.body};
}

export class StoriedClient {
  constructor(private session?: StoriedSession, private http = new StoriedHttp(), private save = saveSession) {}
  static async open(anonymous = false): Promise<StoriedClient> {
    if (anonymous) return new StoriedClient();
    const s = await loadSession();
    if (!validSession(s)) throw new Error('No valid Storied session saved. Run fam storied.session login.');
    return new StoriedClient(s);
  }
  async refresh(): Promise<void> {
    if (!this.session) throw new Error('No Storied session to refresh.');
    this.session = await refreshStoried(this.session, this.http);
    await this.save(this.session);
  }
  async call(name: string, input: CallInput = {}): Promise<unknown> {
    const op = operation(name), request = prepareCall(op, input);
    const send = () => this.http.request(request.path, {...request, token: this.session?.accessToken, sessionId: this.session?.sessionId});
    // Never replay mutations on auth failure. Expiry renewal before a write is safe.
    if (!['GET', 'HEAD'].includes(op.method)) {
      if (this.session?.refreshToken && this.session.expiresAt <= Date.now() + 60_000) await this.refresh();
      return send();
    }
    return withSessionRefresh(send, this.session?.refreshToken ? () => this.refresh() : undefined,
      !!this.session && this.session.expiresAt <= Date.now() + 60_000);
  }
  async me(): Promise<unknown> {
    if (!this.session) throw new Error('me requires a Storied session.');
    return withSessionRefresh(() => this.http.request('/userinfo', {auth: true, token: this.session!.accessToken}),
      this.session.refreshToken ? () => this.refresh() : undefined, this.session.expiresAt <= Date.now() + 60_000);
  }
  async verify() {
    const result = await this.call('trees', {query: {numberOfTrees: 1, includePersonCount: false}});
    if (!Array.isArray(result) || !this.session) throw new Error('Storied account access could not be verified.');
    this.session.validatedAt = new Date().toISOString();
    await this.save(this.session);
    return {authenticated: true, checkedAt: this.session.validatedAt, check: 'account tree list'};
  }
  async personHintCriteria(personId: string, query: Record<string, unknown> = {}) {
    const queryString = await this.call('hints', {path: {personId}, query});
    if (typeof queryString !== 'string' || !queryString.startsWith('?')) throw Object.assign(new Error('Storied did not return the expected person record-search criteria.'), {code: 'api-changed'});
    const params = new URLSearchParams(queryString.slice(1));
    const criteria = Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key)]));
    return {personId, kind: 'record-search-criteria' as const, hintRecordsReturned: false, queryString, criteria,
      note: 'These are provider search-builder criteria, not hint records. Keys and repeated values are preserved without interpreting match modes. Use fam storied.record search for a separate historical-record search.'};
  }
  trees() {return this.call('trees');}
  person(personId: string) {return this.call('person', {path: {personId}});}
  pedigree(treeId: string, personId: string, generations = 4) {return this.call('pedigree', {path: {treeId, personId, generations}});}
}
