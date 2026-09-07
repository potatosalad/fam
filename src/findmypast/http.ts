import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import { parseJson, stringifyJson } from '../shared/json.js';
import type { ApiRequest, ApiResponse, UploadBody } from '../familysearch/transport-types.js';

export const TITAN = 'https://www.findmypast.co.uk/titan/marshal';
export const GRAPHQL = `${TITAN}/graphql`;
export const AUTH = 'https://auth.findmypast.com';
export const ASSETS = 'https://tree.findmypast.co.uk/api/asset/';
export const CONTENT = 'https://findmypast-titan.cdn.prismic.io/';
export const USER_AGENT = 'Findmypast/2.59.0 (Android 16; SDK 36; Google Pixel 9)';
export function checkFindmypastUrl(url: URL): void {
  if (url.username || url.password || url.hash || !(
    (['https://www.findmypast.co.uk', 'https://www.findmypast.com'].includes(url.origin) && url.pathname.startsWith('/titan/marshal/')) ||
    (url.origin === AUTH && ['/oauth/token', '/userinfo', '/.well-known/openid-configuration'].includes(url.pathname)) ||
    (url.origin === new URL(ASSETS).origin && url.pathname.startsWith('/api/asset/')) ||
    (url.origin === new URL(CONTENT).origin && url.pathname.startsWith('/api/v2'))
  )) throw new Error('Refusing a request outside the Findmypast API routes.');
}
export class FindmypastHttpError extends Error {
  constructor(readonly status: number, readonly path: string, readonly code?: string, readonly retryAfter?: string) {
    super(`Findmypast HTTP ${status} from ${path}${code ? ` (${code})` : ''}`);
    this.name = 'FindmypastHttpError';
  }
}
export class FindmypastHttp {
  readonly jar: CookieJar;
  private readonly transport = new Impit({browser: 'chrome', timeout: 30_000});
  constructor(cookies?: Parameters<typeof CookieJar.deserializeSync>[0]) { this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar(); }
  async exchange<T = unknown>(url: string | URL, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const target = new URL(url); checkFindmypastUrl(target);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(name, String(item));
    }
    const headers = new Headers({'Accept': 'application/json', 'User-Agent': USER_AGENT, ...options.headers});
    const cookie = await this.jar.getCookieString(target.href);
    if (cookie) headers.set('Cookie', cookie);
    // Content is public and has no need for account authorization.
    if (target.origin === new URL(CONTENT).origin) { headers.delete('Authorization'); headers.delete('Cookie'); }
    const raw = options.encoding === 'raw';
    if (options.body !== undefined && !raw) headers.set('Content-Type', 'application/json');
    let response;
    try {
      response = await this.transport.fetch(target, {method: options.method ?? 'GET', redirect: 'manual',
        headers: Object.fromEntries(headers), ...(options.body === undefined ? {} : {
          body: raw ? options.body as UploadBody : stringifyJson(options.body),
        })});
    } catch { throw new Error(`Findmypast network request failed for ${target.origin}${target.pathname}.`); }
    for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, target.href);
    if (!response.ok) {
      let code: string | undefined;
      const body = await response.text();
      // Report only recognized error codes, never passwords, tokens or response bodies.
      if (target.origin === AUTH) {
        try { const error = JSON.parse(body).error; if (['invalid_grant', 'invalid_request', 'mfa_required', 'mfa_registration_required', 'too_many_attempts', 'access_denied', 'unauthorized_client', 'requires_verification'].includes(error)) code = error; } catch {}
      }
      throw new FindmypastHttpError(response.status, `${target.origin}${target.pathname}`, code, response.headers.get('retry-after') ?? undefined);
    }
    const result = (data: unknown): ApiResponse<T> => ({data: data as T, status: response.status,
      headers: Object.fromEntries([...response.headers].filter(([name]) => !['set-cookie', 'authorization'].includes(name.toLowerCase())))});
    if (response.status === 204 || options.response === 'void') { await response.text(); return result(undefined); }
    if (options.response === 'binary') return result(new Uint8Array(await response.arrayBuffer()));
    const body = await response.text();
    if (options.response === 'text') return result(body);
    try { return result(parseJson(body)); } catch { throw new Error(`Expected JSON from Findmypast ${target.pathname}.`); }
  }
}
