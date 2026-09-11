import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
// @ts-expect-error The launcher helper also runs before TypeScript is built.
import {withProcessLock} from '../../bin/build-state.mjs';
import {CREDENTIAL_DIR, readPrivateJson, writePrivateJson} from './storage.js';
import {searchModelFile} from './search-model.js';

// Pin weights and preprocessing together: cached vectors must use the same model as queries.
export const embeddingModel = {
  id: 'Snowflake/snowflake-arctic-embed-xs', revision: 'd8c86521100d3556476a063fc2342036d45c106f',
  dtype: 'q8', dimensions: 384, pooling: 'cls', normalize: true, runtime: 'onnxruntime-web@1.29.0',
  queryPrefix: 'Represent this sentence for searching relevant passages: ',
} as const;
export interface SearchDocument {id: string; text: string}
export type SearchProgress = (message: string) => void;
export type Embedder = (texts: string[]) => Promise<number[][]>;
const vectorFile = 'cache/command-search/index.json';

// SHA-256 of the files in the pinned public revision; damaged or interrupted caches repair themselves.
const modelFiles = {
  'tokenizer.json': {bytes: 711649, sha256: '91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854'},
  'tokenizer_config.json': {bytes: 1433, sha256: '9ca59277519f6e3692c8685e26b94d4afca2d5438deff66483db495e48735810'},
  'onnx/model_quantized.onnx': {bytes: 22972992, sha256: 'e6aa5e656466a73d7c3111e9a3378bd13e5b93af30eaac2b3f13fd56692589a1'},
} as const;
const modelFile = (name: keyof typeof modelFiles, progress?: SearchProgress) => searchModelFile(embeddingModel, name, modelFiles[name], progress);

async function loadEmbedder(progress?: SearchProgress): Promise<Embedder> {
  // Portable CPU inference: no native extensions, GPU downloads, Python, or remote inference.
  const [{Tokenizer}, ort] = await Promise.all([import('@huggingface/tokenizers'), import('onnxruntime-web/wasm')]);
  const [definition, config, weights] = await Promise.all([
    modelFile('tokenizer.json', progress), modelFile('tokenizer_config.json', progress), modelFile('onnx/model_quantized.onnx', progress),
  ]);
  const tokenizer = new Tokenizer(JSON.parse(Buffer.from(definition).toString()), JSON.parse(Buffer.from(config).toString()));
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(weights, {executionProviders: ['wasm']});
  return async texts => {
    // Snowflake specifies CLS pooling, 512 tokens, L2 normalization, and a query-only prefix.
    const ids = texts.map(text => [101, ...tokenizer.encode(text, {add_special_tokens: false}).ids.slice(0, 510), 102]);
    const length = Math.max(...ids.map(row => row.length)), shape = [ids.length, length];
    const input = new BigInt64Array(ids.length * length), mask = new BigInt64Array(input.length);
    ids.forEach((row, i) => row.forEach((id, j) => {input[i * length + j] = BigInt(id); mask[i * length + j] = 1n;}));
    const feeds = {input_ids: new ort.Tensor('int64', input, shape), attention_mask: new ort.Tensor('int64', mask, shape),
      token_type_ids: new ort.Tensor('int64', new BigInt64Array(input.length), shape)};
    let output: Awaited<ReturnType<typeof session.run>> | undefined;
    try {
      output = await session.run(feeds);
      const hidden = output.last_hidden_state;
      if (!hidden || hidden.type !== 'float32' || hidden.dims.join(',') !== `${ids.length},${length},${embeddingModel.dimensions}`)
        throw new Error('The search model returned unexpected token embeddings.');
      const data = hidden.data as Float32Array;
      return ids.map((_, i) => {
        const start = i * length * embeddingModel.dimensions, cls = Array.from(data.subarray(start, start + embeddingModel.dimensions));
        const norm = Math.sqrt(cls.reduce((sum, n) => sum + n * n, 0));
        return cls.map(n => n / norm);
      });
    } finally {
      for (const tensor of Object.values(output ?? {})) tensor.dispose();
      for (const tensor of Object.values(feeds)) tensor.dispose();
    }
  };
}

function validVectors(value: unknown, count: number): value is number[][] {
  return Array.isArray(value) && value.length === count && value.every(row => Array.isArray(row)
    && row.length === embeddingModel.dimensions && row.every(n => typeof n === 'number' && Number.isFinite(n))
    && Math.abs(row.reduce((sum, n) => sum + n * n, 0) - 1) < 0.01);
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
// Text determines an embedding, not the entry's ID, position, provider, or surrounding catalog.
const modelFingerprint = digest(JSON.stringify({version: 2, model: embeddingModel, maxTokens: 512}));
const cacheLimit = 4096;
function cachedVectors(saved: unknown): Map<string, number[]> {
  const cache = saved as {version?: number; model?: string; entries?: unknown} | null;
  const entries = new Map<string, number[]>();
  if (cache?.version === 2 && cache.model === modelFingerprint && Array.isArray(cache.entries)) {
    for (const entry of cache.entries.slice(-cacheLimit)) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && /^[a-f0-9]{64}$/.test(entry[0]) && validVectors([entry[1]], 1))
        entries.set(entry[0], entry[1]);
    }
  }
  return entries;
}
async function persistVectors(value: unknown): Promise<void> {
  const directory = join(CREDENTIAL_DIR, 'cache/command-search');
  await mkdir(directory, {recursive: true, mode: 0o700});
  // Lock only the short read/merge/write, never model inference. Concurrent CLI
  // searches must retain each other's additions without waiting for a full index.
  await withProcessLock(directory, '.index.lock', async () => {
    let saved: unknown;
    try {saved = await readPrivateJson(vectorFile);} catch { /* Repair invalid JSON. */ }
    const entries = cachedVectors(saved);
    for (const [key, vector] of cachedVectors(value)) {entries.delete(key); entries.set(key, vector);}
    await writePrivateJson(vectorFile, {version: 2, model: modelFingerprint, entries: [...entries].slice(-cacheLimit)});
  });
}

/** Inject storage/inference for offline tests; production uses the active profile and real model. */
export function createSemanticScorer(dependencies: {
  load?: (progress?: SearchProgress) => Promise<Embedder>;
  read?: () => Promise<unknown>;
  write?: (value: unknown) => Promise<void>;
} = {}) {
  let embedder: Promise<Embedder> | undefined;
  let cache: Map<string, number[]> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  return async (documents: SearchDocument[], query: string, progress?: SearchProgress): Promise<number[]> => {
    if (!documents.length) return [];
    // Serialize shared inference and cache updates, including overlapping provider/doc searches.
    const result = queue.then(async () => {
      embedder ??= (dependencies.load ?? loadEmbedder)(progress).catch(error => {embedder = undefined; throw error;});
      const embed = await embedder;
      if (!cache) {
        let saved: unknown;
        try {saved = await (dependencies.read ?? (() => readPrivateJson(vectorFile)))();}
        catch { /* Missing or damaged entries are regenerated from public catalog text. */ }
        cache = cachedVectors(saved);
      }
      const keys = documents.map(document => digest(document.text));
      const missing = [...new Map(documents.flatMap((document, i) => cache!.has(keys[i]) ? [] : [[keys[i], document.text] as const]))]
        .sort((a, b) => a[1].length - b[1].length);
      let dirty = false, saveFailed = false;
      const save = async () => {
        if (!dirty || saveFailed) return;
        try {
          await (dependencies.write ?? persistVectors)({version: 2, model: modelFingerprint, entries: [...cache!].slice(-cacheLimit)});
          dirty = false;
        } catch {
          saveFailed = true;
          progress?.('Could not save the search index; this search can still use the in-memory embeddings.');
        }
      };
      // Touch requested entries so switching corpora keeps recently used vectors in the bounded cache.
      for (const key of keys) {
        const vector = cache.get(key);
        if (vector) {cache.delete(key); cache.set(key, vector);}
      }
      if (missing.length) progress?.(`Indexing ${missing.length} new or changed search entries (${documents.length - missing.length} cached)…`);
      try {
        for (let i = 0; i < missing.length; i += 16) {
          // Similar-length inputs reduce wasted padding without shortening any document.
          const batch = missing.slice(i, i + 16), encoded = await embed(batch.map(([, text]) => text));
          if (!validVectors(encoded, batch.length)) throw new Error('The search model returned invalid document embeddings.');
          batch.forEach(([key], at) => cache!.set(key, encoded[at]));
          dirty = true;
          const done = i + batch.length;
          if (done % 64 === 0 || done === missing.length) {
            await save();
            progress?.(`Indexed ${done} of ${missing.length} new search entries…`);
          }
        }
      } finally {await save();}
      const vectors = keys.map(key => cache!.get(key)!);
      while (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
      const encoded = await embed([embeddingModel.queryPrefix + query]);
      if (!validVectors(encoded, 1)) throw new Error('The search model returned an invalid query embedding.');
      return vectors.map(vector => vector.reduce((sum, n, i) => sum + n * encoded[0][i], 0));
    });
    queue = result.catch(() => {});
    return result;
  };
}
export const semanticScores = createSemanticScorer();
