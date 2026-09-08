import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Prepare the engine before Firefox can start. Keep Node as the service process
// so Camofox receives shutdown signals and checkpoints its saved sessions.
execFileSync('python3', [fileURLToPath(new URL('./patch-engine.py', import.meta.url))], {stdio: 'inherit'});
process.env.FAM_PRIVATE_CONTEXTS = '1';
await import('/app/server.js');
