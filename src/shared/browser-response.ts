import {BrowserError} from './browser-config.js';

/** Browser engines can join repeated response values with LF, including Set-Cookie. */
export function browserResponseHeaders(input: unknown): [string, string][] {
  const result: [string, string][] = [];
  try {
    // Older browser services returned a header object rather than pairs.
    const entries = input && typeof input === 'object' && !Array.isArray(input) ? Object.entries(input) : input;
    if (!Array.isArray(entries)) throw new Error();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || entry.some(value => typeof value !== 'string')) throw new Error();
      const [name, value] = entry as [string, string];
      for (const part of value.split(/\r?\n/)) {
        // Validate each pair without coalescing cookies or interpreting values as names.
        const headers = new Headers([[name, part]]);
        result.push([name.toLowerCase(), headers.get(name)!]);
      }
    }
  } catch {
    throw new BrowserError('The browser returned malformed response headers.', 'BROWSER_RESPONSE_HEADERS');
  }
  return result;
}
