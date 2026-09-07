import * as cheerio from 'cheerio';
import { checkUrl, NewspaperArchiveError } from './http.js';

export const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
export function pageDetails(html: string, sourceUrl: string) {
  checkUrl(sourceUrl);
  const $ = cheerio.load(html), imageId = String($('#hdnImageId').val() ?? '');
  if (!/^[1-9]\d*$/.test(imageId)) throw new NewspaperArchiveError('api-changed');
  const meta = (selector: string) => $(selector).attr('content') ?? null;
  const title = clean($('title').text());
  const publication = meta('meta[itemprop="publisher"]');
  const date = meta('meta[property="article:published_time"]');
  const pageNumber = String($('#hdnCurrentPage').val() ?? $('#hdnCurrentpageNumber').val() ?? '') || null;
  const ocr = $('.ocr-txt').first();
  ocr.find('script,style,noscript').remove();
  const text = clean(ocr.text()) || null;
  return {sourceUrl, imageId, title, publication, date, pageNumber,
    citation: [publication ?? title, date, pageNumber ? `p. ${pageNumber}` : null, sourceUrl].filter(Boolean).join(', '),
    ocr: text, ocrAvailable: !!text, ocrNote: 'Machine OCR may contain errors; verify names and dates against the newspaper image.',
    thumbnailUrl: meta('meta[itemprop="thumbnailUrl"]'),
    imageAccess: 'Use the source URL to view the scan; access depends on the account subscription.'};
}
