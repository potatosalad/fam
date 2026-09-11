import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createService} from './server.mjs';

process.umask(0o077);
const result = await promisify(execFile)('python', [fileURLToPath(new URL('./launch.py', import.meta.url))], {timeout: 60000});
if (result.stderr) process.stderr.write(result.stderr);
const launch = JSON.parse(result.stdout.trim().split('\n').at(-1));
const service = await createService({apiKey: process.env.FAM_BROWSER_API_KEY,
  profileDir: process.env.FAM_BROWSER_PROFILE_DIR ?? '/data/profiles', launch,
  alternatives: JSON.parse(process.env.FAM_BROWSER_ALTERNATIVES ?? '{}')});
const children = [
  spawn('x11vnc', ['-display', ':99', '-localhost', '-forever', '-shared', '-nopw', '-rfbport', '5900'], {stdio: 'ignore'}),
  spawn('websockify', ['--web=/usr/share/novnc', '6080', '127.0.0.1:5900'], {stdio: 'ignore'}),
];
const server = service.app.listen(9377, '0.0.0.0', () => console.log('fam CloakBrowser API ready on port 9377; viewer on 6080.'));
let stopping;
async function stop(exitCode = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    server.close(); await service.close();
    for (const child of children) child.kill('SIGTERM');
  })();
  await stopping; process.exit(exitCode);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
for (const child of children) {
  child.once('error', () => {console.error('Browser viewer failed to start.'); void stop(1);});
  child.once('exit', () => {if (!stopping) {console.error('Browser viewer stopped.'); void stop(1);}});
}
