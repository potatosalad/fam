import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {parseJson} from '../shared/json.js';

export const ARCHIVE = 'https://archive.org';
export const FULLTEXT = 'https://be-api.us.archive.org/ia-pub-fts-api';
export class InternetArchiveError extends Error {
  constructor(message: string, readonly code = 'INTERNETARCHIVE_ERROR') {super(message);}
}
export function integer(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new InternetArchiveError(`${name} must be an integer from ${min} to ${max}.`, 'INVALID_ARGUMENT');
  return value;
}
export function identifier(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value))
    throw new InternetArchiveError('Use an Internet Archive item identifier (letters, digits, dots, underscores, and hyphens), not a URL.', 'INVALID_ARGUMENT');
  return value;
}
export function fileUrl(id: string, name: string): string {
  identifier(id);
  if (typeof name !== 'string' || !name || /[\x00-\x1f\x7f\\]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..'))
    throw new InternetArchiveError('Invalid archive file name.', 'INVALID_ARGUMENT');
  return `${ARCHIVE}/download/${id}/${name.split('/').map(encodeURIComponent).join('/')}?cnt=0`;
}
export function readerUrl(value: string): URL {
  return checkedUrl(value, false, true);
}
function checkedUrl(value: string, download: boolean, bookreader = false): URL {
  const url = new URL(value);
  const archive = url.origin === ARCHIVE;
  const dataNode = /^(?:ia|dn)\d+[a-z0-9-]*\.(?:us|eu|ca)\.archive\.org$/.test(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !(archive || (download || bookreader) && dataNode || !download && !bookreader && url.href === FULLTEXT))
    throw new InternetArchiveError('Internet Archive returned an unsupported request or redirect origin.', 'UNSAFE_URL');
  if (download && archive && !url.pathname.startsWith('/download/'))
    throw new InternetArchiveError('Internet Archive redirected to an account or unavailable-file page. Public access does not grant restricted downloads.', 'ACCESS_DENIED');
  if (bookreader && !['/BookReader/BookReaderJSIA.php', '/BookReader/BookReaderImages.php', '/BookReader/BookReaderGetTextWrapper.php', '/fulltext/inside.php'].includes(url.pathname))
    throw new InternetArchiveError('Unsupported BookReader endpoint or access redirect.', 'UNSAFE_URL');
  return url;
}
export interface HttpOptions {fetch?: typeof fetch; timeout?: number; userAgentSuffix?: string}
interface RequestOptions {body?: unknown; download?: boolean; bookreader?: boolean}
export class ArchiveHttp {
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly suffix: string;
  private agent?: Promise<string>;
  constructor(options: HttpOptions = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeout = integer(options.timeout ?? 60, 'timeout', 1, 3600) * 1000;
    this.suffix = options.userAgentSuffix ?? '';
    if (/[^\x20-\x7e]/.test(this.suffix)) throw new InternetArchiveError('User-Agent suffix must contain printable ASCII only.', 'INVALID_ARGUMENT');
  }
  private userAgent(): Promise<string> {
    this.agent ??= readFile(new URL('../../package.json', import.meta.url), 'utf8')
      .then(text => `fam/${JSON.parse(text).version} (+https://github.com/potatosalad/fam)${this.suffix ? ` ${this.suffix}` : ''}`);
    return this.agent;
  }
  async request(value: string, options: RequestOptions = {}): Promise<Response> {
    let url = checkedUrl(value, !!options.download, !!options.bookreader);
    const signal = AbortSignal.timeout(this.timeout);
    const headers = {'User-Agent': await this.userAgent(), Accept: options.download ? '*/*' : 'application/json',
      ...(options.body !== undefined ? {'Content-Type': 'application/json'} : {})};
    let redirects = 0, retries = 0;
    while (true) {
      let response: Response;
      try {
        response = await this.fetcher(url, {method: options.body === undefined ? 'GET' : 'POST', headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body), redirect: 'manual', credentials: 'omit', signal});
      } catch {
        throw new InternetArchiveError(signal.aborted ? 'Internet Archive request timed out; retry or increase --timeout.' : 'Internet Archive network request failed.', 'NETWORK_ERROR');
      }
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || ++redirects > 5 || options.body !== undefined) throw new InternetArchiveError('Unexpected Internet Archive redirect.', 'UNSAFE_URL');
        url = checkedUrl(new URL(location, url).href, !!options.download, !!options.bookreader);
        continue;
      }
      if ([429,502,503,504].includes(response.status)) {
        await response.body?.cancel();
        const after = response.headers.get('retry-after');
        const seconds = after === null ? 2 ** retries : /^\d+$/.test(after) ? Number(after) : Math.max(0, (Date.parse(after) - Date.now()) / 1000);
        if (retries++ < 2 && Number.isFinite(seconds) && seconds <= 10) {
          try {await delay(seconds * 1000, undefined, {signal});} catch {throw new InternetArchiveError('Internet Archive request timed out during retry.', 'NETWORK_ERROR');}
          continue;
        }
        throw new InternetArchiveError(`Internet Archive returned HTTP ${response.status}; retry later${after ? ` (Retry-After: ${after})` : ''}.`, response.status === 429 ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE');
      }
      if (!response.ok) {
        await response.body?.cancel();
        if ([401,403].includes(response.status)) throw new InternetArchiveError('Internet Archive denied anonymous access. Restricted files may require account permissions or borrowing; this provider uses public access only.', 'ACCESS_DENIED');
        throw new InternetArchiveError(`Internet Archive returned HTTP ${response.status}.`, response.status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR');
      }
      return response;
    }
  }
  async jsonValue(url: string, options: RequestOptions = {}): Promise<unknown> {
    const response = await this.request(url, options);
    let value: unknown;
    try {value = parseJson((await readBytes(response, 32 * 1024 * 1024)).toString('utf8'));}
    catch (error) {if (error instanceof InternetArchiveError) throw error; throw new InternetArchiveError('Internet Archive returned invalid JSON.', 'INVALID_RESPONSE');}
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const data = value as Record<string, unknown>;
      if (data.error || data.success === false) throw new InternetArchiveError(`Internet Archive API error${data.errcode ? ` (${data.errcode})` : ''}: ${typeof data.error === 'string' ? data.error.slice(0, 500) : 'request failed'}.`, 'API_ERROR');
    }
    return value;
  }
  async json(url: string, body?: unknown, bookreader = false): Promise<Record<string, unknown>> {
    const value = await this.jsonValue(url, {body, bookreader});
    if (Array.isArray(value) && value.length === 0) throw new InternetArchiveError('Internet Archive item was not found.', 'NOT_FOUND');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InternetArchiveError('Internet Archive returned an unexpected response.', 'INVALID_RESPONSE');
    return value as Record<string, unknown>;
  }
}
export async function* chunks(response: Response, maxBytes: number): AsyncGenerator<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(maxBytes)) {
    await response.body?.cancel();
    throw new InternetArchiveError('Response exceeds --max-bytes; no file was saved.', 'SIZE_LIMIT');
  }
  if (!response.body) throw new InternetArchiveError('Internet Archive returned an empty response body.', 'INVALID_RESPONSE');
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes) throw new InternetArchiveError('Response exceeds --max-bytes; no file was saved.', 'SIZE_LIMIT');
      yield part.value;
    }
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock();}
}
export async function readBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of chunks(response, maxBytes)) parts.push(part);
  return Buffer.concat(parts);
}
