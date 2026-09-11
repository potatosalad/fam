import {readFile, readdir} from 'node:fs/promises';
import {join, posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {commandById, compareCliNames, providerNames} from './command-registry.js';

export interface DocSection {
  id: string; title: string; level: number; startLine: number; endLine: number; contentEndLine: number;
}
export interface Guide {
  id: string; provider: string; title: string; source: string; markdown: string; sections: DocSection[];
}
export interface DocumentationCatalog {schemaVersion: 1; documents: Guide[]}
export interface DocPassage {
  id: string; text: string; doc: string; provider: string; title: string; section: string;
  heading: string; source: string; read: string; commands: string[]; excerpt: string;
}
export class DocumentationError extends Error {
  constructor(message: string, readonly suggestion = 'fam cli.doc list') {super(message);}
}
const quote = (value: string) => /^[a-z0-9_./-]+$/i.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
export const docReadCommand = (doc: string, section?: string): string => `fam cli.doc read --doc ${quote(doc)}${section ? ` --section ${quote(section)}` : ''}`;
export const providerDocCommand = (provider: string): string => `fam cli.doc read --provider ${provider}`;
const slug = (title: string) => title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-') || 'section';

/** Heading ranges include child sections; fences never create headings. Lines are one-based. */
export function parseSections(markdown: string): DocSection[] {
  const lines = markdown.split('\n'), headings: {title: string; level: number; line: number}[] = [];
  let fence: {char: string; length: number} | undefined;
  for (let i = 0; i < lines.length; i++) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      continue;
    }
    if (marker) {fence = {char: marker[1][0], length: marker[1].length}; continue;}
    const atx = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (atx) headings.push({title: atx[2], level: atx[1].length, line: i + 1});
    else if (lines[i].trim() && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1] ?? '')) {
      headings.push({title: lines[i].trim(), level: lines[i + 1].trim()[0] === '=' ? 1 : 2, line: i + 1}); i++;
    }
  }
  const used = new Set<string>();
  return headings.map((heading, i) => {
    const base = slug(heading.title); let id = base, duplicate = 0;
    while (used.has(id)) id = `${base}-${++duplicate}`;
    used.add(id);
    return {id, title: heading.title, level: heading.level, startLine: heading.line,
      endLine: (headings.slice(i + 1).find(next => next.level <= heading.level)?.line ?? lines.length + 1) - 1,
      contentEndLine: (headings[i + 1]?.line ?? lines.length + 1) - 1};
  });
}

/** Only the public root README and regular Markdown files under docs enter a build. */
export async function createDocumentationCatalog(root: string): Promise<DocumentationCatalog> {
  async function walk(directory: string): Promise<string[]> {
    const entries = await readdir(join(root, directory), {withFileTypes: true});
    const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`)
      : entry.isFile() && entry.name.endsWith('.md') ? [`${directory}/${entry.name}`] : []));
    return nested.flat();
  }
  const sources = ['README.md', ...await walk('docs')];
  const documents = await Promise.all(sources.map(async source => {
    const markdown = (await readFile(join(root, source), 'utf8')).replaceAll('\r\n', '\n');
    const id = source === 'README.md' ? 'readme' : source.replace(/^docs\//, '').replace(/(?:\/README)?\.md$/, '');
    const provider = providerNames.find(name => source.startsWith(`docs/${name}/`)) ?? 'cli';
    const sections = parseSections(markdown);
    return {id, provider, source, title: sections[0]?.title ?? id, markdown, sections};
  }));
  if (new Set(documents.map(doc => doc.id)).size !== documents.length) throw new Error('Documentation IDs must be unique. Rename the conflicting guide.');
  return {schemaVersion: 1, documents: documents.sort((a, b) => compareCliNames(a.provider, b.provider) || compareCliNames(a.id, b.id))};
}

let cached: Promise<DocumentationCatalog> | undefined;
export function documentationCatalog(): Promise<DocumentationCatalog> {
  cached ??= (async () => {
    // Source runs reflect Markdown edits; compiled runtimes only use their own bundled snapshot.
    if (import.meta.url.endsWith('.ts')) return createDocumentationCatalog(fileURLToPath(new URL('../../', import.meta.url)));
    const catalog = JSON.parse(await readFile(new URL('../docs/catalog.json', import.meta.url), 'utf8')) as DocumentationCatalog;
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.documents)) throw new Error('Unsupported documentation catalog. Rebuild or reinstall fam.');
    return catalog;
  })().catch(error => {cached = undefined; throw error;});
  return cached;
}

function findGuide(catalog: DocumentationCatalog, options: {doc?: string; provider?: string}): Guide {
  const id = options.doc ?? options.provider ?? 'readme';
  const guide = catalog.documents.find(doc => doc.id === id);
  if (!guide) throw new DocumentationError(`Unknown document ${JSON.stringify(id)}. Use fam cli.doc list to see available IDs.`);
  if (options.provider && options.provider !== guide.provider) throw new DocumentationError(`Document ${id} belongs to ${guide.provider}, not ${options.provider}.`);
  return guide;
}
export const guideSummary = (guide: Guide) => ({id: guide.id, provider: guide.provider, title: guide.title,
  source: guide.source, read: docReadCommand(guide.id), sections: guide.sections.map(section => ({id: section.id, title: section.title,
    level: section.level, read: docReadCommand(guide.id, section.id)}))});

export async function listDocumentation(options: {provider?: string; doc?: string} = {}, catalog?: DocumentationCatalog) {
  catalog ??= await documentationCatalog();
  const documents = options.doc ? [findGuide(catalog, options)] : catalog.documents.filter(doc => !options.provider || doc.provider === options.provider);
  return {documents: documents.map(guideSummary)};
}

export function plainMarkdown(markdown: string, guide: Guide, catalog: DocumentationCatalog): string {
  const links = (text: string) => text.replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, target: string) => {
    const [path, anchor] = target.split('#');
    const source = path ? posix.normalize(posix.join(posix.dirname(guide.source), path)) : guide.source;
    const destination = catalog.documents.find(doc => doc.source === source);
    const link = destination ? docReadCommand(destination.id, anchor) : target;
    return `${label} (${link})`;
  }).replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1');
  let fence: {char: string; length: number} | undefined;
  return markdown.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {fence = undefined; return '';}
      return `  ${line}`;
    }
    if (marker) {fence = {char: marker[1][0], length: marker[1].length}; return '';}
    const heading = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {const title = links(heading[1]); return `${title}\n${'-'.repeat(title.length)}`;}
    return links(line);
  }).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export async function readDocumentation(options: {provider?: string; doc?: string; section?: string} = {}, catalog?: DocumentationCatalog) {
  catalog ??= await documentationCatalog();
  const guide = findGuide(catalog, options);
  let section: DocSection | undefined;
  if (options.section) {
    const selector = options.section.replace(/^#/, '');
    section = guide.sections.find(item => item.id === selector);
    if (!section) {
      const matches = guide.sections.filter(item => item.title.toLowerCase() === selector.toLowerCase());
      if (matches.length === 1) section = matches[0];
    }
    if (!section) throw new DocumentationError(`Unknown or ambiguous section ${JSON.stringify(options.section)} in ${guide.id}. Use the section IDs from fam cli.doc list --doc ${guide.id}.`, `fam cli.doc list --doc ${guide.id}`);
  }
  const markdown = section ? guide.markdown.split('\n').slice(section.startLine - 1, section.endLine).join('\n').trimEnd() + '\n' : guide.markdown;
  return {...guideSummary(guide), ...(section ? {section: section.id, heading: section.title} : {}),
    read: docReadCommand(guide.id, section?.id), markdown, text: plainMarkdown(markdown, guide, catalog)};
}

/** Bound passages so later paragraphs survive the embedding model's token limit. */
export function documentationPassages(catalog: DocumentationCatalog): DocPassage[] {
  return catalog.documents.flatMap(guide => {
    const lines = guide.markdown.split('\n');
    const sections = [{id: '', title: guide.title, startLine: 1, contentEndLine: (guide.sections[0]?.startLine ?? lines.length + 1) - 1}, ...guide.sections];
    return sections.flatMap(section => {
      const body = lines.slice(section.startLine - 1, section.contentEndLine).join('\n');
      if (!body.trim()) return [];
      const references = [...new Set([...body.matchAll(/\bfam(?:\s+--)?\s+([a-z][a-z0-9]*\.[a-z.-]+)\s+([a-z-]+)/g)]
        .map(match => `${match[1]} ${match[2]}`).filter(id => commandById.has(id)))];
      const words = body.replace(/^\s*(?:#{1,6}\s+|`{3,}.*$|~{3,}.*$)/gm, '').split(/\s+/).filter(Boolean);
      const passages: DocPassage[] = [];
      for (let start = 0; start < words.length; start += 160) {
        const excerpt = words.slice(start, start + 200).join(' ');
        passages.push({id: `doc:${guide.id}#${section.id}:${start / 160}`, text: `${guide.provider}. ${guide.title}. ${section.title}. ${excerpt}`,
          doc: guide.id, provider: guide.provider, title: guide.title, section: section.id, heading: section.title,
          source: guide.source, read: docReadCommand(guide.id, section.id || undefined), commands: references, excerpt});
        if (start + 200 >= words.length) break;
      }
      return passages;
    });
  });
}
