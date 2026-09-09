import type {describeOperation, discoverOperations} from './discovery.js';
import {stringifyJson} from '../shared/json.js';

type Schema = Record<string, unknown>;
function typeLabel(schema: Schema): string {
  if (typeof schema.$ref === 'string') return schema.$ref.replace(/^#\/\$defs\//, '').replaceAll('~1', '/').replaceAll('~0', '~').split('/').at(-1)!;
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(typeLabel).join(' | ');
  if (schema.type === 'array') return `array of ${typeLabel(schema.items as Schema)}`;
  if (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object')
    return `map of ${typeLabel(schema.additionalProperties as Schema)}`;
  return String(schema.type ?? schema.description ?? 'JSON');
}
function schemaLines(schema: Schema, indent = '  '): string[] {
  const properties = schema.properties as Record<string, Schema> | undefined;
  if (!properties) return [`${indent}${typeLabel(schema)}`];
  const required = schema.required as string[] ?? [];
  return Object.entries(properties).flatMap(([name, value]) => [
    `${indent}${name}: ${typeLabel(value)} (${required.includes(name) ? 'required' : 'optional'})`,
    ...(value.properties ? schemaLines(value, indent + '  ') : []),
    ...(value.description ? [`${indent}  ${value.description}`] : []),
  ]);
}
function schemaSection(title: string, schema: Schema): string[] {
  const defs = schema.$defs as Record<string, Schema> ?? {};
  return [title, ...schemaLines(schema), ...Object.entries(defs).flatMap(([name, model]) =>
    ['', `  ${name.split('/').at(-1)}`, ...schemaLines(model, '    ')])];
}

export function operationDescription(description: ReturnType<typeof describeOperation>): string {
  return [`${description.name} — ${description.description}`, '',
    `Effects: ${description.risk.level.toUpperCase()}. ${description.risk.description}`,
    `Endpoint: ${description.method} ${description.path}`, '',
    `Usage: ${description.invocation}`,
    `Generate example JSON: ${description.exampleCommand}`,
    'Pass the completed JSON with --input FILE or --input - for stdin.', '',
    ...schemaSection('Inputs', description.inputSchema), '',
    'Example input (replace placeholders)', stringifyJson(description.example, 2), '',
    ...schemaSection('Output (advisory)', description.outputSchema),
    ...(description.responseOptional ? ['  An empty response is also allowed (HTTP 204).'] : []),
    ...(description.responseNote ? [`  ${description.responseNote}`] : []), '',
    ...description.limitations.map(note => `Limit: ${note}`),
    description.inputNotes, description.responseNotes, '',
    'Use --json for complete machine-readable schemas, including referenced model definitions.', '',
  ].join('\n');
}

export function operationList(operations: ReturnType<typeof discoverOperations>): string {
  return [`${operations.length} matching FamilySearch genealogy operations`, '',
    ...operations.flatMap(op => [`${op.name} [${op.risk.level}]`, `  ${op.description}`]), '',
    'Inspect inputs, output fields, effects, and examples:',
    '  fam familysearch.api describe --operation <OPERATION>',
    'Generate a JSON input template:',
    '  fam familysearch.api describe --operation <OPERATION> --example', '',
    'Use --json for the structured catalog with invocation and inspection links.', '',
  ].join('\n');
}
