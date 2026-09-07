import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { FindagraveClient } from './client.js';
import { IMAGES } from './http.js';
import { graphqlOperation } from './catalog.js';

export function integer(value: string | number | undefined, fallback: number, min = 0, max = 2147483647): number {
  const n = value === undefined ? fallback : Number(value);
  if (value === '' || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Expected an integer between ${min} and ${max}.`);
  return n;
}
export interface SearchOptions {name?: string; firstName?: string; middleName?: string; lastName?: string; birthYear?: string; deathYear?: string;
  yearRange?: string; location?: string; cemetery?: string[]; exact?: boolean; famous?: boolean; veteran?: boolean; hasGps?: boolean;
  bio?: string; relative?: string; includeMaidenName?: boolean; includeNickname?: boolean; similar?: boolean; plot?: string;
  birthFilter?: string; deathFilter?: string;
  sort?: string; descending?: boolean; size?: number; from?: number; input?: Record<string, unknown>;}
export function searchInput(options: SearchOptions): Record<string, unknown> {
  const input: Record<string,unknown> = {...options.input};
  for (const [key,value] of Object.entries({fullName: options.name, firstName: options.firstName, middleName: options.middleName, lastName: options.lastName,
    bio: options.bio, linkedToName: options.relative, includeMaidenName: options.includeMaidenName, includeNickname: options.includeNickname,
    fuzzyNames: options.similar, plot: options.plot,
    locationId: options.location, cemeteryIds: options.cemetery, exactName: options.exact, isFamous: options.famous, isVeteran: options.veteran, hasGps: options.hasGps})) {
    if (value !== undefined) input[key] = value;
  }
  if (input.bio !== undefined && (typeof input.bio !== 'string' || !input.bio.trim() || input.bio.length > 50)) throw new Error('--bio requires 1–50 characters of keywords.');
  if (input.exactName && input.fuzzyNames) throw new Error('Use either --exact or --similar.');
  if (options.yearRange !== undefined && options.birthYear === undefined && options.deathYear === undefined) throw new Error('--year-range requires --birth-year or --death-year.');
  for (const [key,value,filter] of [['birthYear',options.birthYear,options.birthFilter],['deathYear',options.deathYear,options.deathFilter]] as const) {
    if (value !== undefined) input[key] = integer(value, 0, 1, 9999);
    if (value !== undefined || filter !== undefined) {
      const comparison = filter ?? input[`${key}Filter`] ?? 'exact';
      if (!['exact','before','after','unknown'].includes(String(comparison))) throw new Error('Date filters must be exact, before, after, or unknown.');
      if (comparison === 'unknown' ? input[key] !== undefined : input[key] === undefined) throw new Error('Date comparisons require a year; unknown must be used without a year.');
      input[`${key}Filter`] = comparison;
      if (options.yearRange !== undefined && value !== undefined) input[`${key}Range`] = integer(options.yearRange, 0, 0, 9999);
      if (comparison !== 'exact' && input[`${key}Range`] !== undefined) throw new Error('--year-range requires an exact date comparison.');
    }
  }
  const orders: Record<string,string> = {relevance:'RELEVANCE',name:'NAME',birth:'BIRTH',death:'DEATH',cemetery:'CEMETERY',created:'DATE_CREATED',modified:'DATE_MODIFIED',plot:'PLOT'};
  if (options.sort || options.descending) {
    const order = orders[options.sort ?? 'name'];
    if (!order) throw new Error('Unknown sort; use relevance, name, birth, death, cemetery, created, modified, or plot.');
    if (options.descending && ['RELEVANCE','PLOT'].includes(order)) throw new Error('This sort does not have a descending variant.');
    input.orderBy = ['RELEVANCE','PLOT'].includes(order) ? order : `${order}_${options.descending ? 'DESC' : 'ASC'}`;
  }
  if (!Object.entries(input).some(([key,value]) => !['size','from','orderBy','exactName','fuzzyNames','includeMaidenName','includeNickname'].includes(key) && value !== undefined && value !== '' && value !== false)) throw new Error('Provide a name, date, location, cemetery, or other search filter.');
  input.size = integer(options.size ?? input.size as number | undefined, 20, 1, 100);
  input.from = integer(options.from ?? input.from as number | undefined, 0);
  return input;
}
export interface Photo {id: string; path: string; caption?: string; contributor?: {id: string; publicName: string}; type?: string;}
export async function memorialPhotos(client: FindagraveClient, id: string, size = 20, from = 0) {
  // Extend the APK's full memorial query using the live-confirmed photos(from,size) arguments.
  const op = graphqlOperation('memorial');
  const document = op.document.replace('($ids: [ID!]!)', '($ids: [ID!]!, $photoFrom: Int, $photoSize: Int)')
    .replace('photos(size: 20)', 'photos(from: $photoFrom, size: $photoSize)');
  const result = await client.query<{memorialsById: {id: string; photos?: {total: number; photos: Photo[] | null}}[]}>(document, {ids: [id], photoFrom: from, photoSize: size}, op.name, op.headers);
  const memorial = result.memorialsById?.find(m => String(m.id) === id);
  if (!memorial) throw new Error('Memorial was not found.');
  return {memorialId: id, total: memorial.photos?.total ?? 0, from, size, photos: memorial.photos?.photos ?? []};
}
export async function downloadPhoto(client: FindagraveClient, memorialId: string, photoId: string) {
  let photo: Photo | undefined;
  for (let from = 0; from < 10000; from += 100) {
    const page = await memorialPhotos(client, memorialId, 100, from);
    photo = page.photos.find(p => String(p.id) === photoId);
    if (photo || !page.photos.length || from + page.photos.length >= page.total) break;
  }
  if (!photo) throw new Error('Photo was not found in this memorial.');
  const url = new URL(photo.path);
  if (url.origin !== IMAGES || !url.pathname.startsWith('/photos/') || url.username || url.password || url.hash) throw new Error('Photo URL is not a Find a Grave image.');
  const response = await client.request<Uint8Array>(url.href, {response:'binary', headers:{
    'User-Agent':'Mozilla/5.0', Referer:`https://www.findagrave.com/memorial/${encodeURIComponent(memorialId)}`, Accept:'*/*',
  }});
  const meta = await sharp(response.data, {limitInputPixels: 200_000_000}).metadata();
  if (!meta.width || !meta.height || !['jpeg','png','webp'].includes(meta.format ?? '')) throw new Error('Response was not a supported photo.');
  await sharp(response.data).stats();
  return {bytes: response.data, metadata: {source: `https://www.findagrave.com/memorial/${memorialId}`, memorialId, photoId, imageUrl: url.href,
    caption: photo.caption ?? null, contributor: photo.contributor ?? null, downloadedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(response.data).digest('hex'), bytes: response.data.length, width: meta.width, height: meta.height, format: meta.format}};
}
