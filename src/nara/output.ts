export function humanNara(data: any): string {
  if (data.saved) return `Saved ${data.saved}\n${data.provenance ? `Provenance: ${data.provenance}\nSHA-256: ${data.sha256}\n` : ''}`;
  const lines: string[] = [];
  if (Array.isArray(data.results)) {
    lines.push(`National Archives Catalog: ${data.query}`, `Page ${data.page}; ${data.results.length} results${data.total === null ? '' : ` of ${data.total}`}`, data.url, '');
    for (const hit of data.results) lines.push(`${hit.rank}. ${hit.title} [NAID ${hit.naid}]`, `   ${hit.level}`, `   ${hit.url}`, ...(hit.description ? [`   ${hit.description}`] : []));
    if (!data.results.length) lines.push('No matching results.');
    if (data.nextPage) lines.push('', `Next page: ${data.nextPage} (repeat the query and filters with --page ${data.nextPage})`);
  } else {
    lines.push(`${data.title} [NAID ${data.naid}]`, data.url);
    if (Array.isArray(data.items)) {
      lines.push(`Objects: ${data.items.length} rendered${data.total === null ? '' : ` of ${data.total}`}`);
      for (const item of data.items) lines.push(`${item.page}. ${item.label || 'Digital object'}`, `   ${item.url}`, ...(item.thumbnailUrl ? [`   Thumbnail: ${item.thumbnailUrl}`] : []));
    } else if (data.page) {
      lines.push(`Object page ${data.page}${data.total === null ? '' : ` of ${data.total}`}`);
      if (data.downloadUrl) lines.push(`Original: ${data.downloadUrl}`);
      if ('transcription' in data) lines.push('', data.transcription ? `Citizen transcription:\n${data.transcription}` : 'No transcription is available for this object.');
    } else {
      if (data.hierarchy?.length) lines.push('', 'Hierarchy:', ...data.hierarchy.map((l: any) => `  ${l.title}\n  ${l.url}`));
      lines.push('', data.text);
    }
  }
  for (const warning of data.warnings ?? []) lines.push(`Warning: ${warning}`);
  for (const notice of data.notices ?? []) lines.push(`Notice: ${notice}`);
  return lines.join('\n') + '\n';
}
