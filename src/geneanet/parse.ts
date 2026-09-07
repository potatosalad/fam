import * as cheerio from 'cheerio';
import { parseJson } from '../shared/json.js';
import { checkUrl, GeneanetError, WEB, TREE } from './http.js';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
/** Read JSON literals only. Website JavaScript is never evaluated. Internal: may contain a JWT. */
export function pageKeys(html: string): Record<string, any> {
  const result: Record<string, any> = {};
  for (const match of html.matchAll(/\$\.extend\(true,\s*keys\.elements,\s*(?=\{)/g)) {
    const start = match.index! + match[0].length;
    let depth = 0, quoted = false, escaped = false, end = start;
    for (; end < html.length; end++) {
      const c = html[end];
      if (quoted) {if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false;}
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {end++; break;}
    }
    let value: unknown;
    try { value = parseJson(html.slice(start, end)); } catch { throw new GeneanetError('api-changed'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      result[key] = item && typeof item === 'object' && !Array.isArray(item) ? {...result[key], ...item} : item;
    }
  }
  return result;
}
export function researchUrl(value: string): URL {
  const url = checkUrl(value);
  if (url.origin === TREE && /^\/[a-zA-Z0-9_]+$/.test(url.pathname)) {
    if ([...url.searchParams.keys()].some(k => !['lang','n','p','oc','i','type'].includes(k)) ||
        url.searchParams.has('type') && !['fiche','tree','timeline'].includes(url.searchParams.get('type')!)) throw new Error('Only person reads are supported by this tree URL command.');
  } else if (url.origin === WEB && /^(?:\/cercles\/view\/[\w-]+\/\d+|\/archival-registers\/view\/\d+(?:\/\d+)?|\/media\/public\/[\w-]+|\/library\/livre\/\d+\/[\w-]+|\/library\/viewer\/\d+|\/collections\/catalog\/(?:collection|theme)\/[\w-]+\/?)$/.test(url.pathname)) {
    if ([...url.searchParams.keys()].some(k => !['page','name','nom','with_variantes','individu_filter','zone'].includes(k))) throw new Error('Unsupported research URL parameters.');
  } else throw new Error('Unsupported Geneanet research URL. Use a record, viewer, media, collection, or tree-person link.');
  return url;
}
function link(value: string | undefined, base: string): string | undefined {
  if (!value) return;
  try { const u = new URL(value, base); if (u.protocol === 'https:' && !u.username && !u.password) {u.hash = ''; return u.href;} } catch { /* Ignore unusable links. */ }
}
export interface SearchResult {
  id: string; type: string; url: string; name: string; source: string; summary: string;
  dates: string[]; places: {event: string; place: string}[]; thumbnail?: string; accessMarkers: string[];
}
export interface SearchPage { url: string; total: string; results: SearchResult[]; next?: string; filters: {label: string; url: string}[] }
export function parseSearch(html: string, url: string): SearchPage {
  const $ = cheerio.load(html);
  const empty = /No results found|No individuals were found matching your criteria/i.test($('#no-results-container').text());
  const count = $('[data-nb-results]').first().attr('data-nb-results') ?? (empty && !$('.ligne-resultat').length ? '0' : undefined);
  if (!count || !/^\d+$/.test(count)) throw new GeneanetError('api-changed');
  const results = $('.ligne-resultat[data-id-es]').map((_i, e): SearchResult => {
    const row = $(e), name = clean(row.find('.content-individu .fake-a, .info-resultat .fake-a').first().text());
    const target = link(row.attr('href'), url);
    if (!target || !name) throw new GeneanetError('api-changed');
    return {id: row.attr('data-id-es')!, type: row.attr('data-type-fonds') ?? '', url: target, name,
      source: clean(row.find('.content-individu em').text()), summary: clean(row.find('.info-resultat').text()),
      dates: row.find('.content-periode p').map((_j, p) => clean($(p).text())).get().filter(Boolean),
      places: row.find('.ligne-lieu').map((_j, p) => ({event: $(p).find('[title]').first().attr('title') ?? '', place: clean($(p).find('.title-lieu').text())})).get(),
      thumbnail: link(row.find('.vignette img').attr('src'), url),
      accessMarkers: ['privilege','non-privilege','external-document'].filter(c => row.hasClass(c))};
  }).get();
  if (count !== '0' && !results.length) throw new GeneanetError('api-changed');
  const next = $('a[rel="next"]').attr('href') ?? $('a[href]').filter((_i, e) => /^Next\s*»/.test(clean($(e).text()))).first().attr('href');
  const filters = $('input[data-url]').map((_i, e) => {
    const id = $(e).attr('id'), label = clean($('label').filter((_j, label) => $(label).attr('for') === id).first().text());
    return {label, url: link($(e).attr('data-url'), url) ?? ''};
  }).get().filter(f => f.label && f.url);
  return {url, total: count, results, next: link(next, url), filters};
}
export interface Viewer {
  kind: 'register' | 'book'; id: string; page: string; pages: string; downloadUrl?: string;
  imageApiUrl?: string; imageBaseUrl?: string; singlePage?: boolean;
}
export interface ResearchPage {
  url: string; title: string; text: string; fields: {label: string; value: string}[];
  links: {label: string; url: string}[]; viewer?: Viewer;
  person?: {tree: string; index: string; firstname: string; lastname: string; reference?: string};
  media?: unknown[];
}
export function parsePage(html: string, url: string): ResearchPage {
  const $ = cheerio.load(html);
  if ($('input[name="_password"]').length && !$('#content .ligne-resultat').length) throw new GeneanetError('session-rejected');
  const keys = pageKeys(html), gw = keys.gntGeneweb;
  const viewer = $('#viewer-map'), pdf = $('#viewer-meta');
  let info: Viewer | undefined;
  if (viewer.length) {
    info = {kind: 'register', id: viewer.attr('data-doc-id') ?? '', page: /\/view\/\d+\/(\d+)/.exec(url)?.[1] ?? '1',
      pages: viewer.attr('data-max-page') ?? '', imageApiUrl: link(viewer.attr('data-api-url'), url), imageBaseUrl: link(viewer.attr('data-img-url'), url),
      downloadUrl: link($('.svg-icon-viewer-download').attr('data-url'), url)};
  } else if (pdf.length) {
    info = {kind: 'book', id: pdf.attr('data-livre-id') ?? '', page: pdf.attr('data-page') ?? '1', pages: pdf.attr('data-livre-nb-pages') ?? '',
      singlePage: pdf.attr('data-single-page-mode') === 'true',
      downloadUrl: pdf.attr('data-telechargeable') === '1' ? link(pdf.attr('data-pdf-url'), url) : undefined};
  }
  const title = clean($('title').text());
  $('script,style,noscript,header,footer,nav,form,#gw-header,#gw-footer,#gw-individual-header,.footer-container,.footer-legal,.tarteaucitronRoot').remove();
  const content = $('#content').length ? $('#content') : $('#content-wrapper').length ? $('#content-wrapper') : $('body');
  const links = content.find('a[href]').map((_i, e) => ({label: clean($(e).text()), url: link($(e).attr('href'), url) ?? ''})).get().filter(x => x.url && x.label);
  const fields = content.find('tr').map((_i, e) => {
    const cells = $(e).children('td,th'); return {label: clean(cells.first().text()).replace(/\s*:$/, ''), value: clean(cells.slice(1).text()).replace(/^:\s*/, '')};
  }).get().filter(x => x.label && x.value);
  return {url, title, text: clean(content.text()), fields, links: [...new Map(links.map(l => [l.url + l.label, l])).values()], viewer: info,
    ...(gw?.person && typeof gw.basename === 'string' ? {person: {tree: gw.basename, index: String(gw.person.index), firstname: String(gw.person.firstname ?? ''), lastname: String(gw.person.lastname ?? ''), reference: gw.person.ref}, media: Array.isArray(gw.media) ? gw.media : []} : {})};
}
export function parseCollections(html: string, url: string) {
  const $ = cheerio.load(html);
  const entries = $('a[href]').map((_i, e) => ({title: clean($(e).text()), url: link($(e).attr('href'), url) ?? ''})).get()
    .filter(x => x.title && /\/collections\/catalog\/(collection|theme)\//.test(x.url));
  if (!entries.length) throw new GeneanetError('api-changed');
  return {url, title: clean($('title').text()), entries: [...new Map(entries.map(e => [e.url, e])).values()]};
}
