import { createHash, randomUUID } from 'node:crypto';
import { link, open, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { FS_ORIGIN } from './http.js';
import { stringifyJson } from '../shared/json.js';
import { ResearchError, ResearchTransport, researchUrl } from './research-transport.js';

interface Link { href?: string; results?: number; offset?: number }
interface SourceDescription {
  id?: string; about?: string; resourceType?: string; componentOf?: { description?: string };
  titles?: Array<{ lang?: string; value?: string }>; titleLabel?: { value?: string };
  citations?: Array<{ value?: string }>; rights?: string[]; links?: Record<string, Link>;
}
interface SourceDocument { description?: string; sourceDescriptions?: SourceDescription[]; links?: Record<string, Link> }
interface ViewerImage {
  arkId?: string; dgsNum?: string; meta?: SourceDocument;
  collections?: Array<{ description?: string; collections?: Array<{ title?: string }> }>;
}
interface FilmData { dgsNum?: string; images?: string[]; waypointURL?: string; catalogs?: unknown[] }
interface FulltextEntry {
  id?: string; sourceUrl?: string; collectionId?: string; collectionTitle?: string;
  content?: { title?: string; recordDate?: string; recordPlace?: string; recordType?: string;
    textDocument?: string; highlightTexts?: string[]; entities?: Array<{ type: string; value: string }> };
}
interface FulltextResponse { entries?: FulltextEntry[]; index?: number; results?: number; links?: Record<string, Link>; facets?: unknown[] }

export interface ResearchPage<T> {
  items: T[];
  total?: number;
  offset: number;
  complete: boolean;
  /** Safe service URL for waypoint/search pages; use as --resume. */
  next?: string;
  /** Zero-based position to pass as --offset for bulk film listings. */
  nextOffset?: number;
}
export interface PageOptions { count?: number; offset?: number; all?: boolean; limit?: number; resume?: string }
export interface Waypoint {
  title?: string; label?: string; url: string; kind: 'collection' | 'image';
  imageArk?: string; imageNumber?: number;
}
export interface FilmImage { dgs: string; imageNumber: number; imageArk: string }
export interface ImageInfo {
  imageArk: string; apid: string; dgs?: string; imageNumber?: number; imageCount?: number;
  collectionId?: string; collectionTitle?: string;
  breadcrumbs: string[]; citations: string[];
  allowedToDownload: boolean | null;
  width?: number; height?: number;
  originalUrl?: string;
  previousImageArk?: string; nextImageArk?: string;
}
export interface ImageDownload extends ImageInfo {
  file: string; manifest: string; bytes: number; sha256: string; mediaType: string;
  width: number; height: number; retrievedAt: string; representation: 'distribution-original';
}
export interface FulltextQuery {
  name?: string; keywords?: string; place?: string; fromYear?: number; toYear?: number;
  dgs?: string; collection?: string; recordType?: string;
}
export interface FulltextHit {
  imageArk: string; title?: string; date?: string; place?: string; recordType?: string;
  collectionId?: string; collectionTitle?: string;
  machineTranscript?: string; highlights: string[]; entities: Array<{ type: string; value: string }>;
}
export interface TranscriptToken { id?: string; text: string; rect?: string; redacted?: boolean }
export interface TranscriptLine { id?: string; rect?: string; tokens: TranscriptToken[] }
export interface TranscriptRegion { id?: string; type?: string; rect?: string; subPageId?: string; lines: TranscriptLine[] }
export interface ImageTranscript {
  imageArk: string; available: boolean; machineGenerated: true; text: string;
  dgs?: string; imageNumber?: number; citations: string[]; language?: string;
  recordDate?: string; recordPlace?: string;
  pages: Array<{ id?: string; pageWidth?: number; pageHeight?: number }>;
  regions: TranscriptRegion[]; hasRedactions: boolean; retrievedAt: string; sourceUrl: string;
}
interface TranscriptResponse {
  stuff?: { metadata?: { properties?: Array<{ name: string; value: string }> };
    pages?: ImageTranscript['pages']; regions?: TranscriptRegion[] } | null;
}

export const FULLTEXT_FEATURES = 'search.original.gedcomx,search.default.facet.include.race,search_fullTextResultTitle,search_flatRecordType,search_naturalLanguageSupport,search_fullTextHighlightEnhancement';

export function imageArk(input: string): string {
  let value = input;
  if (/^https?:/i.test(value)) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['www.familysearch.org', 'familysearch.org'].includes(url.host) || url.username || url.password) throw new Error('Expected a FamilySearch image ARK.');
    value = url.pathname;
  }
  const match = /^(?:\/?ark:\/61903\/)?(3:[12]:[A-Z0-9-]+)(?:\/image\.xml)?$/i.exec(value);
  if (!match) throw new Error('Expected an image ARK such as 3:1:3QS7-8935-BJZR, not a person or indexed-record ARK.');
  return `${FS_ORIGIN}/ark:/61903/${match[1].toUpperCase()}`;
}
export function dgsNumber(value: string): string {
  if (!/^\d{1,9}$/.test(value) || Number(value) === 0) throw new Error('Expected a numeric DGS/image group number (up to nine digits).');
  return value.padStart(9, '0');
}
function integer(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
function title(source?: SourceDescription): string | undefined {
  return (source?.titles?.find(t => t.lang?.startsWith('en')) ?? source?.titles?.[0])?.value;
}
function schema(message: string): never { throw new ResearchError('schema-change', message); }
function sources(doc: SourceDocument): SourceDescription[] {
  if (!doc || !Array.isArray(doc.sourceDescriptions)) schema('Missing sourceDescriptions in document metadata.');
  return doc.sourceDescriptions;
}
function safeLink(value?: string): string | undefined { return value ? researchUrl(value).href : undefined; }

export class ResearchClient {
  constructor(readonly transport: ResearchTransport) {}

  async imageInfo(input: string): Promise<ImageInfo> {
    const ark = imageArk(input);
    const data = await this.transport.json<ViewerImage>('/search/filmdatainfo/image-data', { body: {
      type: 'image-data', args: { imageURL: ark, locale: 'en', state: { imageOrFilmUrl: '', selectedImageIndex: -1, viewMode: 'i' } },
    } });
    if (!data.meta || data.arkId !== ark.split('/').pop()) schema('Image metadata did not identify the requested ARK.');
    const descriptions = sources(data.meta);
    const source = descriptions.find(s => s.about && imageArkOrUndefined(s.about) === ark);
    if (!source) schema('Image metadata has no matching source description.');
    const links = data.meta.links ?? {};
    const node = safeLink(links['image-node']?.href);
    const apid = node?.split('/').pop();
    if (!apid) schema('Image metadata has no storage identifier.');
    const rights = source.rights?.find(r => r.startsWith('http://familysearch.org/accessControl?') || r.startsWith('https://familysearch.org/accessControl?'));
    const access = rights ? new URL(rights).searchParams : undefined;
    const allow = access?.get('allowDownload');
    const info: ImageInfo = {
      imageArk: ark, apid, dgs: data.dgsNum ? dgsNumber(data.dgsNum) : undefined,
      imageNumber: links.self?.offset, imageCount: links.self?.results,
      collectionId: data.collections?.[0]?.description?.replace(/^#/, ''),
      collectionTitle: data.collections?.[0]?.collections?.[0]?.title,
      breadcrumbs: [...new Set(descriptions.filter(s => s !== source).map(title).filter((x): x is string => !!x).reverse())],
      citations: source.citations?.map(c => c.value).filter((x): x is string => !!x) ?? [],
      allowedToDownload: access?.get('authorized') === 'false' ? false : allow === 'true' ? true : allow === 'false' ? false : null,
      originalUrl: safeLink(links['image-stream-image-dist']?.href),
      previousImageArk: imageArkOrUndefined(links.prev?.href), nextImageArk: imageArkOrUndefined(links.next?.href),
    };
    const deepzoom = safeLink(links['image-deepzoom']?.href);
    if (deepzoom && info.allowedToDownload === true) {
      const xml = await this.transport.text(deepzoom, { accept: 'application/xml' });
      const size = /<Size\b([^>]*)\/?\s*>/i.exec(xml)?.[1];
      const width = size && /\bWidth=["'](\d+)["']/i.exec(size)?.[1];
      const height = size && /\bHeight=["'](\d+)["']/i.exec(size)?.[1];
      if (!/<Image\b/i.test(xml) || !width || !height) schema('Original image dimensions are absent from the Deep Zoom descriptor.');
      info.width = integer(Number(width), 'Image width', 1);
      info.height = integer(Number(height), 'Image height', 1);
    }
    return info;
  }

  async downloadOriginal(input: string, output: string): Promise<ImageDownload> {
    const info = await this.imageInfo(input);
    if (info.allowedToDownload === false) throw new ResearchError('access-denied', 'FamilySearch reports that downloading this image is not allowed.');
    if (info.allowedToDownload !== true || !info.originalUrl || !info.width || !info.height) schema('An authorized original download and its dimensions could not be established; no thumbnail was substituted.');
    const response = await this.transport.response(info.originalUrl, { accept: 'image/jpeg,image/png,image/tiff,image/webp', image: true });
    const mediaType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!['image/jpeg', 'image/png', 'image/tiff', 'image/webp'].includes(mediaType)) {
      await response.body?.cancel();
      throw new ResearchError('unexpected-content', 'Original download returned a non-image content type; no output file was saved.');
    }
    if (!response.body) throw new ResearchError('unexpected-content', 'Original download has no body.');
    const file = resolve(output), manifest = `${file}.json`;
    const temporary = `${file}.${randomUUID()}.tmp`, metadataTemporary = `${temporary}.json`;
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let bytes = 0, prefix = Buffer.alloc(0);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 256 * 1024 * 1024) throw new ResearchError('unexpected-content', 'Original image exceeded the 256 MiB download limit.');
          if (prefix.length < 16) prefix = Buffer.concat([prefix, part.value]).subarray(0, 16);
          hash.update(part.value);
          await handle.writeFile(part.value);
        }
        await handle.sync();
      } finally { await handle.close(); }
      if (!imageSignatureMatches(prefix, mediaType)) throw new ResearchError('unexpected-content', 'Downloaded bytes do not match the advertised image type.');
      let dimensions: { width: number; height: number };
      try {
        const decoder = sharp(temporary, { failOn: 'warning' });
        const metadata = await decoder.metadata();
        await decoder.stats(); // Force full pixel decoding; headers alone do not detect truncation.
        dimensions = { width: metadata.width, height: metadata.height };
      } catch { throw new ResearchError('unexpected-content', 'The original image is corrupt, truncated, or cannot be decoded.'); }
      if (dimensions.width !== info.width || dimensions.height !== info.height) throw new ResearchError('unexpected-content', 'Downloaded dimensions do not match the original descriptor; no output file was saved.');
      const result: ImageDownload = { ...info, ...dimensions, file, manifest, bytes, sha256: hash.digest('hex'), mediaType,
        retrievedAt: new Date().toISOString(), representation: 'distribution-original' };
      await writeFile(metadataTemporary, `${stringifyJson(result, 2)}\n`, { flag: 'wx', mode: 0o600 });
      // Hard links publish complete files without overwriting an existing research artifact.
      await link(metadataTemporary, manifest);
      try { await link(temporary, file); }
      catch (error) { await rm(manifest, { force: true }); throw error; }
      return result;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      await rm(temporary, { force: true });
      await rm(metadataTemporary, { force: true });
    }
  }

  async browse(input: string, options: PageOptions = {}): Promise<ResearchPage<Waypoint>> {
    const start = /^\d+$/.test(input) ? `/service/cds/recapi/collections/${input}/waypoints` : input;
    const url = researchUrl(start);
    if (!url.pathname.startsWith('/service/cds/recapi/')) throw new Error('Expected a collection ID or recapi waypoint URL.');
    return this.collect(url.href, options, async path => {
      const data = await this.transport.json<SourceDocument>(path);
      const all = sources(data);
      const root = all.find(s => `#${s.id}` === data.description || s.id === data.description);
      if (!root?.id) schema('Waypoint response has no root source description.');
      const links = data.links ?? root.links ?? {};
      const offset = Number(new URL(links.self?.href ?? path).searchParams.get('offset') ?? 0);
      const children = all.filter(s => s.componentOf?.description === `#${root.id}`);
      const items = children.map((s, index): Waypoint => {
        if (!s.about) schema('Waypoint child is missing its URL.');
        const ark = s.resourceType === 'http://gedcomx.org/DigitalArtifact' ? imageArk(s.about) : undefined;
        return { title: title(s), label: s.titleLabel?.value, url: ark ?? researchUrl(s.about).href,
          kind: ark ? 'image' : 'collection', ...(ark ? { imageArk: ark, imageNumber: offset + index + 1 } : {}) };
      });
      return { items, total: links.self?.results, offset, next: safeLink(links.next?.href), complete: !links.next?.href };
    });
  }

  async filmImages(input: string, options: PageOptions = {}): Promise<ResearchPage<FilmImage>> {
    const dgs = dgsNumber(input);
    if (options.resume) throw new Error('Use --offset with a DGS listing; --resume is for waypoint/search links.');
    const { count, offset, limit } = pageOptions(options);
    const data = await this.transport.json<FilmData>('/search/filmdatainfo/film-data', { body: { type: 'film-data', loggedIn: true,
      args: { dgsNum: dgs, state: { i: 0, imageOrFilmUrl: `/search/film/${dgs}`, viewMode: 'g', selectedImageIndex: 0 }, locale: 'en' } } });
    if (data.dgsNum !== dgs || !Array.isArray(data.images)) schema('Film service did not return the requested DGS image list.');
    const end = Math.min(data.images.length, offset + (options.all ? limit : Math.min(count, limit)));
    const items = data.images.slice(offset, end).map((url, index) => ({ dgs, imageNumber: offset + index + 1, imageArk: imageArk(url) }));
    return { items, total: data.images.length, offset, complete: end >= data.images.length,
      ...(end < data.images.length ? { nextOffset: end } : {}) };
  }

  async filmImage(dgs: string, imageNumber: number): Promise<FilmImage> {
    integer(imageNumber, 'Image number', 1);
    const page = await this.filmImages(dgs, { offset: imageNumber - 1, count: 1 });
    if (!page.items[0]) throw new ResearchError('not-found', 'That image number is outside the film.');
    return page.items[0];
  }

  async fulltextAvailable(dgs: string): Promise<{ dgs: string; available: boolean }> {
    const id = dgsNumber(dgs);
    const data = await this.transport.json<{ ids?: string[] }>(`/service/search/fulltext/search/groupNumber?ids=${id}`);
    if (!Array.isArray(data.ids)) schema('Full-Text availability response has no ID list.');
    return { dgs: id, available: data.ids.includes(id) };
  }

  async imageTranscript(input: string): Promise<ImageTranscript> {
    const info = await this.imageInfo(input);
    // This service is hosted directly on sg30p0; the www proxy returns a website 404.
    const sourceUrl = `https://sg30p0.familysearch.org/service/records/volunteer/orchestration/sls/image/records/${info.imageArk.split('/').pop()}`;
    const empty: ImageTranscript = { imageArk: info.imageArk, available: false, machineGenerated: true, text: '',
      dgs: info.dgs, imageNumber: info.imageNumber, citations: info.citations, pages: [], regions: [], hasRedactions: false,
      retrievedAt: new Date().toISOString(), sourceUrl };
    let data: TranscriptResponse;
    try { data = await this.transport.json<TranscriptResponse>(sourceUrl); }
    catch (error) {
      if (error instanceof ResearchError && error.code === 'not-found') return empty;
      throw error;
    }
    return decodeTranscript(data, empty);
  }

  async fulltextSearch(query: FulltextQuery, options: PageOptions = {}): Promise<ResearchPage<FulltextHit>> {
    const url = new URL('/service/search/fulltext/search', FS_ORIGIN);
    url.searchParams.set('m.queryRequireDefault', 'on'); // Otherwise a DGS/name search can match either term.
    url.searchParams.set('m.defaultFacets', 'on');
    for (const [key, value] of Object.entries({ 'q.fullName': query.name, 'q.text': query.keywords, 'q.anyPlace': query.place,
      'q.groupName': query.dgs ? dgsNumber(query.dgs) : undefined, 'f.collectionId': query.collection, 'f.recordType': query.recordType })) {
      if (value !== undefined) { if (!value.trim()) throw new Error('Search criteria must not be empty.'); url.searchParams.set(key, value); }
    }
    if (query.fromYear !== undefined) url.searchParams.set('q.anyYear.from', String(integer(query.fromYear, 'Starting year', 1, 9999)));
    if (query.toYear !== undefined) url.searchParams.set('q.anyYear.to', String(integer(query.toYear, 'Ending year', 1, 9999)));
    if (query.fromYear !== undefined && query.toYear !== undefined && query.fromYear > query.toYear) throw new Error('Starting year must not exceed ending year.');
    if (url.searchParams.size === 2 && !options.resume) throw new Error('Supply at least one Full-Text Search criterion.');
    return this.collect(url.href, options, async path => {
      const data = await this.transport.json<FulltextResponse>(path, { headers: { 'x-fs-feature-tag': FULLTEXT_FEATURES } });
      if (!Array.isArray(data.entries)) schema('Full-Text Search response has no entries array.');
      const items = data.entries.map(e => {
        if (!e.sourceUrl || !e.content) schema('Full-Text Search entry has no image URL or content.');
        return { imageArk: imageArk(e.sourceUrl), title: e.content.title, date: e.content.recordDate, place: e.content.recordPlace,
          recordType: e.content.recordType, collectionId: e.collectionId, collectionTitle: e.collectionTitle,
          machineTranscript: e.content.textDocument, highlights: e.content.highlightTexts ?? [], entities: e.content.entities ?? [] };
      });
      return { items, total: data.results, offset: data.index ?? 0, complete: !data.links?.next?.href, next: safeLink(data.links?.next?.href) };
    });
  }

  private async collect<T>(initial: string, options: PageOptions, read: (url: string) => Promise<ResearchPage<T>>): Promise<ResearchPage<T>> {
    const { count, offset, limit } = pageOptions(options);
    const start = researchUrl(initial), url = options.resume ? researchUrl(options.resume) : start;
    if (url.pathname !== start.pathname) throw new Error('Resume URL belongs to a different research route.');
    if (!options.resume) { url.searchParams.set('count', String(Math.min(count, limit))); url.searchParams.set('offset', String(offset)); }
    const seen = new Set<string>();
    const result: ResearchPage<T> = { items: [], offset: integer(Number(url.searchParams.get('offset') ?? 0), 'Resume offset'), complete: false };
    let next: string | undefined = url.href;
    for (let pageNumber = 0; next && pageNumber < 10000; pageNumber++) {
      if (seen.has(next)) throw new ResearchError('pagination', 'Service repeated a continuation URL.');
      seen.add(next);
      const target = researchUrl(next);
      if (target.pathname !== start.pathname) throw new ResearchError('pagination', 'Service continuation changed research routes.');
      const remaining = limit - result.items.length;
      const requested = integer(Number(target.searchParams.get('count') ?? count), 'Page count', 1, 1000);
      if (requested > remaining) target.searchParams.set('count', String(remaining));
      const page = await read(target.href);
      if (page.items.length > remaining) throw new ResearchError('pagination', 'Service ignored the requested result limit.');
      if (page.offset !== result.offset + result.items.length) throw new ResearchError('pagination', 'Service returned a different offset or its continuation skipped or repeated results.');
      result.items.push(...page.items);
      result.total = page.total;
      next = page.next;
      result.next = next;
      result.complete = !next;
      if (!next && page.total !== undefined && page.offset + page.items.length < page.total) throw new ResearchError('pagination', 'Service omitted a continuation before reaching its reported total.');
      if (!options.all || result.items.length >= limit || !next) return result;
      if (!page.items.length) throw new ResearchError('pagination', 'Service returned an empty page with a continuation.');
    }
    throw new ResearchError('pagination', 'Traversal exceeded 10,000 pages; use a smaller --limit and resume.');
  }
}

export function decodeTranscript(data: TranscriptResponse, base: ImageTranscript): ImageTranscript {
  if (data?.stuff === null) return base;
  const stuff = data?.stuff;
  if (!stuff || !Array.isArray(stuff.regions) || !Array.isArray(stuff.pages) || !Array.isArray(stuff.metadata?.properties)) schema('Transcript service returned an unfamiliar document structure.');
  const properties = new Map(stuff.metadata.properties.map(p => [p.name, p.value]));
  const source = properties.get('IMAGE_ARK');
  if (!source || imageArk(source) !== base.imageArk) schema('Transcript did not identify the requested image ARK.');
  const regions = stuff.regions.map((region): TranscriptRegion => {
    if (!Array.isArray(region.lines)) schema('Transcript region has no ordered lines.');
    return { id: region.id, type: region.type, rect: region.rect, subPageId: region.subPageId,
      lines: region.lines.map(line => {
        if (!Array.isArray(line.tokens)) schema('Transcript line has no ordered tokens.');
        return { id: line.id, rect: line.rect, tokens: line.tokens.filter(Boolean).map(token => {
          if (typeof token.text !== 'string' && !token.redacted) schema('Transcript token is missing its text.');
          return { id: token.id, text: token.redacted ? '[REDACTED]' : token.text, rect: token.rect, ...(token.redacted ? { redacted: true } : {}) };
        }) };
      }) };
  });
  return { ...base, available: true, regions, pages: stuff.pages.map(p => ({ id: p.id, pageWidth: p.pageWidth, pageHeight: p.pageHeight })),
    text: regions.map(r => r.lines.map(l => l.tokens.map(t => t.text).join(' ')).join('\n')).join('\n\n'),
    hasRedactions: regions.some(r => r.lines.some(l => l.tokens.some(t => t.redacted))),
    language: properties.get('LANGUAGE'), recordDate: properties.get('RECORD_DATE'), recordPlace: properties.get('RECORD_PLACE') };
}

function imageArkOrUndefined(value?: string): string | undefined {
  if (!value) return undefined;
  try { return imageArk(value); } catch { return undefined; }
}
function pageOptions(options: PageOptions) {
  return { count: integer(options.count ?? 100, 'Page count', 1, 1000), offset: integer(options.offset ?? 0, 'Offset'),
    limit: integer(options.limit ?? Number.MAX_SAFE_INTEGER, 'Result limit', 1) };
}
export function imageSignatureMatches(bytes: Uint8Array, type: string): boolean {
  const b = Buffer.from(bytes);
  return type === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    : type === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : type === 'image/tiff' ? ['49492a00','4d4d002a','49492b00','4d4d002b'].includes(b.subarray(0,4).toString('hex'))
    : type === 'image/webp' ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' : false;
}
