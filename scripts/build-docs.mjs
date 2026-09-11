import {mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = new URL('../', import.meta.url);
const output = process.argv[2] ? pathToFileURL(`${process.argv[2]}/`) : new URL('dist/', root);
const {createDocumentationCatalog} = await import(new URL('shared/documentation.js', output));
const catalog = await createDocumentationCatalog(fileURLToPath(root));
for (const doc of catalog.documents) {
  const destination = new URL(`docs/${doc.source.replace(/^docs\//, '')}`, output);
  await mkdir(new URL('./', destination), {recursive: true});
  await writeFile(destination, doc.markdown);
}
await writeFile(new URL('docs/catalog.json', output), JSON.stringify(catalog) + '\n');
