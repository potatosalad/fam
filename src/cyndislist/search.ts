import {setTimeout as delay} from 'node:timers/promises';
import {configuredBrowser, type BrowserTab, type Camofox} from '../shared/browser-runtime.js';
import {BrowserError, transportPreference, browserConfig} from '../shared/browser-config.js';
import {siteUrl} from './url.js';
import {errorDetails} from './cache.js';

export interface SearchHit {title: string; url: string | null; googleUrl: string; snippet: string; rank: number}
export interface SearchSnapshot {
  url: string; title: string; ready: boolean; challenge: boolean; empty: boolean;
  hits: {title: string; href: string; snippet: string}[]; nextUrl: string | null;
}
export interface SearchResult {
  query: string; googleQuery: string; results: SearchHit[]; pages: string[]; nextUrl: string | null; cursor: string | null;
  complete: boolean; errors: {url: string; message: string; code?: string; vncUrl?: string}[]; warnings: string[];
}
// Runs in the rendered Camofox tab. No destination URL is reconstructed from
// Google's abbreviated visible breadcrumbs. Redirect links are resolved below.
export const SEARCH_SNAPSHOT = `(() => {
  const text = document.body?.innerText || '';
  const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
  const hits = [];
  for (const h of document.querySelectorAll('#search h3, #rso h3')) {
    const a = h.closest('a[href]');
    if (!a || !h.getClientRects().length || h.closest('#tads, #bottomads, [data-text-ad], [aria-label="Ads"], [aria-label="Sponsored"]')) continue;
    const block = h.closest('.tF2Cxc, .wHYlTd') || h.closest('[data-hveid]');
    const snippet = block?.querySelector('.VwiC3b, [data-sncf="1"], .IsZvec');
    hits.push({title: clean(h.innerText), href:a.href, snippet:clean(snippet?.innerText)});
  }
  return {url:location.href, title:document.title, ready:document.readyState === 'complete',
    challenge: location.hostname === 'consent.google.com' || location.pathname.startsWith('/sorry') ||
      !!document.querySelector('form[action*="/sorry"], #captcha-form, iframe[src*="recaptcha"], form[action*="consent.google"]') ||
      /unusual traffic from your computer network|Before you continue to Google/i.test(text),
    empty: /did not match any documents|No results found for|Your search.*did not match/i.test(text), hits,
    nextUrl: (document.querySelector('a#pnnext, a[aria-label="Next page"], a[aria-label="Next"]') || {}).href || null};
})()`;

export function googleQuery(query: string): string {
  if (!query.trim()) throw new Error('A nonempty search query is required.');
  // Parentheses keep OR expressions inside the mandatory site constraint.
  return `site:cyndislist.com (${query.trim().replace(/\bsite:\S+/gi, '').trim()})`;
}
export function searchUrl(query: string): string {
  const url = new URL('https://www.google.com/search'); url.searchParams.set('q', googleQuery(query)); url.searchParams.set('hl','en'); return url.href;
}
export function checkContinuation(value: string, query: string): string {
  let u: URL; try {u = new URL(value);} catch {throw new Error('Invalid site search continuation URL.');}
  if (u.origin !== 'https://www.google.com' || u.username || u.password || u.pathname !== '/search' || u.searchParams.get('q') !== googleQuery(query))
    throw new Error('Continuation must belong to the same Cyndi’s List site search query.');
  u.hash = ''; return u.href;
}
/** Inspect only Google redirects; never request the linked Cyndi page here. */
export async function resolveGoogleLink(href: string, tab: Pick<BrowserTab, 'request'>): Promise<string> {
  let url = new URL(href, 'https://www.google.com');
  for (let hop = 0; hop < 5; hop++) {
    try {return siteUrl(url.href);} catch {}
    if (url.origin !== 'https://www.google.com' || url.username || url.password || !['/url','/goto'].includes(url.pathname)) throw new Error('Search link does not lead to a supported Cyndi URL.');
    const embedded = url.searchParams.get('q') ?? url.searchParams.get('url');
    if (embedded?.startsWith('https://') || embedded?.startsWith('http://')) {url = new URL(embedded); continue;}
    const response = await tab.request(url.href);
    const location = response.headers.get('location');
    if (![301,302,303,307,308].includes(response.status) || !location) throw new Error(`Site search result redirect could not be resolved (HTTP ${response.status}).`);
    url = new URL(location, url);
  }
  throw new Error('Site search result redirect limit exceeded.');
}
async function ready(tab: BrowserTab): Promise<SearchSnapshot> {
  const loadEnd = Date.now() + 30000;
  let challengeEnd: number | undefined;
  while (true) {
    let state: SearchSnapshot | undefined;
    try {state = await tab.evaluate<SearchSnapshot>(SEARCH_SNAPSHOT);} catch (error) {if (Date.now() >= loadEnd && challengeEnd === undefined) throw error;}
    if (state?.challenge) {
      if (challengeEnd === undefined) {challengeEnd = Date.now() + tab.browser.config.timeout * 1000; await tab.browser.notify();}
    } else if (state?.hits.length || state?.ready && state.empty) return state;
    if (Date.now() >= (challengeEnd ?? loadEnd)) {
      if (challengeEnd !== undefined) throw new BrowserError('Site search needs browser interaction. Complete verification or consent in the viewer, then retry.', 'BROWSER_INTERACTION_REQUIRED', tab.browser.endpoint.vncUrl);
      throw new Error('Site search results could not be recognized. This is not a confirmed empty search.');
    }
    await delay(1000);
  }
}
export async function search(query: string, options: {allPages?: boolean; cursor?: string} = {}, getBrowser: () => Promise<Camofox> = configuredBrowser): Promise<SearchResult> {
  const initial = options.cursor ? checkContinuation(options.cursor, query) : searchUrl(query);
  if (transportPreference(await browserConfig()).policy === 'http') throw new Error('Site search requires a browser; use --transport browser or auto.');
  const browser = await getBrowser(), tab = await browser.tab('cyndislist', initial);
  let keepTab = false;
  const result: SearchResult = {query, googleQuery: googleQuery(query), results: [], pages: [], nextUrl: null, cursor: null, complete: false, errors: [], warnings: []};
  const seenPages = new Set<string>(), seenResults = new Set<string>(); let next: string | null = initial;
  try {
    while (next) {
        const requestedPage: string = next;
      try {
        const pageKey = new URL(next).searchParams.get('start') ?? '0';
        if (seenPages.has(pageKey)) throw new Error('Site search repeated a results page; pagination stopped.');
        seenPages.add(pageKey);
        if (result.pages.length) await tab.navigate(next);
        const state = await ready(tab);
        checkContinuation(state.url, query);
        result.pages.push(state.url);
        for (const hit of state.hits) {
          let url: string | null = null;
          try {url = await resolveGoogleLink(hit.href, tab);} catch (error) {result.errors.push({url: hit.href, ...errorDetails(error)});}
          const key = url ?? hit.href; if (seenResults.has(key)) continue; seenResults.add(key);
          result.results.push({title: hit.title, url, googleUrl: hit.href, snippet: hit.snippet, rank: result.results.length + 1});
        }
        result.nextUrl = state.nextUrl ? checkContinuation(state.nextUrl, query) : null; result.cursor = result.nextUrl;
        result.complete = !result.nextUrl && result.errors.length === 0;
        next = options.allPages ? result.nextUrl : null;
      } catch (error) {
        keepTab = (error as {code?: string}).code === 'BROWSER_INTERACTION_REQUIRED';
        if (!result.pages.length) throw error;
        result.errors.push({url: requestedPage, ...errorDetails(error)}); result.nextUrl = requestedPage; result.cursor = requestedPage; result.complete = false; break;
      }
    }
    return result;
  } finally {
    if (!keepTab) try {await browser.api('/fam/close-tab', {userId: tab.userId, tabId: tab.id});} catch {result.warnings.push('The search finished, but its browser tab could not be closed.');}
  }
}
