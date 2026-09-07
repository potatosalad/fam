import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import { parseJson } from '../shared/json.js';

export const WEB = 'https://en.geneanet.org';
export const TREE = 'https://gw.geneanet.org';
export const API = 'https://api.geneanet.org';
const origins = new Set([WEB, TREE, API, 'https://www.geneanet.org', 'https://static.geneanet.org']);
const cookieOrigins = new Set([WEB, TREE, API, 'https://www.geneanet.org']);
export function checkUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Expected an absolute Geneanet HTTPS URL.'); }
  if (!origins.has(url.origin) || url.username || url.password || url.hash) throw new Error('Refusing a request outside the supported Geneanet origins.');
  return url;
}
export class GeneanetError extends Error {
  constructor(readonly code: 'http' | 'verification-required' | 'session-rejected' | 'api-changed', readonly status?: number) {
    super(code === 'verification-required' ? 'Geneanet requires browser verification for this request. Open the page on the website; the request was not retried.'
      : code === 'session-rejected' ? 'Geneanet did not return the expected signed-in account. Run fam geneanet.session login.'
      : code === 'api-changed' ? 'Geneanet response format changed or this capability is unavailable.'
      : `Geneanet HTTP ${status}; check access rights or subscription on the website. The request was not retried.`);
    this.name = 'GeneanetError';
  }
}
type ResponseLike = Pick<Response, 'status' | 'headers' | 'arrayBuffer'>;
export type Transport = (url: string, init: {method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; redirect: 'manual'}) => Promise<ResponseLike>;
export interface Exchange { url: string; status: number; contentType: string; bytes: Uint8Array }
export interface RequestOptions { body?: URLSearchParams; token?: string; binary?: boolean; referer?: string; redirects?: boolean }

/** Cookies are scoped by the jar. Bearer tokens never leave the account API. */
export class GeneanetHttp {
  readonly jar: CookieJar;
  private readonly transport: Transport;
  constructor(cookies?: Parameters<typeof CookieJar.deserializeSync>[0], transport?: Transport) {
    try { this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar(); }
    catch { throw new Error('Invalid saved Geneanet cookies. Run fam geneanet.session login.'); }
    const impit = new Impit({browser: 'chrome', timeout: 30_000});
    this.transport = transport ?? ((url, init) => impit.fetch(url, init));
  }
  async request(value: string | URL, options: RequestOptions = {}): Promise<Exchange> {
    let url = checkUrl(value), body = options.body?.toString();
    if (body !== undefined && url.href !== `${WEB}/connexion/login_check`) throw new Error('Only the explicit Geneanet sign-in form may submit data.');
    if (options.token && url.origin !== API) throw new Error('Geneanet bearer tokens may only be sent to the account API.');
    for (let hop = 0; hop < 6; hop++) {
      const headers: Record<string, string> = {Accept: options.binary ? '*/*' : 'application/json,text/html;q=0.9,*/*;q=0.8'};
      if (cookieOrigins.has(url.origin)) {
        const cookie = await this.jar.getCookieString(url.href);
        if (cookie) headers.Cookie = cookie;
      }
      if (options.token && url.origin === API) headers.Authorization = `Bearer ${options.token}`;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers.Origin = WEB; headers.Referer = `${WEB}/connexion/`;
      } else if (options.referer) headers.Referer = checkUrl(options.referer).href;
      let response: ResponseLike;
      try { response = await this.transport(url.href, {method: body === undefined ? 'GET' : 'POST', headers, body, redirect: 'manual'}); }
      catch { throw new Error('Geneanet network request failed.'); }
      if (cookieOrigins.has(url.origin)) {
        try { for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, url.href); }
        catch { throw new Error('Geneanet returned an invalid session cookie.'); }
      }
      if ([301,302,303,307,308].includes(response.status)) {
        if (options.redirects === false) throw new GeneanetError('http', response.status);
        const location = response.headers.get('location');
        if (!location) throw new GeneanetError('api-changed');
        const next = checkUrl(new URL(location, url));
        // Do not resend the password, even to another first-party URL.
        if (body !== undefined && [307,308].includes(response.status)) throw new Error('Refusing to replay the Geneanet sign-in form after a redirect.');
        if (options.token && next.origin !== API) throw new Error('Refusing an account API redirect to another origin.');
        body = undefined; url = next; continue;
      }
      const maxBytes = (options.binary ? 150 : 20) * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Geneanet response exceeded the size limit.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const prefix = new TextDecoder().decode(bytes.subarray(0, 10000));
      if (/Just a moment\.\.\.|challenge-platform|cf-chl-|Enable JavaScript and cookies to continue/i.test(prefix)) throw new GeneanetError('verification-required', response.status);
      if (response.status < 200 || response.status >= 300) throw new GeneanetError(response.status === 401 ? 'session-rejected' : 'http', response.status);
      if (bytes.byteLength > maxBytes) throw new Error('Geneanet response exceeded the size limit.');
      return {url: url.href, status: response.status, contentType: response.headers.get('content-type') ?? '', bytes};
    }
    throw new Error('Geneanet redirect limit exceeded.');
  }
  async text(url: string | URL, options: RequestOptions = {}) {
    const result = await this.request(url, options);
    return {url: result.url, text: new TextDecoder().decode(result.bytes)};
  }
  async json<T>(url: string | URL, options: RequestOptions = {}): Promise<T> {
    const {text} = await this.text(url, options);
    try { return parseJson(text) as T; } catch { throw new GeneanetError('api-changed'); }
  }
}
