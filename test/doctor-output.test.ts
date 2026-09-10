import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {execFile, spawn} from 'node:child_process';
import {promisify, stripVTControlCharacters} from 'node:util';
import {writeFile, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {usePrettyDoctor, startDoctorDisplay, formatPrettyDoctor} from '../src/shared/doctor-output.js';
import {formatDoctor, type DoctorReport, type ProviderReport} from '../src/shared/doctor.js';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';

class Terminal extends Writable {
  isTTY = true;
  columns = 80;
  rows = 24;
  color = true;
  chunks: string[] = [];
  hasColors() {return this.color;}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void) {this.chunks.push(chunk.toString()); done();}
  get text() {return this.chunks.join('');}
}
const provider = (name: ProviderReport['provider'], status: ProviderReport['status']): ProviderReport => ({provider: name, status,
  checks: [{id: 'account', status, code: status === 'ok' ? 'probe-passed' : status === 'warning' ? 'session-missing' : 'session-rejected',
    message: 'Synthetic check', ...status !== 'ok' ? {action: 'Run the recovery command. More detail.'} : {}}], limitations: ['Synthetic coverage.']});

test('pretty output defaults to capable human terminals and yields to explicit/plain output modes', () => {
  const output = new Terminal();
  assert.equal(usePrettyDoctor({}, output, {}), true);
  assert.equal(usePrettyDoctor({format: 'text'}, output, {}), true);
  for (const values of [{'no-pretty': true}, {json: true}, {format: 'json'}, {out: 'report.txt'}])
    assert.equal(usePrettyDoctor(values, output, {}), false);
  for (const env of [{TERM: 'dumb'}, {CI: 'true'}, {NO_COLOR: ''}, {NODE_DISABLE_COLORS: '1'}, {NO_COLOR: '1', FORCE_COLOR: '1'}])
    assert.equal(usePrettyDoctor({}, output, env), false);
  output.isTTY = false;
  assert.equal(usePrettyDoctor({}, output, {FORCE_COLOR: '1'}), false);
  output.isTTY = true; output.color = false;
  assert.equal(usePrettyDoctor({}, output, {}), false);
  output.color = true; output.rows = 10;
  assert.equal(usePrettyDoctor({}, output, {}, 11), false);
});

test('display shows every provider immediately, animates pending rows, preserves notices, and restores terminal state', t => {
  t.mock.timers.enable({apis: ['setInterval', 'Date'], now: 1000});
  const output = new Terminal(), diagnostics = new Terminal();
  const write = diagnostics.write;
  const listeners = ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP'].map(event => process.listenerCount(event));
  const display = startDoctorDisplay(['ancestry', 'findagrave', 'geneanet'], true, output, diagnostics);
  try {
    assert.match(output.text, /0\/3 complete/);
    for (const name of ['ancestry', 'findagrave', 'geneanet']) assert.match(output.text, new RegExp(`${name}.*Starting checks`));
    t.mock.timers.tick(160);
    assert.match(output.text, /⠹/);
    assert.match(output.text, /0\.2s/);
    display.update({type: 'progress', provider: 'ancestry', label: 'renewing session'});
    display.update({type: 'complete', provider: 'findagrave', report: provider('findagrave', 'ok')});
    display.update({type: 'complete', provider: 'geneanet', report: provider('geneanet', 'error')});
    const frame = stripVTControlCharacters(output.chunks.at(-1)!);
    assert.match(frame, /2\/3 complete/);
    assert.match(frame, /⠹ ancestry.*renewing session/);
    assert.match(frame, /✓ findagrave.*OK/);
    assert.match(frame, /✗ geneanet.*INVALID/);
    assert.match(output.chunks.at(-1)!, /\x1b\[32m/);
    assert.match(output.chunks.at(-1)!, /\x1b\[31m/);
    diagnostics.write('Complete verification at ');
    const paused = output.text;
    t.mock.timers.tick(160);
    assert.equal(output.text, paused, 'do not redraw over an unfinished diagnostic line');
    diagnostics.write('https://example.invalid/viewer\n');
    assert.equal(diagnostics.text, 'Complete verification at https://example.invalid/viewer\n');
    assert.match(output.chunks.at(-1)!, /2\/3 complete/);
    output.columns = 30;
    display.update({type: 'progress', provider: 'ancestry', label: 'Synthetic\n\x1b[2Jmessage'});
    assert.match(output.chunks.at(-1)!, /Synthetic message/);
    assert.doesNotMatch(output.chunks.at(-1)!, /\x1b\[2J/);
    assert.match(output.chunks.at(-1)!, /^\x1b\[\?7l.*\x1b\[\?7h$/s);
  } finally {display.stop();}
  assert.equal(diagnostics.write, write);
  assert.deepEqual(['exit', 'SIGINT', 'SIGTERM', 'SIGHUP'].map(event => process.listenerCount(event)), listeners);
  assert.ok(output.text.endsWith('\x1b[0m\x1b[?7h\x1b[?25h'));
  const stopped = output.text;
  t.mock.timers.tick(800);
  display.stop();
  assert.equal(output.text, stopped);
});

test('final colored output retains status, recovery steps, and verbose details', () => {
  const report: DoctorReport = {schemaVersion: 1, checkedAt: '2026-01-01T00:00:00.000Z', mode: 'live', status: 'error',
    providers: [provider('ancestry', 'ok'), provider('findagrave', 'warning'), provider('geneanet', 'error')]};
  const text = formatPrettyDoctor(report);
  assert.match(text, /\x1b\[33m!/);
  assert.equal(stripVTControlCharacters(text).replace(/^[✓!✗] /gm, ''), formatDoctor(report));
  assert.equal(stripVTControlCharacters(formatPrettyDoctor(report, true)).replace(/^[✓!✗] /gm, ''), formatDoctor(report, true));
});

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const env = () => ({...process.env, TERM: 'xterm-256color', CI: '', NO_COLOR: undefined, NODE_DISABLE_COLORS: undefined,
  FAM_CREDENTIALS_SYNC_DISABLED: '1', FAM_CREDENTIALS_COMMAND: '["helper-must-never-run"]'});

test('CLI uses the animated TTY path, while JSON, files, and --no-pretty remain clean', async () => {
  const preload = join(CREDENTIAL_DIR, 'doctor-tty.mjs'), out = join(CREDENTIAL_DIR, 'doctor-report.txt');
  await writeFile(preload, `Object.defineProperties(process.stdout, {isTTY: {value: true}, rows: {value: 24}, columns: {value: 80}, hasColors: {value: () => true}});`);
  const invoke = (...args: string[]) => run(process.execPath, ['--import', preload, '--import', import.meta.resolve('tsx'), cli,
    'cli.health', 'check', '--provider', 'wayback', '--offline', ...args], {env: env(), cwd: CREDENTIAL_DIR});
  try {
    const pretty = await invoke();
    assert.match(pretty.stdout, /Starting checks/);
    assert.match(pretty.stdout, /\x1b\[32m✓/);
    assert.equal(pretty.stderr, '');
    for (const args of [['--no-pretty'], ['--json'], ['--format', 'json'], ['--out', out]]) {
      const result = await invoke(...args);
      assert.doesNotMatch(result.stdout + result.stderr, /\x1b|Starting checks/);
      if (args.includes('json') || args.includes('--json')) assert.equal(JSON.parse(result.stdout).data.mode, 'local');
    }
    assert.doesNotMatch(await readFile(out, 'utf8'), /\x1b|Starting checks/);
  } finally {await rm(preload, {force: true}); await rm(out, {force: true});}
});

test('interrupting a live display restores the cursor and keeps normal signal exit behavior', {timeout: 10000}, async () => {
  const script = join(CREDENTIAL_DIR, 'doctor-interrupt.mjs');
  await writeFile(script, `import {startDoctorDisplay} from ${JSON.stringify(new URL('../src/shared/doctor-output.ts', import.meta.url).href)};
    startDoctorDisplay(['ancestry', 'findagrave'], true); setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), script], {env: env(), stdio: ['ignore', 'pipe', 'pipe']});
  let output = '', stderr = '', signaled = false;
  child.stdout.on('data', chunk => {
    output += chunk;
    if (!signaled && output.includes('Starting checks')) {signaled = true; child.kill('SIGINT');}
  });
  child.stderr.on('data', chunk => {stderr += chunk;});
  try {
    const result = await new Promise<{code: number | null; signal: string | null}>((resolve, reject) => {
      child.on('error', reject); child.on('close', (code, signal) => resolve({code, signal}));
    });
    assert.equal(stderr, ''); assert.equal(result.signal, 'SIGINT');
    assert.ok(output.endsWith('\x1b[0m\x1b[?7h\x1b[?25h'));
  } finally {child.kill(); await rm(script, {force: true});}
});
