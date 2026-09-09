import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {inspectResult, setDiagnosticSink, type Diagnostic} from './diagnostics.js';

const REDACTED = '[REDACTED]';

/** Keep diagnostics useful without storing arbitrary flag values, payloads or transcripts. */
export function historyRedactor(args: string[], env: NodeJS.ProcessEnv = process.env): (text: string) => string {
  const hidden = new Set<string>();
  for (const arg of args.slice(2)) {
    if (!arg.startsWith('-')) hidden.add(arg);
    else if (arg.includes('=')) hidden.add(arg.slice(arg.indexOf('=') + 1));
  }
  for (const [key, value] of Object.entries(env)) if (/password|token|secret|cookie|username|credential/i.test(key) && value) hidden.add(value);
  const values = [...hidden].filter(Boolean).sort((a, b) => b.length - a.length);
  return (text: string) => {
    let result = text;
    for (const value of values) {
      if (/^\d+$/.test(value)) result = result.replace(new RegExp(`(^|[^0-9])${value}(?![0-9])`, 'g'), `$1${REDACTED}`);
      else result = result.split(value).join(REDACTED);
    }
    result = result.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try {const url = new URL(raw); return `${url.origin}/${REDACTED}`;} catch {return REDACTED;}
    });
    result = result.replace(/\b(?:Bearer|Basic)\s+[^\s,"';]+/gi, REDACTED)
      .replace(/\b(?:authorization|(?:set-)?cookie)\s*[:=][^\r\n]*/gi, REDACTED)
      .replace(/(["']?(?:[\w-]*(?:password|passwd|token|secret|cookie|credential|authorization|sessionid|api[_-]?key|username)[\w-]*|code|verification[_-]?code)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;&}\]]+)/gi, `$1${REDACTED}`)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
      .split(homedir()).join('~');
    return result.length > 2000 ? `${result.slice(0, 2000)}[TRUNCATED]` : result;
  };
}

export function historyArguments(args: string[]): string[] {
  return args.slice(0, 100).map((arg, index) => {
    if (index < 2 && /^[a-z][a-z0-9.-]{0,100}$/.test(arg)) return arg;
    if (/^--?[a-z][a-z0-9-]*(?:=|$)/i.test(arg)) {
      const name = arg.split('=', 1)[0].slice(0, 100);
      return arg.includes('=') ? `${name}=${REDACTED}` : name;
    }
    return REDACTED;
  });
}

export function errorSummary(error: unknown, redact: (text: string) => string, depth = 0): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {message: redact(typeof error === 'string' ? error : 'Command failed.')};
  const e = error as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'code', 'message', 'status', 'statusCode']) {
    const value = e[key];
    if (typeof value === 'string') result[key] = redact(value);
    else if (typeof value === 'number') result[key] = value;
  }
  if (!result.code && e.extensions && typeof e.extensions === 'object' && 'code' in e.extensions
      && typeof e.extensions.code === 'string') result.code = redact(e.extensions.code);
  if (typeof e.stack === 'string') result.stack = e.stack.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 12).map(redact);
  if (e.cause && depth < 3) result.cause = errorSummary(e.cause, redact, depth + 1);
  return result;
}

export async function startCommandHistory(args: string[]) {
  const id = randomUUID(), startedAt = new Date().toISOString(), start = performance.now();
  const redact = historyRedactor(args);
  const diagnostics: Record<string, unknown>[] = [];
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
    argv: historyArguments(args), argsTruncated: args.length > 100,
    runtime: {node: process.version, platform: process.platform, arch: process.arch}};
  const write = (event: Record<string, unknown>) => {
    if (!append) return;
    try {append({...base, timestamp: new Date().toISOString(), command, provider, ...event});}
    catch {warn();}
  };
  if (process.env.FAM_HISTORY !== '0') {
    try {
      const {appendPrivateJsonl} = await import('./storage.js');
      const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
      let build: unknown = null;
      try {build = JSON.parse(await readFile(new URL('../build-info.json', import.meta.url), 'utf8'));} catch {}
      base.version = pkg.version; base.build = build;
      const file = `history/${startedAt.slice(0, 10)}.jsonl`;
      append = value => appendPrivateJsonl(file, value);
      write({event: 'start'});
    } catch {warn();}
  }
  const add = (item: Diagnostic) => {
    if (item.path && !inspectResults) return;
    if (diagnostics.length >= 32) {droppedDiagnostics++; return;}
    diagnostics.push({code: redact(item.code), message: redact(item.message),
      ...(item.path ? {path: redact(item.path)} : {}),
      ...(item.error === undefined ? {} : {error: errorSummary(item.error, redact)})});
  };
  if (append) setDiagnosticSink(add);
  const history = {
    id,
    command(id: string, service: string, inspect = true) {command = id; provider = service; inspectResults = inspect;},
    result(value: unknown) {if (append && inspectResults) inspectResult(value, add);},
    fail(error: unknown) {
      if (!append) return;
      try {
        failure = errorSummary(error, redact);
        if (error && typeof error === 'object' && 'result' in error) inspectResult(error.result, add);
      } catch {failure = {message: 'Command failed; error details could not be inspected.'};}
    },
    settled() {settled = true;},
    finish(exitCode: number) {
      if (finished) return;
      finished = true;
      write({event: 'finish', durationMs: Math.round(performance.now() - start), exitCode,
        outcome: exitCode !== 0 || failure || !settled ? 'hard_failure' : diagnostics.length ? 'soft_failure' : 'success',
        settled, ...(failure ? {error: failure} : {}), diagnostics, droppedDiagnostics});
      setDiagnosticSink(undefined);
    },
  };
  return history;
}
