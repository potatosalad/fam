import {setTimeout as delay} from 'node:timers/promises';
import {AmericanAncestorsHttp, AmericanAncestorsError, APP, WEB, checkUrl} from './http.js';
import {loadSession, validSession, readAccount} from './auth.js';
import {searchResults, recordDetails, imageDetails, plain} from './parse.js';
import {searchQuery, searchFields, validateSearch, type SearchOptions} from './search.js';
export {searchQuery, type SearchOptions} from './search.js';
export const operations = {
  collections: {method: 'GET', path: '/SearchResults/dropdowns', input: 'onLoad=true; optional category, project, free, images', output: 'SearchDropdown: Databases, Categories, Projects, RecordTypes, LifeEvents'},
  'collection-url': {method: 'GET', path: '/SearchResults/GetDatabseUrl', input: 'collectionName: exact title', output: 'JSON string: numeric collection ID/slug'},
  'collection-fields': {method: 'GET', path: '/SearchResults/ExtendedDropdowns', input: 'collectionName: exact title', output: 'volumes, attributes and optional combinedAttributes'},
  'collection-tips': {method: 'GET', path: '/SearchResults/SearchTips', input: 'collectionName: exact title', output: 'JSON HTML string with collection search guidance'},
  search: {method: 'GET', path: '/searchresults/results', input: 'firstname, lastname, database (title), location, keywords, fromyear, toyear, exact, soundex, page, fam1type/first/last through fam3, indexed collection attributes; see protocol.md', output: 'HTML rows with total-hits, index-page and page-size (50 observed)'},
  record: {method: 'GET', path: '/exploredatabases/RecordDisplay', input: 'cId, rId, volumeId, pageName from source URL', output: 'HTML indexed fields, citation, description and search tips; membership gates possible'},
  image: {method: 'GET', path: '/exploredatabases/image', input: 'cId and volumeId; optional pageName and rId for browsing', output: 'HTML viewer with Deep Zoom source or FamilySearch ARK; membership gates possible'},
};
export function describeOperation(name: string) {if (!Object.hasOwn(operations,name)) throw new Error('Unknown American Ancestors operation. Run fam americanancestors.api list.'); return {name,...operations[name as keyof typeof operations]};}
export class AmericanAncestorsClient {
  constructor(readonly http = new AmericanAncestorsHttp()) {}
  static async open(anonymous = false) {
    const session = anonymous ? undefined : await loadSession();
    if (!anonymous && !validSession(session)) throw new AmericanAncestorsError('session-rejected');
    return new AmericanAncestorsClient(new AmericanAncestorsHttp(session?.cookies));
  }
  private fieldCache = new Map<string, ReturnType<typeof searchFields>>();
  me() {return readAccount(this.http);}
  async fields(name: string) {
    if (!this.fieldCache.has(name)) {
      const data = await this.http.json(`${APP}/SearchResults/ExtendedDropdowns?${new URLSearchParams({collectionName:name})}`);
      this.fieldCache.set(name, searchFields(data?.attributes));
    }
    return this.fieldCache.get(name)!;
  }
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
    const fieldSchema = searchFields(fields.attributes); this.fieldCache.set(name, fieldSchema);
    return {title:name, fieldSchema, collectionId:slug.split('/')[0], sourceUrl:`${WEB}/search/databasesearch/${slug}`, ...fields, searchTips:plain(tips)};
  }
  async search(options: SearchOptions) {validateSearch(options); const q = searchQuery(options, Object.keys(options.fields ?? {}).length ? await this.fields(options.collection!) : undefined); return searchResults((await this.http.text(`${APP}/searchresults/results?${q}`)).text,q);}
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
      const value = url.searchParams.get(key); if (!value && image && key !== 'volumeId') continue; if (!value || value.length > 200 || key !== 'pageName' && !/^\d+$/.test(value)) throw new Error(`Source URL requires a valid ${key}.`);
      params.set(key,value);
    }
    url.pathname = `/databases/${match[1]}/${image ? 'image' : 'RecordDisplay'}/`;
    url.search = new URLSearchParams([...params].filter(([k]) => k !== 'cId')).toString();
    return {sourceUrl:url.href, apiUrl:`${APP}/exploredatabases/${image ? 'image' : 'RecordDisplay'}?${params}`};
  }
  async record(url: string) {const resolved = await this.resolve(url); return recordDetails((await this.http.text(resolved.apiUrl)).text,resolved.sourceUrl);}
  async image(url: string) {
    const resolved = await this.resolve(url,true), request = new URL(resolved.apiUrl);
    const image = imageDetails((await this.http.text(resolved.apiUrl)).text,resolved.sourceUrl);
    if (image.collectionId !== request.searchParams.get('cId') || image.volumeId !== request.searchParams.get('volumeId') ||
        request.searchParams.has('pageName') && image.pageName !== request.searchParams.get('pageName')) throw new Error('American Ancestors did not return the requested volume/page; no different page was substituted.');
    return image;
  }
  async volumes(name: string, filter?: string) {
    const collection = await this.collection(name), slug = new URL(collection.sourceUrl).pathname.split('/').at(-1)!;
    const items = collection.volumes.map((v: any) => {
      const volumeId = String(v.VolumeId ?? '');
      if (!/^\d+$/.test(volumeId) || typeof v.Name !== 'string') throw new AmericanAncestorsError('api-changed');
      return {volumeId, name:v.Name, sequence:v.SequenceId, sourceUrl:`${WEB}/databases/${slug}/image/?${new URLSearchParams({volumeId})}`};
    });
    return {collection:collection.title,collectionId:collection.collectionId,total:items.length,items:items.filter((v: {name:string})=>!filter || v.name.toLowerCase().includes(filter.toLowerCase()))};
  }
  async browse(name: string, volumeId: string, pageName?: string) {
    if (!/^\d+$/.test(volumeId)) throw new Error('Volume ID must be a decimal string.');
    const volumes = await this.volumes(name), volume = volumes.items.find((v: {volumeId:string})=>v.volumeId===volumeId);
    if (!volume) throw new Error('Volume does not belong to the selected collection.');
    const url = new URL(volume.sourceUrl);
    if (pageName !== undefined) {if (!pageName || pageName.length>200 || /[\0\r\n]/.test(pageName))throw new Error('Invalid page label.');url.searchParams.set('pageName',pageName);}
    return this.image(url.href);
  }
  async pages(url: string, limit: number) {
    if (!Number.isSafeInteger(limit) || limit<1 || limit>100)throw new Error('Page browsing limit must be 1–100.');
    const items: Awaited<ReturnType<AmericanAncestorsClient['image']>>[] = [], seen = new Set<string>();
    let next: string | null = url;
    while(next && items.length<limit) {
      if(items.length)await delay(250);
      const image = await this.image(next), key = `${image.collectionId}:${image.volumeId}:${image.pageName}`;
      if(seen.has(key))throw new Error('American Ancestors repeated a page; browsing stopped.');
      seen.add(key);items.push(image);next=image.nextUrl;
    }
    return {items,nextUrl:next,complete:next===null,note:'Page order follows the provider; labels can be nonnumeric. Metadata only, no scan tiles downloaded.'};
  }
}
