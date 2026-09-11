import test from 'node:test';
import assert from 'node:assert/strict';
import {createSemanticScorer, embeddingModel, type Embedder} from '../src/shared/command-embeddings.js';
import {bm25Index, fuseScores, searchExcerpt} from '../src/shared/search-ranking.js';
import {searchCommands, type SemanticScorer} from '../src/shared/command-search.js';
import {humanOutput} from '../src/shared/command-output.js';
import {commandById, providerNames} from '../src/shared/command-registry.js';

const vector = (axis: number) => Array.from({length: embeddingModel.dimensions}, (_, i) => i === axis ? 1 : 0);
const documents = [{id: 'one', text: 'First command'}, {id: 'two', text: 'Second command'}];
const searchEmbeddings: typeof searchCommands = (query, options, ...scorers) => searchCommands(query, {...options, rerank: false}, ...scorers);
const mustNotEmbed: SemanticScorer = async () => {throw new Error('Model should not be loaded.');};

test('BM25 uses rare terms and length normalization; hybrid weighting compares bounded scores', () => {
  const score = bm25Index(['calendar event today', 'calendar event', 'calendar calendar calendar calendar event event event']);
  assert.ok(score('today')[0] > 0);
  assert.equal(score('today')[1], 0);
  assert.equal(score('today today')[0], score('today')[0]);
  assert.ok(bm25Index(['today', 'today irrelevant words here'])('today')[0] > bm25Index(['today', 'today irrelevant words here'])('today')[1]);
  const fused = fuseScores([100, 0, 50], [0, 1, 0.5]);
  assert.deepEqual(fused.map(item => item.score), [0.2, 0.8, 0.5]);
  assert.deepEqual(fuseScores([0, 0], [-0.2, 0.8]).map(item => item.score), [0, 0.8 * 0.8]);
  assert.deepEqual(fuseScores([4, 2]).map(item => item.score), [1, 0.5]);
});

test('bounded reranking excerpts retain matching terms near the end of long guide passages', () => {
  const text = `${'Introductory material. '.repeat(90)}Search by a spouse name with SpouseName. ${'More details. '.repeat(10)}`;
  const excerpt = searchExcerpt(text, 'search spouse name');
  assert.match(excerpt, /Search by a spouse name with SpouseName/);
  assert.ok(excerpt.split(/\s+/).length <= 64);
  assert.equal(searchExcerpt('Short guide.', 'unrelated'), 'Short guide.');
});

test('embedding cache reuses documents, prefixes only queries, and coalesces simultaneous indexing', async () => {
  const calls: string[][] = [];
  let loads = 0, writes = 0, saved: unknown;
  const embed: Embedder = async texts => {calls.push(texts); return texts.map(text => vector(text === 'Second command' ? 1 : 0));};
  const deps = {load: async () => {loads++; return embed;}, read: async () => saved, write: async (value: unknown) => {writes++; saved = structuredClone(value);}};
  const score = createSemanticScorer(deps);
  assert.deepEqual(await Promise.all([score(documents, 'first'), score(documents, 'second')]), [[1, 0], [1, 0]]);
  assert.equal(loads, 1); assert.equal(writes, 1);
  assert.equal(calls.filter(texts => texts[0] === 'First command').length, 1);
  assert.ok(calls.some(texts => texts[0] === embeddingModel.queryPrefix + 'first'));
  await createSemanticScorer(deps)(documents, 'restart');
  assert.equal(writes, 1, 'A new process can reuse persisted vectors.');
  await score([{id: 'one', text: 'Updated description'}, documents[1]], 'updated');
  assert.equal(writes, 2);
  assert.equal(calls.flat().filter(text => text === 'Second command').length, 1, 'Editing one entry retains every unchanged vector.');
  await score([{id: 'renamed', text: 'Updated description'}, documents[1]], 'renamed');
  assert.equal(writes, 2, 'Renaming an entry with identical text requires no inference.');
  assert.deepEqual(await score(documents.toReversed(), 'reordered'), [0, 1]);
  assert.equal(writes, 2, 'Ordering and switching corpora reuse existing vectors.');
});

test('model changes invalidate the cache; damaged entries rebuild individually without contaminating scores', async () => {
  let saved: any;
  const indexed: string[] = [];
  const deps = {load: async () => async (texts: string[]) => {indexed.push(...texts.filter(text => !text.startsWith(embeddingModel.queryPrefix))); return texts.map(() => vector(0));}, read: async () => saved,
    write: async (value: unknown) => {saved = structuredClone(value);}};
  await createSemanticScorer(deps)(documents, 'query');
  for (const damage of [() => {saved.entries[0][1] = [1];}, () => {saved.entries[0][1][0] = NaN;},
    () => {saved.entries[0][1] = Array(384).fill(0);}, () => {saved.entries[0] = null;}]) {
    indexed.length = 0;
    damage();
    assert.deepEqual(await createSemanticScorer(deps)(documents, 'query'), [1, 1]);
    assert.equal(indexed.length, 1, 'An intact entry survives corruption elsewhere in the cache.');
  }
  for (const damage of [() => {saved.model = 'old-model';}, () => {saved = {fingerprint: 'legacy-index', vectors: [vector(0), vector(0)]};}, () => {saved = null;}]) {
    indexed.length = 0;
    damage();
    assert.deepEqual(await createSemanticScorer(deps)(documents, 'query'), [1, 1]);
    assert.equal(indexed.length, 2);
  }
});

test('overlapping corpora share vectors and indexing checkpoints survive failed batches and restarts', async () => {
  let saved: unknown, batches = 0, fail = true;
  const indexed: string[] = [];
  const deps = {read: async () => saved, write: async (value: unknown) => {saved = structuredClone(value);}, load: async (): Promise<Embedder> => async texts => {
    if (!texts[0].startsWith(embeddingModel.queryPrefix)) {
      if (++batches === 5 && fail) throw new Error('Interrupted inference');
      indexed.push(...texts);
    }
    return texts.map(() => vector(0));
  }};
  const corpus = Array.from({length: 80}, (_, i) => ({id: String(i), text: `Entry ${i}`}));
  await assert.rejects(createSemanticScorer(deps)(corpus, 'query'), /Interrupted/);
  assert.equal(indexed.length, 64);
  fail = false;
  const score = createSemanticScorer(deps);
  await Promise.all([score(corpus, 'restart'), score([...corpus.slice(40), {id: 'extra', text: 'Additional entry'}], 'overlap')]);
  assert.equal(indexed.length, 81, 'A restart and overlapping search each embed only missing text.');
  assert.equal(new Set(indexed).size, indexed.length);
  await createSemanticScorer(deps)(corpus, 'another restart');
  assert.equal(indexed.length, 81);
});

test('independent searches merge persisted vectors instead of replacing each other\'s corpus', async () => {
  const load = async (): Promise<Embedder> => async texts => texts.map(() => vector(0));
  await Promise.all(documents.map(document => createSemanticScorer({load})([document], 'concurrent query')));
  const restart = createSemanticScorer({load: async () => async texts => {
    assert.ok(texts.every(text => text.startsWith(embeddingModel.queryPrefix)), 'Both searches\' vectors survive the concurrent writes.');
    return texts.map(() => vector(0));
  }});
  assert.deepEqual(await restart(documents, 'restart'), [1, 1]);
});

test('unreadable and unwritable caches still allow in-memory inference; model failure is retryable', async () => {
  let loads = 0;
  const notices: string[] = [];
  const score = createSemanticScorer({load: async () => {
    if (++loads === 1) throw new Error('download failed');
    return async texts => texts.map(() => vector(0));
  }, read: async () => {throw new Error('corrupt JSON');}, write: async () => {throw new Error('read-only');}});
  await assert.rejects(score(documents, 'query'), /download failed/);
  assert.deepEqual(await score(documents, 'query', message => notices.push(message)), [1, 1]);
  assert.ok(notices.some(message => message.includes('Could not save')));
});

test('semantic matches with no shared words rank first, filtering and pagination preserve scores and invocations', async () => {
  const semantic: SemanticScorer = async entries => entries.map(entry => entry.id === 'familysearch.image download' ? 1 : 0.1);
  const all = await searchEmbeddings('zxqv', {limit: 100}, semantic);
  assert.equal(all.results[0].command, 'familysearch.image download');
  assert.equal(all.results[0].lexicalScore, 0);
  assert.equal(all.results[0].score, 0.8);
  assert.deepEqual(all.weights, {lexical: 0.2, semantic: 0.8});
  const page = await searchEmbeddings(all.query, {offset: 2, limit: 3}, semantic);
  assert.deepEqual(page.results, all.results.slice(2, 5));
  assert.equal(page.nextOffset, 5); assert.equal(page.hasMore, true);
  const filtered = await searchEmbeddings(all.query, {provider: 'familysearch', context: 'https://www.familysearch.org/ark:/61903/3:1:TEST'}, semantic);
  assert.ok(filtered.results.every(item => item.command.startsWith('familysearch.')));
  assert.equal(filtered.results[0].score, all.results[0].score);
  assert.deepEqual(filtered.results[0].prefilledFlags, {ark: '3:1:TEST'});
  assert.deepEqual(filtered.results[0].missingFlags, ['out']);
  assert.equal(filtered.results[0].ready, false);
  assert.match(filtered.results[0].invocation, /--out <OUT>/);
  assert.equal((await searchEmbeddings(all.query, {offset: 10000}, semantic)).results.length, 0);
});

test('lexical, empty, and unmatched-provider searches skip inference; model failures are explicit BM25 fallbacks', async () => {
  for (const query of ['', '   ', '???', 'the and']) {
    const result = await searchEmbeddings(query, {}, mustNotEmbed);
    assert.equal(result.results.length, 0); assert.equal(result.warnings, undefined);
  }
  assert.equal((await searchEmbeddings('image', {provider: 'unknown'}, mustNotEmbed)).warnings, undefined);
  const lexical = await searchEmbeddings('download original image', {lexical: true}, mustNotEmbed);
  assert.equal(lexical.warnings, undefined); assert.equal(lexical.engine, 'local-bm25');
  const fallback = await searchEmbeddings('download original image', {}, async () => {throw new Error('Network unavailable');});
  assert.deepEqual(fallback.results, lexical.results);
  assert.match(fallback.warnings![0], /Semantic search unavailable.*Network unavailable/);
  assert.deepEqual(fallback.weights, {lexical: 1, semantic: 0});
  const invalid = await searchEmbeddings('download image', {}, async () => [NaN]);
  assert.equal(invalid.engine, 'local-bm25'); assert.ok(invalid.warnings?.length);
});

test('provider names constrain results regardless of casing, including before dotted command names', async () => {
  const semantic: SemanticScorer = async entries => entries.map(entry => entry.id.startsWith('familysearch.') ? 1 : 0.2);
  for (const provider of [...providerNames, 'cli']) for (const spelling of [provider, provider.toUpperCase()]) {
    const result = await searchEmbeddings(`${spelling}.record search`, {}, semantic);
    assert.ok(result.results.length > 0);
    assert.ok(result.results.every(item => item.command.startsWith(`${provider}.`)), spelling);
  }
  const result = await searchEmbeddings('MyHeritage record search', {}, semantic);
  assert.ok(result.results.every(item => item.command.startsWith('myheritage.')));
  const override = await searchEmbeddings('MyHeritage record search', {provider: 'ancestry'}, semantic);
  assert.ok(override.results.every(item => item.command.startsWith('ancestry.')));
});

test('table and tree hide scores unless requested; operation identities, flags and continuation are preserved', async () => {
  const result = await searchEmbeddings('find memories', {lexical: true, provider: 'familysearch', limit: 3});
  const command = commandById.get('cli.command search')!;
  const values = {provider: 'familysearch', lexical: true, limit: 3, context: 'https://www.familysearch.org/'};
  const table = humanOutput(command, result, {...values, format: 'table'});
  assert.match(table, /command\s+type\s+description\s+top_args/);
  assert.doesNotMatch(table, /\bscore\b|\b\d\.\d{6}\b/);
  assert.match(humanOutput(command, result, {...values, scores: true, format: 'table'}), /command\s+type\s+score\s+description\s+top_args/);
  assert.match(table, /--operation memories\./); assert.match(table, /--input \(required\)/);
  assert.doesNotMatch(humanOutput(command, result, {...values, format: 'tree'}), /score:|\b\d\.\d{6}\b/);
  assert.doesNotMatch(humanOutput(command, result, {...values, format: 'text'}), /score:/);
  assert.match(humanOutput(command, result, {...values, format: 'text', scores: true}), /score:/);
  const tree = humanOutput(command, result, {...values, format: 'tree', scores: true});
  assert.match(tree, /familysearch\n/); assert.match(tree, /└──|├──/);
  assert.match(tree, /score: \d\.\d{6}/); assert.match(tree, /Inspect: fam familysearch.api describe --operation/);
  assert.match(tree, /More:.*--provider familysearch.*--context.*--lexical --format tree --scores --limit 3 --offset 3/);
  const fallback = await searchEmbeddings('image', {}, mustNotEmbed);
  assert.match(humanOutput(command, fallback, {}), /^Warning: Semantic search unavailable/);
});
