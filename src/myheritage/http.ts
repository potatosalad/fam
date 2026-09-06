import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import { parseJson, stringifyJson } from '../json.js';
import type { ApiRequest, ApiResponse, UploadBody } from '../transport-types.js';

export const FAMILYGRAPH = 'https://familygraph.myheritage.com';
export const GRAPHQL = 'https://familygraphql.myheritage.com';
export const WEB = 'https://www.myheritage.com';
export const USER_AGENT = 'MyHeritage/7.5.44 (Android 16)';
const origins = new Set([FAMILYGRAPH, GRAPHQL, WEB, 'https://origin-www.myheritage.com']);
export function checkMyHeritageUrl(url: URL): void {
  if (!origins.has(url.origin) || url.username || url.password) throw new Error('Refusing a request outside the MyHeritage API origins.');
}
export class MyHeritageHttpError extends Error {
  constructor(readonly status: number, readonly path: string, readonly retryAfter?: string) {
    super(`MyHeritage HTTP ${status} from ${path}`);
  }
}
export class MyHeritageHttp {
  readonly jar: CookieJar;
  private readonly transport = new Impit({ browser: 'chrome', timeout: 30_000 });
  constructor(cookies?: Parameters<typeof CookieJar.deserializeSync>[0]) {
    this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();
  }
  async exchange<T = unknown>(url: string | URL, options: ApiRequest = {}): Promise<ApiResponse<T>> {
    const target = new URL(url);
    checkMyHeritageUrl(target);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(name, String(item));
    }
    const headers = new Headers({ 'Accept': 'application/json', 'Accept-Language': 'en-US', 'User-Agent': USER_AGENT, ...options.headers });
    const cookie = await this.jar.getCookieString(target.href);
    if (cookie) headers.set('Cookie', cookie);
    const raw = options.encoding === 'raw';
    if (options.body !== undefined && !raw && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (raw && options.body instanceof FormData && headers.has('content-type')) throw new Error('FormData supplies its own Content-Type.');
    let response;
    try {
      response = await this.transport.fetch(target, {
        method: options.method ?? 'GET', redirect: 'manual', headers: Object.fromEntries(headers),
        ...(options.body === undefined ? {} : { body: raw ? options.body as UploadBody : stringifyJson(options.body) }),
      });
    } catch { throw new Error(`MyHeritage network request failed for ${target.origin}${target.pathname}.`); }
    for (const cookie of response.headers.getSetCookie()) await this.jar.setCookie(cookie, target.href);
    // Redirects never carry bearer tokens to a new origin. The caller must use an evidenced API URL.
    if (!response.ok) {
      await response.text();
      throw new MyHeritageHttpError(response.status, `${target.origin}${target.pathname}`, response.headers.get('retry-after') ?? undefined);
    }
    const result = (data: unknown): ApiResponse<T> => ({data: data as T, status: response.status,
      headers: Object.fromEntries([...response.headers].filter(([k]) => !['set-cookie', 'authorization'].includes(k.toLowerCase()))) });
    if (options.response === 'void' || response.status === 204) { await response.text(); return result(undefined); }
    if (options.response === 'binary') return result(new Uint8Array(await response.arrayBuffer()));
    const text = await response.text();
    if (options.response === 'text') return result(text);
    try { return result(parseJson(text)); } catch { throw new Error(`Expected JSON from MyHeritage ${target.pathname}.`); }
  }
}

/** Signed upload/download URLs are used without account headers or cookies. No redirects. */
export async function transferMyHeritage<T = Uint8Array>(url: string, options: ApiRequest = {}): Promise<ApiResponse<T>> {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password) throw new Error('File transfers require an HTTPS URL without embedded credentials.');
  const headers = new Headers(options.headers);
  for (const key of ['authorization', 'cookie', 'proxy-authorization']) headers.delete(key);
  let response: Response;
  try {response = await fetch(target, {method: options.method ?? 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(60_000),
    ...(options.body === undefined ? {} : {body: options.body as BodyInit})});}
  catch {throw new Error('MyHeritage file transfer failed.');}
  if (!response.ok) {await response.body?.cancel(); throw new Error(`MyHeritage file transfer returned HTTP ${response.status}.`);}
  const data = options.response === 'void' || response.status === 204 ? (await response.body?.cancel(), undefined) :
    options.response === 'text' ? await response.text() : new Uint8Array(await response.arrayBuffer());
  return {status: response.status, headers: Object.fromEntries([...response.headers].filter(([k]) => !['set-cookie', 'authorization', 'location'].includes(k))), data: data as T};
}
