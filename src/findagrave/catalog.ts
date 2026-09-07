import { Kind, parse, type TypeNode } from 'graphql';
import { contracts } from './generated/contracts.js';
export { contracts };
export const aliases: Record<string, string> = {
  'auth.password': 'graphql.Authenticate.41cc792c', 'auth.oauth': 'graphql.Authenticate.f6cd753f',
  'memorial': 'graphql.FindMemorial.cfbb6c7d', 'memorial.edits': 'graphql.FindMemorial.c91a797b',
};
export function graphqlOperation(name: string) {
  const key = aliases[name] ?? name;
  const matches = contracts.graphql.filter(o => o.id === key || o.name === key);
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous operation ${name}; use a full ID from findagrave ops.` : `Unknown operation ${name}; use findagrave ops.`);
  return matches[0]!;
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
