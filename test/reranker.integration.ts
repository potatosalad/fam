// Opt-in public model download. No provider or API credentials are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {createReranker, rerankerModel} from '../src/shared/command-reranker.js';
import {Tokenizer} from '@huggingface/tokenizers';
import {rerankerPair} from '../src/shared/command-reranker.js';

test('real Ettin: published scoring example, pair encoding, offline restart and scoring-layer integrity', {timeout: 120_000}, async t => {
  // Published Apache-2.0 model-card example; fp32 scores are close to its rounded bf16 reference.
  const docs = [{id: 'venus', text: "Venus is often called Earth's twin because of its similar size and proximity."},
    {id: 'mars', text: 'Mars, known for its reddish appearance, is often referred to as the Red Planet.'},
    {id: 'jupiter', text: 'Jupiter, the largest planet in our solar system, has a prominent red spot.'},
    {id: 'saturn', text: 'Saturn, famous for its rings, is sometimes mistaken for the Red Planet.'}];
  const notices: string[] = [], query = 'Which planet is known as the Red Planet?', score = createReranker(), start = performance.now();
  const cold = await score(docs, query, message => notices.push(message));
  assert.ok(notices.some(message => message.startsWith('Downloading')));
  const reference = [6.59375, 10.5, 8.5625, 10];
  assert.ok(cold.every((value, i) => Math.abs(value - reference[i]) < 0.1), JSON.stringify(cold));
  assert.equal(cold.indexOf(Math.max(...cold)), 1, 'Mars must be the highest-scoring Red Planet passage.');
  t.diagnostic(`Cold model download + inference: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  const modelPath = join(CREDENTIAL_DIR, `cache/command-search/models/${rerankerModel.revision}`);
  const tokenizerPath = join(modelPath, 'tokenizer.json');
  assert.equal((await stat(tokenizerPath)).mode & 0o777, 0o600);
  const bytes = await readFile(tokenizerPath), config = await readFile(join(modelPath, 'tokenizer_config.json'));
  const tokenizer = new Tokenizer(JSON.parse(bytes.toString()), JSON.parse(config.toString()));
  assert.deepEqual(rerankerPair(tokenizer.encode(query, {add_special_tokens: false}).ids, tokenizer.encode(docs[0].text, {add_special_tokens: false}).ids),
    tokenizer.encode(query, {text_pair: docs[0].text}).ids);
  const fetcher = globalThis.fetch;
  globalThis.fetch = async () => {throw new Error('Network disabled by reranker integration test');};
  try {
    assert.deepEqual(await createReranker()(docs, query), cold);
    const changed = await score(docs, 'Which planet is famous for its rings?');
    assert.equal(changed.indexOf(Math.max(...changed)), 3, JSON.stringify(changed));
    await writeFile(tokenizerPath, 'damaged');
    const retry = createReranker();
    await assert.rejects(retry(docs, query), /Network disabled/);
    await writeFile(tokenizerPath, bytes);
    assert.deepEqual(await retry(docs, query), cold);
    const headPath = join(modelPath, '4_Dense/model.safetensors'), headBytes = await readFile(headPath);
    assert.equal((await stat(headPath)).mode & 0o777, 0o600);
    const damaged = Buffer.from(headBytes); damaged[damaged.length - 1] ^= 1;
    await writeFile(headPath, damaged);
    await assert.rejects(createReranker()(docs, query), /Network disabled/, 'Scoring-layer files receive the same integrity check as ONNX weights.');
    await writeFile(headPath, headBytes);
  } finally {globalThis.fetch = fetcher;}
});
