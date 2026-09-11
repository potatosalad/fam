import test from 'node:test';
import assert from 'node:assert/strict';
import {createReranker, rerankerPair, type Reranker} from '../src/shared/command-reranker.js';
import {searchCommands, type SemanticScorer} from '../src/shared/command-search.js';
import {humanOutput} from '../src/shared/command-output.js';
import {commandById} from '../src/shared/command-registry.js';
import {parseInvocation} from '../src/shared/command-runtime.js';

const semantic: SemanticScorer = async docs => docs.map((_, i) => 1 - i / (docs.length + 1));
const identity = (row: {command: string; operation?: string}) => row.command + (row.operation ? ` --operation ${row.operation}` : '');

test('Ettin pairs preserve both texts, model-specific separators and the 512-token bound without mutating inputs', () => {
  assert.deepEqual(rerankerPair([10, 11], [12]), [50281, 10, 11, 50282, 12, 50282]);
  const query = Array(700).fill(10), document = Array(800).fill(20), pair = rerankerPair(query, document);
  assert.equal(pair.length, 512);
  assert.equal(pair.filter(id => id === 50282).length, 2);
  assert.equal(pair.filter(id => id === 10).length, 255);
  assert.equal(pair.filter(id => id === 20).length, 254);
  assert.equal(query.length, 700); assert.equal(document.length, 800);
  assert.equal(rerankerPair([], document).length, 512);
});

test('reranker loads lazily, retries failed loading and preserves batch order and negative logits', async () => {
  let loads = 0;
  const batches: number[] = [];
  const score = createReranker(async () => {
    if (++loads === 1) throw new Error('download failed');
    return {encode: text => [Number(text)], score: async pairs => {batches.push(pairs.length); return pairs.map(pair => -pair[3]);}};
  });
  assert.deepEqual(await score([], '1'), []); assert.equal(loads, 0);
  const docs = Array.from({length: 19}, (_, i) => ({id: String(i), text: String(i)}));
  await assert.rejects(score(docs, '1'), /download failed/);
  assert.deepEqual(await score(docs, '1'), docs.map((_, i) => -i));
  assert.deepEqual(batches, [8, 8, 3]);
  await score(docs.slice(0, 1), '1'); assert.equal(loads, 2);
  for (const values of [[NaN], [], [1, 2]]) {
    const invalid = createReranker(async () => ({encode: () => [], score: async () => values}));
    await assert.rejects(invalid(docs.slice(0, 1), 'query'), /invalid scores/);
  }
});

test('default reranking only sees the genuine fixed shortlist, uses raw logits, and paginates consistently', async () => {
  const query = 'synthetic intent', original = await searchCommands(query, {rerank: false, limit: 500}, semantic);
  let candidateIds: string[] = [];
  const rerank: Reranker = async (docs, receivedQuery) => {
    assert.equal(receivedQuery, query);
    candidateIds = docs.map(doc => doc.id);
    return docs.map((_, i) => i - 99);
  };
  const all = await searchCommands(query, {limit: 100}, semantic, rerank);
  assert.equal(all.engine, 'local-bm25-embeddings-reranked');
  assert.deepEqual(candidateIds, original.results.slice(0, 100).map(identity));
  assert.deepEqual(all.results.map(identity), candidateIds.toReversed());
  assert.equal(all.results[0].score, 0); assert.equal(all.results.at(-1)!.score, -99);
  assert.equal(all.results[0].retrievalScore, original.results[99].score);
  assert.equal(all.results[0].rerankScore, all.results[0].score);
  assert.equal(all.total, 100); assert.equal(all.retrievedTotal, original.total);
  const page = await searchCommands(query, {rerank: true, offset: 3, limit: 7}, semantic, rerank);
  assert.deepEqual(page.results, all.results.slice(3, 10));
  assert.equal(page.nextOffset, 10);
  const beyond = await searchCommands(query, {rerank: true, offset: 100}, semantic, rerank);
  assert.equal(beyond.results.length, 0); assert.equal(beyond.hasMore, false);
  const command = commandById.get('cli.command search')!;
  const table = humanOutput(command, page, {limit: 7});
  assert.doesNotMatch(table, /\bscore\b/); assert.match(table, /More:.*--offset 10/);
  assert.match(humanOutput(command, page, {scores: true}), /\bscore\b/);
  const disabled = parseInvocation(['cli.command', 'search', '--query', query, '--no-rerank']);
  assert.equal(disabled.values['no-rerank'], true);
  const baselinePage = await searchCommands(query, {rerank: false, limit: 10}, semantic);
  assert.match(humanOutput(command, baselinePage, {'no-rerank': true, limit: 10}), /More:.*--no-rerank/);
});

test('mixed guide/command lengths batch together efficiently while scores return in input order', async () => {
  const lengths: number[][] = [];
  const score = createReranker(async () => ({encode: text => text === 'query' ? [99] : Array(Number(text)).fill(Number(text)),
    score: async pairs => {lengths.push(pairs.map(pair => pair.length)); return pairs.map(pair => -pair[3]);}}));
  const docs = Array.from({length: 16}, (_, i) => ({id: String(i), text: String(i % 2 ? 200 + i : i + 1)}));
  assert.deepEqual(await score(docs, 'query'), docs.map(doc => -Number(doc.text)));
  assert.ok(lengths[0].every(length => length < 25));
  assert.ok(lengths[1].every(length => length > 200));
});

test('provider and context filtering apply before reranking; invocation requirements survive', async () => {
  const result = await searchCommands('synthetic intent', {provider: 'familysearch', rerank: true,
    context: 'https://www.familysearch.org/ark:/61903/3:1:TEST'}, semantic, async docs => {
    assert.ok(docs.every(doc => doc.id.startsWith('familysearch.')));
    return docs.map(doc => doc.id === 'familysearch.image download' ? 10 : -10);
  });
  assert.equal(result.results[0].command, 'familysearch.image download');
  assert.deepEqual(result.results[0].prefilledFlags, {ark: '3:1:TEST'});
  assert.deepEqual(result.results[0].missingFlags, ['out']);
  assert.ok(result.results.every(row => row.command.startsWith('familysearch.')));
});

test('search trees keep providers in reranked relevance order, including ahead of FamilySearch', async () => {
  const targets = ['myheritage.document download', 'familysearch.image download'];
  const result = await searchCommands('zxqv', {limit: 2}, async docs => docs.map(doc => targets.includes(doc.id) ? 1 : 0.1),
    async docs => docs.map(doc => doc.id === targets[0] ? 20 : doc.id === targets[1] ? 10 : -1));
  assert.deepEqual(result.results.map(row => row.command), targets);
  const tree = humanOutput(commandById.get('cli.command search')!, result, {format: 'tree'});
  assert.ok(tree.indexOf('\nmyheritage\n') < tree.indexOf('\nfamilysearch\n'));
});

test('disabled, lexical, empty and failed embedding searches skip reranking; reranker failure keeps the complete baseline', async () => {
  const fail: Reranker = async () => {assert.fail('Reranker must not load');};
  await searchCommands('synthetic intent', {rerank: false}, semantic, fail);
  await searchCommands('image', {lexical: true, rerank: true}, semantic, fail);
  await searchCommands('', {rerank: true}, semantic, fail);
  await searchCommands('image', {provider: 'unknown', rerank: true}, semantic, fail);
  await searchCommands('image', {rerank: true}, async () => {throw new Error('offline');}, fail);
  const baseline = await searchCommands('image', {rerank: false, limit: 500}, semantic);
  for (const rerank of [async () => {throw new Error('offline');}, async () => [NaN], async () => []]) {
    const fallback = await searchCommands('image', {rerank: true, limit: 500}, semantic, rerank);
    assert.deepEqual(fallback.results, baseline.results); assert.equal(fallback.total, baseline.total);
    assert.equal(fallback.engine, baseline.engine); assert.match(fallback.warnings![0], /Reranking unavailable/);
    assert.equal(fallback.reranker, undefined);
  }
});
