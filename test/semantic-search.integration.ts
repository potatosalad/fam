// Opt-in: downloads only public model files into the disposable test profile, never contacts providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {createSemanticScorer, embeddingModel} from '../src/shared/command-embeddings.js';
import {searchCommands} from '../src/shared/command-search.js';
import {searchDocumentation} from '../src/shared/documentation-search.js';
import {searchCatalog} from '../src/shared/search-catalog.js';

const searchEmbeddings: typeof searchCommands = (query, options, ...scorers) => searchCommands(query, {...options, rerank: false}, ...scorers);

const cases = [
  ['download original image', 'familysearch', 'familysearch.image download'],
  ['OCR transcription of a scan', 'familysearch', 'familysearch.image transcript'],
  ['find a grave biography', 'findagrave', 'findagrave.memorial search'],
  ['sign in', 'myheritage', 'myheritage.session login'],
  ['historical newspapers', 'findmypast', 'findmypast.newspaper search'],
  ['inspect GraphQL contract', 'ancestry', 'ancestry.api describe'],
  ['find memories', 'familysearch', 'memories.search'],
  ['merge duplicate people', 'familysearch', 'persons.merge'],
  ['undo merge', 'familysearch', 'history.undoMerge'],
  ['attach source', 'familysearch', 'sources.attach'],
  ['family groups', 'familysearch', 'groups.list'],
  ['record hints', 'familysearch', 'hints.recordMatches'],
  ['show the CLI calls that failed recently', 'cli', 'cli.history.failures list'],
  ['save a full resolution scan of a historical document', 'familysearch', 'familysearch.image download'],
  ['let me log on', 'myheritage', 'myheritage.session login'],
  ['where is someone buried', 'findagrave', 'findagrave.memorial search'],
  ['filter indexed records using a spouse name', 'americanancestors', 'americanancestors.record search'],
  ['search collection-specific fields and generation numbers', 'americanancestors', 'americanancestors.record search'],
];

test('real Arctic embeddings: cold setup, intent ranking, offline restart and cache recovery', {timeout: 180_000}, async t => {
  const progress: string[] = [], started = performance.now();
  const query = 'download an original image';
  const cold = await searchEmbeddings(query, {progress: message => progress.push(message)});
  assert.equal(cold.engine, 'local-bm25-embeddings', cold.warnings?.join('\n'));
  assert.ok(progress.some(message => message.startsWith('Downloading')));
  assert.ok(progress.some(message => message.startsWith('Indexing')));
  t.diagnostic(`Cold model download + command index: ${((performance.now() - started) / 1000).toFixed(2)}s`);
  const indexPath = join(CREDENTIAL_DIR, 'cache/command-search/index.json');
  const snapshot = async () => JSON.parse(await readFile(indexPath, 'utf8'));
  const commands = await snapshot(), catalog = await searchCatalog();
  assert.equal(commands.entries.length, new Set(catalog.commands.map(doc => doc.text)).size, 'A command lookup must not precompute guide vectors.');
  const guide = await searchDocumentation('search records using a spouse name', {provider: 'americanancestors', limit: 5});
  assert.equal(guide.engine, 'local-bm25-embeddings-reranked', guide.warnings?.join('\n'));
  assert.ok(guide.results.slice(0, 3).some(item => item.section === 'family-members-and-collection-specific-fields'), guide.results.map(item => item.section).join(', '));
  const ranked = await searchCommands(query, {limit: 10});
  assert.equal(ranked.engine, 'local-bm25-embeddings-reranked', ranked.warnings?.join('\n'));
  assert.equal(ranked.reranker?.id, 'cross-encoder/ettin-reranker-17m-v1');
  assert.equal(ranked.results[0].command, 'familysearch.image download');
  const guideCommand = await searchCommands('search collection-specific fields and generation numbers', {provider: 'americanancestors'});
  assert.equal(guideCommand.engine, 'local-bm25-embeddings-reranked', guideCommand.warnings?.join('\n'));
  assert.equal(guideCommand.results[0].command, 'americanancestors.record search');
  assert.equal((await stat(indexPath)).mode & 0o777, 0o600);
  const combined = await snapshot();
  assert.equal(combined.entries.length, commands.entries.length + new Set(catalog.passages.filter(doc => doc.provider === 'americanancestors').map(doc => doc.text)).size);
  for (const entry of commands.entries) assert.deepEqual(combined.entries.find(([key]: [string]) => key === entry[0]), entry, 'Guide indexing retains all command vectors.');
  let first = 0, topThree = 0;
  // Prove that both fresh model loading and new query inference need no network once cached.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Network disabled by semantic integration test');};
  try {
    for (const [query, provider, expected] of cases) {
      const result = await searchEmbeddings(query, {provider, limit: 10});
      assert.equal(result.engine, 'local-bm25-embeddings', result.warnings?.join('\n'));
      const rank = result.results.findIndex(item => item.command === expected || ('operation' in item && item.operation === expected));
      assert.ok(rank >= 0, `${query}: ${result.results.map(item => 'operation' in item ? item.operation : item.command)}`);
      if (rank === 0) first++;
      if (rank < 3) topThree++;
      if (query === 'let me log on') assert.equal(result.results[0].lexicalScore, 0, 'This match must come from semantic retrieval alone.');
    }
    const offlineGuide = await searchDocumentation('search records using a spouse name', {provider: 'americanancestors', limit: 5});
    assert.deepEqual(offlineGuide.results, guide.results);
    t.diagnostic(`${first}/${cases.length} expected commands ranked first; ${topThree}/${cases.length} in the top three; all in the default ten results.`);
    const warmStart = performance.now(), warmProgress: string[] = [];
    const warm = await searchEmbeddings(query, {progress: message => warmProgress.push(message)}, createSemanticScorer());
    assert.deepEqual(warm.results, cold.results);
    assert.deepEqual(warmProgress, []);
    t.diagnostic(`Cached offline restart: ${((performance.now() - warmStart) / 1000).toFixed(2)}s`);
    await writeFile(indexPath, '{broken json');
    const rebuilt = await searchEmbeddings(query, {}, createSemanticScorer());
    assert.deepEqual(rebuilt.results, cold.results);
    const tokenizerPath = join(CREDENTIAL_DIR, `cache/command-search/models/${embeddingModel.revision}/tokenizer.json`);
    const tokenizer = await readFile(tokenizerPath);
    await writeFile(tokenizerPath, 'damaged model file');
    const fallback = await searchEmbeddings(cases[0][0], {}, createSemanticScorer());
    assert.equal(fallback.engine, 'local-bm25');
    assert.match(fallback.warnings![0], /Network disabled/);
    await writeFile(tokenizerPath, tokenizer);
  } finally {globalThis.fetch = originalFetch;}
});
