// Opt-in public model download. No provider or API credentials are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {createReranker, rerankerModel} from '../src/shared/command-reranker.js';

test('real MiniLM: quantized pair inference, offline restart, integrity failure and recovery', {timeout: 120_000}, async t => {
  const docs = [{id: 'population', text: 'Berlin has a population of 3,520,031 registered inhabitants in an area of 891.82 square kilometers.'},
    {id: 'museums', text: 'Berlin is well known for its museums.'}];
  const notices: string[] = [], query = 'How many people live in Berlin?', score = createReranker(), start = performance.now();
  const cold = await score(docs, query, message => notices.push(message));
  assert.ok(notices.some(message => message.startsWith('Downloading')));
  // Published model-card example: positive population match and negative museum match.
  assert.ok(cold[0] > 8 && cold[1] < -3, JSON.stringify(cold));
  t.diagnostic(`Cold model download + inference: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  const tokenizerPath = join(CREDENTIAL_DIR, `cache/command-search/models/${rerankerModel.revision}/tokenizer.json`);
  assert.equal((await stat(tokenizerPath)).mode & 0o777, 0o600);
  const bytes = await readFile(tokenizerPath), fetcher = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Network disabled by reranker integration test');};
  try {
    assert.deepEqual(await createReranker()(docs, query), cold);
    const changed = await score(docs, 'What is Berlin well known for?');
    assert.ok(changed[1] > changed[0], JSON.stringify(changed));
    await writeFile(tokenizerPath, 'damaged');
    const retry = createReranker();
    await assert.rejects(retry(docs, query), /Network disabled/);
    await writeFile(tokenizerPath, bytes);
    assert.deepEqual(await retry(docs, query), cold);
  } finally {globalThis.fetch = fetcher;}
});
