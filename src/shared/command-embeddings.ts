import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {CREDENTIAL_DIR, readPrivateJson, writePrivateFile, writePrivateJson} from './storage.js';

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
async function modelFile(name: keyof typeof modelFiles, progress?: SearchProgress): Promise<Uint8Array> {
  const relative = `cache/command-search/models/${embeddingModel.revision}/${name}`, expected = modelFiles[name];
  const valid = (bytes: Uint8Array) => bytes.length === expected.bytes && createHash('sha256').update(bytes).digest('hex') === expected.sha256;
  try {
    const bytes = await readFile(join(CREDENTIAL_DIR, relative));
    if (valid(bytes)) return bytes;
  } catch { /* Fetch missing or unreadable model data, without touching credentials. */ }
  progress?.(`Downloading local search ${name} (${(expected.bytes / 1e6).toFixed(1)} MB)…`);
  const response = await fetch(`https://huggingface.co/${embeddingModel.id}/resolve/${embeddingModel.revision}/${name}`, {signal: AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`Search model download failed (HTTP ${response.status}).`);
  // Bound download size as well as time, and publish only verified complete files.
  if (!response.body) throw new Error('Search model download returned no data.');
  const reader = response.body.getReader(), bytes = new Uint8Array(expected.bytes);
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      if (length + value.length > bytes.length) throw new Error('Search model download exceeded its expected size.');
      bytes.set(value, length); length += value.length;
    }
  } finally {await reader.cancel();}
  if (length !== bytes.length || !valid(bytes)) throw new Error('Search model download failed its SHA-256 integrity check.');
  try {await writePrivateFile(relative, bytes);}
  catch {progress?.('Could not cache the search model; using it in memory for this invocation.');}
  return bytes;
}

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
const fingerprint = (documents: SearchDocument[]) => createHash('sha256')
  .update(JSON.stringify({version: 1, model: embeddingModel, documents: documents.map(({id, text}) => ({id, text}))})).digest('hex');

/** Inject storage/inference for offline tests; production uses the active profile and real model. */
export function createSemanticScorer(dependencies: {
  load?: (progress?: SearchProgress) => Promise<Embedder>;
  read?: () => Promise<unknown>;
  write?: (value: unknown) => Promise<void>;
} = {}) {
  let embedder: Promise<Embedder> | undefined;
  let cached: {fingerprint: string; vectors: Promise<number[][]>} | undefined;
  return async (documents: SearchDocument[], query: string, progress?: SearchProgress): Promise<number[]> => {
    embedder ??= (dependencies.load ?? loadEmbedder)(progress).catch(error => {embedder = undefined; throw error;});
    const embed = await embedder, key = fingerprint(documents);
    if (cached?.fingerprint !== key) {
      const vectors = (async () => {
        let saved: {fingerprint?: string; vectors?: unknown} | undefined;
        try {saved = await (dependencies.read ?? (() => readPrivateJson(vectorFile)))() as typeof saved;}
        catch { /* Missing or damaged caches are regenerated from the current public catalog. */ }
        if (saved?.fingerprint === key && validVectors(saved.vectors, documents.length)) return saved.vectors;
        progress?.(`Indexing ${documents.length} commands and operations for local search…`);
        const values: number[][] = [];
        for (let i = 0; i < documents.length; i += 16) {
          const batch = documents.slice(i, i + 16), encoded = await embed(batch.map(document => document.text));
          if (!validVectors(encoded, batch.length)) throw new Error('The search model returned invalid document embeddings.');
          values.push(...encoded);
        }
        try {await (dependencies.write ?? (value => writePrivateJson(vectorFile, value)))({fingerprint: key, vectors: values});}
        catch {progress?.('Could not save the search index; this search can still use the in-memory embeddings.');}
        return values;
      })();
      cached = {fingerprint: key, vectors};
      void vectors.catch(() => {if (cached?.vectors === vectors) cached = undefined;});
    }
    const vectors = await cached.vectors;
    const encoded = await embed([embeddingModel.queryPrefix + query]);
    if (!validVectors(encoded, 1)) throw new Error('The search model returned an invalid query embedding.');
    return vectors.map(vector => vector.reduce((sum, n, i) => sum + n * encoded[0][i], 0));
  };
}
export const semanticScores = createSemanticScorer();
