import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, writeFile, link, rm, lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {ARCHIVE, FULLTEXT, ArchiveHttp, InternetArchiveError, identifier, integer, fileUrl, chunks, readBytes, type HttpOptions} from './http.js';
import {stringifyJson} from '../shared/json.js';
import {ArchiveBooks} from './books.js';
import {ArchiveResearch} from './research.js';

type Data = Record<string, unknown>;
export interface ArchiveFile extends Data {name: string; format?: string; size?: string; md5?: string; private?: string | boolean | number; downloadUrl: string}
export interface ArchiveItem extends Data {identifier: string; url: string; metadata: Data; files: ArchiveFile[]}
export interface SearchOptions {limit?: number; page?: number; fields?: string[]; sort?: string[]}
export interface ScanOptions {count?: number; cursor?: string; fields?: string[]; sort?: string[]}
const defaultFields = ['identifier', 'title', 'creator', 'date', 'year', 'description', 'subject', 'collection', 'mediatype', 'language', 'access-restricted-item'];
const object = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value);
function records(value: unknown): Data[] {
  if (!Array.isArray(value) || !value.every(object)) throw new InternetArchiveError('Internet Archive returned an unexpected result list.', 'INVALID_RESPONSE');
  return value;
}
function query(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw new InternetArchiveError('query must contain 1–10000 characters.', 'INVALID_ARGUMENT');
  return value.trim();
}
function fields(value?: string[]): string[] {
  const result = [...new Set(['identifier', ...(value?.length ? value : defaultFields)])];
  if (result.some(field => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(field))) throw new InternetArchiveError('Invalid metadata field name.', 'INVALID_ARGUMENT');
  return result;
}
function sorts(value: string[] = []): string[] {
  if (value.some(sort => !/^[A-Za-z_][A-Za-z0-9_.-]*(?: (?:asc|desc))?$/.test(sort))) throw new InternetArchiveError('Use a sort field optionally followed by asc or desc.', 'INVALID_ARGUMENT');
  return value;
}
const itemUrl = (id: string) => `${ARCHIVE}/details/${identifier(id)}`;
function searchItem(data: Data): Data {
  if (typeof data.identifier !== 'string') throw new InternetArchiveError('Search result has no identifier.', 'INVALID_RESPONSE');
  return {...data, url: itemUrl(data.identifier)};
}
const privateFile = (file: ArchiveFile) => file.private === true || file.private === 1 || file.private === 'true' || file.private === '1';
async function checkFileResponse(file: ArchiveFile, response: Response): Promise<Response> {
  if (/\btext\/html\b/i.test(response.headers.get('content-type') ?? '') && !/\.x?html?$/i.test(file.name) && !/html/i.test(file.format ?? '')) {
    await response.body?.cancel();
    throw new InternetArchiveError('Internet Archive returned an HTML access page instead of the selected file; no file was saved.', 'ACCESS_DENIED');
  }
  return response;
}
function verifyFile(file: ArchiveFile, bytes: number, md5: string): void {
  if (file.size !== undefined && /^\d+$/.test(String(file.size)) && BigInt(file.size) !== BigInt(bytes))
    throw new InternetArchiveError('File size does not match item metadata; retry after refreshing the item.', 'INTEGRITY_ERROR');
  if (file.md5 && /^[a-f0-9]{32}$/i.test(file.md5) && file.md5.toLowerCase() !== md5)
    throw new InternetArchiveError('File checksum does not match item metadata; no file was saved.', 'INTEGRITY_ERROR');
}

/** Public, read-only Archive.org APIs. Never loads credentials, cookies, or a browser session. */
export class InternetArchiveClient {
  readonly http: ArchiveHttp;
  readonly books: ArchiveBooks;
  readonly research: ArchiveResearch;
  constructor(options: HttpOptions = {}) {
    this.http = new ArchiveHttp(options);
    this.books = new ArchiveBooks(this.http, id => this.item(id));
    this.research = new ArchiveResearch(this.books, id => this.item(id));
  }

  async search(input: string, options: SearchOptions = {}) {
    const q = query(input), limit = integer(options.limit ?? 20, 'limit', 1, 1000), page = integer(options.page ?? 1, 'page', 1, 10000);
    if (page * limit > 10000) throw new InternetArchiveError('Catalog pages are limited to the first 10000 results. Use internetarchive.item scan for cursor pagination.', 'INVALID_ARGUMENT');
    const url = new URL(`${ARCHIVE}/advancedsearch.php`);
    for (const [key, value] of Object.entries({q, rows: limit, page, output: 'json'})) url.searchParams.set(key, String(value));
    fields(options.fields).forEach((field, i) => url.searchParams.set(`fl[${i}]`, field));
    sorts(options.sort).forEach((sort, i) => url.searchParams.set(`sort[${i}]`, sort));
    const data = await this.http.json(url.href), response = data.response;
    if (!object(response) || !(typeof response.numFound === 'number' || typeof response.numFound === 'bigint')) throw new InternetArchiveError('Missing catalog search response.', 'INVALID_RESPONSE');
    const items = records(response.docs).map(searchItem), total = response.numFound;
    const hasMore = page * limit < total;
    return {query: q, url: url.href, items, total, page, limit, hasMore,
      nextPage: hasMore && (page + 1) * limit <= 10000 ? page + 1 : null,
      ...(hasMore && (page + 1) * limit > 10000 ? {note: 'Use internetarchive.item scan to continue beyond the catalog page window.'} : {})};
  }
  async scan(input: string, options: ScanOptions = {}) {
    const q = query(input), count = integer(options.count ?? 100, 'count', 100, 10000);
    const url = new URL(`${ARCHIVE}/services/search/v1/scrape`);
    url.searchParams.set('q', q); url.searchParams.set('count', String(count)); url.searchParams.set('fields', fields(options.fields).join(','));
    const sort = sorts(options.sort);
    if (sort.some((field, i) => /^identifier(?: |$)/.test(field) && i !== sort.length - 1)) throw new InternetArchiveError('identifier must be the last scan sort field.', 'INVALID_ARGUMENT');
    if (sort.length) url.searchParams.set('sorts', sort.join(','));
    if (options.cursor !== undefined) {if (!options.cursor.trim()) throw new InternetArchiveError('cursor must not be empty.', 'INVALID_ARGUMENT'); url.searchParams.set('cursor', options.cursor);}
    const data = await this.http.json(url.href);
    const items = records(data.items).map(searchItem);
    if (data.cursor !== undefined && typeof data.cursor !== 'string') throw new InternetArchiveError('Invalid scan cursor.', 'INVALID_RESPONSE');
    return {query: q, url: url.href, items, count: items.length, total: data.total, cursor: data.cursor || null, hasMore: !!data.cursor};
  }
  async collection(id: string, input = '*:*', options: SearchOptions = {}) {
    return this.search(`collection:${identifier(id)} AND (${query(input)})`, options);
  }
  async fulltext(input: string, options: {limit?: number; offset?: number} = {}) {
    const q = query(input), limit = integer(options.limit ?? 20, 'limit', 1, 100), offset = integer(options.offset ?? 0, 'offset', 0, 9999);
    if (offset + limit > 10000) throw new InternetArchiveError('Full-text offset plus limit cannot exceed 10000. Narrow the query.', 'INVALID_ARGUMENT');
    const data = await this.http.json(FULLTEXT, {q: `!L ${q}`, size: limit, from: offset, scroll: false});
    if (!object(data.hits)) throw new InternetArchiveError('Missing full-text search response.', 'INVALID_RESPONSE');
    const total = data.hits.total;
    const items = records(data.hits.hits).map(hit => {
      const fields = object(hit.fields) ? hit.fields : {};
      const id = Array.isArray(fields.identifier) ? fields.identifier[0] : fields.identifier;
      return {...hit, ...(typeof id === 'string' ? {identifier: id, url: itemUrl(id)} : {})};
    });
    const count = object(total) ? total.value : total;
    const hasMore = typeof count === 'number' || typeof count === 'bigint' ? offset + items.length < count : items.length === limit;
    return {query: q, url: FULLTEXT, items, total, offset, limit, hasMore, nextOffset: hasMore && offset + limit < 10000 ? offset + limit : null,
      timedOut: data.timed_out === true, ...(data.timed_out === true ? {warning: 'Full-text search timed out; results are partial. Retry or narrow the query.'} : {}),
      note: 'Experimental OCR search. Hits may repeat an item or reference restricted files; verify snippets against the scan.'};
  }
  async item(id: string): Promise<ArchiveItem> {
    const data = await this.http.json(`${ARCHIVE}/metadata/${identifier(id)}?extended_err=1`);
    if (!object(data.metadata) || !Object.keys(data.metadata).length) throw new InternetArchiveError('Internet Archive item was not found or has no available metadata.', 'NOT_FOUND');
    const files = records(data.files).map(file => {
      if (typeof file.name !== 'string') throw new InternetArchiveError('Invalid archive file metadata.', 'INVALID_RESPONSE');
      return {...file, name: file.name, downloadUrl: fileUrl(id, file.name)} as ArchiveFile;
    });
    return {...data, identifier: id, url: itemUrl(id), metadata: data.metadata, files};
  }
  async files(id: string, options: {format?: string; name?: string; source?: string} = {}) {
    const item = await this.item(id);
    return {identifier: id, url: item.url, metadata: item.metadata, files: item.files.filter(file =>
      (!options.format || file.format?.toLowerCase() === options.format.toLowerCase()) &&
      (!options.name || file.name.toLowerCase().includes(options.name.toLowerCase())) && (!options.source || file.source === options.source))};
  }
  private async selectedFile(id: string, name: string): Promise<ArchiveFile> {
    fileUrl(id, name);
    const item = await this.item(id), file = item.files.find(file => file.name === name);
    if (!file) throw new InternetArchiveError('File is not listed on this item. Use internetarchive.file list for exact names.', 'NOT_FOUND');
    if (privateFile(file)) throw new InternetArchiveError('This file is marked private. Public access cannot download it; check the item on archive.org for permitted access.', 'ACCESS_DENIED');
    return file;
  }
  async text(id: string, options: {file?: string; offset?: number; limit?: number; maxBytes?: number} = {}) {
    const offset = integer(options.offset ?? 0, 'offset', 0, 50 * 1024 * 1024), limit = integer(options.limit ?? 20000, 'limit', 1, 200000);
    const maxBytes = integer(options.maxBytes ?? 50 * 1024 * 1024, 'max-bytes', 1, 50 * 1024 * 1024);
    const item = await this.item(id);
    const candidates = item.files.filter(file => !privateFile(file) && (file.format === 'DjVuTXT' || file.name.endsWith('_djvu.txt')));
    const file = options.file ? item.files.find(file => file.name === options.file) : candidates.length === 1 ? candidates[0] : undefined;
    if (!file) throw new InternetArchiveError(candidates.length > 1 ? 'Multiple OCR text files; choose --file from internetarchive.file list.' : 'No selected public OCR text file. List files and choose an uncompressed .txt file with --file.', 'NOT_FOUND');
    if (privateFile(file)) throw new InternetArchiveError('Selected text file is private.', 'ACCESS_DENIED');
    if (!file.name.endsWith('.txt')) throw new InternetArchiveError('text get reads uncompressed .txt files. Use file download for PDFs, XML, HTML, or gzip files.', 'INVALID_ARGUMENT');
    const response = await checkFileResponse(file, await this.http.request(file.downloadUrl, {download: true}));
    const bytes = await readBytes(response, maxBytes);
    verifyFile(file, bytes.length, createHash('md5').update(bytes).digest('hex'));
    const content = bytes.toString('utf8'), text = content.slice(offset, offset + limit), hasMore = offset + text.length < content.length;
    return {identifier: id, url: item.url, file: file.name, sourceUrl: file.downloadUrl, text, offset, limit, totalCharacters: content.length, hasMore,
      nextOffset: hasMore ? offset + text.length : null, note: 'Machine OCR; offsets are UTF-16 characters, not printed page numbers. Verify against the scan.'};
  }
  async download(id: string, name: string, out: string, options: {maxBytes?: number} = {}) {
    const maxBytes = integer(options.maxBytes ?? 512 * 1024 * 1024, 'max-bytes', 1, 2 * 1024 * 1024 * 1024);
    if (!out) throw new InternetArchiveError('An explicit download destination is required.', 'INVALID_ARGUMENT');
    // Avoid a needless download when the caller already has a file or sidecar.
    // The final hard links still enforce no-overwrite if another process races us.
    for (const path of [out, `${out}.json`]) {
      try {await lstat(path);} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error;}
      throw Object.assign(new Error('Download destination or sidecar already exists.'), {code: 'EEXIST'});
    }
    const file = await this.selectedFile(id, name);
    await mkdir(dirname(out), {recursive: true, mode: 0o700});
    const temporary = `${out}.${randomUUID()}.tmp`, side = `${out}.json`, sideTemp = `${side}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const response = await checkFileResponse(file, await this.http.request(file.downloadUrl, {download: true}));
      const handle = await open(temporary, 'wx', 0o600), md5 = createHash('md5'), sha256 = createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of chunks(response, maxBytes)) {
          await handle.writeFile(chunk); bytes += chunk.length; md5.update(chunk); sha256.update(chunk);
        }
      } finally {await handle.close();}
      const checksum = md5.digest('hex'); verifyFile(file, bytes, checksum);
      const metadata = {provider: 'internetarchive', identifier: id, file: name, sourceUrl: itemUrl(id), downloadUrl: file.downloadUrl,
        retrievedAt: new Date().toISOString(), bytes, md5: checksum, sha256: sha256.digest('hex'), archiveFile: file};
      await writeFile(sideTemp, `${stringifyJson(metadata, 2)}\n`, {flag: 'wx', mode: 0o600});
      await link(temporary, out); created = true;
      try {await link(sideTemp, side);} catch (error) {if (created) await rm(out); throw error;}
      return {saved: out, metadata: side, bytes, sha256: metadata.sha256};
    } finally {await rm(temporary, {force: true}); await rm(sideTemp, {force: true});}
  }
}
