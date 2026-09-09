import {commands, providerNames, type Command, type Provider} from './command-registry.js';
import {discoverOperations, type operationSummary} from '../familysearch/discovery.js';

// Local intent vocabulary. No network, generated commands, or model downloads.
const concepts = [
  ['download', 'save', 'fetch', 'export', 'copy'], ['image', 'scan', 'photograph', 'photo', 'picture'],
  ['original', 'resolution', 'fullresolution', 'uncompressed'], ['transcript', 'transcription', 'ocr', 'text', 'transcribe'],
  ['ancestry', 'ancestors', 'ancestor', 'pedigree', 'generations'], ['person', 'people', 'individual', 'relative'],
  ['tree', 'genealogy', 'familytree'], ['record', 'historical', 'census', 'birth', 'death', 'marriage'],
  ['memorial', 'grave', 'burial', 'tombstone', 'headstone', 'deceased'], ['cemetery', 'cemeteries', 'graveyard'],
  ['login', 'signin', 'authenticate', 'authentication', 'auth'], ['session', 'token', 'logged', 'authentication'],
  ['refresh', 'renew', 'expired'], ['credential', 'credentials', 'password', 'username'],
  ['search', 'find', 'lookup', 'locate'], ['list', 'browse', 'enumerate'], ['get', 'read', 'inspect', 'show', 'view'],
  ['collection', 'collections', 'recordset', 'catalog'], ['film', 'dgs', 'microfilm'],
  ['newspaper', 'newspapers', 'press', 'obituary'], ['library', 'book', 'books', 'publication'],
  ['health', 'doctor', 'diagnose', 'working', 'broken'], ['gql', 'graphql'], ['api', 'endpoint', 'rest'],
  ['memory', 'memories', 'artifact', 'artifacts'], ['merge', 'duplicate', 'duplicates'],
  ['source', 'sources', 'citation', 'citations'], ['attach', 'link', 'connect'],
  ['edit', 'update', 'change'], ['restore', 'undo', 'recover'], ['group', 'groups'],
];
const stop = new Set('a an the i me my we our you to of for from in on with and or is are can could want need how do does please using'.split(' '));
function tokens(text: string): string[] {
  return (text.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => !stop.has(word));
}
function expanded(words: string[]): Set<string> {
  const source = new Set(words), set = new Set(words);
  for (const group of concepts) if (group.some(word => source.has(word))) for (const word of group) set.add(word);
  return set;
}
type Operation = ReturnType<typeof operationSummary>;
const documents: {command: Command; operation?: Operation}[] = commands.map(command => ({command}));
const familysearchCall = commands.find(command => command.id === 'familysearch.api call')!;
documents.push(...discoverOperations().map(operation => ({command: familysearchCall, operation})));
const index = documents.map(({command, operation}) => {
  const content = operation ? `${operation.name} ${operation.description}`
    : `${command.id} ${command.description} ${command.examples.join(' ')} ${command.flags.filter(f => !['help', 'json', 'out', 'dry-run'].includes(f.name)).map(f => f.name).join(' ')}`;
  const words = tokens(content);
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return {command, operation, words, counts, action: operation?.name.split('.')[1] ?? command.action,
    concepts: expanded(tokens(operation ? content : `${command.object} ${command.action} ${command.description}`))};
});
const averageLength = index.reduce((sum, entry) => sum + entry.words.length, 0) / index.length;
const documentFrequency = new Map<string, number>();
for (const entry of index) for (const word of entry.counts.keys()) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);

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
export function searchCommands(query: string, options: {provider?: string; context?: string; limit?: number; offset?: number} = {}) {
  const contextText = options.context ?? query.match(/https:\/\/[^\s<>"']+/)?.[0];
  const context = contextText ? resolveContext(contextText, options.provider) : undefined;
  const words = [...new Set(tokens(query.replace(/https:\/\/\S+/g, ' ')))], queryConcepts = expanded(words);
  const explicitProvider = options.provider ?? providerNames.find(provider => words.includes(provider)) ?? context?.provider;
  const ranked = index.filter(entry => !explicitProvider || entry.command.provider === explicitProvider).map(entry => {
    let keyword = 0;
    for (const word of words) {
      const frequency = entry.counts.get(word) ?? 0;
      if (!frequency) continue;
      const df = documentFrequency.get(word) ?? 0, idf = Math.log(1 + (index.length - df + 0.5) / (df + 0.5));
      keyword += idf * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * entry.words.length / averageLength));
    }
    let conceptMatches = 0;
    for (const word of queryConcepts) if (entry.concepts.has(word)) conceptMatches++;
    const score = keyword + conceptMatches / Math.max(1, queryConcepts.size) * 3
      + (queryConcepts.has(entry.action) ? 3 : 0) + (!entry.operation && context?.object === entry.command.object ? 5 : 0);
    return {entry, score};
  }).filter(result => result.score > 0).sort((a, b) => b.score - a.score
    || (a.entry.operation?.name ?? a.entry.command.id).localeCompare(b.entry.operation?.name ?? b.entry.command.id, 'en'));
  const limit = options.limit ?? 3, offset = options.offset ?? 0;
  return {query, engine: 'local-bm25-concepts', ...(context ? {context} : {}), total: ranked.length, offset, limit,
    hasMore: offset + limit < ranked.length, nextOffset: offset + limit < ranked.length ? offset + limit : null,
    results: ranked.slice(offset, offset + limit).map(({entry, score}) => ({...(entry.operation ? operationCandidate(entry.command, entry.operation)
      : candidate(entry.command, context)), score: Math.round(score * 1000) / 1000}))};
}
export function contextCommands(input: string, provider?: string) {
  const context = resolveContext(input, provider);
  return {context, commands: commands.filter(command => command.provider === context.provider && command.object === context.object).map(command => candidate(command, context))};
}
