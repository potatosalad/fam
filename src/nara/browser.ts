import {setTimeout as delay} from 'node:timers/promises';
import {configuredBrowser, type BrowserTab} from '../shared/browser-runtime.js';
import {browserConfig, transportPreference, BrowserError} from '../shared/browser-config.js';
import {catalogUrl, NaraError} from './url.js';

export interface Link {title: string; url: string}
export interface Snapshot {
  url: string; title: string; text: string; alerts: string[]; challenge: boolean;
  search: {present: boolean; summary: string; page: string; pages: string; limit: string; sort: string; online: boolean;
    results: {title: string; url: string; level: string; description: string; text: string; thumbnailUrl: string | null}[]};
  record: {title: string; level: string; header: string; text: string; breadcrumbs: Link[]; links: Link[]};
  objects: {page: string; total: string; selected: string; downloadUrl: string | null;
    items: {page: string; label: string; thumbnailUrl: string | null}[];
    transcriptionLabel: string; transcriptionOpen: boolean; transcription: string | null};
}
// Read rendered DOM only. No API keys, application state, cookies, or web-storage
// extraction. The Catalog itself performs its ordinary anonymous page requests.
export const SNAPSHOT = String.raw`(() => {
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const text = el => (el?.innerText || '').trim();
  const value = selector => one(selector)?.value || '';
  const link = el => ({title: text(el), url: el.href});
  const body = text(document.body);
  const heading = one('[data-testid="nac-page-header--title"]');
  const description = one('[data-testid="nac-description_full-result"]');
  const panel = one('[data-testid="nac-object-viewer--transcription-panel"]');
  const header = text(heading?.parentElement);
  const downloadUrl = one('a#contents-tab')?.href || null;
  const total = one('#object-page-input_object')?.max || header.match(/^([\d,]+) (?:Images?|Files?|Digital Objects?)\s*$/m)?.[1]?.replaceAll(',', '') || '';
  const selected = one('[id^="object-thumb--"][aria-selected="true"]')?.id.replace('object-thumb--', '') || '';
  const objectPage = value('#object-page-input_object') || selected || (total === '1' && downloadUrl ? '1' : '');
  const items = all('[id^="object-thumb--"]').map(el => ({page: el.id.replace('object-thumb--', ''),
    label: one('[title^="Designator:"]', el)?.getAttribute('title')?.replace(/^Designator:\s*/, '') || text(el),
    thumbnailUrl: one('img', el)?.src || null}));
  // Single-file records have no thumbnail strip or pagination input.
  if (!items.length && total === '1' && downloadUrl) items.push({page: '1', label: 'Digital object 1', thumbnailUrl: null});
  const transcriptionLabel = one('#transcription-tab')?.getAttribute('aria-label') || '';
  return {
    url: location.href, title: document.title, text: body.slice(0, 2000000),
    alerts: all('.usa-alert').map(text).filter(Boolean),
    challenge: /^(Just a moment|Access denied|Attention Required)/i.test(document.title) ||
      !!one('form#challenge-form, #cf-challenge-running, iframe[src*="challenges.cloudflare.com"]'),
    search: {
      present: !!one('[data-testid="nac-results"]'),
      summary: body.split('Results per page:')[0].slice(-5000),
      page: value('#object-page-input_results-top'), pages: one('#object-page-input_results-top')?.max || '',
      limit: value('#results-per-page'), sort: value('#sort-results'), online: !!one('#available-online')?.checked,
      results: all('.search-result').map(el => {
        const a = one('a.result-link', el);
        return {title: text(a), url: a?.href || '', level: text(a?.previousElementSibling),
          description: text(one('[data-testid="nac-result_description"]', el)), text: text(el),
          thumbnailUrl: one('img', el)?.src || null};
      })
    },
    record: {title: text(heading), level: text(one('[data-testid="nac-page-header--label"]')?.parentElement?.parentElement),
      header, text: text(description),
      breadcrumbs: all('[data-testid="nac-breadcrumbs"] a[href]').map(link),
      links: description ? all('a[href]', description).map(link) : []},
    objects: {page: objectPage, total, selected, downloadUrl, items, transcriptionLabel,
      transcriptionOpen: !!panel, transcription: panel && !/not (?:yet )?available|no transcription/i.test(transcriptionLabel)
        ? all('p', panel).map(text).filter(Boolean).join('\n\n') : null}
  };
})()`;

export type PageKind = 'search' | 'record' | 'object' | 'transcription';
export type ReadPage = (url: string, kind: PageKind) => Promise<Snapshot>;
export function ready(state: Snapshot, url: string, kind: PageKind): boolean {
  const expected = catalogUrl(url), actual = catalogUrl(state.url);
  if (actual.pathname !== expected.pathname) throw new NaraError('The Catalog navigated away from the requested page.', 'UNEXPECTED_PAGE');
  if (state.challenge) throw new BrowserError('National Archives Catalog requires browser verification. Open its page in the configured browser and retry.', 'BROWSER_INTERACTION_REQUIRED');
  if (kind === 'search') {
    if (actual.searchParams.get('q') !== expected.searchParams.get('q')) throw new NaraError('The Catalog changed the requested query.', 'UNEXPECTED_PAGE');
    const empty = /(?:\b0\s+results?\b|no (?:search )?results (?:found|were found)|no results match)/i.test(state.search.summary);
    return state.search.results.length > 0 || empty;
  }
  if (/\b(?:page|record) (?:was )?not found\b|record (?:is |has been )?unavailable/i.test(state.title)) throw new NaraError('Catalog record not found.', 'NOT_FOUND');
  if (!state.record.title || !state.record.text || !/NAID:\s*\d+/.test(state.record.header)) return false;
  if (kind === 'record') return true;
  if (!state.objects.items.length && !state.objects.downloadUrl) return false;
  const page = expected.searchParams.get('objectPage') ?? '1';
  if (state.objects.total && Number(page) > Number(state.objects.total)) throw new NaraError('Requested object page exceeds the record’s object count.', 'INVALID_ARGUMENT');
  if ((state.objects.page || state.objects.selected) !== page || state.objects.selected && state.objects.selected !== page) return false;
  if (kind === 'object') return !!state.objects.downloadUrl;
  return state.objects.transcriptionOpen && (!!state.objects.transcription || /not (?:yet )?available|no transcription/i.test(state.objects.transcriptionLabel));
}
export async function readPage(url: string, kind: PageKind, timeout = 60,
  getBrowser = configuredBrowser): Promise<Snapshot> {
  catalogUrl(url);
  if (transportPreference(await browserConfig()).policy === 'http') throw new NaraError('Anonymous NARA reads require the rendered Catalog; use --transport browser or auto. API-key access is not implemented.', 'BROWSER_REQUIRED');
  const browser = await getBrowser();
  const tab: BrowserTab = await browser.tab('nara', url);
  try {
    const end = Date.now() + timeout * 1000;
    do {
      const state = await tab.evaluate<Snapshot>(SNAPSHOT);
      if (ready(state, url, kind)) return state;
      await delay(500);
    } while (Date.now() < end);
    throw new NaraError('The Catalog did not finish rendering recognizable content. This is not a confirmed empty result; retry or increase --timeout.', 'PAGE_TIMEOUT');
  } finally {await tab.close().catch(() => {});}
}
