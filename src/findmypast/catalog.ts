import { Kind, parse, type TypeNode } from 'graphql';
import { contracts } from './generated/contracts.js';
import { ASSETS, CONTENT, TITAN, checkFindmypastUrl } from './http.js';
import type { ApiRequest, HttpMethod, Query } from '../transport-types.js';
export { contracts };
export type GraphQLOperation = typeof contracts.graphql[number];
export type GraphQLName = GraphQLOperation['name'];
export const aliases: Record<string, string> = {
  'image.details': 'rest.eh7.b', 'image.coordinates': 'rest.eh7.a', 'newspaper.manifest': 'rest.eh7.c',
  'newspaper.issue': 'rest.eh7.e', 'newspaper.clip': 'rest.eh7.d', 'asset': 'rest.w40.a',
  'assets': 'rest.w40.d', 'asset.create': 'rest.w40.e', 'asset.detach': 'rest.w40.b',
  'asset.profile': 'rest.w40.c', 'content.repository': 'rest.hl0.c',
};
export function graphqlOperation(name: string): GraphQLOperation {
  const op = contracts.graphql.find(op => op.id === name || op.name === name);
  if (!op) throw new Error(`Unknown operation ${name}; use findmypast ops.`);
  return op;
}
export function validateDocument(document: string, variables: Record<string, unknown>, name?: string): string {
  const definitions = parse(document).definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
  const operation = name ? definitions.find(d => d.name?.value === name) : definitions.length === 1 ? definitions[0] : undefined;
  if (!operation?.name) throw new Error('Provide one named GraphQL operation.');
  const valid = (type: TypeNode, value: unknown): boolean => {
    if (type.kind === Kind.NON_NULL_TYPE) return value != null && valid(type.type, value);
    if (value == null) return true;
    if (type.kind === Kind.LIST_TYPE) return Array.isArray(value) && value.every(item => valid(type.type, item));
    switch (type.name.value) {
      case 'String': case 'Date': case 'EmailAddress': return typeof value === 'string';
      case 'ID': return typeof value === 'string' || typeof value === 'bigint' || typeof value === 'number' && Number.isSafeInteger(value);
      case 'Int': return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
      case 'Float': return typeof value === 'number' && Number.isFinite(value);
      case 'Boolean': return typeof value === 'boolean';
      case 'BigInt': return typeof value === 'bigint' || typeof value === 'number' && Number.isSafeInteger(value) || typeof value === 'string' && /^-?\d+$/.test(value);
      default: return typeof value === 'string' || typeof value === 'object' && !Array.isArray(value);
    }
  };
  for (const definition of operation.variableDefinitions ?? []) {
    const key = definition.variable.name.value, value = variables[key];
    if (value === undefined && definition.defaultValue) continue;
    if (!valid(definition.type, value)) throw new Error(`Missing or invalid ${key} for ${operation.name.value}.`);
  }
  for (const key of Object.keys(variables)) {
    if (!operation.variableDefinitions?.some(d => d.variable.name.value === key)) throw new Error(`Unknown variable ${key} for ${operation.name.value}.`);
  }
  return operation.name.value;
}
export function restOperation(name: string) {
  const op = contracts.rest.find(op => op.id === (aliases[name] ?? name));
  if (!op) throw new Error(`Unknown REST operation ${name}; use findmypast ops.`);
  return op;
}
export interface RestArguments { path?: Record<string, string | number | bigint>; query?: Query; headers?: Record<string, string>; body?: unknown; response?: ApiRequest['response']; }
export function prepareRest(name: string, args: RestArguments = {}) {
  const op = restOperation(name);
  const path = op.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = args.path?.[key];
    if (value == null || !String(value) || ['.', '..'].includes(String(value))) throw new Error(`Missing or invalid path parameter ${key}.`);
    return encodeURIComponent(String(value));
  });
  const base = op.owner === 'w40' ? ASSETS : op.owner === 'hl0' ? CONTENT : `${TITAN}/`;
  const url = new URL(path, base); checkFindmypastUrl(url);
  if (Object.keys(args.headers ?? {}).some(key => /^(authorization|cookie|host)$/i.test(key))) throw new Error('Account headers are managed by the client.');
  if (op.parameters.some(p => p.kind === 'Header' && p.name === 'x-signature')) throw new Error('Signed anonymous telemetry is cataloged only; use an authenticated declaration.');
  if (op.parameters.some(p => p.kind === 'Body') && args.body === undefined) throw new Error(`${name} requires body.`);
  if (args.body !== undefined && !op.parameters.some(p => p.kind === 'Body' || p.kind === 'Part')) throw new Error(`${name} does not declare a body.`);
  if (op.encoding === 'multipart' && !(args.body instanceof FormData)) throw new Error('Multipart operation requires FormData (CLI: parts input).');
  const options: ApiRequest = {method: op.method as HttpMethod, query: args.query, headers: args.headers,
    body: args.body, encoding: op.encoding === 'multipart' ? 'raw' : 'json', response: args.response};
  return {url: url.href, options, anonymous: op.owner === 'hl0'};
}
