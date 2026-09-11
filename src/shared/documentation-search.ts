import {scoreCatalog, searchCatalog, type SemanticScorer} from './search-catalog.js';
import {embeddingModel, semanticScores, type SearchProgress} from './command-embeddings.js';
import {rerankerModel, rerankScores, type Reranker} from './command-reranker.js';
import {searchTokens, searchWeights} from './search-ranking.js';
import {DocumentationError} from './documentation.js';

export interface DocumentationSearchOptions {provider?: string; doc?: string; limit?: number; offset?: number; lexical?: boolean; rerank?: boolean; progress?: SearchProgress}
export async function searchDocumentation(query: string, options: DocumentationSearchOptions = {}, scoreSemantic: SemanticScorer = semanticScores, scoreRerank: Reranker = rerankScores) {
  if (options.doc) {
    const guide = (await searchCatalog()).guides.find(doc => doc.id === options.doc);
    if (!guide) throw new DocumentationError(`Unknown document ${JSON.stringify(options.doc)}.`);
    if (options.provider && guide.provider !== options.provider) throw new DocumentationError(`Document ${guide.id} belongs to ${guide.provider}, not ${options.provider}.`);
  }
  const {catalog, warnings, semantic, passageScores} = await scoreCatalog(query, {...options, target: 'documentation'}, scoreSemantic);
  let ranked = (searchTokens(query).length ? catalog.passages : []).map((entry, i) => ({entry, ...passageScores[i], retrievalScore: passageScores[i].score, rerankScore: null as number | null}))
    .filter(row => row.score > 0 && (!options.provider || row.entry.provider === options.provider) && (!options.doc || row.entry.doc === options.doc))
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id, 'en'));
  // Show each section once, using its most relevant passage even when it is near the end.
  const seen = new Set<string>();
  ranked = ranked.filter(row => {
    const key = `${row.entry.doc}#${row.entry.section}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const retrievedTotal = ranked.length;
  let reranked = false;
  if (options.rerank !== false && semantic && ranked.length) {
    try {
      const shortlist = ranked.slice(0, 100), logits = await scoreRerank(shortlist.map(row => row.entry), query, options.progress);
      if (logits.length !== shortlist.length || logits.some(n => !Number.isFinite(n))) throw new Error('Invalid reranker scores.');
      ranked = shortlist.map((row, i) => ({...row, score: logits[i], rerankScore: logits[i]}))
        .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id, 'en'));
      reranked = true;
    } catch (error) {warnings.push(`Reranking unavailable; showing BM25 + Arctic results. ${error instanceof Error ? error.message : 'Could not load the local reranker.'}`);}
  }
  const limit = options.limit ?? 10, offset = options.offset ?? 0;
  return {query, engine: reranked ? 'local-bm25-embeddings-reranked' : semantic ? 'local-bm25-embeddings' : 'local-bm25',
    weights: semantic ? searchWeights : {lexical: 1, semantic: 0}, ...(semantic ? {model: embeddingModel} : {}),
    ...(reranked ? {reranker: {...rerankerModel, candidateLimit: 100}, retrievedTotal} : {}), ...(warnings.length ? {warnings} : {}),
    total: ranked.length, offset, limit, hasMore: offset + limit < ranked.length, nextOffset: offset + limit < ranked.length ? offset + limit : null,
    results: ranked.slice(offset, offset + limit).map(({entry, ...scores}) => ({...entry, ...scores, type: 'documentation' as const}))};
}
