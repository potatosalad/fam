import { ORIGIN } from './http.js';
import type { ApiRequest, HttpMethod, Query } from '../familysearch/transport-types.js';

export interface RestOperation {name: string; method: HttpMethod; path: string; write: boolean; source: string; query?: readonly string[]; body?: 'json' | 'form'; defaults?: Query;}
const route = (name: string, method: HttpMethod, path: string, source: string, options: Partial<RestOperation> = {}): RestOperation =>
  ({name, method, path, write: method !== 'GET', source: `analysis/findagrave/smali/smali/t9.smali#${source}`, ...options});
// Paths/verbs/query bindings checked against t9's Ktor request builders in smali.
export const restOperations: RestOperation[] = [
  route('requests.claimed', 'GET', '/photo-request/requests-claimed', 'A', {query: ['sortBy','limit','skip']}),
  route('requests.mine', 'GET', '/photo-request/my-requests', 'B', {query: ['type','sortBy','limit','skip']}),
  route('requests.nearby', 'GET', '/photo-request/location/current/{latitude}/{longitude}', 'C', {query: ['sortBy','limit','skip','searchRadius']}),
  route('requests.volunteer', 'GET', '/photo-request/volunteer-cemeteries', 'F', {query: ['sortBy','limit','skip']}),
  route('virtual-cemeteries.exclude-memorial', 'GET', '/memorial/virtual-cemetery/exclude/{memorialId}', 'G', {query: ['skip','limit']}),
  route('virtual-cemeteries.for-memorial', 'GET', '/memorial/virtual-cemetery', 'H', {query: ['skip','limit','memorialId']}),
  route('cemetery.plots', 'GET', '/memorialPlot/{cemeteryId}', 'K', {query: ['geoHash']}),
  route('cemetery.geohashes', 'GET', '/memorialPlot/{cemeteryId}', 'L', {defaults: {summary: true}}),
  route('virtual-cemetery.remove-memorial', 'POST', '/virtual-cemetery/remove-memorial', 'Q', {body: 'json'}),
  route('my-cemetery.remove', 'GET', '/my-cemetery/{cemeteryId}/remove', 'R', {write: true}),
  route('request.report-problem', 'POST', '/photo-request/{requestId}/report-problem', 'T', {body: 'json'}),
  route('photo.rotate', 'PUT', '/photo/rotate', 'U', {body: 'json'}),
  route('requests.contributor', 'GET', '/photo-request/search/contributor/{contributorId}', 'W', {query: ['limit','skip','includeProblems','sortBy']}),
  route('memorial.find-similar', 'POST', '/memorial/find-similar', 'a', {write: false, body: 'json'}),
  route('memorial.request-photo', 'POST', '/memorial/{memorialId}/photo-request', 'b', {body: 'json'}),
  route('account.forgot-password', 'POST', '/forgot-password', 'b0', {body: 'json'}),
  route('friend.toggle', 'POST', '/user/friend/add-remove', 'c', {body: 'json'}),
  route('memorial.set-profile-photo', 'POST', '/memorial/set-profile-photo', 'c0', {body: 'json'}),
  route('virtual-cemetery.toggle-memorial', 'POST', '/memorial/virtual-cemetery/toggle', 'f0', {body: 'form'}),
  route('request.unclaim', 'GET', '/photo-request/{requestId}/unclaim', 'g0', {write: true}),
  route('account.change-email', 'POST', '/change-email', 'h', {body: 'json'}),
  route('account.update-activity', 'POST', '/user/update-activity', 'i0'),
  route('request.claim', 'GET', '/photo-request/{requestId}/claim', 'j', {write: true}),
  route('memorial.update', 'POST', '/memorial/update-memorial/{memorialId}', 'j0', {body: 'json'}),
  route('account.create', 'POST', '/m/create-account', 'k', {body: 'json'}),
  route('account.change-password', 'POST', '/change-password', 'l0', {body: 'json'}),
  route('my-cemetery.add', 'GET', '/my-cemetery/create/{cemeteryId}', 'm', {write: true}),
  route('photo.update', 'POST', '/memorial/update-photo', 'm0', {body: 'json'}),
  route('virtual-cemetery.create', 'POST', '/virtual-cemetery/create', 'n', {body: 'json'}),
  route('virtual-cemetery.update', 'POST', '/virtual-cemetery/update', 'n0', {body: 'json'}),
  route('memorial.delete', 'POST', '/memorial/delete-memorial/{memorialId}/{cemeteryId}', 'p'),
  route('photo.delete', 'POST', '/memorial/delete-photo', 'q', {body: 'json'}),
  route('request.delete', 'GET', '/photo-request/{requestId}/delete', 'r', {write: true}),
  route('virtual-cemetery.delete', 'DELETE', '/virtual-cemetery/{virtualCemeteryId}', 's'),
  route('memorial.create', 'POST', '/memorial/create', 'w', {body: 'json'}),
  route('requests.cemetery', 'GET', '/photo-request/search/cemetery/{cemeteryId}', 'x', {query: ['sortBy','limit','skip','includeProblems'], defaults: {ajax: true}}),
];
export interface RestArguments {path?: Record<string, string | number>; query?: Query; body?: unknown;}
export function restOperation(name: string) {
  const op = restOperations.find(o => o.name === name);
  if (!op) throw new Error(`Unknown REST operation ${name}; use fam findagrave ops.`);
  return op;
}
export function prepareRest(name: string, input: RestArguments = {}) {
  const op = restOperation(name);
  for (const key of Object.keys(input)) if (!['path','query','body'].includes(key)) throw new Error(`Unexpected REST input ${key}.`);
  const pathKeys = [...op.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]!);
  for (const key of Object.keys(input.path ?? {})) if (!pathKeys.includes(key)) throw new Error(`Unknown path parameter ${key}.`);
  const path = op.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = input.path?.[key];
    if (value == null || !String(value) || ['.','..'].includes(String(value))) throw new Error(`Missing or invalid path parameter ${key}.`);
    return encodeURIComponent(String(value));
  });
  for (const key of Object.keys(input.query ?? {})) if (!op.query?.includes(key)) throw new Error(`Unknown query parameter ${key}.`);
  if (Boolean(op.body) !== (input.body !== undefined)) throw new Error(op.body ? `${name} requires body.` : `${name} does not take body.`);
  let body = input.body, headers: Record<string,string> | undefined;
  if (op.body === 'form') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Form body must be an object.');
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (!['string','number','boolean'].includes(typeof value)) throw new Error('Form values must be scalar.');
      form.set(key, String(value));
    }
    body = form.toString(); headers = {'Content-Type': 'application/x-www-form-urlencoded'};
  }
  return {op, url: ORIGIN + path, options: {method: op.method, query: {...op.defaults, ...input.query}, headers, body,
    encoding: op.body === 'form' ? 'raw' : 'json'} as ApiRequest};
}
