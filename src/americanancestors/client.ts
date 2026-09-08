import {AmericanAncestorsHttp, AmericanAncestorsError, APP, WEB, checkUrl} from './http.js';
import {loadSession, validSession, readAccount} from './auth.js';
import {searchResults, recordDetails, imageDetails, plain} from './parse.js';
export interface SearchOptions {
  firstName?: string; lastName?: string; keywords?: string; location?: string; fromYear?: string; toYear?: string;
  collection?: string; category?: string; project?: string; recordType?: string; volumeId?: string; pageName?: string;
  exact?: boolean; soundex?: boolean; free?: boolean; images?: boolean; page?: number;
}
export function searchQuery(o: SearchOptions = {}) {
  if (![o.firstName,o.lastName,o.keywords,o.collection].some(v => v?.trim())) throw new Error('Supply a first name, last name, keywords, or collection title.');
  if (!Number.isSafeInteger(o.page ?? 1) || (o.page ?? 1) < 1 || (o.page ?? 1) > 1_000_000) throw new Error('Page must be an integer between 1 and 1000000.');
  if (o.exact && o.soundex) throw new Error('Choose either exact or soundex matching.');
  for (const y of [o.fromYear,o.toYear]) if (y !== undefined && !/^\d{4}$/.test(y)) throw new Error('Years must have four digits.');
  if (o.fromYear && o.toYear && o.fromYear > o.toYear) throw new Error('From year must be on or before to year.');
  if ((o.volumeId || o.pageName) && !o.collection) throw new Error('Volume and page filters require a collection title.');
  if (o.volumeId && !/^\d+$/.test(o.volumeId)) throw new Error('Volume ID must be a decimal string.');
  const q = new URLSearchParams({searchPage: 'Advanced-Search', page: String(o.page ?? 1), exactYear: 'true', exactRecordType: 'true'});
  for (const [key,value] of Object.entries({firstname:o.firstName,lastname:o.lastName,keywords:o.keywords,location:o.location,fromyear:o.fromYear,toyear:o.toYear,database:o.collection,category:o.category,project:o.project,recordtype:o.recordType,volumeId:o.volumeId,pageName:o.pageName})) if (value?.trim()) q.set(key,value.trim());
  for (const key of ['exact','soundex','free','images'] as const) if (o[key]) q.set(key,'true');
  return q;
}
export const operations = {
  collections: {method: 'GET', path: '/SearchResults/dropdowns', input: 'onLoad=true; optional category, project, free, images', output: 'SearchDropdown: Databases, Categories, Projects, RecordTypes, LifeEvents'},
  'collection-url': {method: 'GET', path: '/SearchResults/GetDatabseUrl', input: 'collectionName: exact title', output: 'JSON string: numeric collection ID/slug'},
  'collection-fields': {method: 'GET', path: '/SearchResults/ExtendedDropdowns', input: 'collectionName: exact title', output: 'volumes, attributes and optional combinedAttributes'},
  'collection-tips': {method: 'GET', path: '/SearchResults/SearchTips', input: 'collectionName: exact title', output: 'JSON HTML string with collection search guidance'},
  search: {method: 'GET', path: '/searchresults/results', input: 'firstname, lastname, database (title), location, keywords, fromyear, toyear, exact, soundex, page; see protocol.md', output: 'HTML rows with total-hits, index-page and page-size (50 observed)'},
  record: {method: 'GET', path: '/exploredatabases/RecordDisplay', input: 'cId, rId, volumeId, pageName from source URL', output: 'HTML indexed fields, citation, description and search tips; membership gates possible'},
  image: {method: 'GET', path: '/exploredatabases/image', input: 'cId, rId, volumeId, pageName from source URL', output: 'HTML viewer with Deep Zoom source or FamilySearch ARK; membership gates possible'},
};
export function describeOperation(name: string) {if (!Object.hasOwn(operations,name)) throw new Error('Unknown American Ancestors operation. Run fam americanancestors.api list.'); return {name,...operations[name as keyof typeof operations]};}
export class AmericanAncestorsClient {
  constructor(readonly http = new AmericanAncestorsHttp()) {}
  static async open(anonymous = false) {
    const session = anonymous ? undefined : await loadSession();
    if (!anonymous && !validSession(session)) throw new AmericanAncestorsError('session-rejected');
    return new AmericanAncestorsClient(new AmericanAncestorsHttp(session?.cookies));
  }
  me() {return readAccount(this.http);}
  async collections(filter?: string) {
    const data = await this.http.json(`${APP}/SearchResults/dropdowns?onLoad=true`), catalog = data?.SearchDropdown;
    if (!catalog || !['Databases','Categories','Projects','RecordTypes','LifeEvents'].every(k => Array.isArray(catalog[k]) && catalog[k].every((v: unknown) => typeof v === 'string'))) throw new AmericanAncestorsError('api-changed');
    const titles = catalog.Databases.filter((v: string) => v !== '-All-');
    return {items: titles.filter((title: string) => !filter || title.toLowerCase().includes(filter.toLowerCase())).map((title: string) => ({title})), total: titles.length,
      categories: catalog.Categories.filter((s: string) => s !== '-All-'), projects: catalog.Projects.filter((s: string) => s !== '-All-'), recordTypes: catalog.RecordTypes.filter((s: string) => s !== '-All-')};
  }
  async collection(name: string) {
    if (!name.trim()) throw new Error('An exact collection title is required.');
    const query = new URLSearchParams({collectionName:name});
    const slug = await this.http.json(`${APP}/SearchResults/GetDatabseUrl?${query}`);
    if (typeof slug !== 'string' || !/^\d+\/[a-z0-9-]+$/i.test(slug)) throw new Error('Collection was not found; use an exact title from fam americanancestors.collection list.');
    const fields = await this.http.json(`${APP}/SearchResults/ExtendedDropdowns?${query}`);
    if (!Array.isArray(fields?.volumes) || !Array.isArray(fields?.attributes)) throw new AmericanAncestorsError('api-changed');
    const tips = await this.http.json(`${APP}/SearchResults/SearchTips?${query}`);
    if (typeof tips !== 'string') throw new AmericanAncestorsError('api-changed');
    return {title:name, collectionId:slug.split('/')[0], sourceUrl:`${WEB}/search/databasesearch/${slug}`, ...fields, searchTips:plain(tips)};
  }
  async search(options: SearchOptions) {const q = searchQuery(options); return searchResults((await this.http.text(`${APP}/searchresults/results?${q}`)).text,q);}
  async resolve(source: string, image = false) {
    let url = checkUrl(source);
    if (url.origin !== WEB) throw new Error('Use the www.americanancestors.org record or image source URL.');
    if (/^\/DB\d+\/(?:r\/\d+|(?:rd|i)\/\d+\/[^/]+\/\d+)\/?$/i.test(url.pathname)) url = checkUrl((await this.http.text(url)).url);
    const match = url.pathname.match(/^\/databases\/([a-z0-9-]+)\/(?:RecordDisplay|image)\/?$/i);
    if (!match || url.origin !== WEB) throw new Error('Expected an American Ancestors record or image URL from search results.');
    const data = await this.http.json(`${APP}/ExploreDatabases/CollectionId?${new URLSearchParams({alias:match[1]})}`);
    const cId = String(data?.collection_id ?? ''); if (!/^\d+$/.test(cId)) throw new AmericanAncestorsError('api-changed');
    const params = new URLSearchParams({cId});
    for (const key of ['volumeId','pageName','rId']) {
      const value = url.searchParams.get(key); if (!value || value.length > 200 || key !== 'pageName' && !/^\d+$/.test(value)) throw new Error(`Source URL requires a valid ${key}.`);
      params.set(key,value);
    }
    url.pathname = `/databases/${match[1]}/${image ? 'image' : 'RecordDisplay'}/`;
    url.search = new URLSearchParams([...params].filter(([k]) => k !== 'cId')).toString();
    return {sourceUrl:url.href, apiUrl:`${APP}/exploredatabases/${image ? 'image' : 'RecordDisplay'}?${params}`};
  }
  async record(url: string) {const resolved = await this.resolve(url); return recordDetails((await this.http.text(resolved.apiUrl)).text,resolved.sourceUrl);}
  async image(url: string) {const resolved = await this.resolve(url,true); return imageDetails((await this.http.text(resolved.apiUrl)).text,resolved.sourceUrl);}
}
