import {renderData} from '../shared/command-output.js';

export function humanInternetArchive(value: unknown): string {
  const data = value as Record<string, any>;
  const pageLabel = (p: Record<string, any>) => `Reader page ${p.page ?? '?'} · leaf ${p.leaf}${p.pageLabel !== null && p.pageLabel !== undefined ? ` · printed ${p.pageLabel}` : ''}`;
  if (data.kind === 'citation') return `${data.text}\n\n${data.note}\n`;
  if (data.kind === 'page-ocr') return `${pageLabel(data.page)}\n${data.url}\n\n${data.text || '[No OCR text on this page.]'}\n\n${data.note}\n`;
  if (Array.isArray(data.matches)) {
    const rows = data.matches.map((match: Record<string, any>) => {
      const pages = match.pages ?? [match.page];
      return `${match.book ? `${match.book} · ${match.query} · ${match.matchType}\n` : ''}${match.text ?? match.snippet ?? ''}\n`
        + pages.map((p: Record<string, any>) => `  ${pageLabel(p)}\n  ${p.url ?? p.warning ?? 'No mapped page link'}`).join('\n');
    });
    return `${data.status ? `Status: ${data.status}\n` : ''}${data.total ?? data.totalReturned} page/query or server matches; showing ${rows.length}\n\n${rows.join('\n\n') || 'No matches.'}\n`
      + (data.nextOffset !== null ? `\nMore: --offset ${data.nextOffset}\n` : '')
      + (data.books ? `\nCoverage:\n${data.books.map((b: Record<string, any>) => `  ${b.book}: ${b.searchedPages} pages searched, ${b.missingOcrPages} missing OCR; cached ${b.cachedAt}`).join('\n')}\n` : '')
      + (data.errors?.length ? `\nErrors:\n${renderData(data.errors)}\n` : '') + `\n${data.note}\n`;
  }
  if (data.pageCount !== undefined) return `${Array.isArray(data.title) ? data.title.join('; ') : data.title}\n${data.url}\nVolume: ${data.volume}\n${data.pageCount} reader pages\n${data.access.note}\nSearch inside: ${data.searchAvailable ? 'available' : 'unavailable'}; page OCR: ${data.ocrAvailable ? 'available' : 'unavailable'}\nUse internetarchive.page list for the page map, or --json for full metadata.\n`;
  if (Array.isArray(data.pages)) return `${data.identifier} · ${data.volume}\n${data.total} reader pages; showing ${data.pages.length}\n\n`
    + data.pages.map((p: Record<string, any>) => `${pageLabel(p)}\n  ${p.url}`).join('\n\n') + '\n'
    + (data.nextOffset !== null ? `\nMore: --offset ${data.nextOffset}\n` : '') + `\n${data.note}\n`;
  if (typeof data.text === 'string') return `${data.url}\nOCR file: ${data.file}\nCharacters ${data.offset}–${data.offset + data.text.length} of ${data.totalCharacters}\n\n${data.text}\n`
    + (data.hasMore ? `\nMore: --offset ${data.nextOffset}\n` : '') + `\n${data.note}\n`;
  if (Array.isArray(data.items)) {
    const rows = data.items.map((item: Record<string, any>) => {
      const fields = item.fields ?? {}, title = item.title ?? fields.meta_title ?? item.identifier ?? item._id;
      const author = item.creator ?? fields.meta_creator, date = item.date ?? fields.meta_date;
      return `${Array.isArray(title) ? title.join('; ') : title}\n  ${item.url ?? ''}`
        + (author || date ? `\n  ${[author, date].filter(Boolean).map(v => Array.isArray(v) ? v.join('; ') : v).join(' · ')}` : '')
        + (item.highlight?.text ? `\n  ${item.highlight.text.join('\n  ')}` : '');
    });
    return `${rows.length} results${data.total !== undefined ? ` (total: ${typeof data.total === 'object' ? renderData(data.total) : data.total})` : ''}\n\n${rows.join('\n\n') || 'No matches.'}\n`
      + (data.nextPage ? `\nMore: --page ${data.nextPage}\n` : '') + (data.nextOffset !== null && data.nextOffset !== undefined ? `\nMore: --offset ${data.nextOffset}\n` : '')
      + (data.cursor ? `\nContinue with the same query, fields, and sort using --cursor '${data.cursor.replaceAll("'", "'\\''")}'\n` : '')
      + (data.warning ? `\nWarning: ${data.warning}\n` : '') + (data.note ? `\n${data.note}\n` : '');
  }
  return `${renderData(data)}\n`;
}
