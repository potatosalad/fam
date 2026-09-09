import {createHash} from 'node:crypto';
import {readPrivateJson, writePrivateJson} from '../shared/storage.js';
import {CATEGORY_INDEX, siteUrl} from './url.js';
import type {CachedPage, Page, CategoryLink} from './types.js';

const VERSION = 2, HOUR = 3600000, DAY = 24 * HOUR;
interface Entry {version: number; fetchedAt: number; page: Page; generation: string | null; categoryUrl: string | null; publishedUpdated: string | null}
interface Index {version: number; checkedAt: number; page: Page}
export interface CacheStore {read<T>(name: string): Promise<T | undefined>; write(name: string, data: unknown): Promise<void>}
const store: CacheStore = {read: readPrivateJson, write: writePrivateJson};
const indexFile = 'cyndislist/cache/index.json';
const key = (url: string) => `cyndislist/cache/pages/${createHash('sha256').update(url).digest('hex')}.json`;
const generation = (category?: CategoryLink) => category?.updated ? JSON.stringify([category.updated, category.linkCount]) : null;
function owner(url: string, categories: CategoryLink[]): CategoryLink | undefined {
  const path = new URL(url).pathname;
  return categories.filter(c => c.updated && (path === new URL(c.url).pathname || path.startsWith(new URL(c.url).pathname.endsWith('/') ? new URL(c.url).pathname : new URL(c.url).pathname + '/')))
    .sort((a,b) => b.url.length - a.url.length)[0];
}
export function errorDetails(error: unknown): {message: string; code?: string; vncUrl?: string} {
  const e = error as {message?: string; code?: string; vncUrl?: string};
  return {message: e?.message ?? String(error), ...(e?.code ? {code: e.code} : {}), ...(e?.vncUrl ? {vncUrl: e.vncUrl} : {})};
}
/** One index check per operation; disk state shares the hourly check across CLI invocations. */
export class PageCache {
  private indexPromise?: Promise<{index?: Index; warning?: string; fresh?: boolean}>;
  constructor(private fetchPage: (url: string) => Promise<Page>, private storage: CacheStore = store, private now: () => number = Date.now) {}
  private async read<T>(name: string): Promise<T | undefined> {
    try {return await this.storage.read<T>(name);} catch {return undefined;} // A broken disposable cache is rebuilt, never treated as provider data.
  }
  private async index(refresh: boolean) {
    return this.indexPromise ??= (async () => {
      const saved = await this.read<Index>(indexFile);
      const prior = saved?.version === VERSION && Array.isArray(saved.page?.categories) ? saved : undefined;
      if (prior && !refresh && this.now() - prior.checkedAt < HOUR) return {index: prior};
      try {
        const page = await this.fetchPage(CATEGORY_INDEX);
        if (!page.categories.some(c => c.updated)) throw new Error('The category index did not expose published update dates.');
        const index = {version: VERSION, checkedAt: this.now(), page};
        await this.storage.write(indexFile, index); return {index, fresh: true};
      } catch (error) {return {index: prior, warning: `Could not check category updates: ${errorDetails(error).message}`};}
    })();
  }
  async get(input: string, refresh = false): Promise<CachedPage> {
    const url = siteUrl(input), {index, warning, fresh} = await this.index(refresh);
    if (url === CATEGORY_INDEX) {
      if (!index) throw new Error(warning ?? 'The category index is unavailable.');
      return {...index.page, requestedUrl: input, cache: {status: warning ? 'stale' : fresh ? 'fresh' : 'cached',
        fetchedAt: new Date(index.checkedAt).toISOString(), ageSeconds: Math.max(0, Math.floor((this.now()-index.checkedAt)/1000)),
        checkedAt: new Date(index.checkedAt).toISOString(), categoryUrl: null, publishedUpdated: null, warnings: warning ? [warning] : []}};
    }
    const saved = await this.read<Entry>(key(url));
    const prior = saved?.version === VERSION && typeof saved.fetchedAt === 'number' && saved.page?.url ? saved : undefined;
    const category = owner(prior?.page.url ?? url, index?.page.categories ?? []);
    const version = generation(category), age = prior ? this.now() - prior.fetchedAt : Infinity;
    // An entry fetched on the publication day needs a later check even if the
    // date stays the same. The 48h margin covers the publisher's unknown timezone.
    const stableDate = prior && category?.updated && prior.fetchedAt >= Date.parse(category.updated + 'T00:00:00Z') + 2 * DAY;
    const reusable = prior && !refresh && !warning && prior.generation === version && (version && stableDate || age < DAY);
    let entry = prior, status: CachedPage['cache']['status'] = 'cached';
    const warnings = warning ? [warning] : [];
    if (!reusable) {
      try {
        const page = await this.fetchPage(url), actualOwner = owner(page.url, index?.page.categories ?? []);
        entry = {version: VERSION, fetchedAt: this.now(), page, generation: generation(actualOwner), categoryUrl: actualOwner?.url ?? null, publishedUpdated: actualOwner?.updated ?? null};
        await this.storage.write(key(url), entry); status = 'fresh';
      } catch (error) {
        if (!prior) throw error;
        status = 'stale'; warnings.push(`Refresh failed; using the saved page: ${errorDetails(error).message}`);
      }
    }
    return {...entry!.page, requestedUrl: input, cache: {status, fetchedAt: new Date(entry!.fetchedAt).toISOString(),
      ageSeconds: Math.max(0, Math.floor((this.now()-entry!.fetchedAt)/1000)), checkedAt: index ? new Date(index.checkedAt).toISOString() : null,
      categoryUrl: entry!.categoryUrl, publishedUpdated: entry!.publishedUpdated, warnings}};
  }
}
