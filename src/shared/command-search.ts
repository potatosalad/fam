import {commands, providerNames, type Command, type Provider} from './command-registry.js';
import {discoverOperations, type operationSummary} from '../familysearch/discovery.js';
import {replaySnapshot} from '../wayback/url.js';

import {bm25Index, fuseScores, searchTokens, searchWeights} from './search-ranking.js';
import {embeddingModel, semanticScores, type SearchDocument, type SearchProgress} from './command-embeddings.js';
import {rerankerModel, rerankScores, type Reranker} from './command-reranker.js';

type Operation = ReturnType<typeof operationSummary>;
const documents: {command: Command; operation?: Operation}[] = commands.map(command => ({command}));
const familysearchCall = commands.find(command => command.id === 'familysearch.api call')!;
documents.push(...discoverOperations().map(operation => ({command: familysearchCall, operation})));
const ignoredFlags = new Set(['help', 'json', 'dry-run']);
const index = documents.map(({command, operation}) => {
  // The same identity + description document for every entry. Long option lists must
  // not penalize commands with many flags or dilute their semantic representation.
  const id = operation ? `${command.id} --operation ${operation.name}` : command.id;
  return {command, operation, id, text: `${id}. ${operation?.description ?? command.description}`};
});
const lexicalScores = bm25Index(index.map(entry => entry.text));

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
  } else if (detected === 'newspapers' && ['www.newspapers.com','newspapers.com'].includes(host) && !url.port) {
    const page = path.match(/^\/(?:image|newspage)\/([1-9]\d*)\/?$/);
    if (page) return {...result,object:'page',flags:{'page-id':page[1]}};
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
export type SemanticScorer = (documents: SearchDocument[], query: string, progress?: SearchProgress) => Promise<number[]>;
export async function searchCommands(query: string, options: SearchOptions = {}, scoreSemantic: SemanticScorer = semanticScores, scoreRerank: Reranker = rerankScores) {
  const contextText = options.context ?? query.match(/https:\/\/[^\s<>"']+/)?.[0];
  const context = contextText ? resolveContext(contextText, options.provider) : undefined;
  const queryText = query.replace(/https:\/\/\S+/g, ' ').trim(), words = searchTokens(queryText);
  const explicitProvider = options.provider ?? [...providerNames, 'cli'].find(provider => words.includes(provider)) ?? context?.provider;
  const selected = index.map((entry, i) => ({entry, i})).filter(({entry}) => !explicitProvider || entry.command.provider === explicitProvider);
  // A URL alone can still discover commands for its recognized object.
  const intent = words.length ? queryText : context?.object || '';
  const warnings: string[] = [];
  let semantic: number[] | undefined;
  if (!options.lexical && intent && selected.length) {
    try {
      // Index the complete catalog once; filtering and paging never rebuild it or distort normalization.
      semantic = await scoreSemantic(index, intent, options.progress);
      if (semantic.length !== index.length || semantic.some(n => !Number.isFinite(n))) throw new Error('Invalid semantic scores.');
    } catch (error) {
      semantic = undefined;
      warnings.push(`Semantic search unavailable; showing BM25 results. ${error instanceof Error ? error.message : 'Could not load the local model.'} Retry to initialize the model, or use --lexical.`);
    }
  }
  const scores = fuseScores(lexicalScores(intent), semantic);
  let ranked = (intent ? selected : []).map(({entry, i}) => ({entry, ...scores[i], retrievalScore: scores[i].score, rerankScore: null as number | null}))
    .filter(result => result.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id, 'en'));
  const retrievedTotal = ranked.length;
  let reranked = false;
  if (options.rerank !== false && semantic && ranked.length) {
    try {
      // A fixed shortlist before pagination keeps ordering independent of page size.
      // Only reranker logits order this set; never mix them with retrieval scores.
      const shortlist = ranked.slice(0, 100), logits = await scoreRerank(shortlist.map(row => row.entry), intent, options.progress);
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
    results: ranked.slice(offset, offset + limit).map(({entry, score, lexicalScore, semanticScore, retrievalScore, rerankScore}) => ({
      ...(entry.operation ? operationCandidate(entry.command, entry.operation) : candidate(entry.command, context)),
      type: entry.operation ? 'operation' as const : 'action' as const, score: round(score), lexicalScore: round(lexicalScore),
      semanticScore: semanticScore === null ? null : round(semanticScore),
      ...(rerankScore === null ? {} : {retrievalScore: round(retrievalScore), rerankScore: round(rerankScore)}),
    }))};
}
export function contextCommands(input: string, provider?: string) {
  const context = resolveContext(input, provider);
  return {context, commands: commands.filter(command => command.provider === context.provider && command.object === context.object).map(command => candidate(command, context))};
}
