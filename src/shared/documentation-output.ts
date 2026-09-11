import type {listDocumentation, readDocumentation} from './documentation.js';
import type {searchDocumentation} from './documentation-search.js';
import type {Values} from './command-runtime.js';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function wrap(text: string, width: number): string {
  const lines = [''];
  for (const word of text.split(/\s+/)) {
    if (lines.at(-1) && lines.at(-1)!.length + word.length + 1 > width) lines.push('');
    lines[lines.length - 1] += `${lines.at(-1) ? ' ' : ''}${word}`;
  }
  return lines.map(line => `   ${line}`).join('\n');
}
export function documentationOutput(action: string, data: unknown, values: Values, width = 100): string {
  if (action === 'read') {
    const doc = data as Awaited<ReturnType<typeof readDocumentation>>;
    return values.format === 'markdown' ? doc.markdown : doc.text;
  }
  if (action === 'list') {
    const {documents} = data as Awaited<ReturnType<typeof listDocumentation>>;
    if (!documents.length) return 'No matching guides. Run fam cli.doc list to see all documents.\n';
    return [`Installed documentation (${documents.length})`, '', ...documents.flatMap(doc => [
      `${doc.id} — ${doc.title}`, `  Read: ${doc.read}`,
      ...(values.doc ? doc.sections.flatMap(section => [`  ${section.id} — ${section.title}`, `    ${section.read}`]) : []), '',
    ]), 'List sections: fam cli.doc list --doc <ID>', 'Read a section: fam cli.doc read --doc <ID> --section <SECTION>', ''].join('\n');
  }
  const result = data as Awaited<ReturnType<typeof searchDocumentation>>;
  const warnings = (result.warnings ?? []).map(warning => `Warning: ${warning}\n`).join('');
  if (!result.results.length) return `${warnings}No documentation found for “${result.query}”.\nTry fewer words, or run fam cli.doc list.\n`;
  const next = ['fam cli.doc search', '--query', quote(result.query),
    ...(values.provider ? ['--provider', quote(String(values.provider))] : []), ...(values.doc ? ['--doc', quote(String(values.doc))] : []),
    ...(values.lexical ? ['--lexical'] : []), ...(values['no-rerank'] ? ['--no-rerank'] : []),
    ...(values.limit !== undefined ? ['--limit', String(values.limit)] : []), '--offset', String(result.nextOffset)].join(' ');
  return warnings + [`Documentation ${result.offset + 1}–${result.offset + result.results.length} of ${result.total} for “${result.query}”`, '',
    ...result.results.flatMap((item, i) => [`${result.offset + i + 1}. ${item.title} — ${item.heading} (${item.doc})`,
      wrap(item.excerpt.length > 400 ? item.excerpt.slice(0, 397) + '…' : item.excerpt, Math.max(30, width - 3)),
      `   Read: ${item.read}`, '']), ...(result.hasMore ? [`More: ${next}`, ''] : [])].join('\n');
}
