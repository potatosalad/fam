import {createHash} from 'node:crypto';
import {parseJson, stringifyJson} from '../shared/json.js';
import {readPrivateFile, writePrivateFile} from '../shared/storage.js';
import {InternetArchiveError, integer, readBytes} from './http.js';
import {ArchiveBooks, bookReference, enabled, ocrNote, parseOcr, publicContent, sha256, type ArchiveBook, type ArchivePage} from './books.js';
import type {ArchiveItem} from './client.js';

interface CachedBook {
  version: 1; reference: string; cachedAt: string; book: ArchiveBook;
  source: {url: string; file: string; bytes: number; md5: string; sha256: string};
  pages: {page: ArchivePage; text: string | null}[]; unmappedOcrLeaves: number[];
}
const cacheLimit = 64 * 1024 * 1024;
const cacheName = (reference: string) => `internetarchive/books/${sha256(reference)}.json`;
function references(values: string[]): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 20) throw new InternetArchiveError('Supply 1–20 --book values (IDENTIFIER or IDENTIFIER/VOLUME).', 'INVALID_ARGUMENT');
  return [...new Set(values.map(value => {
    if (typeof value !== 'string') throw new InternetArchiveError('Invalid book reference.', 'INVALID_ARGUMENT');
    const ref = bookReference(value); return ref.identifier + (ref.volume ? `/${ref.volume}` : '');
  }))];
}
async function readCache(reference: string): Promise<CachedBook | undefined> {
  try {
    const raw = await readPrivateFile(cacheName(reference), cacheLimit);
    if (!raw) return undefined;
    const envelope = parseJson(raw.toString('utf8')) as {sha256: string; data: CachedBook}, data = envelope.data;
    if (!data || data.version !== 1 || data.reference !== reference || envelope.sha256 !== sha256(stringifyJson(data)) ||
      data.book.identifier !== bookReference(reference).identifier || !Array.isArray(data.pages) || data.pages.length !== data.book.pageCount ||
      !data.pages.every(p => p && (typeof p.text === 'string' || p.text === null) && Number.isSafeInteger(p.page?.leaf))) throw new Error('Invalid cache schema or checksum');
    return data;
  } catch {throw new InternetArchiveError(`Cache for ${reference} is damaged, incompatible, or oversized. Run research cache --book ${reference} --refresh.`, 'INVALID_CACHE');}
}
const normalized = (value: string) => value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
/** At most one Unicode-code-point insertion, deletion, or substitution; no automatic name equivalence. */
function oneEdit(a: string, b: string): boolean {
  const left = [...a], right = [...b];
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {i++; j++; continue;}
    if (++edits > 1) return false;
    if (left.length >= right.length) i++;
    if (right.length >= left.length) j++;
  }
  return edits + Number(i < left.length || j < right.length) <= 1;
}
export class ArchiveResearch {
  constructor(private readonly books: ArchiveBooks, private readonly item: (id: string) => Promise<ArchiveItem>) {}
  async cache(values: string[], options: {refresh?: boolean; maxBytes?: number} = {}) {
    const refs = references(values), maxBytes = integer(options.maxBytes ?? 32 * 1024 * 1024, 'max-bytes', 1, cacheLimit);
    const results: {book: string; status: string; cachedAt: string; pages: number; missingOcrPages: number; sourceSha256: string}[] = [];
    const errors: {book: string; code: string; message: string}[] = [];
    for (const reference of refs) {
      try {
        const cached = options.refresh ? undefined : await readCache(reference);
        let data = cached;
        if (!data) {
          const ref = bookReference(reference), item = await this.item(ref.identifier), book = await this.books.get(ref.identifier, ref, item);
          publicContent(book);
          const file = item.files.find(file => file.name === `${book.volume}_djvu.xml`);
          if (!file) throw new InternetArchiveError('No uncompressed DjVu XML file for this volume. Use file list for other derivatives.', 'UNAVAILABLE');
          if (enabled(file.private)) throw new InternetArchiveError('This volume’s OCR file is private; caching requires public OCR.', 'ACCESS_DENIED');
          const bytes = await readBytes(await this.books.http.request(file.downloadUrl, {download: true}), maxBytes), md5 = createHash('md5').update(bytes).digest('hex');
          if (file.size !== undefined && /^\d+$/.test(String(file.size)) && BigInt(file.size) !== BigInt(bytes.length) ||
            file.md5 && /^[a-f\d]{32}$/i.test(file.md5) && file.md5.toLowerCase() !== md5) throw new InternetArchiveError('OCR bytes do not match item size/checksum metadata.', 'INTEGRITY_ERROR');
          const parsed = parseOcr(bytes.toString('utf8'), book.volume), byLeaf = new Map(parsed.map(p => [p.leaf, p]));
          const pages = book.pages.map(page => {
            const ocr = byLeaf.get(page.leaf);
            if (ocr && (ocr.width !== page.width || ocr.height !== page.height)) throw new InternetArchiveError('OCR dimensions do not match the reader page map.', 'INTEGRITY_ERROR');
            return {page, text: page.viewable ? ocr?.text ?? null : null};
          });
          const leaves = new Set(book.pages.map(p => p.leaf));
          data = {version: 1, reference, cachedAt: new Date().toISOString(), book, pages, unmappedOcrLeaves: parsed.filter(p => !leaves.has(p.leaf)).map(p => p.leaf),
            source: {url: file.downloadUrl, file: file.name, bytes: bytes.length, md5, sha256: sha256(bytes)}};
          const serialized = stringifyJson({sha256: sha256(stringifyJson(data)), data});
          if (Buffer.byteLength(serialized) > cacheLimit) throw new InternetArchiveError('Parsed cache exceeds the 64 MiB storage limit.', 'SIZE_LIMIT');
          await writePrivateFile(cacheName(reference), serialized);
        }
        results.push({book: reference, status: cached ? 'reused' : 'cached', cachedAt: data.cachedAt, pages: data.pages.length,
          missingOcrPages: data.pages.filter(p => p.text === null).length, sourceSha256: data.source.sha256});
      } catch (error) {
        errors.push({book: reference, code: error instanceof InternetArchiveError ? error.code : 'CACHE_ERROR', message: (error as Error).message});
      }
    }
    return {kind: 'research-cache', status: errors.length ? 'partial' : 'complete', results, errors,
      note: 'Rerun the same book list to resume: completed caches are reused with no network requests. --refresh replaces each cache only after a successful download. No per-file byte resume. Search reports missing OCR pages.'};
  }
  async search(values: string[], queries: string[], options: {fuzzy?: boolean; offset?: number; limit?: number} = {}) {
    const refs = references(values), offset = integer(options.offset ?? 0, 'offset', 0, Number.MAX_SAFE_INTEGER), limit = integer(options.limit ?? 20, 'limit', 1, 1000);
    if (!Array.isArray(queries) || !queries.length || queries.length > 20 || queries.some(q => typeof q !== 'string' || !q.trim() || q.length > 200)) throw new InternetArchiveError('Supply 1–20 literal --query values, each containing 1–200 characters.', 'INVALID_ARGUMENT');
    const terms = [...new Set(queries)].map(query => ({query, normalized: normalized(query)}));
    if (options.fuzzy && terms.some(t => !/^[\p{L}\p{N}]{4,40}$/u.test(t.normalized))) throw new InternetArchiveError('--fuzzy requires single words of 4–40 letters/digits; repeat --query for explicit spelling variants.', 'INVALID_ARGUMENT');
    const matches: {book: string; query: string; matched: string; matchType: string; page: ArchivePage; snippet: string; cachedAt: string; sourceSha256: string}[] = [];
    const books: {book: string; cachedAt: string; searchedPages: number; missingOcrPages: number; unmappedOcrLeaves: number[]}[] = [], errors: {book: string; code: string; message: string}[] = [];
    let total = 0;
    for (const reference of refs) {
      let cached: CachedBook | undefined;
      try {cached = await readCache(reference); if (!cached) throw new InternetArchiveError(`No cache for ${reference}. Run internetarchive.research cache with this --book first.`, 'CACHE_MISSING');}
      catch (error) {errors.push({book: reference, code: error instanceof InternetArchiveError ? error.code : 'CACHE_ERROR', message: (error as Error).message}); continue;}
      books.push({book: reference, cachedAt: cached.cachedAt, searchedPages: cached.pages.filter(p => p.text !== null).length,
        missingOcrPages: cached.pages.filter(p => p.text === null).length, unmappedOcrLeaves: cached.unmappedOcrLeaves});
      for (const {page, text} of cached.pages) {
        if (text === null) continue;
        const source = normalized(text);
        for (const term of terms) {
          let index = source.indexOf(term.normalized), matched = term.normalized, matchType = 'literal';
          if (options.fuzzy) {
            index = -1;
            let approximate: {index: number; matched: string} | undefined;
            for (const word of source.matchAll(/[\p{L}\p{N}]+/gu)) {
              if (word[0] === term.normalized) {index = word.index; matched = word[0]; break;}
              if (!approximate && oneEdit(word[0], term.normalized)) approximate = {index: word.index, matched: word[0]};
            }
            if (index < 0 && approximate) {index = approximate.index; matched = approximate.matched; matchType = 'approximate-one-edit';}
          }
          if (index < 0) continue;
          if (total >= offset && matches.length < limit) matches.push({book: reference, query: term.query, matched, matchType, page,
            snippet: source.slice(Math.max(0, index - 100), index + matched.length + 150), cachedAt: cached.cachedAt, sourceSha256: cached.source.sha256});
          total++;
        }
      }
    }
    return {kind: 'research-search', status: errors.length || books.some(b => b.missingOcrPages > 0 || b.unmappedOcrLeaves.length > 0) ? 'partial' : 'complete',
      offline: true, queries, matches, total, offset, limit, nextOffset: offset + limit < total ? offset + limit : null, books, errors,
      note: `One hit per query per reader page, in book, reader-page, then query order; literal matching ignores case and collapses whitespace. Snippets show normalized OCR. Fuzzy mode compares whole words using at most one insertion, deletion, or substitution; approximate matches are leads, not identity evidence. ${ocrNote}`};
  }
}
