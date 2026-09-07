import { readFileSync } from 'node:fs';

export interface Schema {
  $ref?: string; type?: string; format?: string; nullable?: boolean; required?: string[]; enum?: unknown[];
  properties?: Record<string, Schema>; items?: Schema; additionalProperties?: boolean | Schema;
  allOf?: Schema[]; oneOf?: Schema[]; anyOf?: Schema[]; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number;
}
export interface Operation {
  id: string; method: string; path: string; version: string; tags: string[];
  parameters: {name: string; in: 'path' | 'query'; required?: boolean; schema?: Schema}[];
  requestBody: {required: boolean; contentType: string; schema: Schema} | null;
  responses: Record<string, Record<string, Schema>>;
  apkMethods: {name: string; functionId: number}[];
}
export const contracts = JSON.parse(readFileSync(new URL('../../docs/storied/contracts.json', import.meta.url), 'utf8')) as {
  version: number; source: string; operations: Operation[]; models: Record<string, Schema>;
};
export const aliases: Record<string, string> = {
  trees: 'GET /api/Users/trees', tree: 'GET /api/Trees/detail', people: 'GET /api/Trees/{treeId}/listPeople',
  person: 'GET /api/Persons/{personId}/treePersonInfo', pedigree: 'GET /api/Persons/pedigree/{treeId}/{personId}/{generations}',
  family: 'GET /api/Persons/immediatefamily', events: 'GET /api/Persons/{treeId}/{personId}/lifeevents',
  hints: 'GET /api/Persons/{personId}/personhint', records: 'GET /api/Persons/{personId}/savedrecords',
  stories: 'GET /api/Users/{pageNumber}/{pageSize}/authorstories', story: 'GET /api/Story/{storyId}',
  feed: 'GET /api/Users/stories/{pageNumber}/{pageSize}', 'person-stories': 'GET /api/Persons/{personId}/{pageNumber}/{pageSize}/PersonStories',
  comments: 'GET /api/Story/{storyId}/comments/{pageNumber}/{pageSize}',
  media: 'POST /api/v2/Users/media', 'media-item': 'GET /api/Media/{mediaId}',
  groups: 'GET /api/Users/groups', notifications: 'GET /api/Users/notifications/{pageNumber}/{pageSize}',
  subscription: 'GET /api/Users/userSubscriptionDetailsV2', 'recent-people': 'GET /api/Users/recentpeoplecard',
  'home-hints': 'GET /api/Users/homepagehints', 'mobile-version': 'GET /api/Users/mobilesupportedversion',
  search: 'POST /api/search/forms/universal-search', 'search-raw': 'POST /api/HistoricalSearch',
  'find-people': 'GET /api/Users/typeahead/search/{requestId}/page/{pageNumber}/{searchString}',
};
export function operation(name: string): Operation {
  const id = Object.hasOwn(aliases, name) ? aliases[name] : name;
  const matches = contracts.operations.filter(o => o.id === id || o.apkMethods.some(m => m.name === name || `${o.tags[0]}.${m.name}` === name));
  if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous Storied operation; use its complete method and route ID.' : 'Unknown Storied operation. Run fam storied ops.');
  return matches[0];
}
export function model(name: string): Schema {
  const names = Object.keys(contracts.models).filter(n => n === name || n.split('.').at(-1) === name);
  if (names.length !== 1) throw new Error('Unknown or ambiguous model; use the full name from fam storied models.');
  return contracts.models[names[0]];
}

/** Validate primitive wire values without converting exact IDs or inventing defaults. */
export function validate(value: unknown, s: Schema, label: string, depth = 0): void {
  if (depth > 30) throw new Error(`${label} exceeds the supported schema depth.`);
  if (value === null && s.nullable) return;
  if (s.$ref) {
    const key = s.$ref.replace('#/components/schemas/', '');
    if (!Object.hasOwn(contracts.models, key)) throw new Error('Unknown Storied schema reference.');
    validate(value, contracts.models[key], label, depth + 1); return;
  }
  for (const part of s.allOf ?? []) validate(value, part, label, depth + 1);
  // Storied's OpenAPI marks several string enums as type: object. Wire enums are authoritative.
  if (s.enum) {
    if (!s.enum.includes(value)) throw new Error(`${label} is outside the allowed enum values.`);
    return;
  }
  if (s.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) if (!Object.hasOwn(obj, key)) throw new Error(`${label}.${key} is required.`);
    for (const [key, val] of Object.entries(obj)) {
      if (s.properties && Object.hasOwn(s.properties, key)) validate(val, s.properties[key], `${label}.${key}`, depth + 1);
      else if (s.additionalProperties === false) throw new Error(`${label} has an unknown field. Check fam storied schema or model.`);
    }
  }
  if (s.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
    if (s.items) value.forEach(v => validate(v, s.items!, label, depth + 1));
  }
  if (s.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
    if (s.format === 'uuid' && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new Error(`${label} must be a UUID.`);
    if (s.minLength !== undefined && value.length < s.minLength || s.maxLength !== undefined && value.length > s.maxLength) throw new Error(`${label} has an invalid length.`);
  }
  if (s.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  if (s.type === 'integer' && !(typeof value === 'bigint' || typeof value === 'number' && Number.isSafeInteger(value))) throw new Error(`${label} must be an exact integer.`);
  if (s.type === 'number' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error(`${label} must be a number.`);
  if (typeof value === 'number' && (s.minimum !== undefined && value < s.minimum || s.maximum !== undefined && value > s.maximum)) throw new Error(`${label} is out of range.`);
}
