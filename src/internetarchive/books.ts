import {createHash, randomUUID} from 'node:crypto';
import {link, lstat, mkdir, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import sharp from 'sharp';
import {load} from 'cheerio';
import {stringifyJson} from '../shared/json.js';
import {ARCHIVE, ArchiveHttp, InternetArchiveError, identifier, integer, fileUrl, readerUrl, readBytes} from './http.js';
import type {ArchiveItem} from './client.js';

type Data = Record<string, unknown>;
const object = (v: unknown): v is Data => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Data => object(v) ? v : {};
export const enabled = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
export const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const ocrNote = 'Machine OCR and supplied page labels can be wrong. Verify names, dates, and printed pagination against the scan.';
export interface BookOptions {volume?: string}
export interface PageOptions extends BookOptions {page?: number; leaf?: number; pageLabel?: string}
export interface ArchivePage {
  page: number; pageIndex: number; leaf: number; pageLabel: string | null; pageType: string | null;
  width: number; height: number; url: string; imageUrl: string | null; viewable: boolean;
}
export interface ArchiveBook {
  identifier: string; volume: string; volumes: string[]; title: unknown; url: string; metadata: Data;
  access: {restricted: boolean; streamOnly: boolean; lendingRequired: boolean; protected: boolean; publicContent: boolean; note: string};
  pageCount: number; pages: ArchivePage[]; sourceUrl: string; retrievedAt: string;
  server: string; itemPath: string; bookPath: string; searchAvailable: boolean; ocrAvailable: boolean;
}
export interface OcrWord {text: string; box: number[] | null}
export interface OcrPage {leaf: number; width: number; height: number; text: string; paragraphs: {text: string; words: OcrWord[]}[]}
function volumeName(id: string, volume: string): string {
  if (volume.length > 500) throw new InternetArchiveError('Volume name is too long.', 'INVALID_ARGUMENT');
  fileUrl(id, volume); return volume;
}
export function bookReference(value: string): {identifier: string; volume?: string} {
  const slash = value.indexOf('/'), id = identifier(slash < 0 ? value : value.slice(0, slash));
  return {identifier: id, ...(slash < 0 ? {} : {volume: volumeName(id, value.slice(slash + 1))})};
}
export function bookVolumes(item: ArchiveItem): string[] {
  const names = item.files.map(file => file.name);
  let volumes = names.filter(name => /_(?:scandata\.xml|(?:jp2|tif|jpg)\.zip)$/.test(name)).map(name => name.replace(/_(?:scandata\.xml|(?:jp2|tif|jpg)\.zip)$/, ''));
  if (!volumes.length) volumes = names.filter(name => name.endsWith('_djvu.xml')).map(name => name.slice(0, -9));
  return [...new Set(volumes.map(v => volumeName(item.identifier, v)))].sort();
}
function validateSelector(options: PageOptions, required = true): void {
  if (options.page !== undefined) integer(options.page, 'page', 1, 1000000);
  if (options.leaf !== undefined) integer(options.leaf, 'leaf', 0, 1000000);
  if (options.pageLabel !== undefined && (!options.pageLabel.trim() || options.pageLabel.length > 200)) throw new InternetArchiveError('page-label must contain 1–200 characters.', 'INVALID_ARGUMENT');
  const count = [options.page, options.leaf, options.pageLabel].filter(v => v !== undefined).length;
  if (count > 1 || required && count !== 1) throw new InternetArchiveError('Select exactly one of --page (one-based reader position), --leaf (scan number), or --page-label (printed label).', 'INVALID_ARGUMENT');
}
export function selectPage(book: ArchiveBook, options: PageOptions): ArchivePage {
  validateSelector(options);
  const found = book.pages.filter(p => options.page !== undefined ? p.page === options.page : options.leaf !== undefined ? p.leaf === options.leaf : p.pageLabel === options.pageLabel);
  if (found.length !== 1) throw new InternetArchiveError(found.length ? 'Printed page label is ambiguous. Use --page or --leaf from page list.' : 'Selected page is not in this volume. Use internetarchive.page list.', found.length ? 'AMBIGUOUS_PAGE' : 'NOT_FOUND');
  return found[0];
}
export function publicContent(book: ArchiveBook, page?: ArchivePage): void {
  if (!book.access.publicContent || page && !page.viewable) throw new InternetArchiveError('This volume requires restricted, streaming, or loan access. Page OCR, downloads, caching, and evidence export use public content only. Check the book on archive.org for login, borrowing, or eligibility requirements.', 'ACCESS_DENIED');
}
function imageOptions(options: {scale?: number; maxBytes?: number}) {
  const scale = integer(options.scale ?? 1, 'scale', 1, 32), maxBytes = integer(options.maxBytes ?? 32 * 1024 * 1024, 'max-bytes', 1, 64 * 1024 * 1024);
  if (![1,2,4,8,16,32].includes(scale)) throw new InternetArchiveError('scale must be 1, 2, 4, 8, 16, or 32; BookReader rounds other divisors.', 'INVALID_ARGUMENT');
  return {scale, maxBytes};
}
function endpoint(server: string, path: string, params: Record<string, string | number>): string {
  const url = readerUrl(`https://${server}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}
function responseInteger(value: unknown, name: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > 1000000) throw new InternetArchiveError(`Invalid BookReader ${name}.`, 'INVALID_RESPONSE');
  return value;
}
/** Parse only DjVu XML data; no external resources or declared entities are resolved. */
export function parseOcr(xml: string, volume: string): OcrPage[] {
  if (!/^\s*<\?xml\b/.test(xml) || !/<\/(?:DjVuXML|OBJECT)>\s*$/.test(xml) || /<!ENTITY\b/i.test(xml))
    throw new InternetArchiveError('Expected complete DjVu XML OCR, not an access page, truncated response, or an entity declaration.', 'INVALID_RESPONSE');
  const $ = load(xml, {xml: true});
  const seen = new Set<number>();
  const result: OcrPage[] = [];
  $('OBJECT').each((_, element) => {
    const node = $(element), name = node.children('PARAM[name="PAGE"]').attr('value') ?? node.attr('usemap') ?? '';
    const prefix = `${volume.split('/').at(-1)}_`;
    const tail = name.startsWith(prefix) ? name.slice(prefix.length) : '';
    if (!/^\d+\.djvu$/.test(tail)) throw new InternetArchiveError('OCR page cannot be mapped to a scan leaf safely.', 'INVALID_RESPONSE');
    const leaf = responseInteger(Number(tail.slice(0, -5)), 'OCR leaf');
    if (seen.has(leaf)) throw new InternetArchiveError('Duplicate OCR scan leaf.', 'INVALID_RESPONSE');
    seen.add(leaf);
    const paragraphs: OcrPage['paragraphs'] = [];
    node.find('PARAGRAPH').each((_, paragraph) => {
      const words: OcrWord[] = [], lines: string[] = [];
      $(paragraph).find('LINE').each((_, line) => {
        const lineWords: string[] = [];
        $(line).find('WORD').each((_, word) => {
          const text = $(word).text(), coords = ($(word).attr('coords') ?? '').split(',').map(Number);
          words.push({text, box: coords.length === 4 && coords.every(Number.isFinite) ? coords : null}); lineWords.push(text);
        });
        lines.push(lineWords.join(' '));
      });
      paragraphs.push({text: lines.join('\n'), words});
    });
    if (paragraphs.reduce((count, p) => count + p.words.length, 0) !== node.find('WORD').length)
      throw new InternetArchiveError('Unsupported OCR layout; some words could not be placed in paragraphs.', 'INVALID_RESPONSE');
    result.push({leaf, width: responseInteger(Number(node.attr('width')), 'OCR width', 1), height: responseInteger(Number(node.attr('height')), 'OCR height', 1),
      text: paragraphs.map(p => p.text).join('\n\n'), paragraphs});
  });
  if (!result.length) throw new InternetArchiveError('No DjVu OCR pages returned.', 'INVALID_RESPONSE');
  return result;
}
function bibliographic(item: {identifier: string; url: string; metadata: Data}, volume?: string, page?: ArchivePage) {
  const m = item.metadata, retrievedAt = new Date().toISOString();
  const fields = {title: m.title ?? null, creator: m.creator ?? null, date: m.date ?? m.year ?? null, publisher: m.publisher ?? null,
    volume: m.volume ?? null, language: m.language ?? null, contributor: m.contributor ?? null, collection: m.collection ?? null,
    source: m.source ?? null, callNumber: m.call_number ?? null};
  const phrase = (v: unknown): string => Array.isArray(v) ? v.map(phrase).join('; ') : typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  const label = page ? `${page.pageLabel !== null ? `p. ${page.pageLabel}, ` : ''}reader page ${page.page}, scan leaf ${page.leaf}` : '';
  const url = page?.url ?? item.url;
  const text = `${[phrase(fields.creator), phrase(fields.title) || `[title unavailable: ${item.identifier}]`, phrase(fields.publisher), phrase(fields.date), volume ? `digital volume ${volume}` : '', label].filter(Boolean).join('. ')}. Internet Archive, ${url} (accessed ${retrievedAt.slice(0, 10)}).`;
  return {kind: 'citation', provider: 'internetarchive', identifier: item.identifier, volume: volume ?? null, url, fields, page: page ?? null,
    retrievedAt, text, metadata: m, note: `Draft source citation from contributor metadata; review bibliographic details and any supplied page label. ${ocrNote}`};
}
async function absent(path: string): Promise<void> {
  try {await lstat(path);} catch (e) {if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e;}
  throw Object.assign(new Error('Output destination already exists.'), {code: 'EEXIST'});
}
/** Hard links publish files exclusively; an existing file or symlink is never replaced. */
async function savePage(out: string, image: Buffer, provenance: unknown) {
  const side = `${out}.json`, temporary = `${out}.${randomUUID()}.tmp`, sideTemp = `${temporary}.json`;
  await absent(out); await absent(side); await mkdir(dirname(out), {recursive: true, mode: 0o700});
  let created = false;
  try {
    await writeFile(temporary, image, {flag: 'wx', mode: 0o600});
    await writeFile(sideTemp, `${stringifyJson(provenance, 2)}\n`, {flag: 'wx', mode: 0o600});
    await link(temporary, out); created = true;
    try {await link(sideTemp, side);} catch (error) {if (created) await rm(out); throw error;}
  } finally {await rm(temporary, {force: true}); await rm(sideTemp, {force: true});}
  return {saved: resolve(out), metadata: resolve(side), bytes: image.length, sha256: sha256(image)};
}

export class ArchiveBooks {
  constructor(readonly http: ArchiveHttp, private readonly item: (id: string) => Promise<ArchiveItem>) {}
  async list(id: string) {
    const item = await this.item(identifier(id));
    return {identifier: id, url: item.url, volumes: bookVolumes(item), note: 'Choose the exact volume prefix with --volume when more than one is listed.'};
  }
  async get(id: string, options: BookOptions = {}, loadedItem?: ArchiveItem): Promise<ArchiveBook> {
    identifier(id); if (options.volume !== undefined) volumeName(id, options.volume);
    const item = loadedItem ?? await this.item(id), volumes = bookVolumes(item);
    const volume = options.volume ?? (volumes.length === 1 ? volumes[0] : undefined);
    if (!volume || !volumes.includes(volume)) throw new InternetArchiveError(volumes.length ? `Choose --volume from internetarchive.book list. Available: ${volumes.join(', ')}` : 'No readable scan volume was found in item metadata.', 'VOLUME_REQUIRED');
    const server = String(item.server ?? item.d1 ?? ''), itemPath = String(item.dir ?? '');
    if (!new RegExp(`^/\\d+/items/${id.replaceAll('.', '\\.')}$`).test(itemPath)) throw new InternetArchiveError('Missing or unsupported Archive storage path.', 'INVALID_RESPONSE');
    const sourceUrl = endpoint(server, '/BookReader/BookReaderJSIA.php', {id, server, itemPath, subPrefix: volume, format: 'json'});
    const result = await this.http.json(sourceUrl, undefined, true), data = obj(result.data), br = obj(data.brOptions), info = obj(data.data), lending = obj(data.lendingInfo);
    if (info.id !== id || info.subPrefix !== volume || br.bookId !== id || br.subPrefix !== volume || br.bookPath !== `${itemPath}/${volume}` || !Array.isArray(br.data)) throw new InternetArchiveError('BookReader metadata does not match the requested volume.', 'INVALID_RESPONSE');
    const access = {restricted: enabled(info.isRestricted) || enabled(item.metadata['access-restricted-item']), streamOnly: enabled(info.streamOnly),
      lendingRequired: enabled(lending.isLendingRequired), protected: enabled(lending.shouldProtectImages) || enabled(br.protected)};
    const publicAccess = info.isRestricted === false && info.streamOnly === false && !Object.values(access).some(Boolean);
    const bookUrl = new URL(String(info.bookUrl ?? item.url), ARCHIVE);
    if (bookUrl.origin !== ARCHIVE || !(bookUrl.pathname === `/details/${id}` || bookUrl.pathname.startsWith(`/details/${id}/`))) throw new InternetArchiveError('Unexpected BookReader citation URL.', 'INVALID_RESPONSE');
    // JSIA can return the main item URL even for a non-default volume. Preserve the selected volume in citations.
    bookUrl.pathname = `/details/${id}${volume !== id || volumes.length > 1 ? `/${volume.split('/').map(encodeURIComponent).join('/')}` : ''}`;
    bookUrl.search = ''; bookUrl.hash = '';
    const pages: ArchivePage[] = [], seen = new Set<number>();
    for (const raw of br.data.flat()) {
      if (!object(raw)) throw new InternetArchiveError('Invalid BookReader page map.', 'INVALID_RESPONSE');
      const leaf = responseInteger(raw.leafNum, 'leaf');
      if (seen.has(leaf)) throw new InternetArchiveError('Duplicate scan leaf in page map.', 'INVALID_RESPONSE');
      seen.add(leaf);
      let imageUrl: string | null = null;
      const viewable = publicAccess && raw.viewable !== false;
      if (viewable && typeof raw.uri === 'string') {
        const url = readerUrl(new URL(raw.uri, sourceUrl).href);
        const zip = url.searchParams.get('zip'), file = url.searchParams.get('file') ?? '';
        const format = ['jp2', 'tif', 'jpg'].find(ext => zip === `${itemPath}/${volume}_${ext}.zip`);
        const base = volume.split('/').at(-1)!;
        if (url.pathname !== '/BookReader/BookReaderImages.php' || url.searchParams.get('id') !== id || !format ||
          !file.startsWith(`${base}_${format}/${base}_`) || !file.endsWith(`.${format}`) ||
          !/^\d+$/.test(file.slice(`${base}_${format}/${base}_`.length, -format.length - 1)) ||
          Number(file.slice(`${base}_${format}/${base}_`.length, -format.length - 1)) !== leaf)
          throw new InternetArchiveError('Unexpected BookReader page image URL or scan leaf.', 'INVALID_RESPONSE');
        imageUrl = url.href;
      }
      pages.push({page: pages.length + 1, pageIndex: pages.length, leaf, pageLabel: typeof raw.pageNum === 'string' && raw.pageNum.trim() || typeof raw.pageNum === 'number' ? String(raw.pageNum) : null,
        pageType: typeof raw.pageType === 'string' ? raw.pageType : null, width: responseInteger(raw.width, 'page width', 1), height: responseInteger(raw.height, 'page height', 1),
        url: `${bookUrl.href.replace(/\/$/, '')}/page/n${pages.length}/mode/1up`, imageUrl, viewable});
    }
    if (!pages.length) throw new InternetArchiveError('BookReader returned no pages.', 'NOT_FOUND');
    const plugins = obj(br.plugins);
    return {identifier: id, volume, volumes, url: bookUrl.href, title: item.metadata.title ?? br.bookTitle, metadata: item.metadata,
      access: {...access, publicContent: publicAccess, note: publicAccess ? 'Public anonymous access; individual service requests may still fail.' : 'Account, loan, streaming, or eligibility restrictions apply. fam does not authenticate or borrow.'},
      pageCount: pages.length, pages, sourceUrl, retrievedAt: new Date().toISOString(), server, itemPath, bookPath: String(br.bookPath),
      searchAvailable: enabled(obj(plugins.search).enabled), ocrAvailable: publicAccess && (enabled(obj(plugins.textSelection).enabled) || enabled(obj(plugins.tts).enabled))};
  }
  async pages(id: string, options: BookOptions & {offset?: number; limit?: number} = {}) {
    const offset = integer(options.offset ?? 0, 'offset', 0, 1000000), limit = integer(options.limit ?? 50, 'limit', 1, 1000), book = await this.get(id, options);
    return {identifier: id, volume: book.volume, url: book.url, access: book.access, total: book.pageCount, pages: book.pages.slice(offset, offset + limit), offset, limit,
      nextOffset: offset + limit < book.pageCount ? offset + limit : null, note: ocrNote};
  }
  async page(id: string, options: PageOptions) {
    validateSelector(options); const book = await this.get(id, options);
    return {identifier: id, volume: book.volume, access: book.access, ...selectPage(book, options), note: ocrNote};
  }
  async search(id: string, query: string, options: BookOptions & {offset?: number; limit?: number} = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 1000) throw new InternetArchiveError('Book query must contain 1–1000 characters.', 'INVALID_ARGUMENT');
    const offset = integer(options.offset ?? 0, 'offset', 0, 1000000), limit = integer(options.limit ?? 20, 'limit', 1, 1000);
    const book = await this.get(id, options);
    if (!book.searchAvailable) throw new InternetArchiveError('Search inside is unavailable for this volume.', 'UNAVAILABLE');
    const url = endpoint(book.server, '/fulltext/inside.php', {item_id: id, doc: book.volume, path: book.itemPath, q: query.trim(), pre_tag: '{{{', post_tag: '}}}'});
    const data = await this.http.json(url, undefined, true);
    if (data.indexed === false) throw new InternetArchiveError('This volume has not been indexed for search inside. Try public OCR caching when available.', 'NOT_INDEXED');
    if (data.ia !== id || !Array.isArray(data.matches) || !data.matches.every(object)) throw new InternetArchiveError('Unexpected search-inside response.', 'INVALID_RESPONSE');
    const matches = data.matches.slice(offset, offset + limit).map(match => {
      const pars = Array.isArray(match.par) ? match.par.filter(object) : [];
      const leaves = [...new Set(pars.map(par => par.page).filter((v): v is number => typeof v === 'number'))];
      return {...match, pages: leaves.map(leaf => book.pages.find(p => p.leaf === leaf) ?? {leaf, url: null, warning: 'Search leaf is absent from the reader page map.'})};
    });
    return {kind: 'book-search', identifier: id, volume: book.volume, query, url: book.url, sourceUrl: url, indexed: data.indexed ?? null,
      matches, totalReturned: data.matches.length, offset, limit, nextOffset: offset + limit < data.matches.length ? offset + limit : null,
      note: `Pagination slices this bounded server response; the service supplies no completeness guarantee or continuation cursor. ${ocrNote}`};
  }
  async readOcr(book: ArchiveBook, page: ArchivePage) {
    publicContent(book, page);
    if (!book.ocrAvailable) throw new InternetArchiveError('Page OCR is unavailable for this volume.', 'UNAVAILABLE');
    const sourceUrl = endpoint(book.server, '/BookReader/BookReaderGetTextWrapper.php', {path: `${book.bookPath}_djvu.xml`, mode: 'djvu_xml', page: page.pageIndex});
    const bytes = await readBytes(await this.http.request(sourceUrl, {bookreader: true}), 16 * 1024 * 1024), xml = bytes.toString('utf8');
    const parsed = parseOcr(xml, book.volume);
    if (parsed.length !== 1 || parsed[0].leaf !== page.leaf || parsed[0].width !== page.width || parsed[0].height !== page.height) throw new InternetArchiveError('Page OCR does not match the selected scan leaf and dimensions.', 'INTEGRITY_ERROR');
    return {kind: 'page-ocr', identifier: book.identifier, volume: book.volume, page, url: page.url, sourceUrl, retrievedAt: new Date().toISOString(),
      text: parsed[0].text, paragraphs: parsed[0].paragraphs, xmlSha256: sha256(bytes), note: `${ocrNote} Text is reconstructed from OCR words and lines. Word boxes use DjVu coordinates [left, bottom, right, top] in full-resolution pixels.`};
  }
  async ocr(id: string, options: PageOptions) {
    validateSelector(options); const book = await this.get(id, options); return this.readOcr(book, selectPage(book, options));
  }
  private async image(book: ArchiveBook, page: ArchivePage, options: {scale?: number; maxBytes?: number}) {
    publicContent(book, page);
    if (!page.imageUrl) throw new InternetArchiveError('No public page image is available.', 'UNAVAILABLE');
    const {scale, maxBytes} = imageOptions(options);
    const url = readerUrl(page.imageUrl); url.searchParams.set('scale', String(scale)); url.searchParams.set('rotate', '0');
    const bytes = await readBytes(await this.http.request(url.href, {bookreader: true}), maxBytes);
    let image;
    try {
      const decoder = sharp(bytes, {limitInputPixels: 100000000, failOn: 'warning'});
      image = await decoder.metadata();
      // Metadata alone can succeed for a truncated JPEG. Decode pixels before accepting evidence.
      await decoder.stats();
    }
    catch {throw new InternetArchiveError('BookReader returned an invalid or oversized image, possibly an access page.', 'INVALID_RESPONSE');}
    if (image.format !== 'jpeg' || !image.width || !image.height || Math.abs(image.width - Math.ceil(page.width / scale)) > 2 || Math.abs(image.height - Math.ceil(page.height / scale)) > 2) throw new InternetArchiveError('Page image dimensions or format do not match the selected scan; no image was saved.', 'INTEGRITY_ERROR');
    return {bytes, provenance: {provider: 'internetarchive', identifier: book.identifier, volume: book.volume, page, sourceUrl: url.href,
      retrievedAt: new Date().toISOString(), scale, width: image.width, height: image.height, bytes: bytes.length, sha256: sha256(bytes)}};
  }
  async download(id: string, out: string, options: PageOptions & {scale?: number; maxBytes?: number}) {
    validateSelector(options); if (!out) throw new InternetArchiveError('An explicit --out is required.', 'INVALID_ARGUMENT');
    imageOptions(options);
    await absent(out); await absent(`${out}.json`);
    const book = await this.get(id, options), image = await this.image(book, selectPage(book, options), options);
    return savePage(out, image.bytes, image.provenance);
  }
  async citation(id: string, options: PageOptions = {}) {
    validateSelector(options, false);
    if (options.volume !== undefined || [options.page, options.leaf, options.pageLabel].some(v => v !== undefined)) {
      const book = await this.get(id, options), page = [options.page, options.leaf, options.pageLabel].some(v => v !== undefined) ? selectPage(book, options) : undefined;
      return bibliographic(book, book.volume, page);
    }
    return bibliographic(await this.item(identifier(id)));
  }
  async evidence(id: string, out: string, options: PageOptions & {scale?: number; maxBytes?: number}) {
    validateSelector(options); if (!out) throw new InternetArchiveError('An explicit evidence directory --out is required.', 'INVALID_ARGUMENT');
    imageOptions(options);
    await absent(out);
    const book = await this.get(id, options), page = selectPage(book, options);
    const ocr = await this.readOcr(book, page), image = await this.image(book, page, options), citation = bibliographic(book, book.volume, page);
    const entries: Record<string, string | Buffer> = {'page.jpg': image.bytes, 'ocr.txt': ocr.text, 'ocr.json': `${stringifyJson(ocr, 2)}\n`,
      'citation.txt': `${citation.text}\n`, 'citation.json': `${stringifyJson(citation, 2)}\n`};
    const manifest = {schemaVersion: 1, provider: 'internetarchive', identifier: id, volume: book.volume, page, retrievedAt: new Date().toISOString(),
      bookReader: {sourceUrl: book.sourceUrl, retrievedAt: book.retrievedAt}, image: image.provenance, ocr: {sourceUrl: ocr.sourceUrl, xmlSha256: ocr.xmlSha256, retrievedAt: ocr.retrievedAt},
      files: Object.entries(entries).map(([name, bytes]) => ({name, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes)})), note: citation.note};
    await mkdir(dirname(resolve(out)), {recursive: true, mode: 0o700});
    await mkdir(out, {mode: 0o700}); // Exclusive reservation. manifest.json is the completion marker, written last.
    try {
      for (const [name, bytes] of Object.entries(entries)) await writeFile(`${out}/${name}`, bytes, {flag: 'wx', mode: 0o600});
      await writeFile(`${out}/manifest.json`, `${stringifyJson(manifest, 2)}\n`, {flag: 'wx', mode: 0o600});
    } catch (error) {await rm(out, {recursive: true, force: true}); throw error;}
    return {saved: resolve(out), manifest: resolve(out, 'manifest.json'), files: [...Object.keys(entries), 'manifest.json'], citation: citation.text};
  }
}
