import {Impit} from 'impit';
import {browserConfig, transportPreference, useBrowser, rememberBrowser, BrowserError} from '../shared/browser-config.js';
import {isChallenge} from '../shared/browser-challenge.js';
import {browserFetchOptions, browserFetchResult, extractBrowserContent, fetchBrowserUrl, type BrowserFetchResult, type FetchFormat} from '../shared/browser-fetch.js';
import {UsageError} from '../shared/command-runtime.js';
import {archiveUrl, originalUrl, replaySnapshot, snapshot, timestamp, fullTimestamp, type Snapshot} from './url.js';

export interface WaybackOptions {timeout?: number; open?: 'auto' | 'always' | 'never'}
export interface FindResult {url: string; requestedDate?: string; available: boolean; snapshot: Snapshot | null}
export interface ListResult {url: string; snapshots: Snapshot[]; limit: number; truncated: boolean}
export interface ArchivedPage extends BrowserFetchResult {snapshot: Snapshot; requestedUrl: string}
type Wire = {url: string; status: number; statusText: string; headers: [string,string][]; bodyBase64: string};

export class WaybackClient {
  constructor(private options: WaybackOptions = {}) {
    if (options.timeout !== undefined && (!Number.isInteger(options.timeout) || options.timeout < 1 || options.timeout > 3600))
      throw new UsageError('--timeout must be between 1 and 3600 seconds.');
    if (options.open !== undefined && !['auto','always','never'].includes(options.open)) throw new UsageError('--open must be auto, always, or never.');
  }
  private async get(input: string): Promise<Wire> {
    let url = archiveUrl(input);
    const http = new Impit({browser: 'chrome', timeout: (this.options.timeout ?? 60) * 1000});
    const policy = transportPreference(await browserConfig()).policy;
    let browser = this.options.open === 'always' || await useBrowser('wayback', new URL(url).origin);
    for (let hop = 0; hop < 10; hop++) {
      let wire: Wire | undefined;
      if (!browser) {
        const response = await http.fetch(url, {method: 'GET', redirect: 'manual', headers: {Accept: '*/*'}});
        if (Number(response.headers.get('content-length')) > 48 * 1024 * 1024) throw new Error('Wayback response exceeds 48 MiB.');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 48 * 1024 * 1024) throw new Error('Wayback response exceeds 48 MiB.');
        if (isChallenge(response.headers, bytes.toString('utf8')) && policy !== 'http') browser = true;
        else wire = {url, status: response.status, statusText: response.statusText, headers: [...response.headers], bodyBase64: bytes.toString('base64')};
      }
      if (browser) {
        const result = await fetchBrowserUrl(await browserFetchOptions({url, mode:'request', format:'raw', context:'wayback',
          timeout:this.options.timeout ?? 60, open:this.options.open ?? 'auto', redirects:'manual'}));
        wire = {...result, bodyBase64:result.bodyBase64!};
        archiveUrl(wire.url);
      }
      const response = wire!, headers = new Headers(response.headers);
      if ([301,302,303,307,308].includes(response.status)) {
        const location = headers.get('location');
        if (!location) throw new Error('Wayback returned a redirect without a destination.');
        url = archiveUrl(new URL(location, url).href);
        if (input.includes('id_/')) url = replaySnapshot(url)?.rawUrl ?? url;
        continue;
      }
      if (response.status === 429) throw Object.assign(new Error(`Internet Archive is rate limiting requests.${headers.get('retry-after') ? ` Retry after ${headers.get('retry-after')}.` : ' Try again later.'}`), {code:'WAYBACK_RATE_LIMITED'});
      if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`Internet Archive returned HTTP ${response.status} for ${url}.`), {code:'WAYBACK_HTTP_ERROR'});
      if (isChallenge(headers, Buffer.from(response.bodyBase64,'base64').toString('utf8')))
        throw new BrowserError('Internet Archive requires browser verification. Retry with --transport browser.', 'BROWSER_INTERACTION_REQUIRED');
      if (browser) await rememberBrowser('wayback', new URL(response.url).origin);
      return response;
    }
    throw new Error('Wayback redirect limit exceeded.');
  }
  private async json(url: string): Promise<unknown> {
    const response = await this.get(url);
    try {return JSON.parse(Buffer.from(response.bodyBase64, 'base64').toString('utf8'));}
    catch {throw new Error('Internet Archive returned an unexpected response instead of JSON.');}
  }
  private async captures(url: string, query: Record<string,string>): Promise<Snapshot[]> {
    const params = new URLSearchParams({url, matchType:'exact', output:'json', fl:'timestamp,original,statuscode,mimetype,digest', filter:'statuscode:200', ...query});
    const rows = await this.json(`https://web.archive.org/cdx/search/cdx?${params}`);
    if (!Array.isArray(rows) || rows.length && JSON.stringify(rows[0]) !== JSON.stringify(['timestamp','original','statuscode','mimetype','digest']))
      throw new Error('Unexpected Wayback capture index response.');
    return rows.slice(1).map(row => {
      if (!Array.isArray(row) || row.length !== 5 || !row.every(value => typeof value === 'string')) throw new Error('Invalid Wayback capture record.');
      return {...snapshot(row[0],row[1]), status:Number(row[2]), mimeType:row[3], digest:row[4]};
    });
  }
  async find(input: string, date?: string): Promise<FindResult> {
    const saved = replaySnapshot(input), url = saved?.originalUrl ?? originalUrl(input), when = timestamp(date);
    const closest = when ?? saved?.timestamp;
    const [found] = await this.captures(url, closest ? {limit:'1', sort:'closest', closest:fullTimestamp(closest)} : {limit:'-1'});
    return {url, ...(when ? {requestedDate:when} : {}), available:!!found,
      snapshot:found ?? null};
  }
  async list(input: string, options: {from?: string; to?: string; limit?: number} = {}): Promise<ListResult> {
    const url = replaySnapshot(input)?.originalUrl ?? originalUrl(input), limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new UsageError('Use --limit 1–1000.');
    const from = timestamp(options.from), to = timestamp(options.to);
    if (from && to && from.padEnd(14,'0') > to.padEnd(14,'9')) throw new UsageError('--from must be no later than --to.');
    const records = await this.captures(url, {limit:String(limit + 1), ...(from ? {from} : {}), ...(to ? {to} : {})});
    return {url, snapshots:records.slice(0, limit), limit, truncated:records.length > limit};
  }
  async fetch(input: string, options: {date?: string; format?: FetchFormat} = {}): Promise<ArchivedPage> {
    const exact = replaySnapshot(input);
    const selected = exact && !options.date ? exact : (await this.find(input, options.date)).snapshot;
    if (!selected) throw Object.assign(new Error(`No successful Wayback capture is indexed for ${input}.`), {code:'WAYBACK_NOT_FOUND'});
    const response = await this.get(selected.rawUrl);
    const actual = replaySnapshot(response.url);
    if (!actual) throw new Error('Wayback did not return an archived capture.');
    const result = browserFetchResult(await browserFetchOptions({url:selected.rawUrl, mode:'request', format:options.format ?? 'text'}), response);
    // Resolve archived relative links against their original page, not /web/.
    if (result.html !== undefined) Object.assign(result, extractBrowserContent(result.html, actual.originalUrl));
    return {...result, requestedUrl:input, snapshot:{...actual, status:response.status}};
  }
}
