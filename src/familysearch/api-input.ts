import {resolve} from 'node:path';
import {readCommandFile, readCommandStdin} from '../shared/command-input.js';
import {parseJson} from '../shared/json.js';
import {InputError} from '../shared/input-error.js';
import {operationQueryInput, prepareOperation} from './operations.js';
import type {OperationName} from './generated/operations.js';
import {createStatus, declareDeceased} from './input-normalization.js';

/** Shared by execution and dry-run; never opens a session or contacts a provider. */
export async function prepareApiInput(name: string, source?: string, query: string[] = [], options: {deceased?: boolean} = {}) {
  const text = source === '-' ? await readCommandStdin(16 * 1024 * 1024, 'JSON input exceeded 16 MiB.')
    : source ? source.trimStart().startsWith('{') ? source : await readCommandFile(resolve(source), 'utf8') : '{}';
  let value: unknown;
  try {value = parseJson(text);} catch {throw new InputError('Input must be valid JSON.');}
  const input = declareDeceased(name, operationQueryInput(name, value, query), options.deceased === true);
  const prepared = prepareOperation(name as OperationName, input);
  return {...prepared, ...(name === 'persons.create' ? {creation: createStatus(prepared.input)} : {})};
}
