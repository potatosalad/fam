export const ORIGIN = 'https://catalog.archives.gov';
export class NaraError extends Error {
  constructor(message: string, readonly code = 'NARA_ERROR') {super(message); this.name = 'NaraError';}
}
export function integer(value: number, name: string, min = 1, max = 1000000): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new NaraError(`${name} must be an integer from ${min} to ${max}.`, 'INVALID_ARGUMENT');
  return value;
}
export function naid(value: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) throw new NaraError('Use a positive National Archives Identifier (NAID).', 'INVALID_ARGUMENT');
  return value;
}
export function catalogUrl(value: string): URL {
  let url: URL;
  try {url = new URL(value);} catch {throw new NaraError('Expected a National Archives Catalog HTTPS URL.', 'UNSAFE_URL');}
  if (url.origin !== ORIGIN || url.username || url.password) throw new NaraError('Only https://catalog.archives.gov URLs are supported.', 'UNSAFE_URL');
  return url;
}
export function recordId(value: string): string {
  if (/^[1-9]\d{0,19}$/.test(value)) return naid(value);
  const match = catalogUrl(value).pathname.match(/^\/id\/([1-9]\d{0,19})\/?$/);
  if (!match) throw new NaraError('Use a NAID or a Catalog /id/NAID record URL.', 'INVALID_ARGUMENT');
  return match[1];
}
export function recordUrl(value: string, page?: number, transcription = false): string {
  const url = new URL(`/id/${recordId(value)}`, ORIGIN);
  if (page !== undefined) url.searchParams.set('objectPage', String(integer(page, 'page')));
  if (transcription) url.searchParams.set('objectPanel', 'transcription');
  return url.href;
}
export const SORTS = ['relevant', 'title:asc', 'title:desc', 'naId:asc', 'naId:desc'] as const;
export interface SearchOptions {page?: number; limit?: number; availableOnline?: boolean; sort?: typeof SORTS[number]}
export function searchUrl(query: string, options: SearchOptions = {}): string {
  if (typeof query !== 'string' || !query.trim() || query.length > 4000) throw new NaraError('A nonempty query of at most 4,000 characters is required.', 'INVALID_ARGUMENT');
  const limit = options.limit ?? 20;
  if (![20, 50, 75, 100].includes(limit)) throw new NaraError('Catalog page size must be 20, 50, 75, or 100.', 'INVALID_ARGUMENT');
  if (options.sort !== undefined && !SORTS.includes(options.sort)) throw new NaraError('Unsupported Catalog sort order.', 'INVALID_ARGUMENT');
  const url = new URL('/search', ORIGIN);
  url.searchParams.set('q', query.trim()); url.searchParams.set('page', String(integer(options.page ?? 1, 'page')));
  url.searchParams.set('limit', String(limit));
  if (options.availableOnline) url.searchParams.set('availableOnline', 'true');
  if (options.sort && options.sort !== 'relevant') url.searchParams.set('sort', options.sort);
  return url.href;
}
export function mediaUrl(value: string): string {
  const url = catalogUrl(value);
  if (!/^\/media[a-zA-Z0-9/-]/.test(url.pathname) || url.hash || url.search) throw new NaraError('The Catalog did not expose a supported original media URL.', 'UNSAFE_URL');
  return url.href;
}
