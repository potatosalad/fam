import {parseJson} from '../shared/json.js';
/** Read JSON assigned by a page without evaluating any JavaScript. */
export function pageJson<T = unknown>(html: string, name: string): T | undefined {
  if (!/^\w+$/.test(name)) throw new Error('Invalid page data name.');
  const found = new RegExp(`(?:\\bvar\\s+|\\bwindow\\.)${name}\\s*=\\s*`).exec(html);
  if (!found) return undefined;
  const source = html.slice(found.index + found[0].length);
  if (source.startsWith('JSON.parse(')) {
    const text = source.slice('JSON.parse('.length).trimStart();
    const quote = text[0];
    if (quote !== '"' && quote !== "'") throw new Error('Unsupported page JSON encoding.');
    let decoded = '';
    for (let i = 1; i < text.length; i++) {
      const c = text[i]!;
      if (c === quote) {if (!/^\s*\)\s*;/.test(text.slice(i + 1))) throw new Error('Unexpected expression after page JSON.'); return parseJson(decoded) as T;}
      if (c !== '\\') {decoded += c; continue;}
      const escape = text[++i]!;
      const simple: Record<string, string> = {"'": "'", '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v'};
      if (escape in simple) decoded += simple[escape];
      else if (escape === 'u' || escape === 'x') {
        const length = escape === 'u' ? 4 : 2, code = text.slice(i + 1, i + 1 + length);
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(code)) throw new Error('Invalid page JSON escape.');
        decoded += String.fromCharCode(parseInt(code, 16)); i += length;
      } else throw new Error('Unsupported page JSON escape.');
    }
    throw new Error('Unterminated page JSON string.');
  }
  let quoted = false, escaped = false, depth = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false;}
    else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return parseJson(source.slice(0, i)) as T;
  }
  throw new Error('Unterminated page JSON data.');
}
