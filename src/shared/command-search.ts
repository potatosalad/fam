import {commands, providerNames, type Command, type Provider} from './command-registry.js';
import type {operationSummary} from '../familysearch/discovery.js';
import {replaySnapshot} from '../wayback/url.js';

import {searchExcerpt, searchTokens, searchWeights} from './search-ranking.js';
import {embeddingModel, semanticScores, type SearchProgress} from './command-embeddings.js';
import {scoreCatalog, type SemanticScorer} from './search-catalog.js';
import type {DocPassage} from './documentation.js';
export type {SemanticScorer} from './search-catalog.js';
import {rerankerModel, rerankScores, type Reranker} from './command-reranker.js';

type Operation = ReturnType<typeof operationSummary>;
const ignoredFlags = new Set(['help', 'json', 'dry-run']);

export interface Context {input: string; provider?: Provider; flags: Record<string, string>; object?: string; note?: string}
/** Recognize known URL shapes without fetching anything. */
export function resolveContext(input: string, provider?: string): Context {
  const result: Context = {input, ...(providerNames.includes(provider as Provider) ? {provider: provider as Provider} : {}), flags: {}};
  let url: URL;
  try {url = new URL(input);} catch {
    if (/^(?:1:1|3:1):[A-Za-z0-9-]+$/.test(input)) return {...result, provider: 'familysearch', object: input.startsWith('3:1:') ? 'image' : 'record', flags: {ark: input}};
    return {...result, note: 'Bare ID: supply an explicit provider/object; no parameters were guessed.'};
  }
  if (url.protocol !== 'https:' || url.username || url.password) return {...result, note: 'Only recognized HTTPS provider URLs are resolved.'};
  const host = url.hostname.toLowerCase(), path = url.pathname;
  if (provider === 'wayback') return {...result, object:'page', flags:{url:url.href}};
  if (host === 'web.archive.org' && !url.port) {
    try {if (replaySnapshot(url.href) && !provider) return {...result, provider:'wayback', object:'page', flags:{url:url.href}};} catch {}
  }
  if (host === 'archive.org' && !url.port) {
    if (provider && provider !== 'internetarchive') return {...result, note: 'URL belongs to internetarchive, conflicting with the explicit provider. No flags were inferred.'};
    result.provider = 'internetarchive';
    const item = path.match(/^\/(details|metadata|download)\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:\/(.*))?$/);
    if (item) {
      if (item[1] === 'download' && item[3]) {
        try {
          const file = decodeURIComponent(item[3]);
          if (!/[\x00-\x1f\x7f\\]/.test(file) && file.split('/').every(part => part && part !== '.' && part !== '..'))
            return {...result, object: 'file', flags: {identifier: item[2], file}};
        } catch {}
      } else {
        const page = (item[3] ?? '').match(/^(?:(.+)\/)?page\/n(\d+)(?:\/mode\/(?:1up|2up|thumb))?\/?$/);
        if (item[1] === 'details' && page && Number(page[2]) < 1000000) {
          try {
            const volume = page[1] ? decodeURIComponent(page[1]) : undefined;
            if (volume && (/[\x00-\x1f\x7f\\]/.test(volume) || volume.split('/').some(p => !p || p === '.' || p === '..'))) throw new Error('Invalid volume');
            return {...result, object: 'page', flags: {identifier: item[2], ...(volume ? {volume} : {}), page: String(Number(page[2]) + 1)}};
          } catch {}
        }
        return {...result, object: 'item', flags: {identifier: item[2]}};
      }
    }
    return {...result, note: 'Archive.org URL recognized; use an item identifier from its details page.'};
  }
  const detected = providerNames.find(p => host === `${p}.org` || host.endsWith(`.${p}.org`) || host === `${p}.com` || host.endsWith(`.${p}.com`))
    || (/^((www|search|search-records)\.)?findmypast\.(co\.uk|ie|com\.au)$/.test(host) ? 'findmypast' : undefined)
    || (/^(www\.)?ancestry\.(co\.uk|ca|com\.au)$/.test(host) ? 'ancestry' : undefined);
  if (!detected) return {...result, note: 'Unrecognized provider URL; no request was made.'};
  if (result.provider && result.provider !== detected) return {...result, note: `URL belongs to ${detected}, conflicting with the explicit provider. No flags were inferred.`};
  result.provider = detected;
  if (detected === 'familysearch') {
    const ark = path.match(/\/ark:\/61903\/(1:1:[A-Za-z0-9-]+|3:1:[A-Za-z0-9-]+)/)?.[1];
    if (ark) return {...result, object: ark.startsWith('3:1:') ? 'image' : 'record', flags: {ark}};
    const person = path.match(/\/tree\/person\/(?:details|sources|memories|timeline)\/([A-Za-z0-9-]+)/)?.[1];
    if (person) return {...result, object: 'person', flags: {'person-id': person}};
    const collection = path.match(/\/search\/collection\/(\d+)/)?.[1];
    if (collection) return {...result, object: 'collection', flags: {collection}};
  } else if (detected === 'ancestry') {
    const person = path.match(/\/family-tree\/person\/tree\/(\d+)\/person\/(\d+)/);
    if (person) return {...result, object: 'person', flags: {'tree-id': person[1], 'person-id': person[2]}};
    const record = path.match(/\/discoveryui-content\/view\/(\d+):(\d+)/);
    if (record) return {...result, object: 'record', flags: {'record-id': record[1], 'collection-id': record[2]}};
  } else if (detected === 'findagrave') {
    const memorial = path.match(/\/memorial\/(\d+)/)?.[1];
    if (memorial) return {...result, object: 'memorial', flags: {'memorial-id': memorial}};
    const cemetery = path.match(/\/cemetery\/(\d+)/)?.[1];
    if (cemetery) return {...result, object: 'cemetery', flags: {'cemetery-id': cemetery}};
  } else if (detected === 'myheritage' || detected === 'geneanet') {
    return {...result, object: /research|record/.test(path) ? 'record' : undefined, flags: {url: url.href}};
  } else if (detected === 'cyndislist') {
    if (['cyndislist.com', 'www.cyndislist.com'].includes(host) && !url.port) return {...result, object: 'page', flags: {url: url.href}};
  } else if (detected === 'americanancestors') {
    if (/^\/DB\d+\/|^\/databases\//i.test(path)) return {...result, object: /\/image\/|\/i\//i.test(path) ? 'image' : 'record', flags: {url: url.href}};
  } else if (detected === 'findmypast') {
    const id = url.searchParams.get('id');
    if (id) return {...result, object: 'record', flags: {'record-id': id}};
  } else if (detected === 'fold3' && ['www.fold3.com','fold3.com'].includes(host) && !url.port) {
    const match=path.match(/^\/(image|document|record|memorial|unit|publication|sub-image)\/([1-9]\d*)(?:\/[^/]*)?\/?$/);
    if(match){const object=match[1]==='document'?'image':match[1]==='sub-image'?'entry':match[1];return {...result,object,flags:{[`${object}-id`]:match[2]}};}
  } else if (detected === 'newspapers' && ['www.newspapers.com','newspapers.com'].includes(host) && !url.port) {
    const clipping=path.match(/^\/(?:clip|clipping)\/([1-9]\d{0,19})(?:\/[^/]*)?\/?$/);
    if(clipping)return {...result,object:'clipping',flags:{'clipping-id':clipping[1]}};
    const page = path.match(/^\/(?:image|newspage)\/([1-9]\d*)\/?$/);
    if (page) {
      const article=url.searchParams.get('article'),clip=url.searchParams.get('clipping_id');
      if(clip&&/^[1-9]\d{0,19}$/.test(clip))return {...result,object:'clipping',flags:{'page-id':page[1],'clipping-id':clip}};
      if(article&&/^(?:[1-9]\d{0,19}|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.test(article))return {...result,object:'article',flags:{'page-id':page[1],'article-id':article.toLowerCase()}};
      return {...result,object:'page',flags:{'page-id':page[1]}};
    }
  } else if (detected === 'newspaperarchive' && /-p-\d+\/?$/.test(path)) {
    return {...result, object: 'page', flags: {url: url.href}};
  }
  return {...result, note: 'Provider recognized; this URL shape has no unambiguous parameter mapping yet.'};
}
const quote = (value: string): string => /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
export function candidate(command: Command, context?: Context) {
  const flags = Object.fromEntries(Object.entries(context?.flags ?? {}).filter(([name]) => command.flags.some(f => f.name === name)));
  const missing = command.flags.filter(f => f.required && flags[f.name] === undefined).map(f => f.name);
  const argv = [command.id.split(' ')[0], command.action, ...Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value])];
  return {command: command.id, description: command.description,
    topArgs: [...command.flags.filter(f => f.required), ...command.flags.filter(f => !f.required && !ignoredFlags.has(f.name) && !['transport', 'browser-timeout'].includes(f.name))]
      .slice(0, 5).map(f => `--${f.name}${f.required ? ' (required)' : ''}`),
    invocation: `fam ${argv.map(quote).join(' ')}${missing.map(name => ` --${name} <${name.toUpperCase().replaceAll('-', '_')}>`).join('')}`,
    argv, ready: missing.length === 0, requiredFlags: command.flags.filter(f => f.required), missingFlags: missing, prefilledFlags: flags,
    examples: command.examples, risk: command.risk, describe: `fam cli.command describe --command ${quote(command.id)}`};
}
function operationCandidate(command: Command, operation: Operation) {
  // Input JSON is deliberately not guessed from an unrelated URL or person ID.
  const flags = command.flags.map(flag => ({...flag,
    ...(flag.name === 'input' ? {required: operation.needsInput} : {}),
    ...(flag.name === 'out' ? {required: operation.binary} : {})}));
  const result = candidate({...command, flags}, {input: '', provider: 'familysearch', flags: {operation: operation.name}});
  return {...result, operation: operation.name, description: operation.description, invocation: operation.invocation,
    examples: [operation.exampleCommand], risk: operation.risk, describe: operation.describe,
    requiredInput: operation.requiredInput, limitations: operation.limitations};
}
export interface SearchOptions {provider?: string; context?: string; limit?: number; offset?: number; lexical?: boolean; rerank?: boolean; progress?: SearchProgress}
export async function searchCommands(query: string, options: SearchOptions = {}, scoreSemantic: SemanticScorer = semanticScores, scoreRerank: Reranker = rerankScores) {
  const contextText = options.context ?? query.match(/https:\/\/[^\s<>"']+/)?.[0];
  const context = contextText ? resolveContext(contextText, options.provider) : undefined;
  const queryText = query.replace(/https:\/\/\S+/g, ' ').trim(), words = searchTokens(queryText);
  const explicitProvider = options.provider ?? [...providerNames, 'cli'].find(provider => words.includes(provider)) ?? context?.provider;
  // A URL alone can still discover commands for its recognized object.
  const intent = words.length ? queryText : context?.object || '';
  const {catalog, warnings, semantic, commandScores, passageScores} = await scoreCatalog(intent, {...options, provider: explicitProvider}, scoreSemantic);
  const selected = catalog.commands.map((entry, i) => ({entry, i})).filter(({entry}) => !explicitProvider || entry.command.provider === explicitProvider);
  const evidence = new Map<string, {passage: DocPassage; score: number}>();
  for (const [i, passage] of catalog.passages.entries()) {
    if (explicitProvider && passage.provider !== explicitProvider && passage.provider !== 'cli') continue;
    const score = passageScores[i].score * 0.9;
    for (const command of passage.commands) {
      if (score > (evidence.get(command)?.score ?? 0)) evidence.set(command, {passage, score});
    }
  }
  let ranked = (intent ? selected : []).map(({entry, i}) => {
    // A passage can surface only the registered actions explicitly mentioned in its section.
    // Guide BM25 enriches lexical retrieval without embedding every guide on a command lookup.
    const found = entry.operation ? undefined : evidence.get(entry.id);
    const guide = found && found.score > commandScores[i].lexicalScore ? found : undefined;
    const score = commandScores[i].score + (guide ? (guide.score - commandScores[i].lexicalScore) * (semantic ? searchWeights.lexical : 1) : 0);
    const documentation = guide ? {doc: guide.passage.doc, section: guide.passage.section, title: guide.passage.title,
      heading: guide.passage.heading, source: guide.passage.source, read: guide.passage.read, excerpt: guide.passage.excerpt, score: guide.score} : undefined;
    return {entry, ...commandScores[i], score, documentation, retrievalScore: score, rerankScore: null as number | null};
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id, 'en'));
  const retrievedTotal = ranked.length;
  let reranked = false;
  if (options.rerank !== false && semantic && ranked.length) {
    try {
      // A fixed shortlist before pagination keeps ordering independent of page size.
      // Only reranker logits order this set; never mix them with retrieval scores.
      const shortlist = ranked.slice(0, 100), logits = await scoreRerank(shortlist.map(row => ({id: row.entry.id, text: row.entry.text + (row.documentation ? `\n\n${row.documentation.heading}\n${searchExcerpt(row.documentation.excerpt, intent)}` : '')})), intent, options.progress);
      if (logits.length !== shortlist.length || logits.some(n => !Number.isFinite(n))) throw new Error('Invalid reranker scores.');
      ranked = shortlist.map((row, i) => ({...row, score: logits[i], rerankScore: logits[i]}))
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id, 'en'));
      reranked = true;
    } catch (error) {
      warnings.push(`Reranking unavailable; showing BM25 + Arctic results. ${error instanceof Error ? error.message : 'Could not load the local reranker.'} Retry to initialize the model, or use --no-rerank.`);
    }
  }
  const limit = options.limit ?? 10, offset = options.offset ?? 0;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {query, engine: reranked ? 'local-bm25-embeddings-reranked' : semantic ? 'local-bm25-embeddings' : 'local-bm25',
    weights: semantic ? searchWeights : {lexical: 1, semantic: 0}, ...(semantic ? {model: embeddingModel} : {}),
    ...(reranked ? {reranker: {...rerankerModel, candidateLimit: 100}, retrievedTotal} : {}),
    ...(warnings.length ? {warnings} : {}), ...(context ? {context} : {}), total: ranked.length, offset, limit,
    hasMore: offset + limit < ranked.length, nextOffset: offset + limit < ranked.length ? offset + limit : null,
    results: ranked.slice(offset, offset + limit).map(({entry, score, lexicalScore, semanticScore, retrievalScore, rerankScore, documentation}) => ({
      ...(entry.operation ? operationCandidate(entry.command, entry.operation) : candidate(entry.command, context)),
      ...(documentation ? {documentation} : {}),
      type: entry.operation ? 'operation' as const : 'action' as const, score: round(score), lexicalScore: round(lexicalScore),
      semanticScore: semanticScore === null ? null : round(semanticScore),
      ...(rerankScore === null ? {} : {retrievalScore: round(retrievalScore), rerankScore: round(rerankScore)}),
    }))};
}
export function contextCommands(input: string, provider?: string) {
  const context = resolveContext(input, provider);
  return {context, commands: commands.filter(command => command.provider === context.provider && command.object === context.object).map(command => candidate(command, context))};
}
