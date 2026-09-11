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
  return {guides, commands: commandDocuments, passages,
    commandLexical: bm25Index(commandDocuments.map(doc => doc.text)), passageLexical: bm25Index(passages.map(doc => doc.text))};
}
export const searchCatalog = () => cached ??= loadCatalog().catch(error => {cached = undefined; throw error;});

/** Index only the requested kind/provider; BM25 keeps stable corpus-wide normalization. */
export async function scoreCatalog(query: string, options: {target?: 'commands' | 'documentation'; provider?: string; doc?: string; lexical?: boolean; progress?: SearchProgress}, scoreSemantic: SemanticScorer = semanticScores) {
  const catalog = await searchCatalog(), warnings: string[] = [];
  let semantic: number[] | undefined;
  const documentation = options.target === 'documentation';
  const selected = documentation
    ? catalog.passages.map((document, i) => ({document, i})).filter(({document}) => (!options.provider || document.provider === options.provider) && (!options.doc || document.doc === options.doc))
    : catalog.commands.map((document, i) => ({document, i})).filter(({document}) => !options.provider || document.command.provider === options.provider);
  if (!options.lexical && searchTokens(query).length && selected.length) {
    try {
      const scores = await scoreSemantic(selected.map(({document}) => document), query, options.progress);
      if (scores.length !== selected.length || scores.some(n => !Number.isFinite(n))) throw new Error('Invalid semantic scores.');
      semantic = Array(documentation ? catalog.passages.length : catalog.commands.length).fill(0) as number[];
      selected.forEach(({i}, at) => {semantic![i] = scores[at];});
    } catch (error) {
      semantic = undefined;
      warnings.push(`Semantic search unavailable; showing BM25 results. ${error instanceof Error ? error.message : 'Could not load the local model.'} Retry to initialize the model, or use --lexical.`);
    }
  }
  return {catalog, warnings, semantic,
    commandScores: fuseScores(catalog.commandLexical(query), documentation ? undefined : semantic),
    passageScores: fuseScores(catalog.passageLexical(query), documentation ? semantic : undefined)};
}
