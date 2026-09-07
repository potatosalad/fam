import { contracts } from './generated/contracts.js';
import { checkMyHeritageUrl } from './http.js';
import type { ApiRequest, HttpMethod, Query } from '../familysearch/transport-types.js';
export { contracts };
export type GraphQLOperation = typeof contracts.graphql[number];
export type GraphQLId = GraphQLOperation['id'];
type Scalar<T extends string> = T extends `${infer S}!` ? Scalar<S> : T extends `[${infer S}]` ? Scalar<S>[] :
  T extends 'Int' | 'Float' ? number : T extends 'BigInt' ? bigint | number | string : T extends 'Boolean' ? boolean :
  T extends 'String' | 'ID' ? string : Record<string, unknown>;
export type Variables<I extends GraphQLId, V extends {name: string; type: string; required: boolean} = Extract<GraphQLOperation, {id: I}>['variables'][number]> =
  {[P in V as P['required'] extends true ? P['name'] : never]: Scalar<P['type']>} &
  {[P in V as P['required'] extends false ? P['name'] : never]?: Scalar<P['type']> | null};
export const aliases = {
  'me': 'com.myheritage.coreinfrastructure.user.service.UserApiService.getUser',
  'site': 'com.myheritage.coreinfrastructure.site.service.SiteApiService.getSite',
  'tree': 'air.com.myheritage.mobile.common.dal.site.network.TreeApiService.getTree',
  'person': 'com.myheritage.coreinfrastructure.individual.service.IndividualApiService.getIndividual',
  'person.add': 'air.com.myheritage.mobile.common.dal.individual.network.MHIndividualApiService.addIndividual',
  'person.update': 'air.com.myheritage.mobile.common.dal.individual.network.MHIndividualApiService.updateIndividual',
  'person.delete': 'air.com.myheritage.mobile.common.dal.individual.network.MHIndividualApiService.deleteIndividual',
  'family': 'air.com.myheritage.mobile.common.dal.individual.network.FamilyApiInterface.getFamily',
  'events': 'air.com.myheritage.mobile.common.dal.individual.network.MHIndividualApiService.getIndividualEvents',
  'event.add': 'air.com.myheritage.mobile.common.dal.event.network.EventApiService.addEvent',
  'event.update': 'air.com.myheritage.mobile.common.dal.event.network.EventApiService.editEvent',
  'event.delete': 'air.com.myheritage.mobile.common.dal.event.network.EventApiService.deleteEvent',
  'matches': 'air.com.myheritage.mobile.common.dal.match.network.DiscoveriesApiService.getMatchesForIndividual',
  'match': 'air.com.myheritage.mobile.common.dal.match.network.MatchApiInterface.getSmartMatch',
  'match.update': 'air.com.myheritage.mobile.common.dal.match.network.DiscoveriesApiService.editMatch',
  'discoveries': 'air.com.myheritage.mobile.common.dal.match.network.DiscoveriesApiService.getDiscoveries',
  'media': 'com.myheritage.coreinfrastructure.media.services.MediaApiService.getParentMedia',
  'tags': 'com.myheritage.coreinfrastructure.media.services.MediaApiService.getTags',
  'tree.add': 'com.myheritage.coreinfrastructure.site.service.TreeApiService.addTree',
} as const;
export function graphqlOperation(name: string): GraphQLOperation {
  const exact = contracts.graphql.find(op => op.id === name);
  if (exact) return exact;
  const matches = contracts.graphql.filter(op => op.name === name);
  if (matches.length === 1) return matches[0]!;
  throw new Error(matches.length ? `Ambiguous operation ${name}; use its full ID from fam myheritage ops.` : `Unknown operation ${name}; use fam myheritage ops.`);
}
export function validateVariables(operation: GraphQLOperation, variables: Record<string, unknown>): void {
  for (const v of operation.variables) {
    const value = variables[v.name];
    if (v.required && value == null) throw new Error(`${operation.id} requires ${v.name}: ${v.type}.`);
    if (value == null) continue;
    const type = v.type.replace(/!$/, '');
    if (type === 'String' && typeof value !== 'string' || type === 'Boolean' && typeof value !== 'boolean' ||
        type.startsWith('[') && !Array.isArray(value) || type === 'BigInt' && !((typeof value === 'number' && Number.isSafeInteger(value)) || typeof value === 'bigint' || typeof value === 'string' && /^-?\d+$/.test(value))) {
      throw new Error(`Invalid ${v.name}; expected ${v.type}.`);
    }
  }
  for (const name of Object.keys(variables)) if (!operation.variables.some(v => v.name === name)) throw new Error(`Unknown variable ${name} for ${operation.id}.`);
}
export function restOperation(name: string) {
  const alias = aliases[name as keyof typeof aliases];
  const id = alias ? `rest.${alias}` : name;
  const op = contracts.rest.find(op => op.id === id);
  if (!op) throw new Error(`Unknown REST operation ${name}; use fam myheritage ops.`);
  return op;
}
export interface RestArguments {
  path?: Record<string, string | number | bigint>; query?: Query; headers?: Record<string, string>;
  body?: unknown; url?: string; response?: ApiRequest['response'];
}
export function prepareRest(name: string, args: RestArguments = {}): {url: string; options: ApiRequest; anonymous?: boolean} {
  const op = restOperation(name);
  const path = op.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = args.path?.[key];
    if (value == null || !String(value) || ['.', '..'].includes(String(value))) throw new Error(`Missing or invalid path parameter ${key}.`);
    return encodeURIComponent(String(value));
  });
  const dynamic = op.parameters.some(p => p.kind === 'Url');
  if (dynamic && !args.url) throw new Error(`${name} requires url.`);
  if (!dynamic && args.url) throw new Error('url is only accepted by dynamic URL declarations.');
  const url = new URL(dynamic ? args.url! : path, op.base!);
  const anonymous = dynamic && (op.owner.endsWith('/FileDownloadApi') || op.owner.endsWith('/UploadMediaItemInterface'));
  if (anonymous) {if (url.protocol !== 'https:' || url.username || url.password) throw new Error('File transfers require HTTPS without embedded credentials.');}
  else checkMyHeritageUrl(url);
  const headers: Record<string, string> = {...op.headers, ...args.headers};
  if (args.body !== undefined && op.encoding !== 'multipart' && !op.parameters.some(p => p.kind === 'Body' || p.kind === 'FieldMap')) throw new Error(`${name} does not declare a request body.`);
  let body = args.body, encoding: ApiRequest['encoding'] = 'json';
  if (op.parameters.some(p => p.kind === 'Body' || p.kind === 'FieldMap') && body === undefined) throw new Error(`${name} requires body; use fam myheritage schema ${name}.`);
  if (op.encoding === 'form') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Form body must be an object.');
    body = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded'; encoding = 'raw';
  } else if (op.encoding === 'multipart') {
    if (!(body instanceof FormData)) throw new Error('Multipart operations require FormData (CLI: a parts object with file or value entries).');
    encoding = 'raw';
  } else if (dynamic && body !== undefined) encoding = 'raw';
  return {url: url.href, anonymous, options: {method: op.method as HttpMethod, query: args.query, headers, body, encoding, response: args.response ?? (anonymous ? op.method === 'PUT' ? 'void' : 'binary' : op.path.includes('/Mobile/') || op.path.includes('reportEvent.php') ? 'text' : 'json')}};
}
