import {readPage, type ReadPage, type Snapshot, type Link} from './browser.js';
import {NaraError, catalogUrl, recordId, recordUrl, searchUrl, integer, mediaUrl, type SearchOptions} from './url.js';
import {downloadObject} from './download.js';

function number(value: string): number | null {
  if (!/^\d[\d,]*$/.test(value)) return null;
  const result = Number(value.replaceAll(',', ''));
  return Number.isSafeInteger(result) ? result : null;
}
function links(items: Link[]): Link[] {
  const found = new Map<string, Link>();
  for (const item of items) {
    try {
      const url = catalogUrl(item.url);
      if (!/^\/id\/[1-9]\d*\/?$/.test(url.pathname) || url.hash) continue;
      found.set(url.href, {title: item.title, url: url.href});
    } catch {}
  }
  return [...found.values()];
}
function thumbnail(value: string | null): string | null {
  if (!value) return null;
  try {const url = catalogUrl(value); return /^\/(?:iiif\/|media)/.test(url.pathname) ? url.href : null;} catch {return null;}
}
function provenance(state: Snapshot) {
  return {source: 'catalog-browser' as const, url: state.url, retrievedAt: new Date().toISOString(), warnings: [...state.alerts], notices: [...state.notices ?? []]};
}
export interface ClientOptions {read?: ReadPage; timeout?: number; fetch?: typeof fetch}
/** Read-only Catalog website provider. Official API-key access is a future transport. */
export class NaraClient {
  private readonly read: ReadPage;
  private readonly timeout: number;
  constructor(private readonly options: ClientOptions = {}) {
    this.timeout = integer(options.timeout ?? 60, 'timeout', 1, 300);
    this.read = options.read ?? ((url, kind) => readPage(url, kind, this.timeout));
  }
  async search(query: string, options: SearchOptions = {}) {
    const requested = new URL(searchUrl(query, options));
    const state = await this.read(requested.href, 'search');
    const actual = catalogUrl(state.url);
    if (actual.pathname !== '/search' || actual.searchParams.get('q') !== query.trim()) throw new NaraError('The Catalog changed the search query.', 'UNEXPECTED_PAGE');
    const page = number(state.search.page) ?? (state.search.results.length ? null : options.page ?? 1);
    const limit = number(state.search.limit) ?? (state.search.results.length ? null : options.limit ?? 20);
    if (page !== (options.page ?? 1) || limit !== (options.limit ?? 20) ||
      state.search.results.length && (state.search.online !== !!options.availableOnline || state.search.sort !== (options.sort ?? 'relevant')))
      throw new NaraError('The Catalog did not apply the requested page, page size, online filter, or sort.', 'UNEXPECTED_PAGE');
    const totalMatch = state.search.summary.match(/(?:[\d,]+\s*[–-]\s*[\d,]+\s+of\s+)?([\d,]+)\s+result\s*s?\b/i);
    const empty = /no (?:search )?results (?:found|were found)|no results match/i.test(state.search.summary);
    const total = totalMatch ? number(totalMatch[1]) : empty ? 0 : null;
    const totalPages = total === 0 ? 0 : number(state.search.pages);
    const warnings = [...state.alerts];
    const results = state.search.results.map((item, index) => {
      const url = catalogUrl(item.url);
      return {naid: recordId(url.href), title: item.title, url: url.href,
        rank: (page! - 1) * limit! + index + 1, level: item.level, description: item.description,
        text: item.text.replace(/^Select result\s+\d+\s*/, ''), thumbnailUrl: thumbnail(item.thumbnailUrl)};
    });
    if (!results.length && total !== 0)
      throw new NaraError('Search response was not a confirmed empty result.', 'INVALID_RESPONSE');
    const partial = warnings.some(w => /timed? out|only some results|too long|error|failed/i.test(w));
    if (total === null && results.length) warnings.push('The Catalog result total could not be recognized.');
    const nextPage = totalPages !== null && page! < totalPages ? page! + 1 : null;
    return {...provenance(state), warnings, query: query.trim(), page, limit, total, totalPages, results,
      nextPage, nextUrl: nextPage ? searchUrl(query, {...options, page: nextPage}) : null,
      partial, complete: !partial && page === 1 && (total === 0 || total !== null && results.length === total)};
  }
  async record(value: string) {
    const id = recordId(value), state = await this.read(recordUrl(id), 'record');
    this.checkRecord(state, id);
    return {...provenance(state), naid: id, title: state.record.title, level: state.record.level,
      header: state.record.header, text: state.record.text, hierarchy: links(state.record.breadcrumbs),
      relatedLinks: links(state.record.links), objectCount: number(state.objects.total),
      catalogUrl: recordUrl(id)};
  }
  private checkRecord(state: Snapshot, id: string) {
    if (recordId(state.url) !== id || !state.record.title || state.record.header.match(/NAID:\s*([1-9]\d*)/)?.[1] !== id)
      throw new NaraError('The Catalog record did not match the requested NAID.', 'UNEXPECTED_PAGE');
  }
  async objects(value: string) {
    const id = recordId(value), state = await this.read(recordUrl(id), 'record');
    this.checkRecord(state, id);
    const total = number(state.objects.total);
    const items = state.objects.items.map(item => ({page: integer(Number(item.page), 'object page'), label: item.label,
      url: recordUrl(id, Number(item.page)), thumbnailUrl: thumbnail(item.thumbnailUrl)}));
    const complete = total !== null && items.length === total && items.every((item, index) => item.page === index + 1);
    return {...provenance(state), naid: id, title: state.record.title, total, items, complete,
      warnings: [...state.alerts, ...(!complete ? ['Only rendered object thumbnails are listed; an absent object is not proof that the record has no digital objects. Use object get with --page to select another page.'] : [])]};
  }
  async object(value: string, page = 1, transcription = false) {
    const id = recordId(value), url = recordUrl(id, page, transcription);
    const state = await this.read(url, transcription ? 'transcription' : 'object');
    this.checkRecord(state, id);
    if (Number(state.objects.page || state.objects.selected) !== page || state.objects.selected && Number(state.objects.selected) !== page)
      throw new NaraError('The Catalog did not select the requested object page.', 'UNEXPECTED_PAGE');
    const downloadUrl = state.objects.downloadUrl ? mediaUrl(state.objects.downloadUrl) : null;
    const item = state.objects.items.find(item => Number(item.page) === page);
    return {...provenance(state), naid: id, title: state.record.title, page, total: number(state.objects.total),
      label: item?.label ?? null, thumbnailUrl: thumbnail(item?.thumbnailUrl ?? null), downloadUrl,
      ...(transcription ? {transcription: state.objects.transcription || null, transcriptionKind: 'citizen-contributed' as const,
        transcriptionStatus: state.objects.transcription ? 'available' as const : 'unavailable' as const} : {})};
  }
  async download(value: string, out: string, options: {page?: number; maxBytes?: number} = {}) {
    if (!out?.trim()) throw new NaraError('A destination file is required.', 'INVALID_ARGUMENT');
    const maxBytes = integer(options.maxBytes ?? 64 * 1024 * 1024, 'max-bytes', 1, 512 * 1024 * 1024);
    const object = await this.object(value, options.page ?? 1);
    if (!object.downloadUrl) throw new NaraError('No public original download link is rendered for this object.', 'NOT_FOUND');
    return downloadObject(object, out, {fetch: this.options.fetch, timeout: this.timeout, maxBytes});
  }
}
