import {fileURLToPath} from 'node:url';
import {pinBuild} from './build-state.mjs';

// A detached, silent worker. Do not load the command dispatcher or history.
try {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await pinBuild(root);
  const {autoUpdateCli} = await import(new URL(`../${directory}/shared/cli-update.js`, import.meta.url));
  await autoUpdateCli({root});
} catch {} // Offline, busy, read-only and failed installations retry another day.
