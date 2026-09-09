import {Impit} from 'impit';
import {CookieJar} from 'tough-cookie';
import {fetchWithBrowser, isChallenge} from '../shared/browser-transport.js';
import {BrowserError} from '../shared/browser-config.js';
import {parseJson} from '../shared/json.js';

export const WEB = 'https://www.americanancestors.org';
export const APP = 'https://app.americanancestors.org';
export const ACCOUNT = 'https://my.americanancestors.org';
const origins = new Set([WEB, APP, ACCOUNT, 'https://shop.americanancestors.org']);
export function checkUrl(value: string | URL, media = false): URL {
  let url: URL;
  try {url = new URL(value);} catch {throw new Error('Expected an absolute American Ancestors HTTPS URL.');}
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !(media ? /^\d+\.img\.americanancestors\.org$/.test(url.hostname) && !url.port : origins.has(url.origin)))
    throw new Error('Refusing a request outside the supported American Ancestors origins.');
  return url;
}
export class AmericanAncestorsError extends Error {
  constructor(readonly code: 'http' | 'session-rejected' | 'verification-required' | 'api-changed' | 'access-denied', readonly status?: number) {
    super(code === 'session-rejected' ? 'American Ancestors session is missing or rejected. Run fam americanancestors.session login; passwords are never retried automatically.'
      : code === 'verification-required' ? 'American Ancestors requires browser verification. Complete verification on the website; login was not retried.'
      : code === 'api-changed' ? 'American Ancestors response format changed or the requested capability is unavailable.'
      : code === 'access-denied' ? 'American Ancestors did not grant access to this record or image. Check membership access on its source page.'
      : `American Ancestors HTTP ${status}. The request was not retried.`);
    this.name = 'AmericanAncestorsError';
  }
}
export type Transport = (url: string, init: {method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; redirect: 'manual'}) => Promise<Pick<Response, 'status' | 'headers' | 'arrayBuffer'>>;
export class AmericanAncestorsHttp {
  readonly jar: CookieJar;
  private direct: Transport;
  constructor(cookies?: Parameters<typeof CookieJar.deserializeSync>[0], transport?: Transport) {
    try {this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();}
    catch {throw new Error('Invalid American Ancestors session cookies.');}
    const impit = new Impit({browser: 'chrome', timeout: 30_000});
    this.direct = transport ?? ((url, init) => impit.fetch(url, init));
  }
  async request(value: string | URL, options: {body?: URLSearchParams; media?: boolean; redirects?: boolean} = {}) {
    let url = checkUrl(value, options.media), body = options.body?.toString();
    if (body !== undefined && (url.origin !== ACCOUNT || url.pathname !== '/account/login')) throw new Error('Only the explicit American Ancestors login form may submit data.');
    for (let hop = 0; hop < 8; hop++) {
      const headers: Record<string, string> = {Accept: options.media ? '*/*' : 'application/json,text/html;q=0.9'};
      if (!options.media) {const cookie = await this.jar.getCookieString(url.href); if (cookie) headers.Cookie = cookie;}
      if (body !== undefined) Object.assign(headers, {'Content-Type': 'application/x-www-form-urlencoded', Origin: ACCOUNT, Referer: `${ACCOUNT}/account/login`});
      const init = {method: body === undefined ? 'GET' as const : 'POST' as const, headers, body, redirect: 'manual' as const};
      let response: Awaited<ReturnType<Transport>>;
      try {
        // Login submissions never enter challenge recovery: it can replay requests.
        response = body !== undefined ? await this.direct(url.href, init)
          : await fetchWithBrowser('americanancestors', url.href, init, () => this.direct(url.href, init), options.media ? undefined : this.jar);
      } catch (error) {if (error instanceof BrowserError) throw error; throw new Error('American Ancestors network request failed.');}
      if (!options.media) {
        try {for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, url.href);}
        catch {throw new Error('American Ancestors returned an invalid session cookie.');}
      }
      if ([301,302,303,307,308].includes(response.status)) {
        if (options.redirects === false) throw new AmericanAncestorsError('session-rejected', response.status);
        if (body !== undefined && [307,308].includes(response.status)) throw new Error('Refusing to replay an American Ancestors password after a redirect.');
        const location = response.headers.get('location'); if (!location) throw new AmericanAncestorsError('api-changed');
        const next = checkUrl(new URL(location, url), options.media);
        if (next.origin === 'https://shop.americanancestors.org' && !next.pathname.startsWith('/account/login/multipass/')) throw new Error('Unsupported American Ancestors SSO redirect.');
        url = next; body = undefined; continue;
      }
      const max = 20 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > max) throw new Error('American Ancestors response exceeded 20 MiB.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > max) throw new Error('American Ancestors response exceeded 20 MiB.');
      if (isChallenge(response.headers, new TextDecoder().decode(bytes.subarray(0,131072)))) throw new AmericanAncestorsError('verification-required', response.status);
      if (response.status < 200 || response.status >= 300) throw new AmericanAncestorsError(response.status === 401 ? 'session-rejected' : 'http', response.status);
      return {url: url.href, bytes, contentType: response.headers.get('content-type') ?? ''};
    }
    throw new Error('American Ancestors redirect limit exceeded.');
  }
  async text(value: string | URL, options: Parameters<AmericanAncestorsHttp['request']>[1] = {}) {
    const response = await this.request(value, options); return {url: response.url, text: new TextDecoder().decode(response.bytes)};
  }
  async json(value: string | URL): Promise<any> {
    const {text} = await this.text(value); try {return parseJson(text);} catch {throw new AmericanAncestorsError('api-changed');}
  }
}
