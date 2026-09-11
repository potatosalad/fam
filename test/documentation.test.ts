import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDocumentationCatalog, documentationCatalog, documentationPassages, listDocumentation, parseSections, readDocumentation} from '../src/shared/documentation.js';
import {searchDocumentation} from '../src/shared/documentation-search.js';
import {searchCommands, type SemanticScorer} from '../src/shared/command-search.js';
import {completionCatalog, complete} from '../src/shared/completion.js';
import {humanOutput, namespaceHelp} from '../src/shared/command-output.js';
import {commandById} from '../src/shared/command-registry.js';
import {namespaceInfo} from '../src/shared/command-navigation.js';

const run = promisify(execFile);
const neverEmbed: SemanticScorer = async () => {assert.fail('Reading and lexical search must not load models.');};
const readCommand = commandById.get('cli.doc read')!;

test('sections ignore fenced examples, preserve nested content, and give repeated headings unique IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fam-docs-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'docs/americanancestors'), {recursive: true});
  await writeFile(join(root, 'README.md'), '# fam\nWelcome.\n');
  const markdown = '# Example\n\n## Read records\n\nKeep **all** the text.\n\n```sh\n# not a heading\nfam americanancestors.record search --last-name Adams\n```\n\n### Details\n\nExact strings.\n\n## Read records\n\nOther section.\n\nSetext title\n------------\n\nLast section.\n';
  await writeFile(join(root, 'docs/americanancestors/README.md'), markdown);
  await writeFile(join(root, 'secret.md'), 'Must not be bundled');
  await symlink(join(root, 'secret.md'), join(root, 'docs/private.md'));
  const catalog = await createDocumentationCatalog(root);
  assert.deepEqual(catalog.documents.map(doc => doc.id), ['americanancestors', 'readme']);
  assert.deepEqual(parseSections(markdown).map(section => section.id), ['example', 'read-records', 'details', 'read-records-1', 'setext-title']);
  const full = await readDocumentation({provider: 'americanancestors'}, catalog);
  assert.equal(full.markdown, markdown);
  const part = await readDocumentation({doc: 'americanancestors', section: 'read-records'}, catalog);
  assert.match(part.markdown, /### Details[\s\S]*Exact strings/);
  assert.doesNotMatch(part.markdown, /Other section/);
  assert.match(part.text, /Keep all the text/);
  assert.match(part.text, /# not a heading\n  fam americanancestors.record search --last-name Adams/);
  await assert.rejects(readDocumentation({doc: 'americanancestors', section: 'Read records'}, catalog), /ambiguous/);
  await assert.rejects(readDocumentation({doc: '../../secret.md'}, catalog), /Unknown document/);
  await assert.rejects(readDocumentation({provider: 'ancestry', doc: 'americanancestors'}, catalog), /belongs to/);
  assert.ok(documentationPassages(catalog).some(p => p.commands.includes('americanancestors.record search')));
});

test('full provider guides, section navigation, Markdown, JSON data, and documentation completion share the catalog', async () => {
  const catalog = await documentationCatalog();
  const guide = await readDocumentation({provider: 'americanancestors'});
  assert.equal(guide.markdown, await readFile(new URL('../docs/americanancestors/README.md', import.meta.url), 'utf8'));
  assert.equal(humanOutput(readCommand, guide, {format: 'markdown'}), guide.markdown);
  assert.match(guide.text, /shared credential setup \(fam cli.doc read --doc setup\)/);
  assert.equal((await readDocumentation({provider: 'cli'})).id, 'cli');
  assert.equal((await readDocumentation()).id, 'readme');
  const listed = await listDocumentation({provider: 'americanancestors'});
  assert.deepEqual(listed.documents.map(doc => doc.id), ['americanancestors', 'americanancestors/protocol']);
  assert.ok(listed.documents[0].sections.some(s => s.id === 'family-members-and-collection-specific-fields'));
  const completion = completionCatalog(catalog);
  assert.ok(complete(completion, ['cli.doc', 'read', '--doc', 'american']).candidates.includes('americanancestors/protocol'));
  for (const words of [
    ['cli.doc', 'read', '--provider', 'americanancestors', '--section', 'family'],
    ['cli.doc', 'read', '--doc=americanancestors', '--section=family'],
    ['cli.doc', 'read', '--doc', '=', 'americanancestors', '--section', '=', 'family'],
  ]) assert.ok(complete(completion, words).candidates.some(candidate => candidate.endsWith('family-members-and-collection-specific-fields')));
  for (const name of ['americanancestors', 'americanancestors.record', 'cli', 'cli.doc']) {
    const namespace = namespaceInfo(name)!;
    assert.match(namespaceHelp(namespace), new RegExp(`Documentation: fam cli.doc read --provider ${namespace.provider}`));
    assert.doesNotMatch(namespaceHelp(namespace), /Documentation:.*(?:README\.md|\/Users\/|\/root\/)/);
  }
});

test('documentation search finds section-only terms, paginates, and adds usable evidence to command search', async () => {
  const query = 'Generation=5', options = {provider: 'americanancestors', lexical: true, limit: 100};
  const docs = await searchDocumentation(query, options, neverEmbed);
  assert.equal(docs.results[0].section, 'family-members-and-collection-specific-fields');
  assert.ok(docs.results.every(doc => doc.provider === 'americanancestors'));
  assert.equal(new Set(docs.results.map(doc => `${doc.doc}#${doc.section}`)).size, docs.results.length);
  const page = await searchDocumentation(query, {...options, limit: 1}, neverEmbed);
  assert.deepEqual(page.results, docs.results.slice(0, 1));
  const restricted = await searchDocumentation('browser', {...options, doc: 'americanancestors/protocol'}, neverEmbed);
  assert.ok(restricted.results.every(doc => doc.doc === 'americanancestors/protocol'));
  await assert.rejects(searchDocumentation('browser', {doc: '../../secret'}, neverEmbed), /Unknown document/);
  const commands = await searchCommands(query, options, neverEmbed);
  const match = commands.results.find(item => item.command === 'americanancestors.record search')!;
  assert.ok(match);
  assert.equal(match.lexicalScore, 0, 'This phrase is present in the guide, not the command description.');
  assert.equal(match.documentation?.section, 'family-members-and-collection-specific-fields');
  assert.ok(match.score > 0);
  assert.match(humanOutput(commandById.get('cli.command search')!, commands, {}), /fam cli.doc read --doc americanancestors --section family-members/);
  const parsed = await readDocumentation({doc: match.documentation!.doc, section: match.documentation!.section});
  assert.match(parsed.markdown, /Generation=5/);
});

test('semantic indexing respects search kind and provider/doc filters; sections rerank and fall back without losing matches', async () => {
  let corpus: string[] = [];
  const semantic: SemanticScorer = async docs => {corpus = docs.map(doc => doc.id); return docs.map(doc => doc.id.includes('#family-members-and-collection-specific-fields:') ? 1 : 0.1);};
  const result = await searchDocumentation('relatives', {provider: 'americanancestors', rerank: false}, semantic);
  assert.equal(result.results[0].section, 'family-members-and-collection-specific-fields');
  assert.ok(corpus.length > 0 && corpus.every(id => id.startsWith('doc:americanancestors')));
  await searchCommands('relatives', {provider: 'americanancestors', rerank: false}, semantic);
  assert.ok(corpus.length > 0 && corpus.every(id => id.startsWith('americanancestors.')), 'Command search must not embed guides or other providers.');
  await searchCommands('download an original image', {rerank: false}, semantic);
  assert.ok(corpus.every(id => !id.startsWith('doc:')), 'Unfiltered command search must not build a guide vector index.');
  await searchDocumentation('browser', {doc: 'americanancestors/protocol', rerank: false}, semantic);
  assert.ok(corpus.length > 0 && corpus.every(id => id.startsWith('doc:americanancestors/protocol#')));
  const reranked = await searchDocumentation('relatives', {provider: 'americanancestors', limit: 2}, semantic, async docs => docs.map((_, i) => 0 - i));
  assert.equal(reranked.engine, 'local-bm25-embeddings-reranked');
  assert.equal(reranked.results[0].score, 0);
  assert.equal(reranked.results[1].score, -1);
  const fallback = await searchDocumentation('Generation=5', {provider: 'americanancestors'}, async () => {throw new Error('offline');});
  assert.equal(fallback.engine, 'local-bm25');
  assert.match(fallback.warnings![0], /offline/);
  assert.equal(fallback.results[0].section, 'family-members-and-collection-specific-fields');
});

test('guide terms enrich command retrieval and reranking without passage embeddings', async () => {
  const semantic: SemanticScorer = async docs => {
    assert.ok(docs.every(doc => !doc.id.startsWith('doc:')));
    return docs.map(() => 0.2);
  };
  const result = await searchCommands('Generation=5', {provider: 'americanancestors'}, semantic, async docs => {
    const match = docs.find(doc => doc.id === 'americanancestors.record search')!;
    assert.match(match.text, /Generation=5/);
    return docs.map(doc => doc === match ? 1 : -1);
  });
  assert.equal(result.results[0].command, 'americanancestors.record search');
  assert.equal(result.results[0].lexicalScore, 0);
  assert.equal(result.results[0].semanticScore, 0.2);
  assert.equal(result.results[0].documentation?.section, 'family-members-and-collection-specific-fields');
  assert.equal(result.results[0].retrievalScore, 0.34, 'The discounted guide match improves the lexical part of hybrid retrieval.');
});

test('reading and lexical doc search run outside the checkout without accounts or a config directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-doc-cli-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/cli.ts', import.meta.url)), ...args],
    {cwd: directory, env: {...process.env, FAM_CONFIG_DIR: join(directory, 'no-profile'), FAM_HISTORY: '0', FAM_CREDENTIALS_COMMAND: '["must-never-run"]'}});
  const full = await invoke('cli.doc', 'read', '--provider', 'americanancestors', '--json');
  assert.equal(JSON.parse(full.stdout).data.id, 'americanancestors');
  assert.match(JSON.parse(full.stdout).data.markdown, /## Family members/);
  const search = await invoke('cli.doc', 'search', '--query', 'Generation=5', '--provider', 'americanancestors', '--lexical');
  assert.match(search.stdout, /Read: fam cli.doc read/);
  assert.equal(search.stderr, '');
  await assert.rejects(invoke('cli.doc', 'read', '--doc', '../../etc/passwd'), (error: any) => error.code === 2 && /Unknown document/.test(error.stderr));
  await invoke('cli.doc', 'read', '--provider', 'americanancestors', '--format', 'markdown', '--out', join(directory, 'guide.md'));
  assert.equal(await readFile(join(directory, 'guide.md'), 'utf8'), JSON.parse(full.stdout).data.markdown);
  await assert.rejects(stat(join(directory, 'no-profile')), {code: 'ENOENT'});
});
