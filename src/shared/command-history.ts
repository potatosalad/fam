import {createHash, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {inspectResult, setDiagnosticSink, type Diagnostic} from './diagnostics.js';
import {setCommandInputSink, type HistoryInput} from './command-input.js';

export function errorSummary(error: unknown, depth = 0): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {message: typeof error === 'string' ? error : 'Command failed.'};
  const e = error as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'code', 'message', 'status', 'statusCode']) {
    const value = e[key];
    if (typeof value === 'string') result[key] = value;
    else if (typeof value === 'number') result[key] = value;
  }
  if (!result.code && e.extensions && typeof e.extensions === 'object' && 'code' in e.extensions
      && typeof e.extensions.code === 'string') result.code = e.extensions.code;
  if (typeof e.stack === 'string') result.stack = e.stack.split('\n').filter(line => /^\s+at /.test(line));
  if (e.cause && depth < 3) result.cause = errorSummary(e.cause, depth + 1);
  return result;
}

export async function startCommandHistory(args: string[]) {
  const id = randomUUID(), startedAt = new Date().toISOString(), start = performance.now();
  const diagnostics: Record<string, unknown>[] = [];
  const inputs: HistoryInput[] = [];
  let droppedDiagnostics = 0, failure: Record<string, unknown> | undefined;
  let command: string | null = null, provider: string | null = null, settled = false, finished = false;
  let inspectResults = true;
  let append: ((value: unknown) => void) | undefined;
  let warned = false;
  const warn = () => {
    if (warned) return;
    warned = true;
    try {process.stderr.write('Warning: fam could not write command history; check the profile directory and free disk space.\n');} catch {}
  };
  const base: Record<string, unknown> = {schemaVersion: 1, id, startedAt, pid: process.pid,
    argv: [...args], argvCapture: 'verbatim', cwd: process.cwd(),
    runtime: {node: process.version, platform: process.platform, arch: process.arch}};
  const write = (event: Record<string, unknown>) => {
    if (!append) return;
    try {append({...base, timestamp: new Date().toISOString(), command, provider, ...event});}
    catch {warn();}
  };
  if (process.env.FAM_HISTORY !== '0') {
    try {
      const {appendPrivateJsonl, writePrivateFile} = await import('./storage.js');
      const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
      let build: {version?: string} | null = null;
      try {build = JSON.parse(await readFile(new URL('../build-info.json', import.meta.url), 'utf8'));} catch {}
      base.version = build?.version ?? pkg.version; base.build = build;
      const file = `history/${startedAt.slice(0, 10)}.jsonl`;
      append = value => appendPrivateJsonl(file, value);
      write({event: 'start'});
      setCommandInputSink(async input => {
        const saved: HistoryInput = {kind: input.kind, path: input.path, snapshot: null,
          bytes: input.data.length, sha256: createHash('sha256').update(input.data).digest('hex'), complete: input.complete};
        const index = inputs.push(saved);
        try {saved.snapshot = await writePrivateFile(`history/inputs/${id}/${index}.bin`, input.data);}
        catch (error) {saved.error = error instanceof Error ? error.message : String(error); warn();}
        write({event: 'input', input: saved});
      });
    } catch {warn();}
  }
  const add = (item: Diagnostic) => {
    if (item.path && !inspectResults) return;
    if (diagnostics.length >= 32) {droppedDiagnostics++; return;}
    diagnostics.push({code: item.code, message: item.message,
      ...(item.path ? {path: item.path} : {}),
      ...(item.error === undefined ? {} : {error: errorSummary(item.error)})});
  };
  if (append) setDiagnosticSink(add);
  const history = {
    id,
    command(id: string, service: string, inspect = true) {command = id; provider = service; inspectResults = inspect;},
    result(value: unknown) {if (append && inspectResults) inspectResult(value, add);},
    fail(error: unknown) {
      if (!append) return;
      try {
        failure = errorSummary(error);
        if (error && typeof error === 'object' && 'result' in error) inspectResult(error.result, add);
      } catch {failure = {message: 'Command failed; error details could not be inspected.'};}
    },
    settled() {settled = true;},
    finish(exitCode: number) {
      if (finished) return;
      finished = true;
      write({event: 'finish', durationMs: Math.round(performance.now() - start), exitCode,
        outcome: exitCode !== 0 || failure || !settled ? 'hard_failure' : diagnostics.length ? 'soft_failure' : 'success',
        settled, ...(failure ? {error: failure} : {}), diagnostics, droppedDiagnostics, inputs});
      setDiagnosticSink(undefined);
      setCommandInputSink(undefined);
    },
  };
  return history;
}
