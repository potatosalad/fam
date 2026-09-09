// Both shell completion and machine-readable artifacts come from the executable registry.
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const directory = process.argv[2] ? pathToFileURL(`${process.argv[2]}/`) : new URL('../dist/', import.meta.url);
const {completionCatalog} = await import(new URL('shared/completion.js', directory));
const {commands} = await import(new URL('shared/command-registry.js', directory));
const {describe} = await import(new URL('shared/command-runtime.js', directory));
await mkdir(new URL('shared/', directory), {recursive: true});
await writeFile(new URL('shared/completion-data.json', directory), JSON.stringify(completionCatalog()) + '\n');
await writeFile(new URL('shared/commands.json', directory), JSON.stringify(commands.map(describe), null, 2) + '\n');
