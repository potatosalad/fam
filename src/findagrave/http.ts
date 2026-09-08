import {fetchWithBrowser} from '../shared/browser-transport.js';
import {BrowserError} from '../shared/browser-config.js';
import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import { parseJson, stringifyJson } from '../shared/json.js';
import type { ApiRequest, ApiResponse, UploadBody } from '../familysearch/transport-types.js';

export const ORIGIN = 'https://www.findagrave.com';
export const GRAPHQL = `${ORIGIN}/orc/graphql`;
export const IMAGES = 'https://images.findagrave.com';
export const USER_AGENT = 'FindAGrave-Android-2349Ced0';
// Static Android application identifier, distributed in the APK, not an account secret.
export const APP_KEY = 'cb98d01e0ebd11e9abf812e7b2364c0a';
export function checkUrl(url: URL) {
  if (![ORIGIN, IMAGES].includes(url.origin) || url.username || url.password || url.hash) {
    throw new Error('Refusing a request outside Find a Grave.');
  }
}
export class FindagraveHttpError extends Error {
  constructor(readonly status: number, readonly path: string, readonly retryAfter?: string) {
    super(`Find a Grave HTTP ${status} from ${path}${status === 401 ? '; run fam findagrave.session login.' : ''}`);
    this.name = 'FindagraveHttpError';
  }
}
export class FindagraveHttp {
  readonly jar: CookieJar;
  private readonly transport = new Impit({browser: 'chrome', timeout: 30_000});
  private fetch(url: string | URL, init: Parameters<Impit['fetch']>[1]) {
    return fetchWithBrowser('findagrave', url, init ?? {}, () => this.transport.fetch(url, init), this.jar);
  }
  constructor(cookies?: Parameters<typeof CookieJar.deserializeSync>[0]) {
    this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();
  }
  async exchange<T = unknown>(url: string | URL, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const target = new URL(url); checkUrl(target);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(item));
    }
    const headers = new Headers({Accept: 'application/json', 'User-Agent': USER_AGENT, ...options.headers});
    if (target.origin === ORIGIN) {
      for (const [key, value] of Object.entries({ak: APP_KEY, locale: 'en-US', bv: '1', 'Ancestry-ClientPath': 'findagrave-android', mv: 'android:4.0.2'})) headers.set(key, value);
      const cookie = await this.jar.getCookieString(target.href);
      if (cookie) headers.set('Cookie', cookie);
    } else {
      for (const key of ['authorization', 'cookie', 'fgm', 'fgmSeed', 'ak']) headers.delete(key);
    }
    const raw = options.encoding === 'raw';
    if (options.body !== undefined && !raw) headers.set('Content-Type', 'application/json');
    let response;
    try {
      // Image requests work with the standard transport and browser headers; the
      // impersonating transport still receives a CDN challenge with those headers.
      response = target.origin === IMAGES && options.response === 'binary' && (options.method ?? 'GET') === 'GET' && options.body === undefined
        ? await fetchWithBrowser('findagrave', target, {headers}, () => fetch(target, {headers, redirect: 'manual', signal: AbortSignal.timeout(45_000)}))
        : await this.fetch(target, {method: options.method ?? 'GET', headers: Object.fromEntries(headers), redirect: 'manual',
          ...(options.body === undefined ? {} : {body: raw ? options.body as UploadBody : stringifyJson(options.body)})});
    } catch (error) { if (error instanceof BrowserError) throw error; throw new Error(`Find a Grave network request failed for ${target.pathname}.`); }
    if (target.origin === ORIGIN) for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, target.href);
    if (!response.ok) {
      await response.text();
      throw new FindagraveHttpError(response.status, target.pathname, response.headers.get('retry-after') ?? undefined);
    }
    const result = (data: unknown): ApiResponse<T> => ({data: data as T, status: response.status,
      headers: Object.fromEntries([...response.headers].filter(([name]) => !/^(set-cookie|authorization|fgmseed)$/i.test(name)))});
    if (response.status === 204 || options.response === 'void') { await response.text(); return result(undefined); }
    if (options.response === 'binary') return result(new Uint8Array(await response.arrayBuffer()));
    const text = await response.text();
    if (options.response === 'text') return result(text);
    try { return result(parseJson(text)); } catch { throw new Error(`Expected JSON from Find a Grave ${target.pathname}.`); }
  }
}
