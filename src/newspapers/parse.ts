import {load} from 'cheerio';
import {parseJson} from '../shared/json.js';
import {NewspapersError, WEB} from './http.js';
/** Parse Next's serialized data as JSON; never execute website scripts. */
export function pageObjects(html: string): Record<string,any>[] {
  const $ = load(html), chunks: string[] = [], objects: Record<string,any>[] = [];
  $('script').each((_i, el) => {
    const script = $(el).text().trim(), prefix = 'self.__next_f.push(';
    if (!script.startsWith(prefix) || !/\);?$/.test(script)) return;
    try {const data = parseJson(script.slice(prefix.length).replace(/\);?$/, '')) as any;
      if (Array.isArray(data) && data[0] === 1 && typeof data[1] === 'string') chunks.push(data[1]);
    } catch { /* Other scripts are not data records. */ }
  });
  const visit = (value: any, depth = 0) => {
    if (depth > 100 || !value || typeof value !== 'object') return;
    if (!Array.isArray(value)) objects.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  for (const line of chunks.join('').split('\n')) {
    if (!/^[0-9a-f]+:[\[{]/i.test(line)) continue;
    try {visit(parseJson(line.slice(line.indexOf(':') + 1)));} catch {}
  }
  return objects;
}
export function account(html: string) {
  const value = pageObjects(html).find(x => typeof x.isAuthenticated === 'boolean' && Object.hasOwn(x,'username') && Object.hasOwn(x,'id'));
  if (!value) throw new NewspapersError('api-changed');
  if (!value.isAuthenticated) throw new NewspapersError('session-rejected');
  if (!/^[1-9]\d*$/.test(String(value.id)) || typeof value.username !== 'string' || typeof value.isSubscriber !== 'boolean') throw new NewspapersError('api-changed');
  return {id:String(value.id), username:value.username, email:typeof value.email === 'string' ? value.email : null,
    authenticated:true, isConfirmed:value.isConfirmed === true, isSubscriber:value.isSubscriber,
    isExtraSubscriber:value.isExtraSubscriber === true, isBasicSubscriber:value.isBasicSubscriber === true};
}
const secretKey = /token|cookie|authorization|password|secret|^iat$|^pqsid$|session|ancestryUid|^_internal/i;
/** Raw catalog responses are also filtered; authorization material stays internal. */
export function publicValue(value: any): any {
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key)).map(([key,v]) => [key,publicValue(v)]));
  if (typeof value === 'string') {
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return '[redacted]';
    if (/^https?:\/\//.test(value)) try {const url = new URL(value); for (const key of [...url.searchParams.keys()]) if (secretKey.test(key) || ['user','signature','sig'].includes(key)) url.searchParams.delete(key); return url.href;} catch {}
  }
  return value;
}
export function pageMetadata(value: any, id: string) {
  const image = value?.image;
  if (!image || String(image.imageId) !== id || typeof image.canView !== 'boolean' || typeof image.publicationTitle !== 'string') throw new NewspapersError('api-changed');
  const fields = ['date','edition','height','width','language','location','title','publicationTitle','publicationUrl','canView','reasonCanView','archived','extra'];
  return {imageId:id, publicationId:String(image.publicationId), ...Object.fromEntries(fields.filter(k => image[k] !== undefined).map(k => [k,publicValue(image[k])])),
    sourceUrl:`${WEB}/image/${id}/`, rights:Object.fromEntries(Object.entries(value.rights ?? {}).map(([key,right]:any) => [key,right?.allowed === true]))};
}
