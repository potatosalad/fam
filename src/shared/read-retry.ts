import {setTimeout as delay} from 'node:timers/promises';
import {reportDiagnostic} from './diagnostics.js';

let policy: {failFast?: boolean; progress?: (message: string) => void} = {};
export function setReadRetryPolicy(value: typeof policy = {}): void {policy = value;}

export function transientConnectionError(error: unknown, depth = 0): boolean {
  if (!(error instanceof Error) || depth > 5 || error.name === 'AbortError') return false;
  if (/^(TimeoutError|ConnectTimeout|ReadTimeout|PoolTimeout|NetworkError|ConnectError|ReadError|CloseError|RemoteProtocolError)$/.test(error.name)) return true;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/.test(code)) return true;
  return error.cause ? transientConnectionError(error.cause, depth + 1) : error instanceof TypeError && error.message === 'fetch failed';
}
export function retryDelay(value: string | null, attempt: number, now = Date.now()): number {
  const seconds = value !== null && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : value ? Date.parse(value) - now : NaN;
  return Number.isFinite(requested) ? Math.max(0, requested) : 500 * 2 ** attempt + Math.floor(Math.random() * 250);
}
type ReadResponse = Pick<Response, 'status' | 'headers'> & {body?: ReadableStream<Uint8Array> | null};
interface Options {enabled?: boolean; signal?: AbortSignal | null; sleep?: (ms: number) => Promise<void>}

/** Retry one read request, never a whole command or an ambiguous write. */
export async function retryRead<T extends ReadResponse>(provider: string, send: () => Promise<T>, options: Options = {}): Promise<T> {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    let response: T | undefined, failure: unknown;
    try {
      response = await send();
      if (![429,502,503,504].includes(response.status)) return response;
    } catch (error) {
      if (!transientConnectionError(error)) throw error;
      failure = error;
    }
    const ms = retryDelay(response?.headers.get('retry-after') ?? null, attempt);
    if (policy.failFast || options.enabled === false || attempt >= 2 || options.signal?.aborted || ms > 30_000 - waited) {
      if (response) return response;
      throw failure;
    }
    await response?.body?.cancel();
    const reason = response ? `HTTP ${response.status}` : 'temporary connection failure';
    const message = `${provider}: ${reason}; retrying in ${(ms / 1000).toFixed(2)}s (attempt ${attempt + 2}/3)`;
    reportDiagnostic('HTTP_RETRY', message);
    try {policy.progress?.(message);} catch { /* Progress cannot change the request outcome. */ }
    if (options.sleep) await options.sleep(ms);
    else await delay(ms, undefined, {signal: options.signal ?? undefined});
    waited += ms;
  }
}
