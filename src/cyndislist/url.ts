export const ORIGIN = 'https://www.cyndislist.com';
export const CATEGORY_INDEX = `${ORIGIN}/categories/`;
export function linkUrl(value: string | undefined, base: string): string | null {
  if (!value) return null;
  try {const u = new URL(value, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : null;} catch {return null;}
}
/** Preserve arbitrary site paths/query parameters; only normalize equivalent hosts and page 1. */
export function siteUrl(value: string, base?: string): string {
  let u: URL;
  try {u = base ? new URL(value, base) : new URL(value);} catch {throw new Error('Expected an absolute Cyndi’s List URL.');}
  if (!['http:', 'https:'].includes(u.protocol) || !['cyndislist.com','www.cyndislist.com'].includes(u.hostname) || u.username || u.password || u.port)
    throw new Error('Expected a URL on cyndislist.com or www.cyndislist.com.');
  u.protocol = 'https:'; u.hostname = 'www.cyndislist.com'; u.hash = '';
  if (u.searchParams.getAll('page').length === 1 && u.searchParams.get('page') === '1') u.searchParams.delete('page');
  u.searchParams.sort();
  return u.href;
}
export function categoryUrl(value: string): string {const u = new URL(siteUrl(value)); u.searchParams.delete('page'); return u.href;}
export function sourceId(value: string, base?: string): string | null {
  try {const u = new URL(siteUrl(value, base)); return /^\/openurl\/?$/.test(u.pathname) ? u.searchParams.get('url') : null;} catch {return null;}
}
export function sameCollection(a: string, b: string): boolean {return categoryUrl(a) === categoryUrl(b);}
