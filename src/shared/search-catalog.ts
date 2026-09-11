import {commands} from './command-registry.js';
import {discoverOperations} from '../familysearch/discovery.js';
import {documentationCatalog, documentationPassages} from './documentation.js';
import {bm25Index, fuseScores, searchTokens} from './search-ranking.js';
import {semanticScores, type SearchDocument, type SearchProgress} from './command-embeddings.js';

export type SemanticScorer = (documents: SearchDocument[], query: string, progress?: SearchProgress) => Promise<number[]>;
const call = commands.find(command => command.id === 'familysearch.api call')!;
const commandDocuments = [
  ...commands.map(command => ({command, operation: undefined as ReturnType<typeof discoverOperations>[number] | undefined})),
  ...discoverOperations().map(operation => ({command: call, operation})),
].map(({command, operation}) => {
  const id = operation ? `${command.id} --operation ${operation.name}` : command.id;
  return {command, operation, id, text: `${id}. ${operation?.description ?? command.description}`};
});
let cached: ReturnType<typeof loadCatalog> | undefined;
async function loadCatalog() {
  const guides = (await documentationCatalog()).documents;
  const passages = documentationPassages({schemaVersion: 1, documents: guides});
  return {guides, commands: commandDocuments, passages, documents: [...commandDocuments, ...passages],
    commandLexical: bm25Index(commandDocuments.map(doc => doc.text)), passageLexical: bm25Index(passages.map(doc => doc.text))};
}
export const searchCatalog = () => cached ??= loadCatalog().catch(error => {cached = undefined; throw error;});

/** Both searches share one vector corpus/cache; their BM25 length normalization stays separate. */
export async function scoreCatalog(query: string, options: {provider?: string; lexical?: boolean; progress?: SearchProgress}, scoreSemantic: SemanticScorer = semanticScores) {
  const catalog = await searchCatalog(), warnings: string[] = [];
  let semantic: number[] | undefined;
  const matches = !options.provider || catalog.commands.some(doc => doc.command.provider === options.provider)
    || catalog.passages.some(doc => doc.provider === options.provider);
  if (!options.lexical && searchTokens(query).length && matches) {
    try {
      semantic = await scoreSemantic(catalog.documents, query, options.progress);
      if (semantic.length !== catalog.documents.length || semantic.some(n => !Number.isFinite(n))) throw new Error('Invalid semantic scores.');
    } catch (error) {
      semantic = undefined;
      warnings.push(`Semantic search unavailable; showing BM25 results. ${error instanceof Error ? error.message : 'Could not load the local model.'} Retry to initialize the model, or use --lexical.`);
    }
  }
  return {catalog, warnings, semantic,
    commandScores: fuseScores(catalog.commandLexical(query), semantic?.slice(0, catalog.commands.length)),
    passageScores: fuseScores(catalog.passageLexical(query), semantic?.slice(catalog.commands.length))};
}
