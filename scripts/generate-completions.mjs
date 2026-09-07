// Both shell completion and machine-readable artifacts come from the executable registry.
import {mkdir, writeFile} from 'node:fs/promises';
import {completionCatalog} from '../dist/shared/completion.js';
import {commands} from '../dist/shared/command-registry.js';
import {describe} from '../dist/shared/command-runtime.js';
await mkdir(new URL('../dist/shared/', import.meta.url), {recursive: true});
await writeFile(new URL('../dist/shared/completion-data.json', import.meta.url), JSON.stringify(completionCatalog()) + '\n');
await writeFile(new URL('../dist/shared/commands.json', import.meta.url), JSON.stringify(commands.map(describe), null, 2) + '\n');
