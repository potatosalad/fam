import type { FamilySearchClient } from './client.js';
import type { ChangeDto, OneSearchRequestDto, OneSearchResultDto, NoteDto, FactDto } from './generated/models.js';

/** APK ie0.g: file + filename + title/description + isPrivate form fields. */
export function memoryUpload(input: { file: Blob; filename: string; title?: string; description?: string; isPrivate: boolean }): FormData {
  if (!input.filename || /[\r\n/\\]/.test(input.filename)) throw new Error('Use a filename without directory separators.');
  if (!(input.file instanceof Blob) || typeof input.isPrivate !== 'boolean') throw new Error('Memory upload requires a Blob and an explicit isPrivate boolean.');
  const data = new FormData();
  data.append('file', input.file, input.filename);
  data.append('filename', input.filename);
  if (input.title?.trim()) data.append('title', input.title);
  if (input.description?.trim()) data.append('description', input.description);
  data.append('isPrivate', String(input.isPrivate));
  return data;
}

/** APK kh6: image/jpeg multipart upload with normalized crop coordinates. */
export function groupImageUpload(file: Blob, filename: string): FormData {
  if (!(file instanceof Blob) || file.type !== 'image/jpeg') throw new Error('Group images must be JPEG Blobs.');
  if (!filename || /[\r\n/\\]/.test(filename)) throw new Error('Use a filename without directory separators.');
  const data = new FormData();
  data.append('file', file, filename);
  for (const [key, value] of Object.entries({ mediaType: 'image/jpeg', x: '0', y: '0', width: '1', height: '1', rotation: '0' })) data.append(key, value);
  return data;
}

/** Payload builders keep the same DTO shape used for edits and create requests. */
export function notePayload(title: string, text: string, changeMessage: string, noteId = ''): NoteDto {
  return { noteId, value: { title, text }, attribution: { changeMessage } };
}
export function factPayload(conclusionType: string, value: FactDto['value'], changeMessage: string): FactDto {
  return { conclusionType, value, attribution: { changeMessage } };
}

function pageLimit(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error('maxPages must be an integer from 1 to 10000.');
}

/** Iterate the actual nextPageToken contract; reject repeated or missing continuation tokens. */
export async function* personChanges(client: FamilySearchClient, pid: string, options: { from?: string; maxPages?: number; signal?: AbortSignal } = {}): AsyncGenerator<ChangeDto> {
  const maxPages = options.maxPages ?? 100;
  pageLimit(maxPages);
  let from = options.from;
  const seen = new Set<string>(from ? [from] : []);
  for (let page = 0; page < maxPages; page++) {
    options.signal?.throwIfAborted();
    const result = await client.genealogy.history.changes({ pid, query: { from } });
    for (const change of result.changes ?? []) yield change;
    if (result.lastPage) return;
    const token = result.nextPageToken;
    if (!token || seen.has(token)) throw new Error('Change history returned a missing or repeated continuation token.');
    seen.add(token);
    from = token;
  }
  throw new Error('Change history exceeded maxPages; resume explicitly with a continuation token.');
}

/** One Search is a read-only POST with from/size offsets and results/total. */
export async function* searchResults(client: FamilySearchClient, body: OneSearchRequestDto, options: { from?: number; size?: number; maxPages?: number; signal?: AbortSignal } = {}): AsyncGenerator<OneSearchResultDto> {
  const maxPages = options.maxPages ?? 100;
  const size = options.size ?? 20;
  let from = options.from ?? 0;
  pageLimit(maxPages);
  if (!Number.isSafeInteger(size) || size < 1 || size > 100 || !Number.isSafeInteger(from) || from < 0) throw new Error('Search requires size 1–100 and a nonnegative integer offset.');
  for (let page = 0; page < maxPages; page++) {
    options.signal?.throwIfAborted();
    const result = await client.genealogy.search.results({ body, query: { from, size } });
    for (const item of result.results) yield item;
    from += result.results.length;
    if (from >= result.total || result.results.length === 0) return;
  }
  throw new Error('Search exceeded maxPages; resume explicitly with a from offset.');
}
