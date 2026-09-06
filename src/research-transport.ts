import { Impit, type ImpitResponse } from 'impit';
import { FS_ORIGIN, HttpError, type HttpSession } from './http.js';
import { parseJson, stringifyJson } from './json.js';

export type ResearchErrorCode = 'access-denied' | 'security-challenge' | 'not-found' | 'throttled' | 'temporary-failure' | 'unexpected-content' | 'schema-change' | 'pagination';
export class ResearchError extends Error {
  constructor(readonly code: ResearchErrorCode, message: string, readonly status?: number) {
    super(`${code}: ${message}`);
    this.name = 'ResearchError';
  }
}

// Only read services observed in the FamilySearch website. These do not extend
// the genealogy client's write surface or accept arbitrary credential destinations.
export function isResearchPath(path: string): boolean {
  return /^\/ark:\/61903\/3:[12]:[A-Z0-9-]+(?:\/(?:image\.xml|dist\.jpg))?$/i.test(path)
    || /^\/service\/cds\/recapi\/(?:collections\/\d+(?:\/waypoints)?|waypoints\/[A-Z0-9:,-]+)$/i.test(path)
    || /^\/service\/records\/storage\/(?:dascloud\/das\/v2|deepzoomcloud\/dz\/v1)\/(?:TH-[A-Z0-9-]+|3:[12]:[A-Z0-9-]+)(?:\/(?:parents|children|permission|name|image\.xml|dist\.jpg|artifactmetadata\.xml))?$/i.test(path)
    || /^\/service\/search\/fulltext\/(?:search(?:\/groupNumber)?|collections)$/.test(path)
    || isTranscriptPath(path)
    || /^\/search\/filmdatainfo\/(?:image-data|film-data|waypoint-data)$/.test(path);
}
function isTranscriptPath(path: string): boolean {
  return /^\/service\/records\/volunteer\/orchestration\/sls\/image\/records\/3:[12]:[A-Z0-9-]+$/i.test(path);
}
const TRANSCRIPT_ORIGIN = 'https://sg30p0.familysearch.org';

export function researchUrl(input: string): URL {
  if (/[\\\u0000-\u0020]/.test(input) || /%(?:2e|2f|5c)/i.test(input.split('?')[0])) throw new Error('Invalid research URL.');
  const url = new URL(input, FS_ORIGIN);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Expected a FamilySearch research URL.');
  // The production viewer performs this same proxy substitution (module 31723).
  if (url.origin === 'https://sg30p0.familysearch.org' && url.pathname.startsWith('/service/records/storage/')) url.host = 'www.familysearch.org';
  if (!((url.origin === FS_ORIGIN && isResearchPath(url.pathname)) || (url.origin === TRANSCRIPT_ORIGIN && isTranscriptPath(url.pathname)))) throw new Error('Requests must stay within the supported FamilySearch research routes.');
  if ([...url.searchParams.keys()].some(k => /^(access_token|sessionid|fssessionid|refresh_token)$/i.test(k))) throw new Error('Send authentication in headers, not URL parameters.');
  return url;
}

// This is the actual signed storage destination returned for the Walton images.
// Do not accept arbitrary *.amazonaws.com hosts or send the FS token/cookies here.
export function checkImageRedirect(url: URL): void {
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
    || url.hostname !== 'ps-services-us-east-1-914248642252-pipe-storage-das-cloud.s3.amazonaws.com'
    || !url.pathname.startsWith('/s3/pipe-storage-das-cloud-prod-dasS3/')) {
    throw new Error('Image redirect uses an unrecognized storage destination.');
  }
}

export type ResearchAuthorization = <T>(action: (http: HttpSession, headers: Record<string, string>) => Promise<T>) => Promise<T>;
export interface ReadOptions {
  accept?: string;
  headers?: Record<string, string>;
  /** Only the three observed filmdatainfo POST reads accept bodies. */
  body?: Record<string, unknown>;
  image?: boolean;
}

export function retryDelay(value: string | null, attempt: number, now = Date.now()): number {
  const seconds = value !== null && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : value ? Date.parse(value) - now : NaN;
  // If the server asks for a longer delay, surface the error instead of retrying early.
  if (Number.isFinite(requested)) return Math.max(0, requested);
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

export class ResearchTransport {
  private readonly assets = new Impit({ browser: 'chrome', timeout: 45_000 });
  constructor(private readonly authorize: ResearchAuthorization,
    private readonly sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

  async response(input: string, options: ReadOptions = {}): Promise<ImpitResponse> {
    const initial = researchUrl(input); // Validate before loading credentials.
    if (options.body && !/^\/search\/filmdatainfo\/(image-data|film-data|waypoint-data)$/.test(initial.pathname)) throw new Error('This research route is read-only.');
    if (Object.keys(options.headers ?? {}).some(k => !/^(x-fs-feature-tag|accept)$/i.test(k))) throw new Error('Research authentication and transport headers are managed by the client.');
    return this.authorize(async (http, credentials) => {
      let current = initial;
      let external = false;
      for (let redirect = 0; redirect < 6; redirect++) {
        let response: ImpitResponse | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            // No shared cookie jar, bearer header, Referer, or session body on storage requests.
            response = external
              ? await this.assets.fetch(current, { redirect: 'manual', headers: { Accept: options.accept ?? 'image/*' } })
              : current.origin === TRANSCRIPT_ORIGIN
              ? await this.assets.fetch(current, { redirect: 'manual', headers: { ...credentials, Accept: options.accept ?? 'application/json' } })
              : await http.request(current, {
                method: options.body ? 'POST' : 'GET',
                headers: { ...credentials, ...options.headers, Accept: options.accept ?? 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
                ...(options.body ? { body: stringifyJson(options.body) } : {}),
              });
          } catch {
            if (attempt === 2) throw new ResearchError('temporary-failure', 'Document service connection failed after three attempts.');
            await this.sleep(retryDelay(null, attempt));
            continue;
          }
          if (![429, 502, 503, 504].includes(response.status)) break;
          const delay = retryDelay(response.headers.get('retry-after'), attempt);
          if (attempt === 2 || delay > 30_000) break;
          await response.body?.cancel();
          await this.sleep(delay);
        }
        if (!response) throw new ResearchError('temporary-failure', 'No document response received.');
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || options.body) throw new ResearchError('unexpected-content', 'Unexpected redirect from a document metadata service.');
          let next = new URL(location, current);
          if (next.origin === 'https://ident.familysearch.org' || next.pathname.includes('/identity/login')) throw new HttpError(401, initial.pathname);
          if (external || ![FS_ORIGIN, TRANSCRIPT_ORIGIN].includes(next.origin)) {
            if (!options.image) throw new ResearchError('unexpected-content', 'Metadata redirected outside its service.');
            checkImageRedirect(next);
            external = true;
          } else next = researchUrl(next.href);
          current = next;
          continue;
        }
        if (response.ok) return response;
        const content = await readLimited(response, 64 * 1024).catch(() => '');
        if (response.status === 401 && !external) throw new HttpError(401, initial.pathname);
        const challenge = /incapsula|imperva|blocked by our security service|_Incapsula_Resource/i.test(content);
        const code: ResearchErrorCode = challenge ? 'security-challenge' : [401, 403, 451].includes(response.status) ? 'access-denied'
          : response.status === 404 ? 'not-found' : response.status === 429 ? 'throttled' : response.status >= 500 ? 'temporary-failure' : 'unexpected-content';
        const retry = response.headers.get('retry-after');
        throw new ResearchError(code, `HTTP ${response.status} from ${initial.pathname}.${retry && /^(\d+|[\w,: -]+)$/.test(retry) ? ` Retry-After: ${retry}.` : ''}${challenge ? ' The website security service rejected the request; this is not proof of expired tree authentication.' : ''}`, response.status);
      }
      throw new ResearchError('unexpected-content', 'Document request exceeded the redirect limit.');
    });
  }

  async text(input: string, options: ReadOptions = {}): Promise<string> {
    const response = await this.response(input, options);
    const text = await readLimited(response);
    if (/^\s*(?:<!doctype\s+html|<html)/i.test(text) || /incapsula|_Incapsula_Resource/i.test(text)) {
      throw new ResearchError('unexpected-content', 'The document service returned HTML instead of document data.');
    }
    return text;
  }

  async json<T = unknown>(input: string, options: ReadOptions = {}): Promise<T> {
    const text = await this.text(input, options);
    try { return parseJson(text) as T; }
    catch { throw new ResearchError('unexpected-content', 'The document service did not return valid JSON.'); }
  }
}

async function readLimited(response: ImpitResponse, limit = 32 * 1024 * 1024): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new ResearchError('unexpected-content', 'Document metadata exceeded the response size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
