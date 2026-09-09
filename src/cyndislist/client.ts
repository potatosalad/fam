import {PageCache, errorDetails, type CacheStore} from './cache.js';
import {CyndisListHttp, type Transport} from './http.js';
import {parsePage} from './parse.js';
import {CATEGORY_INDEX, siteUrl, categoryUrl, sameCollection} from './url.js';
import type {PageCollection, CategoryLink} from './types.js';

export interface ReadOptions {allPages?: boolean; depth?: number; refresh?: boolean}
export class CyndisListClient {
  private http: CyndisListHttp;
  constructor(private options: {transport?: Transport; store?: CacheStore; now?: () => number} = {}) {this.http = new CyndisListHttp(options.transport);}
  private cache() {return new PageCache(async url => parsePage(await this.http.get(url), url), this.options.store, this.options.now);}
  async categories(filter = '', refresh = false) {
    const page = await this.cache().get(CATEGORY_INDEX, refresh);
    const terms = filter.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return {url: page.url, categories: page.categories.filter(c => terms.every(term => c.title.toLocaleLowerCase().includes(term))), cache: page.cache, warnings: page.warnings};
  }
  async read(input: string, options: ReadOptions = {}): Promise<PageCollection> {
    const depth = options.depth ?? 0;
    if (!Number.isSafeInteger(depth) || depth < 0 || depth > 20) throw new Error('Category depth must be an integer from 0 to 20.');
    const cache = this.cache(), visited = new Set<string>();
    const read = async (url: string, remaining: number): Promise<PageCollection> => {
      const result: PageCollection = {url, pages: [], categories: [], related: [], resources: [], children: [], nextUrl: null, complete: true, errors: []};
      const seenPages = new Set<string>(); let next: string | null = url;
      while (next) {
        const requestedPage: string = next;
        if (seenPages.has(next)) {result.errors.push({url: next, message: 'Repeated pagination URL; traversal stopped.'}); result.complete = false; break;}
        seenPages.add(next);
        try {
          const page = await cache.get(next, options.refresh);
          if (!result.pages.length) {result.url = page.url; visited.add(categoryUrl(page.url));}
          if (!sameCollection(page.url, result.url)) throw new Error('Pagination redirected outside the requested category.');
          result.pages.push(page); result.resources.push(...page.resources);
          for (const c of page.categories) if (!result.categories.some(prior => prior.url === c.url)) result.categories.push(c);
          for (const r of page.related) if (!result.related.some(prior => prior.url === r.url)) result.related.push(r);
          result.nextUrl = page.nextUrl; result.complete = !page.nextUrl;
          next = options.allPages ? page.nextUrl : null;
        } catch (error) {
          if (!result.pages.length) throw error;
          result.errors.push({url: requestedPage, ...errorDetails(error)}); result.complete = false; result.nextUrl = requestedPage; break;
        }
      }
      if (remaining > 0) for (const child of result.categories) {
        const key = categoryUrl(child.url); if (visited.has(key)) continue;
        visited.add(key);
        try {const tree = await read(child.url, remaining - 1); result.children.push(tree); if (!tree.complete) result.complete = false;}
        catch (error) {result.errors.push({url: child.url, ...errorDetails(error)}); result.complete = false;}
      }
      return result;
    };
    const url = siteUrl(input); visited.add(categoryUrl(url)); return read(url, depth);
  }
  async resolve(input: string, refresh = false) {
    const page = await this.cache().get(siteUrl(input), refresh);
    return {url: page.url, destinationUrl: page.destinationUrl ?? null, resolved: !!page.destinationUrl, cache: page.cache,
      warnings: page.destinationUrl ? page.warnings : [...page.warnings, 'This Cyndi page did not return an external redirect. Use page get to read its contents.']};
  }
}
