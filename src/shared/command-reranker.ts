import type {SearchDocument, SearchProgress} from './command-embeddings.js';
import {searchModelFile} from './search-model.js';
import {createRerankerHead} from './reranker-head.js';

export const rerankerModel = {
  id: 'cross-encoder/ettin-reranker-17m-v1', revision: '9e4aa35321a6dd1a43ca313f500c4b4f7cfb5cc6',
  dtype: 'fp32', runtime: 'onnxruntime-web@1.29.0', maxTokens: 512,
} as const;
const modelFiles = {
  'tokenizer.json': {bytes: 3583327, sha256: '28c5e078e4c52aa37cf0e6de1a212878f3dbd58dd1c70466298efe0b6b86db35'},
  'tokenizer_config.json': {bytes: 488, sha256: '2b85302525d8c528a9e1fbaea2733472bd00d4755eae881441c8c52b90e2d600'},
  'onnx/model_O2.onnx': {bytes: 67300850, sha256: 'f98dfc97321ea2a38e76b9f7df3feb34f0ec14484c21406f6ee43a4623e7a8a7'},
  '2_Dense/model.safetensors': {bytes: 262232, sha256: '85e9596d9250a871deb159fb5db6979e910b4cf181d05c806733c49bc43d47c8'},
  '3_LayerNorm/model.safetensors': {bytes: 2200, sha256: 'de99fa351fb4badb74b56e85fa70b5bbd3fcf4d0e74de79eb749dba1e9e28b4a'},
  '4_Dense/model.safetensors': {bytes: 1172, sha256: '654827171b89c76d19d663162243f38d63d1ba812ac1ec9c1b36512f1a8e9ce8'},
} as const;
export type Reranker = (documents: SearchDocument[], query: string, progress?: SearchProgress) => Promise<number[]>;
type PairScorer = (pairs: number[][]) => Promise<number[]>;

/** Pinned Ettin pair template; ModernBERT has no token-type IDs. Bound CPU work to 512 tokens. */
export function rerankerPair(query: number[], document: number[]) {
  const available = rerankerModel.maxTokens - 3;
  let q = Math.min(query.length, available), d = Math.min(document.length, available);
  while (q + d > available) {if (q > d) q--; else d--;}
  return [50281, ...query.slice(0, q), 50282, ...document.slice(0, d), 50282];
}

async function loadReranker(progress?: SearchProgress) {
  const [{Tokenizer}, ort] = await Promise.all([import('@huggingface/tokenizers'), import('onnxruntime-web/wasm')]);
  const file = (name: keyof typeof modelFiles) => searchModelFile(rerankerModel, name, modelFiles[name], progress);
  const [definition, config, weights, dense, normalization, outputWeights] = await Promise.all([
    file('tokenizer.json'), file('tokenizer_config.json'), file('onnx/model_O2.onnx'),
    file('2_Dense/model.safetensors'), file('3_LayerNorm/model.safetensors'), file('4_Dense/model.safetensors'),
  ]);
  const head = createRerankerHead(dense, normalization, outputWeights);
  const tokenizer = new Tokenizer(JSON.parse(Buffer.from(definition).toString()), JSON.parse(Buffer.from(config).toString()));
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(weights, {executionProviders: ['wasm']});
  const score: PairScorer = async pairs => {
    const length = Math.max(...pairs.map(pair => pair.length)), shape = [pairs.length, length];
    const input = new BigInt64Array(pairs.length * length).fill(50283n), mask = new BigInt64Array(input.length);
    pairs.forEach((pair, i) => pair.forEach((id, j) => {
      const at = i * length + j; input[at] = BigInt(id); mask[at] = 1n;
    }));
    const feeds = {input_ids: new ort.Tensor('int64', input, shape), attention_mask: new ort.Tensor('int64', mask, shape)};
    let output: Awaited<ReturnType<typeof session.run>> | undefined;
    try {
      output = await session.run(feeds);
      const hidden = output.last_hidden_state;
      if (!hidden || hidden.type !== 'float32' || hidden.dims.join(',') !== `${pairs.length},${length},256`)
        throw new Error('The reranker returned unexpected token embeddings.');
      const data = hidden.data as Float32Array;
      return pairs.map((_, i) => head(data.subarray(i * length * 256, i * length * 256 + 256)));
    } finally {
      for (const tensor of Object.values(output ?? {})) tensor.dispose();
      for (const tensor of Object.values(feeds)) tensor.dispose();
    }
  };
  return {encode: (text: string) => tokenizer.encode(text, {add_special_tokens: false}).ids, score};
}

export function createReranker(load = loadReranker): Reranker {
  let model: ReturnType<typeof load> | undefined;
  return async (documents, query, progress) => {
    if (!documents.length) return [];
    model ??= load(progress).catch(error => {model = undefined; throw error;});
    const {encode, score} = await model, queryTokens = encode(query), values: number[] = Array(documents.length);
    const pairs = documents.map((doc, index) => ({index, pair: rerankerPair(queryTokens, encode(doc.text))}))
      .sort((a, b) => a.pair.length - b.pair.length);
    // Group similar lengths so a long guide does not pad every short command to its length.
    for (let i = 0; i < pairs.length; i += 8) {
      const batch = pairs.slice(i, i + 8), scores = await score(batch.map(({pair}) => pair));
      if (scores.length !== batch.length || scores.some(n => !Number.isFinite(n))) throw new Error('The reranker returned invalid scores.');
      batch.forEach(({index}, at) => {values[index] = scores[at];});
    }
    return values;
  };
}
export const rerankScores = createReranker();
