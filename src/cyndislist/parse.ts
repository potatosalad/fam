import {load, type Cheerio} from 'cheerio';
import type {Page, Link, CategoryLink, Resource} from './types.js';
import {CATEGORY_INDEX, categoryUrl, linkUrl, siteUrl, sourceId, sameCollection} from './url.js';
import type {Document} from './http.js';

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
function plain(element: Cheerio<any>): string {const copy = element.clone(); copy.find('br').replaceWith(' '); return clean(copy.text());}
const number = (text: string): number | null => {const m = text.match(/[\d,]+/); return m ? Number(m[0].replaceAll(',', '')) : null;};
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
export function updatedDate(text: string): string | null {
  const m = /Updated\s+(\w+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  const month = m ? months.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && month && Number(m[2]) >= 1 && Number(m[2]) <= 31 ? `${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}` : null;
}
export function parsePage(document: Document, requestedUrl = document.url): Page {
  const {url, text: html, contentType, destinationUrl} = document;
  const result: Page = {requestedUrl, url, title: '', kind: 'page', text: '', links: [], breadcrumbs: [], categories: [], related: [],
    resources: [], linkCount: null, pagination: [], nextUrl: null, warnings: [], contentType};
  if (destinationUrl) return {...result, kind: 'redirect', title: 'Cyndi’s List resource redirect', destinationUrl};
  if (contentType && !/html|text\/|json|xml/i.test(contentType))
    return {...result, kind: 'file', title: new URL(url).pathname, warnings: [`Linked file (${contentType}); open the source URL to read it.`]};
  if (!/<(?:html|body|div|p|h1|main)\b/i.test(html)) return {...result, text: html, title: new URL(url).pathname};
  const $ = load(html);
  let content = $('#contentarea-inner, #staticpage_content, main, article').first();
  if (!content.length) {content = $('body'); result.warnings.push('Unrecognized page layout; extracted the available body text and links.');}
  const heading = content.find('h1').first();
  result.title = plain(heading) || clean($('title').text());
  if (/^(?:404\b|page not found|not found\b|access denied|forbidden\b|error\b)/i.test(result.title)) throw new Error(`Cyndi’s List returned an error page: ${result.title}`);
  const copy = content.clone();
  copy.find('script, style, noscript, iframe, nav, footer, .add-this-widget, .under_content_section, .adsbygoogle').remove();
  copy.find('br').replaceWith('\n');
  copy.find('p, h1, h2, h3, li, div').append('\n');
  result.text = copy.text().split('\n').map(clean).filter(Boolean).join('\n');
  const links = (elements: Cheerio<any>, internal = false): Link[] => {
    const found = new Map<string, Link>();
    elements.each((_, el) => {
      const a = $(el), href = linkUrl(a.attr('href'), url); if (!href) return;
      let target = href;
      if (internal) {try {target = siteUrl(href);} catch {return;}}
      const key = `${target}\n${plain(a)}`;
      found.set(key, {title: plain(a), url: target});
    }); return [...found.values()];
  };
  result.links = links(content.find('a[href]'));
  result.breadcrumbs = links(heading.find('a[href]'), true);
  result.linkCount = number(plain(content.find('.linkcount').first()));
  const categoryLinks = new Map<string, CategoryLink>();
  const addCategory = (element: any) => {
    const a = $(element); let target: string;
    try {target = siteUrl(a.attr('href')!, url);} catch {return;}
    if (target === categoryUrl(url) || sourceId(target)) return;
    const li = a.closest('li'), update = plain(li.children('.updateText')) || null;
    const ownText = li.clone(); ownText.children('ul, ol, .updateText').remove();
    const count = /\(([\d,]+)\)/.exec(plain(ownText));
    categoryLinks.set(target, {title: plain(a), url: target, linkCount: count ? Number(count[1].replaceAll(',','')) : null,
      updated: update ? updatedDate(update) : null, updatedText: update});
  };
  $('#catindex a[href]').each((_, a) => addCategory(a));
  if (categoryUrl(url) === CATEGORY_INDEX) $('.updateText').each((_, el) => {
    const a = $(el).closest('li').children('a[href]').first(); if (a.length) addCategory(a[0]);
  });
  result.categories = [...categoryLinks.values()];
  $('h2, h3').each((_, h) => {
    if (/^Related Categories$/i.test(plain($(h)))) result.related.push(...links($(h).nextAll('ul, ol').first().find('a[href]'), true));
  });
  result.pagination = links($('.pagination a[href], a[rel="next"]'), true).filter(a => sameCollection(a.url, url) && a.url !== url);
  const currentNumber = Number(new URL(url).searchParams.get('page') ?? 1);
  result.nextUrl = result.pagination.filter(a => Number(new URL(a.url).searchParams.get('page') ?? 1) > currentNumber)
    .sort((a,b) => Number(new URL(a.url).searchParams.get('page') ?? 1) - Number(new URL(b.url).searchParams.get('page') ?? 1))[0]?.url ?? null;

  // Select actual resource anchors even when malformed HTML has moved them
  // outside the usual lists. Preserve unlinked headings and nested context.
  const byLi = new Map<any, Resource>();
  const nodes: {element: any; node: Resource}[] = [];
  $('a[href], .nolink').each((_, el) => {
    const a = $(el), id = sourceId(a.attr('href') ?? '', url);
    if (!id && !a.hasClass('nolink')) return;
    if (a.closest('.linkDesc').length) return;
    const li = a.closest('li'), own = li.children('div').first();
    if (!id && !li.length) return;
    if (li.length && byLi.has(li[0])) return;
    const description = own.children('p.linkDesc');
    const node: Resource = {id, kind: id ? 'resource' : 'heading', title: plain(a), url: id ? siteUrl(a.attr('href')!, url) : null,
      description: plain(description) || null, descriptionLinks: links(description.find('a[href]')),
      markers: plain(own.find('sup, .text-newlink, .text-updatedlink')) || null, parentId: null, parentTitles: [], children: []};
    if (!own.length && id) result.warnings.push(`Resource ${id} uses an unfamiliar layout; its title and link were retained.`);
    nodes.push({element: li[0], node}); if (li.length) byLi.set(li[0], node);
  });
  for (const {element, node} of nodes) {
    const parents = element ? $(element).parents('li').toArray().reverse().flatMap(e => byLi.has(e) ? [byLi.get(e)!] : []) : [];
    node.parentTitles = parents.map(p => p.title); node.parentId = parents.filter(p => p.id).at(-1)?.id ?? null;
    const parent = parents.at(-1); if (parent) parent.children.push(node); else result.resources.push(node);
  }
  if (result.categories.length || result.resources.length || content.find('.linkcount').length || $('#catindex').length || categoryUrl(url) === CATEGORY_INDEX) result.kind = 'category';
  return result;
}
