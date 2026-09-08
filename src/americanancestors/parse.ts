import {load} from 'cheerio';
import {AmericanAncestorsError, WEB, checkUrl} from './http.js';
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
export function plain(html: string) {const $ = load(html); $('script,style').remove(); return clean($.root().text());}
function source(href?: string) {if (!href) return null; const url = checkUrl(new URL(href, WEB)); return url.origin === WEB ? url.href : null;}
export function searchResults(html: string, query: URLSearchParams) {
  const $ = load(html), totalValue = $('.total-hits').val(), pageValue = $('.index-page').val(), sizeValue = $('.page-size').val();
  if (![totalValue,pageValue,sizeValue].every(v => typeof v === 'string' && /^\d+$/.test(v))) throw new AmericanAncestorsError('api-changed');
  const total = Number(totalValue), page = Number(pageValue), pageSize = Number(sizeValue);
  if (![total,page,pageSize].every(Number.isSafeInteger) || page < 1 || pageSize < 1) throw new AmericanAncestorsError('api-changed');
  const items = $('#tblSearchResult > table > tbody > tr').toArray().map(row => {
    const cells = $(row).children('td'), link = cells.eq(0).find('a[id^=name-]').first();
    const match = link.attr('href')?.match(/^\/DB(\d+)\/r\/(\d+)$/i);
    if (!match) throw new AmericanAncestorsError('api-changed');
    const labels = cells.eq(1).find('.labelDivStyle').toArray().map(e => clean($(e).text()));
    const values = cells.eq(1).find('.valueDiv').toArray().map(e => clean($(e).text()));
    return {collectionId: match[1], recordId: match[2], name: clean(link.text()), collection: clean(cells.eq(0).find('.nameValueDiv').text()),
      sourceUrl: source(link.attr('href')), imageUrl: source(cells.eq(0).find('a[id^=image-]').attr('href')),
      events: clean(cells.eq(1).text()), fields: labels.length === values.length ? labels.map((label,i) => ({label, value: values[i]})) : [],
      relationships: clean(cells.eq(2).text()), masked: cells.find('.placeholder-text').length > 0};
  });
  if (total > 0 && !items.length || items.length > pageSize || items.length > total) throw new AmericanAncestorsError('api-changed');
  const nextPage = page * pageSize < total ? page + 1 : null;
  const next = new URLSearchParams(query); if (nextPage) next.set('page', String(nextPage));
  return {items, total, page, pageSize, nextPage, sourceUrl: `${WEB}/search/database-search?${query}`, nextUrl: nextPage ? `${WEB}/search/database-search?${next}` : null,
    accessNote: 'Search hits may be masked for guests. Read the record and check its citation; a matching name alone is not proof of identity.'};
}
export function recordDetails(html: string, sourceUrl: string) {
  const $ = load(html), table = $('#tblRecordDislpay');
  if (!table.length) {
    if (/please\s+log in|become a member|access this database/i.test(plain($('#tblTranscript').html() ?? html))) throw new AmericanAncestorsError('access-denied');
    throw new AmericanAncestorsError('api-changed');
  }
  const fields = table.find('tr').toArray().map(row => {const c = $(row).children('td'); return {label: clean(c.eq(0).text()), value: clean(c.eq(1).text())};}).filter(v => v.label);
  if (!fields.length) throw new AmericanAncestorsError('api-changed');
  return {sourceUrl, recordId: String($('#hdnRecordid').val() ?? ''), recordType: String($('#hdnRecordTypeValue').val() ?? ''), fields,
    citation: clean($('#divClipboardURLTranscript').text()), descriptionAndSearchTips: plain($('#SearchTips').html() ?? '')};
}
export function imageDetails(html: string, sourceUrl: string) {
  const $ = load(html);
  // Extract only the source and partner flag; never evaluate scripts or expose their access tokens.
  const match = html.match(/initImage\(\s*'([^'\r\n]+)'\s*,\s*jQuery\.parseJSON\('(true|false)'\)/);
  if (!match) {
    if (/please\s+log in|become a member|access this database/i.test(plain(html))) throw new AmericanAncestorsError('access-denied');
    throw new AmericanAncestorsError('api-changed');
  }
  let imageSource = match[1], partner = match[2] === 'true';
  if (partner) {
    const url = new URL(imageSource);
    if (!['https://familysearch.org','https://www.familysearch.org'].includes(url.origin) || !/^\/ark:\/61903\/3:1:[A-Za-z0-9-]+$/.test(url.pathname)) throw new AmericanAncestorsError('api-changed');
    imageSource = `${url.origin}${url.pathname}`;
  } else {
    const url = checkUrl(imageSource, true);
    if (!/^\/[a-f0-9-]+\.xml$/i.test(url.pathname) || url.search) throw new AmericanAncestorsError('api-changed');
    imageSource = url.href;
  }
  return {sourceUrl, kind: partner ? 'familysearch' as const : 'deepzoom' as const, imageSource,
    downloadAvailable: !partner && $('#download').length > 0 && !$('#download').hasClass('disabled'),
    citation: clean($('#divClipboardURLTranscript').text()), collectionId: String($('#hdnCollectionID').val() ?? ''), volumeId: String($('#hdnVolumeid').val() ?? ''),
    previousPageName: String($('#hdnPrevPageName').val() ?? '') || null, nextPageName: String($('#hdnNextPageName').val() ?? '') || null,
    note: partner ? 'Partner-hosted scan. Use the FamilySearch source URL and its own access rules; no partner tokens are exported.' : 'Provider Deep Zoom image; downloads reconstruct the published tiles as PNG.'};
}
