// Opt-in: downloads only public model files into the disposable test profile, never contacts providers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {createSemanticScorer, embeddingModel} from '../src/shared/command-embeddings.js';
import {searchCommands} from '../src/shared/command-search.js';

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
];

test('real Arctic embeddings: cold setup, intent ranking, offline restart and cache recovery', {timeout: 180_000}, async t => {
  const progress: string[] = [], started = performance.now();
  const cold = await searchCommands(cases[0][0], {provider: cases[0][1], progress: message => progress.push(message)});
  assert.equal(cold.engine, 'local-bm25-embeddings', cold.warnings?.join('\n'));
  assert.ok(progress.some(message => message.startsWith('Downloading')));
  assert.ok(progress.some(message => message.startsWith('Indexing')));
  t.diagnostic(`Cold model download + full catalog: ${((performance.now() - started) / 1000).toFixed(2)}s`);
  const indexPath = join(CREDENTIAL_DIR, 'cache/command-search/index.json');
  assert.equal((await stat(indexPath)).mode & 0o777, 0o600);
  let first = 0, topThree = 0;
  // Prove that both fresh model loading and new query inference need no network once cached.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Network disabled by semantic integration test');};
  try {
    for (const [query, provider, expected] of cases) {
      const result = await searchCommands(query, {provider, limit: 10});
      assert.equal(result.engine, 'local-bm25-embeddings', result.warnings?.join('\n'));
      const rank = result.results.findIndex(item => item.command === expected || ('operation' in item && item.operation === expected));
      assert.ok(rank >= 0, `${query}: ${result.results.map(item => 'operation' in item ? item.operation : item.command)}`);
      if (rank === 0) first++;
      if (rank < 3) topThree++;
      if (query === 'let me log on') assert.equal(result.results[0].lexicalScore, 0, 'This match must come from semantic retrieval alone.');
    }
    t.diagnostic(`${first}/${cases.length} expected commands ranked first; ${topThree}/${cases.length} in the top three; all in the default ten results.`);
    const warmStart = performance.now(), warmProgress: string[] = [];
    const warm = await searchCommands(cases[0][0], {provider: cases[0][1], progress: message => warmProgress.push(message)}, createSemanticScorer());
    assert.deepEqual(warm.results, cold.results);
    assert.deepEqual(warmProgress, []);
    t.diagnostic(`Cached offline restart: ${((performance.now() - warmStart) / 1000).toFixed(2)}s`);
    await writeFile(indexPath, '{broken json');
    const rebuilt = await searchCommands(cases[0][0], {provider: cases[0][1]}, createSemanticScorer());
    assert.deepEqual(rebuilt.results, cold.results);
    const tokenizerPath = join(CREDENTIAL_DIR, `cache/command-search/models/${embeddingModel.revision}/tokenizer.json`);
    const tokenizer = await readFile(tokenizerPath);
    await writeFile(tokenizerPath, 'damaged model file');
    const fallback = await searchCommands(cases[0][0], {}, createSemanticScorer());
    assert.equal(fallback.engine, 'local-bm25');
    assert.match(fallback.warnings![0], /Network disabled/);
    await writeFile(tokenizerPath, tokenizer);
  } finally {globalThis.fetch = originalFetch;}
});
