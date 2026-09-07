import { contracts } from './generated/schema.js';
import type { WireType, OperationContract } from './contract-types.js';
import type { GenealogyApi, OperationName } from './generated/operations.js';
import type { ApiRequest, Query } from './transport-types.js';
import type { FamilySearchClient } from './client.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function fail(path: string, expected: string): never {
  // Include schema locations, never the user's supplied value.
  throw new Error(`Invalid ${path}: expected ${expected}.`);
}

export function validateWire(value: unknown, type: WireType, path = 'body', allowUnknown = false, depth = 0): void {
  if (depth > 64) fail(path, 'an acyclic value no more than 64 levels deep');
  const next = (v: unknown, t: WireType, p: string) => validateWire(v, t, p, allowUnknown, depth + 1);
  switch (type.kind) {
    case 'string': if (typeof value !== 'string') fail(path, 'string'); break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'finite number'); break;
    case 'integer':
      if (typeof value === 'bigint') { if (value < -(1n << 63n) || value >= (1n << 63n)) fail(path, 'signed 64-bit integer'); }
      else if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(path, 'safe integer or bigint');
      break;
    case 'boolean': if (typeof value !== 'boolean') fail(path, 'boolean'); break;
    case 'void': if (value !== undefined) fail(path, 'no response body'); break;
    case 'binary': if (!(value instanceof Uint8Array)) fail(path, 'bytes'); break;
    case 'upload': if (!(value instanceof FormData || value instanceof Blob || value instanceof Uint8Array || typeof value === 'string')) fail(path, 'FormData, Blob, bytes, or text'); break;
    case 'array':
      if (!Array.isArray(value)) fail(path, 'array');
      value.forEach((item, index) => next(item, type.items, `${path}[${index}]`));
      break;
    case 'record':
      if (!object(value)) fail(path, 'object');
      for (const v of Object.values(value)) next(v, type.values, `${path}.*`);
      break;
    case 'ref': {
      if (!object(value)) fail(path, 'object');
      const fields = contracts.models[type.name];
      if (!fields) throw new Error('Missing generated wire model.');
      for (const [name, f] of Object.entries(fields)) {
        const item = value[name];
        if (item === undefined) { if (f.required) fail(`${path}.${name}`, 'required field'); }
        else if (item === null && f.nullable) continue;
        else next(item, f.type, `${path}.${name}`);
      }
      if (!allowUnknown && Object.keys(value).some(name => !Object.hasOwn(fields, name))) fail(path, 'only documented fields');
      break;
    }
    case 'json':
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') break;
      if (typeof value === 'number' && Number.isFinite(value)) break;
      if (Array.isArray(value)) { value.forEach(v => next(v, type, `${path}[]`)); break; }
      if (object(value)) { Object.values(value).forEach(v => next(v, type, `${path}.*`)); break; }
      fail(path, 'JSON value');
  }
}

export function operationContract(name: string): OperationContract {
  if (!Object.hasOwn(contracts.operations, name)) throw new Error('Unknown genealogy operation. Use the operations catalog.');
  // Return a copy so caller edits cannot change credential-bearing request routes.
  return structuredClone(contracts.operations[name]);
}
export function listOperations(prefix = ''): OperationContract[] {
  return Object.keys(contracts.operations).filter(name => name.startsWith(prefix)).map(operationContract);
}

/** Illustrative, schema-valid input. Placeholder values still need real IDs/data. */
export function operationExample(name: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const sample = (type: WireType, key: string, seen = new Set<string>()): unknown => {
    switch (type.kind) {
      case 'string': return /^(pid|personId)$/i.test(key) ? 'XXXX-XXX' : /url|uri/i.test(key) ? 'https://www.familysearch.org/ark:/61903/1:1:EXAMPLE' : `<${key}>`;
      case 'boolean': return false;
      case 'integer': case 'number': return 1;
      case 'array': return [];
      case 'record': case 'json': return {};
      case 'void': return undefined;
      case 'binary': return new Uint8Array();
      case 'upload': return '<upload text; use the TypeScript client for binary/FormData>';
      case 'ref': {
        if (seen.has(type.name)) throw new Error('Cannot generate a finite example for this recursive required model.');
        const next = new Set([...seen, type.name]);
        const fields = contracts.models[type.name];
        return Object.fromEntries(Object.entries(fields).filter(([, f]) => f.required).map(([k, f]) => [k, f.nullable ? null : sample(f.type, k, next)]));
      }
    }
  };
  for (const p of operationContract(name).parameters) {
    const value = sample(p.type, p.name);
    if (p.kind === 'query' || p.kind === 'header') {
      const group = p.kind === 'query' ? 'query' : 'headers';
      ((result[group] ??= {}) as Record<string, unknown>)[p.name] = value;
    } else result[p.name] = value;
  }
  return result;
}

/** Query flags retain strings (including leading zeros) and use the wire schema for scalars. */
export function operationQueryInput(name: string, supplied: unknown, flags: string[]): Record<string, unknown> {
  if (!object(supplied)) fail('input', 'object');
  const input = structuredClone(supplied);
  if (input.query !== undefined && !object(input.query)) fail('query', 'object');
  const query: Record<string, unknown> = { ...(input.query as Record<string, unknown> ?? {}) };
  for (const flag of flags) {
    const split = flag.indexOf('=');
    if (split < 1) throw new Error('--query requires parameter=value.');
    const key = flag.slice(0, split), text = flag.slice(split + 1);
    const parameter = operationContract(name).parameters.find(p => p.kind === 'query' && p.name === key);
    if (!parameter) throw new Error(`Unknown query parameter. Use "fam familysearch.api describe --operation ${name}".`);
    if (Object.hasOwn(query, key)) throw new Error(`Query parameter ${key} was supplied more than once.`);
    let value: unknown = text;
    if (parameter.type.kind === 'boolean') {
      if (!['true','false'].includes(text)) throw new Error(`Query parameter ${key} requires true or false.`);
      value = text === 'true';
    } else if (parameter.type.kind === 'integer') {
      if (!/^-?\d+$/.test(text)) throw new Error(`Query parameter ${key} requires an integer.`);
      value = BigInt(text);
      if (Number.isSafeInteger(Number(value))) value = Number(value);
    } else if (parameter.type.kind === 'number') {
      if (!text.trim()) throw new Error(`Query parameter ${key} requires a number.`);
      value = Number(text);
    } else if (parameter.type.kind !== 'string') throw new Error(`Query parameter ${key} requires JSON input; use --input FILE.`);
    validateWire(value, parameter.type, `query.${key}`);
    query[key] = value;
  }
  if (flags.length) input.query = query;
  return input;
}
/** Optional drift check. Unknown response fields are deliberately accepted. */
export function validateOperationResponse(name: OperationName, data: unknown): void {
  if (data === undefined && operationContract(name).responseOptional) return;
  validateWire(data, operationContract(name).response, 'response', true);
}

/** Moshi's string reader accepts numeric tokens. Match that behavior for typed responses,
 * while preserving extra server fields and leaving request bodies strictly typed. */
export function decodeOperationResponse(name: OperationName, data: unknown): unknown {
  const contract = operationContract(name);
  if (data === undefined && contract.response.kind !== 'void' && !contract.responseOptional) throw new Error(`Unexpected empty response for ${name}.`);
  function decode(value: unknown, type: WireType): unknown {
    if (value == null) return value;
    if (type.kind === 'string' && (typeof value === 'number' || typeof value === 'bigint')) return String(value);
    if ((type.kind === 'integer' || type.kind === 'number') && typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)) {
      if (type.kind === 'integer' && /^-?\d+$/.test(value) && !Number.isSafeInteger(Number(value))) return BigInt(value);
      return Number(value);
    }
    if (type.kind === 'array' && Array.isArray(value)) return value.map(v => decode(v, type.items));
    if (type.kind === 'record' && object(value)) return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,decode(v,type.values)]));
    if (type.kind === 'ref' && object(value)) {
      const result = { ...value };
      for (const [key, field] of Object.entries(contracts.models[type.name])) if (Object.hasOwn(value, key)) result[key] = decode(value[key], field.type);
      return result;
    }
    return value;
  }
  return decode(data, contract.response);
}

export function prepareOperation(name: OperationName, supplied: unknown): { path: string; options: ApiRequest } {
  const contract = operationContract(name);
  const input = supplied === undefined ? {} : supplied;
  if (!object(input)) fail('input', 'object');
  const allowed = new Set(['query', 'headers', ...contract.parameters.filter(p => p.kind === 'path' || p.kind === 'body').map(p => p.name)]);
  for (const key of Object.keys(input).filter(k => !allowed.has(k))) {
    const parameter = contract.parameters.find(p => p.name === key && (p.kind === 'query' || p.kind === 'header'));
    if (parameter) throw new Error(`Invalid input: ${parameter.name} belongs under ${parameter.kind === 'query' ? 'query' : 'headers'}. Use "fam familysearch.api describe --operation ${name} --example" for the correct nesting.`);
    fail('input', 'documented input properties');
  }
  for (const kind of ['query', 'headers']) {
    if (input[kind] !== undefined && !object(input[kind])) fail(kind, 'object');
    const allowedNames = new Set(contract.parameters.filter(p => p.kind === (kind === 'headers' ? 'header' : 'query')).map(p => p.name));
    if (Object.keys(input[kind] ?? {}).some(k => !allowedNames.has(k))) fail(kind, 'documented parameter names');
  }
  let path = contract.path;
  const headers: Record<string, string> = { ...contract.defaultHeaders };
  for (const line of contract.staticHeaders) { const i = line.indexOf(':'); headers[line.slice(0, i)] = line.slice(i + 1).trim(); }
  const query: Query = {};
  let body: unknown;
  let raw = false;
  for (const p of contract.parameters) {
    const value = p.kind === 'query' ? (input.query as Record<string, unknown> | undefined)?.[p.name]
      : p.kind === 'header' ? (input.headers as Record<string, unknown> | undefined)?.[p.name] : input[p.name];
    if (value === undefined) { if (p.required) fail(p.name, 'required parameter'); continue; }
    validateWire(value, p.type, p.kind === 'body' ? 'body' : `${p.kind}.${p.name}`);
    if (p.kind === 'path') {
      // Encoded traversal and separators are rejected, including when the APK accepts encoded paths.
      if (!String(value) || /[\\/\u0000-\u001f]/.test(String(value)) || /^(\.|\.\.)$/.test(String(value)) || /%(?:2e|2f|5c)/i.test(String(value))) fail(`path.${p.name}`, 'one nonempty, unescaped path segment');
      path = path.replaceAll(`{${p.name}}`, encodeURIComponent(String(value)));
    } else if (p.kind === 'query') query[p.name] = value as Query[string];
    else if (p.kind === 'header') {
      if (/[\r\n]/.test(String(value))) fail(`header.${p.name}`, 'a single-line header value');
      // The APK's genealogy repositories use Java URLEncoder for X-Reason.
      headers[p.name] = p.name === 'X-Reason' ? new URLSearchParams({ reason: String(value) }).toString().slice(7) : String(value);
    }
    else if (p.kind === 'body') { body = value; raw = p.type.kind === 'upload'; }
    else throw new Error('Unsupported parameter annotation.');
  }
  if (/\{[^}]+\}/.test(path)) throw new Error('Unresolved operation path parameter.');
  if (name === 'memories.replaceFile') {
    if (typeof body !== 'string') fail('body', 'story text');
    raw = true;
  }
  return { path, options: { method: contract.method, query, headers, body, encoding: raw ? 'raw' : 'json',
    response: contract.response.kind === 'void' ? 'void' : contract.response.kind === 'binary' ? 'binary' : 'json' } };
}

export function createGenealogyApi(client: FamilySearchClient): GenealogyApi {
  const groups: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};
  for (const name of Object.keys(contracts.operations) as OperationName[]) {
    const [group, method] = name.split('.');
    (groups[group] ??= {})[method] = (input?: unknown) => client.operation(name, input as any);
  }
  return groups as GenealogyApi;
}
