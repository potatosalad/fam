import {InputError} from '../shared/input-error.js';
import {contracts} from './generated/schema.js';
import type {OperationContract, WireType} from './contract-types.js';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

/** Accept lossless integer IDs and search years; names, free text and unknown fields stay strict. */
export function normalizeOperationInput(contract: OperationContract, supplied: unknown): unknown {
  function walk(value: unknown, type: WireType, path: string, depth = 0): unknown {
    if (depth > 64) throw new InputError('Input exceeds 64 nested levels.');
    if (type.kind === 'string' && (/(?:^|\.)(?:id|pid|[A-Za-z]+Id)$/.test(path) || /\.year\.value$/.test(path)) && (typeof value === 'number' || typeof value === 'bigint')) {
      if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new InputError(`Invalid ${path}: use an exact integer or a string; unsafe numeric IDs cannot be recovered.`);
      return String(value);
    }
    if (type.kind === 'array' && Array.isArray(value)) return value.map((v, i) => walk(v, type.items, `${path}[${i}]`, depth + 1));
    if (type.kind === 'ref' && object(value)) return Object.fromEntries(Object.entries(value).map(([key, v]) => {
      const field = contracts.models[type.name]?.[key];
      return [key, field ? walk(v, field.type, `${path}.${key}`, depth + 1) : v];
    }));
    return value;
  }
  if (!object(supplied)) return supplied;
  const input = {...supplied};
  for (const parameter of contract.parameters) {
    if (['path', 'body'].includes(parameter.kind) && Object.hasOwn(input, parameter.name))
      input[parameter.name] = walk(input[parameter.name], parameter.type, parameter.name);
  }
  return input;
}

export function createStatus(input: Record<string, any>) {
  const deceased = input.body?.person?.facts?.some((fact: any) => ['Death', 'http://gedcomx.org/Death'].includes(fact?.value?.type)) === true;
  return {status: deceased ? 'deceased' : 'living-by-default', warnings: deceased ? [] : [
    'No Death conclusion is supplied. FamilySearch may create a private Living profile, regardless of birth year. Supply --deceased or an evidence-supported Death fact to create a deceased person.',
  ]};
}

export function declareDeceased(name: string, input: Record<string, any>, deceased: boolean): Record<string, any> {
  if (!deceased) return input;
  if (name !== 'persons.create') throw new InputError('--deceased applies only to persons.create.');
  if (!object(input.body) || !object(input.body.person)) throw new InputError('--deceased requires body.person.');
  if (input.body.person.facts !== undefined && !Array.isArray(input.body.person.facts)) throw new InputError('body.person.facts must be an array.');
  if (createStatus(input).status === 'deceased') return input;
  return {...input, body: {...input.body, person: {...input.body.person, facts: [...(input.body.person.facts ?? []), {value: {type: 'Death'}}]}}};
}
