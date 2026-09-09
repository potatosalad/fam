export interface Link {title: string; url: string}
export interface CategoryLink extends Link {linkCount: number | null; updated: string | null; updatedText: string | null}
export interface Resource {
  id: string | null; kind: 'resource' | 'heading'; title: string; url: string | null;
  description: string | null; markers: string | null; descriptionLinks: Link[];
  parentId: string | null; parentTitles: string[]; children: Resource[];
}
export interface Page {
  requestedUrl: string; url: string; title: string; kind: 'category' | 'page' | 'redirect' | 'file';
  text: string; links: Link[]; breadcrumbs: Link[]; categories: CategoryLink[]; related: Link[];
  resources: Resource[]; linkCount: number | null; pagination: Link[]; nextUrl: string | null;
  destinationUrl?: string; contentType?: string; warnings: string[];
}
export interface CacheInfo {
  status: 'fresh' | 'cached' | 'stale'; fetchedAt: string; ageSeconds: number;
  checkedAt: string | null; categoryUrl: string | null; publishedUpdated: string | null;
  warnings: string[];
}
export interface CachedPage extends Page {cache: CacheInfo}
export interface PageCollection {
  url: string; pages: CachedPage[]; categories: CategoryLink[]; related: Link[]; resources: Resource[];
  children: PageCollection[]; nextUrl: string | null; complete: boolean;
  errors: {url: string; message: string; code?: string; vncUrl?: string}[];
}
