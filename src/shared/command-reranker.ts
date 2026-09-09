import type {SearchDocument, SearchProgress} from './command-embeddings.js';
import {searchModelFile} from './search-model.js';

export const rerankerModel = {
  id: 'cross-encoder/ms-marco-MiniLM-L6-v2', revision: '233902d25c440f23af6f7d6e94d2946bac0bee0a',
  dtype: 'q8', runtime: 'onnxruntime-web@1.29.0', maxTokens: 512,
} as const;
const modelFiles = {
  'tokenizer.json': {bytes: 711396, sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66'},
  'tokenizer_config.json': {bytes: 1330, sha256: 'a5c2e5a7b1a29a0702cd28c08a399b5ecc110c263009d17f7e3b415f25905fd8'},
  'onnx/model_quint8_avx2.onnx': {bytes: 23200716, sha256: 'c80a8b34256ea453093d612e3ac48d3d965a0c0a48c7906709af8b8e28461bf9'},
} as const;
export type Reranker = (documents: SearchDocument[], query: string, progress?: SearchProgress) => Promise<number[]>;
type PairScorer = (pairs: {ids: number[]; types: number[]}[]) => Promise<number[]>;

/** BERT query/document pairs, with longest-first truncation and separate segment IDs. */
export function rerankerPair(query: number[], document: number[]) {
  let q = Math.min(query.length, 509), d = Math.min(document.length, 509);
  while (q + d > 509) {if (q > d) q--; else d--;}
  return {ids: [101, ...query.slice(0, q), 102, ...document.slice(0, d), 102],
    types: [...Array(q + 2).fill(0), ...Array(d + 1).fill(1)] as number[]};
}

async function loadReranker(progress?: SearchProgress) {
  const [{Tokenizer}, ort] = await Promise.all([import('@huggingface/tokenizers'), import('onnxruntime-web/wasm')]);
  const file = (name: keyof typeof modelFiles) => searchModelFile(rerankerModel, name, modelFiles[name], progress);
  const [definition, config, weights] = await Promise.all([file('tokenizer.json'), file('tokenizer_config.json'), file('onnx/model_quint8_avx2.onnx')]);
  const tokenizer = new Tokenizer(JSON.parse(Buffer.from(definition).toString()), JSON.parse(Buffer.from(config).toString()));
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(weights, {executionProviders: ['wasm']});
  const score: PairScorer = async pairs => {
    const length = Math.max(...pairs.map(pair => pair.ids.length)), shape = [pairs.length, length];
    const input = new BigInt64Array(pairs.length * length), mask = new BigInt64Array(input.length), types = new BigInt64Array(input.length);
    pairs.forEach((pair, i) => pair.ids.forEach((id, j) => {
      const at = i * length + j; input[at] = BigInt(id); mask[at] = 1n; types[at] = BigInt(pair.types[j]);
    }));
    const feeds = {input_ids: new ort.Tensor('int64', input, shape), attention_mask: new ort.Tensor('int64', mask, shape),
      token_type_ids: new ort.Tensor('int64', types, shape)};
    let output: Awaited<ReturnType<typeof session.run>> | undefined;
    try {
      output = await session.run(feeds);
      const logits = output.logits;
      if (!logits || logits.type !== 'float32' || logits.dims.join(',') !== `${pairs.length},1`)
        throw new Error('The reranker returned unexpected logits.');
      return Array.from(logits.data as Float32Array);
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
    const {encode, score} = await model, queryTokens = encode(query), values: number[] = [];
    // Batch inference bounds memory; preserve input order, including negative logits.
    for (let i = 0; i < documents.length; i += 8) {
      const batch = documents.slice(i, i + 8), scores = await score(batch.map(doc => rerankerPair(queryTokens, encode(doc.text))));
      if (scores.length !== batch.length || scores.some(n => !Number.isFinite(n))) throw new Error('The reranker returned invalid scores.');
      values.push(...scores);
    }
    return values;
  };
}
export const rerankScores = createReranker();
