import {CookieJar} from 'tough-cookie';
import {fetchWithBrowser, isChallenge} from '../shared/browser-transport.js';
import {BrowserError} from '../shared/browser-config.js';
import {parseJson} from '../shared/json.js';
export const WEB = 'https://www.newspapers.com';
export const IMG = 'https://img.newspapers.com';
export class NewspapersError extends Error {
  constructor(readonly code: 'http' | 'session-rejected' | 'api-changed' | 'access-denied' | 'verification-required' | 'not-found', readonly status?: number) {
    super(code === 'session-rejected' ? 'Newspapers sign-in is required. Run fam newspapers.session login.'
      : code === 'access-denied' ? 'Newspapers did not grant this account access to the requested content.'
      : code === 'not-found' ? 'The requested Newspapers record was not found.'
      : code === 'verification-required' ? 'Newspapers requires browser verification. Use --transport browser and complete verification in the viewer.'
      : code === 'api-changed' ? 'Newspapers returned an unexpected response format.' : `Newspapers HTTP ${status}; the request was not retried.`);
    this.name = 'NewspapersError';
  }
}
export function checkUrl(value: string | URL) {
  let url: URL; try {url = new URL(value);} catch {throw new Error('Expected an absolute Newspapers HTTPS URL.');}
  if (![WEB, IMG].includes(url.origin) || url.username || url.password || url.hash) throw new Error('Refusing a request outside Newspapers.');
  return url;
}
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export class NewspapersHttp {
  readonly jar: CookieJar;
  constructor(cookies?: ReturnType<CookieJar['serializeSync']>, private transport: Transport = fetch, private userAgent?: string) {
    this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();
  }
  withCookies(cookies: ReturnType<CookieJar['serializeSync']>, userAgent?: string) {return new NewspapersHttp(cookies, this.transport, userAgent);}
  async get(value: string | URL, headers: Record<string,string> = {}) {
    let url = checkUrl(value), currentHeaders = {...headers};
    for (let hop = 0; hop < 6; hop++) {
      const cookie = await this.jar.getCookieString(url.href);
      const init: RequestInit = {method:'GET', redirect:'manual', headers:{Accept:'application/json, text/html;q=0.9, */*;q=0.8',
        ...(this.userAgent ? {'User-Agent':this.userAgent} : {}), ...currentHeaders, ...(cookie ? {Cookie:cookie} : {})}};
      let response: Response;
      try {response = await fetchWithBrowser('newspapers', url, init, () => this.transport(url.href, {...init, signal:AbortSignal.timeout(30_000)}), this.jar);}
      catch (error) {if (error instanceof BrowserError) throw error; throw new Error('Newspapers network request failed.');}
      for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, url.href, {ignoreError:true});
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); if (!location) throw new NewspapersError('api-changed');
        const next = checkUrl(new URL(location, url));
        if (next.origin !== url.origin) currentHeaders = {};
        url = next; await response.body?.cancel(); continue;
      }
      const max = 64 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > max) {await response.body?.cancel(); throw new Error('Newspapers response exceeded 64 MiB.');}
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
      if (reader) try {while (true) {const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > max) {await reader.cancel(); throw new Error('Newspapers response exceeded 64 MiB.');} chunks.push(value);}} finally {reader.releaseLock();}
      const bytes = Buffer.concat(chunks), text = () => bytes.toString('utf8');
      if (isChallenge(response.headers, text().slice(0,131072))) throw new NewspapersError('verification-required', response.status);
      if (response.status === 401) throw new NewspapersError('session-rejected',401);
      if (!response.ok) throw new NewspapersError('http', response.status);
      return {url:url.href, bytes, text, contentType:response.headers.get('content-type') ?? ''};
    }
    throw new Error('Newspapers redirect limit exceeded.');
  }
  async json(value: string | URL, headers?: Record<string,string>): Promise<any> {
    const result = await this.get(value, headers);
    try {return parseJson(result.text());} catch {throw new NewspapersError('api-changed');}
  }
}
