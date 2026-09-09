import type {CategoryLink, Link, Resource, PageCollection, CacheInfo} from './types.js';
import type {SearchResult} from './search.js';

export function humanCyndisList(data: any): string {
  const lines: string[] = [];
  const link = (l: Link, prefix = '') => lines.push(`${prefix}${l.title || l.url}`, `${prefix}  ${l.url}`);
  const categories = (items: CategoryLink[], prefix = '') => items.forEach(c => {
    link(c, prefix); if (c.updatedText || c.linkCount !== null) lines.push(`${prefix}  ${[c.linkCount !== null ? `${c.linkCount} links` : '', c.updatedText].filter(Boolean).join(' · ')}`);
  });
  const cache = (c: CacheInfo, prefix = '') => {
    lines.push(`${prefix}Cache: ${c.status}; fetched ${c.fetchedAt}; age ${c.ageSeconds}s${c.publishedUpdated ? `; category updated ${c.publishedUpdated}` : ''}`);
    for (const warning of c.warnings) lines.push(`${prefix}Warning: ${warning}`);
  };
  const resources = (items: Resource[], prefix = '') => items.forEach(r => {
    lines.push(`${prefix}• ${r.title || '(untitled)'}${r.markers ? ` [${r.markers}]` : ''}${r.id ? ` [ID ${r.id}]` : ''}`);
    if (r.url) lines.push(`${prefix}  ${r.url}`);
    if (r.description) lines.push(`${prefix}  ${r.description}`);
    for (const l of r.descriptionLinks) link(l, prefix + '  ');
    resources(r.children, prefix + '  ');
  });
  const collection = (c: PageCollection, prefix = '') => {
    lines.push(`${prefix}${c.pages[0]?.title || c.url}`, `${prefix}${c.url}`);
    for (const page of c.pages) {
      if (c.pages.length > 1) lines.push(`${prefix}Page: ${page.url}`);
      cache(page.cache, prefix); for (const warning of page.warnings) lines.push(`${prefix}Warning: ${warning}`);
      if (page.breadcrumbs.length) lines.push(`${prefix}Breadcrumbs: ${page.breadcrumbs.map(b => b.title).join(' > ')}`);
      if (page.destinationUrl) lines.push(`${prefix}Destination: ${page.destinationUrl}`);
      if (page.kind === 'page') {lines.push('', page.text.split('\n').map(l => prefix+l).join('\n')); for (const l of page.links) link(l, prefix);}
    }
    if (c.categories.length) {lines.push(`${prefix}Subcategories:`); categories(c.categories, prefix + '  ');}
    if (c.resources.length) {lines.push(`${prefix}Resources:`); resources(c.resources, prefix + '  ');}
    if (c.related.length) {lines.push(`${prefix}Related categories:`); c.related.forEach(l => link(l, prefix + '  '));}
    if (c.nextUrl) lines.push(`${prefix}Next page: ${c.nextUrl}`);
    if (!c.complete) lines.push(`${prefix}More pages remain or part of the requested traversal failed.`);
    for (const e of c.errors) lines.push(`${prefix}Error: ${e.url}: ${e.message}${e.vncUrl ? ` (${e.vncUrl})` : ''}`);
    for (const child of c.children) {lines.push(''); collection(child, prefix + '  ');}
  };
  if (data.saved) return `Saved ${data.saved}\n`;
  if (Array.isArray(data.results)) {
    const s = data as SearchResult; lines.push(`Google: ${s.googleQuery}`, '');
    for (const hit of s.results) {lines.push(`${hit.rank}. ${hit.title}`, `   ${hit.url ?? hit.googleUrl}`); if (hit.snippet) lines.push(`   ${hit.snippet}`);}
    if (!s.results.length) lines.push('No matching results.');
    if (s.cursor) lines.push('', `Continue with the same --query and --cursor ${JSON.stringify(s.cursor)}`);
    for (const e of s.errors) lines.push(`Error: ${e.message}${e.vncUrl ? ` (${e.vncUrl})` : ''}`);
    for (const w of s.warnings) lines.push(`Warning: ${w}`);
  } else if (Array.isArray(data.pages)) collection(data);
  else if (Array.isArray(data.categories)) {lines.push(data.url); cache(data.cache); categories(data.categories); for (const w of data.warnings) lines.push(`Warning: ${w}`);}
  else {lines.push(`Source: ${data.url}`, `Destination: ${data.destinationUrl ?? 'unresolved'}`); cache(data.cache); for (const w of data.warnings) lines.push(`Warning: ${w}`);}
  return lines.join('\n') + '\n';
}
