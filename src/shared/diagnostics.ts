/** Explicit diagnostics are inert for library callers; only the CLI installs a sink. */
export interface Diagnostic {
  code: string;
  message: string;
  path?: string;
  error?: unknown;
}
let sink: ((diagnostic: Diagnostic) => void) | undefined;
export function setDiagnosticSink(next?: (diagnostic: Diagnostic) => void): void {sink = next;}
export function reportDiagnostic(code: string, message: string, error?: unknown): void {
  try {sink?.({code, message, error});} catch { /* Diagnostics must not change provider behavior. */ }
}

/** Inspect explicit failure markers, never infer failure from empty data or pagination. */
export function inspectResult(value: unknown, emit = sink): void {
  if (!emit) return;
  const seen = new WeakSet<object>();
  let remaining = 10_000;
  const walk = (item: unknown, path: string, depth: number): void => {
    if (!item || typeof item !== 'object' || ArrayBuffer.isView(item) || seen.has(item)) return;
    if (--remaining < 0 || depth > 20) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length && remaining > 0; i++) walk(item[i], `${path}[${i}]`, depth + 1);
      return;
    }
    const record = item as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const lower = key.toLowerCase(), location = `${path}.${key}`;
      if (['error', 'errors', 'warning', 'warnings'].includes(lower) && child
          && (!Array.isArray(child) || child.length > 0)) {
        const entries = Array.isArray(child) ? child : [child];
        for (const entry of entries.slice(0, 32)) {
          emit({code: lower.startsWith('warn') ? 'RESULT_WARNING' : 'RESULT_ERROR', path: location,
            message: lower.startsWith('warn') ? 'Provider returned a warning.' : 'Provider returned an error.', error: entry});
        }
        continue;
      }
      if ((['ok', 'success'].includes(lower) && child === false)
          || lower === 'status' && typeof child === 'string' && /^(error|failed|failure|warning|partial)$/i.test(child)
          || lower === 'partial' && child === true) {
        emit({code: 'RESULT_FAILURE', message: `Provider reported ${lower}=${String(child)}.`, path: location,
          error: typeof record.message === 'string' ? {message: record.message, code: record.code} : undefined});
      }
      // Bodies, headers and auth objects are not diagnostic containers.
      if (!/password|token|cookie|secret|credential|authorization|headers|body/i.test(key)) walk(child, location, depth + 1);
    }
  };
  try {walk(value, '$', 0);}
  catch {reportDiagnostic('DIAGNOSTIC_INSPECTION_FAILED', 'Could not inspect the entire result for diagnostics.');}
}
