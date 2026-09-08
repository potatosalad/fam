import {fetchWithBrowser} from '../shared/browser-transport.js';
import {BrowserError} from '../shared/browser-config.js';
import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import type { ApiRequest, ApiResponse, HttpMethod, UploadBody } from './transport-types.js';
import { parseJson, stringifyJson } from '../shared/json.js';

export const FS_ORIGIN = 'https://www.familysearch.org';
export const IDENT_ORIGIN = 'https://ident.familysearch.org';
export const CHURCH_ORIGIN = 'https://id.churchofjesuschrist.org';
const ALLOWED_ORIGINS = new Set([FS_ORIGIN, IDENT_ORIGIN, CHURCH_ORIGIN]);
export const MOBILE_USER_AGENT = 'FS-Android-Tree/5.4.4 (Linux; Android 16)';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly path: string, public readonly retryAfter?: string) {
    // Response bodies and query strings can contain credentials; never include them.
    super(`HTTP ${status} from ${path}`);
    this.name = 'HttpError';
  }
}

export function checkOrigin(url: URL): void {
  if (!ALLOWED_ORIGINS.has(url.origin) || url.username || url.password) {
    throw new Error('Refusing a request outside the FamilySearch/Church authentication origins.');
  }
}

export class HttpSession {
  readonly jar: CookieJar;
  private readonly transport: Impit;
  private fetch(url: string | URL, init: Parameters<Impit['fetch']>[1]) {
    return fetchWithBrowser('familysearch', url, init ?? {}, () => this.transport.fetch(url, init), this.jar);
  }
  constructor(cookies?: Parameters<typeof CookieJar.deserializeSync>[0]) {
    this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();
    this.transport = new Impit({ browser: 'chrome', timeout: 30_000 });
  }

  async request(url: string | URL, init: { method?: HttpMethod; headers?: Record<string, string>; body?: UploadBody } = {}): Promise<Response> {
    const target = new URL(url);
    checkOrigin(target);
    const headers: Record<string, string> = { 'Accept-Language': 'en-US', ...init.headers };
    const cookie = await this.jar.getCookieString(target.href);
    if (cookie) headers.Cookie = cookie;
    let response: Response;
    try { response = await this.fetch(target, { ...init, headers, redirect: 'manual' }); }
    catch (error) { if (error instanceof BrowserError) throw error; throw new Error(`Network request failed for ${target.origin}${target.pathname}.`); }
    for (const value of response.headers.getSetCookie()) await this.jar.setCookie(value, target.href);
    return response;
  }

  async follow(url: string, stopAt?: string): Promise<{ url: string; response?: Response; html?: string }> {
    let current = new URL(url);
    for (let step = 0; step < 20; step++) {
      if (stopAt && current.href.split('?')[0] === stopAt) return { url: current.href };
      const response = await this.request(current);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect is missing a Location header.');
        current = new URL(location, current);
        await response.text();
        continue;
      }
      if (!response.ok) throw new HttpError(response.status, `${current.origin}${current.pathname}`);
      return { url: current.href, response, html: await response.text() };
    }
    throw new Error('Authentication exceeded the redirect limit.');
  }

  async json<T>(url: string | URL, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    return (await this.exchange<T>(url, { method: body === undefined ? 'GET' : 'POST', body, headers })).data;
  }

  async exchange<T>(url: string | URL, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const target = new URL(url);
    const raw = options.encoding === 'raw';
    const headers = new Headers(options.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    if (options.body !== undefined && !raw && !headers.has('content-type')) headers.set('content-type', 'application/json');
    // The transport supplies the boundary for FormData. Never replace it with a bare media type.
    if (raw && options.body instanceof FormData && headers.has('content-type')) throw new Error('FormData must supply its own Content-Type boundary.');
    const response = await this.request(target, {
      method: options.method ?? 'GET', headers: Object.fromEntries(headers),
      ...(options.body === undefined ? {} : { body: raw ? options.body as UploadBody : stringifyJson(options.body) }),
    });
    if (!response.ok) {
      await response.text();
      throw new HttpError(response.status, `${target.origin}${target.pathname}`, response.headers.get('retry-after') ?? undefined);
    }
    const safeHeaders = Object.fromEntries([...response.headers].filter(([name]) => !['set-cookie', 'authorization'].includes(name.toLowerCase())));
    const result = (data: unknown): ApiResponse<T> => ({ data: data as T, status: response.status, headers: safeHeaders });
    if (options.response === 'void' || [204, 205].includes(response.status)) { await response.text(); return result(undefined); }
    if (options.response === 'binary') return result(new Uint8Array(await response.arrayBuffer()));
    const text = await response.text();
    if (options.response === 'text') return result(text);
    try { return result(parseJson(text)); }
    catch { throw new Error(`Expected JSON from ${target.pathname}.`); }
  }
}
