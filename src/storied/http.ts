import { randomUUID } from 'node:crypto';
import { parseJson, stringifyJson } from '../shared/json.js';

export const API_ORIGIN = 'https://api.storied.com';
export const AUTH_ORIGIN = 'https://auth.storied.com';
export const CLIENT_ID = 'fv3DapFIYX6h5bBUsU8QwZixI9bs9LLs';
export const API_CLIENT_ID = 'cc64746c-54eb-1231-a70e-3762b64fce63';
export const AUDIENCE = 'https://prodapiendpoint.com';
export type Fetch = typeof globalThis.fetch;
export class StoriedError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(`Storied request failed (HTTP ${status}${code ? `, ${code}` : ''}). Response details were suppressed.`);
  }
}

/** Secrets may only be sent to the two fixed first-party origins. Never follow redirects. */
export class StoriedHttp {
  constructor(private readonly fetcher: Fetch = globalThis.fetch) {}
  async request(path: string, options: {auth?: boolean; method?: string; token?: string; body?: unknown; sessionId?: string; version?: string} = {}): Promise<unknown> {
    const origin = options.auth ? AUTH_ORIGIN : API_ORIGIN;
    const url = new URL(path, origin);
    if (url.origin !== origin || url.username || url.password || url.hash || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
      throw new Error('Storied requests must use a relative path on the fixed provider origin.');
    }
    if (options.auth && !['/oauth/token', '/userinfo', '/.well-known/openid-configuration'].includes(url.pathname)) throw new Error('Unsupported authentication endpoint.');
    if (!options.auth && !url.pathname.startsWith('/api/')) throw new Error('Storied API paths must begin with /api/.');
    const headers: Record<string, string> = {accept: 'application/json'};
    if (!options.auth) {
      headers['wa-clientId'] = API_CLIENT_ID;
      headers['wa-requestId'] = randomUUID();
      if (options.sessionId) headers['wa-sessionId'] = options.sessionId;
      headers['x-api-version'] = options.version ?? '1.0';
    }
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetcher(url, {method: options.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(30_000),
        ...(options.body !== undefined ? {body: stringifyJson(options.body)} : {})});
    } catch {throw new Error('Storied network request failed or timed out.');}
    let text: string;
    try {text = await response.text();} catch {throw new Error('Storied response could not be read; details were suppressed.');}
    let data: unknown;
    try {data = text ? parseJson(text) : null;} catch {data = undefined;}
    if (!response.ok) {
      const error = data && typeof data === 'object' && 'error' in data ? (data as {error: unknown}).error : undefined;
      // Fixed codes only: never echo passwords, account data, remote URLs or descriptions.
      const allowed = ['invalid_grant', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type', 'access_denied', 'mfa_required', 'too_many_attempts', 'invalid_token'];
      throw new StoriedError(response.status, typeof error === 'string' && allowed.includes(error) ? error : undefined);
    }
    if (data === undefined) throw new Error('Expected JSON from Storied; response details were suppressed.');
    if (data && typeof data === 'object' && 'error' in data && 'data' in data && (data as {error: unknown}).error) throw new StoriedError(response.status, 'api-error');
    return data;
  }
}
