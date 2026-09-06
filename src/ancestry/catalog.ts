import { contracts } from './generated/contracts.js';
import { GATEWAY, checkAncestryUrl } from './http.js';
import type { ApiRequest, HttpMethod, Query } from '../transport-types.js';

export { contracts };
export const aliases = {
  'trees.get': 'TreeIOApi.a', 'trees.members': 'TreeIOApi.u', 'trees.invitees': 'TreeIOApi.n',
  'persons.get': 'TreeIOApi.o', 'persons.batch': 'TreeIOApi.A', 'persons.list': 'TreeIOApi.i',
  'persons.pedigree': 'TreeIOApi.t', 'persons.relationships': 'TreeIOApi.x', 'persons.weblinks': 'TreeIOApi.l',
  'persons.research': 'TimelineApi.m', 'persons.story': 'TimelineApi.b', 'persons.familySources': 'TimelineApi.d',
  'media.forPerson': 'TreeIOApi.j', 'media.forTree': 'TreeIOApi.g', 'media.forAlbum': 'TreeIOApi.r', 'media.deleted': 'TreeIOApi.c',
  'citations.count': 'TreeIOApi.k', 'sync.persons': 'TreeIOApi.z', 'sync.citations': 'TreeIOApi.d',
  'sync.sources': 'TreeIOApi.h', 'sync.counts': 'TreeIOApi.y', 'sync.deletedPersons': 'TreeIOApi.w', 'sync.deletedCitations': 'TreeIOApi.s',
  'cache.tree': 'Pm3CacheApi.f', 'cache.persons': 'Pm3CacheApi.b', 'cache.personCount': 'Pm3CacheApi.a',
  'cache.citations': 'Pm3CacheApi.c', 'cache.citationCount': 'Pm3CacheApi.e', 'cache.sources': 'Pm3CacheApi.i',
  'cache.sourceCount': 'Pm3CacheApi.g', 'cache.media': 'Pm3CacheApi.h', 'cache.mediaCount': 'Pm3CacheApi.d',
  'records.get': 'RecordApi.f', 'records.fields': 'RecordApi.e', 'records.image': 'RecordApi.c',
  'records.imageData': 'RecordApi.d', 'records.hasDocuments': 'RecordApi.a',
  'collections.text': 'CollectionApi.a', 'collections.facets': 'CollectionApi.d',
  'places.search': 'AncestryApi.x', 'places.get': 'AncestryApi.k',
  'search.records': 'rest.zk0.m0.b', 'search.count': 'rest.zk0.m0.a', 'search.personContext': 'rest.zk0.m0.c',
  'hints.counts': 'rest.zk0.z.b', 'hints.forPerson': 'rest.zk0.z.c', 'hints.forTree': 'rest.zk0.z.f',
} as const;
export type RestAlias = keyof typeof aliases;
export type GraphQLOperation = typeof contracts.graphql[number];
export type GraphQLName = GraphQLOperation['name'];
type Scalar<T extends string> = T extends `${infer S}!` ? Scalar<S> : T extends `[${infer S}]` ? Scalar<S>[] :
  T extends 'Int' | 'Float' ? number : T extends 'Long' ? bigint | number | string : T extends 'Boolean' ? boolean :
  T extends 'ID' | 'UUID' | 'String' ? string : unknown;
export type Variables<N extends GraphQLName, V extends {name: string; type: string; required: boolean} = Extract<GraphQLOperation, {name: N}>['variables'][number]> =
  {[P in V as P['required'] extends true ? P['name'] : never]: Scalar<P['type']>} &
  {[P in V as P['required'] extends false ? P['name'] : never]?: Scalar<P['type']> | null};
export function graphqlOperation(name: string): GraphQLOperation {
  const operation = contracts.graphql.find(op => op.name === name || op.id === name);
  if (!operation) throw new Error(`Unknown GraphQL operation: ${name}. Use ancestry ops.`);
  return operation;
}
export function validateVariables(operation: GraphQLOperation, variables: Record<string, unknown>): void {
  for (const variable of operation.variables) {
    if (variable.required && variables[variable.name] == null) throw new Error(`${operation.name} requires ${variable.name}: ${variable.type}.`);
  }
  for (const name of Object.keys(variables)) {
    if (!operation.variables.some(v => v.name === name)) throw new Error(`Unknown variable ${name} for ${operation.name}.`);
  }
}
export function restOperation(name: string) {
  const alias = aliases[name as RestAlias];
  const id = alias ? alias.startsWith('rest.') ? alias : `rest.com.ancestry.service.apis.${alias}` : name;
  const operation = contracts.rest.find(op => op.id === id);
  if (!operation) throw new Error(`Unknown REST operation: ${name}. Use ancestry ops.`);
  return operation;
}
export interface RestArguments {
  path?: Record<string, string | number | bigint>;
  query?: Query;
  headers?: Record<string, string>;
  body?: unknown;
  /** Required for declarations without a researched base mapping; only approved Ancestry origins. */
  base?: string;
  response?: ApiRequest['response'];
}
export function prepareRest(name: string, args: RestArguments = {}, userId?: string): {url: string; options: ApiRequest} {
  const operation = restOperation(name);
  // These genealogy interfaces are constructed with the live gateway Retrofit provider.
  const gateway = /^com\/ancestry\/service\/apis\/(TreeIOApi|TimelineApi|Pm3CacheApi|RecordApi|CollectionApi|AncestryApi)$/.test(operation.owner)
    || ['zk0/m0', 'zk0/z'].includes(operation.owner);
  if (!args.base && !gateway) throw new Error('This declaration has no confirmed base mapping; supply base explicitly after checking its APK call site.');
  const base = args.base ?? GATEWAY;
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = args.path?.[key] ?? (/^userid$/i.test(key) ? userId : undefined);
    if (value == null || String(value) === '' || ['.', '..'].includes(String(value))) throw new Error(`Missing or invalid path parameter ${key}.`);
    return encodeURIComponent(String(value));
  });
  const url = new URL(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
  checkAncestryUrl(url);
  const headers: Record<string, string> = {...operation.headers, ...args.headers};
  let body = args.body;
  let encoding: ApiRequest['encoding'] = 'json';
  if (operation.parameters.some(p => p.kind === 'Body' || p.kind === 'FieldMap') && body === undefined) throw new Error(`${name} requires body; inspect ancestry schema ${name}.`);
  if (operation.encoding === 'form') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Form body must be an object.');
    body = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded'; encoding = 'raw';
  }
  return {url: url.href, options: {method: operation.method as HttpMethod, query: args.query, headers, body, encoding, response: args.response}};
}
