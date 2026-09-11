import {renderData} from '../shared/command-output.js';

export function humanInternetArchive(value: unknown): string {
  const data = value as Record<string, any>;
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
