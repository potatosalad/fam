import {discovery} from './generated/discovery.js';
import {contracts} from './generated/schema.js';
import {operationContract, operationExample} from './operations.js';
import type {WireType} from './contract-types.js';

/** Local catalog metadata only: no client, profile, credentials, or network access. */
export const operationNames = Object.keys(discovery.operations);
export const operationGroups = Object.entries(discovery.groups).map(([group, description]) => ({group, description,
  count: operationNames.filter(name => name.startsWith(`${group}.`)).length,
  browse: `fam familysearch.api list --filter ${group}`}));

export function operationSummary(name: string) {
  const contract = operationContract(name), info = discovery.operations[name];
  const requiredInput = contract.parameters.filter(p => p.required).map(p =>
    p.kind === 'query' ? `query.${p.name}` : p.kind === 'header' ? `headers.${p.name}` : p.name);
  const needsInput = contract.parameters.length > 0;
  const binary = contract.response.kind === 'binary';
  const limitations = info.limitations ?? [];
  return {name, group: name.split('.')[0], description: info.description, method: contract.method, path: contract.path,
    risk: {level: info.effect, description: info.effect === 'read'
      ? 'Reads provider data. Existing authentication may renew and save a session.'
      : `${info.description} Executes immediately with the supplied input; account permissions and server rules apply.`},
    requiredInput, needsInput, binary, limitations,
    invocation: `fam familysearch.api call --operation ${name}${needsInput ? ' --input <INPUT_JSON_FILE>' : ''}${binary ? ' --out <OUTPUT_FILE>' : ''}`,
    describe: `fam familysearch.api describe --operation ${name}`,
    exampleCommand: `fam familysearch.api describe --operation ${name} --example`,
  };
}

export function discoverOperations(filter = '') {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return operationNames.map(operationSummary).filter(op => words.every(word =>
    `${op.name} ${op.description} ${discovery.groups[op.group]} ${op.method} ${op.path}`.toLowerCase().includes(word)));
}

type Schema = Record<string, unknown>;
/** Reachable definitions make recursive models inspectable without infinite expansion. */
function schemaBuilder(response: boolean) {
  const defs: Record<string, Schema> = {};
  const objectSchema = (properties: Record<string, Schema>, required: string[]) => ({type: 'object', properties, required, additionalProperties: response});
  function schema(type: WireType): Schema {
    switch (type.kind) {
      case 'ref': {
        if (!Object.hasOwn(defs, type.name)) {
          defs[type.name] = {}; // Mark before traversing recursive models.
          const fields = contracts.models[type.name];
          defs[type.name] = objectSchema(Object.fromEntries(Object.entries(fields).map(([name, field]) =>
            [name, field.nullable ? {anyOf: [schema(field.type), {type: 'null'}]} : schema(field.type)])),
          Object.entries(fields).filter(([, field]) => field.required).map(([name]) => name));
        }
        return {$ref: `#/$defs/${type.name.replaceAll('~', '~0').replaceAll('/', '~1')}`};
      }
      case 'array': return {type: 'array', items: schema(type.items)};
      case 'record': return {type: 'object', additionalProperties: schema(type.values)};
      case 'integer': return {type: 'integer', description: 'Signed 64-bit integer. Use a lossless JSON parser for values beyond JavaScript safe integers.'};
      case 'json': return {description: 'Unstructured JSON value; no narrower response contract was recovered.'};
      case 'void': return {description: 'No response body.', 'x-no-content': true};
      case 'binary': return {description: 'Binary bytes; CLI output requires --out FILE.', 'x-binary': true};
      case 'upload': return {description: 'Upload body. Binary bytes and multipart FormData require the TypeScript client; JSON CLI input can only supply text.', 'x-upload': true};
      default: return {type: type.kind};
    }
  }
  return {schema, objectSchema, finish: (root: Schema) => ({$schema: 'https://json-schema.org/draft/2020-12/schema', ...root,
    ...(Object.keys(defs).length ? {$defs: defs} : {})})};
}

export function describeOperation(name: string) {
  const contract = operationContract(name), input = schemaBuilder(false), output = schemaBuilder(true);
  const properties: Record<string, Schema> = {}, required: string[] = [];
  for (const parameter of contract.parameters.filter(p => ['path', 'body'].includes(p.kind))) {
    properties[parameter.name] = input.schema(parameter.type);
    if (parameter.required) required.push(parameter.name);
  }
  for (const [kind, field] of [['query', 'query'], ['header', 'headers']]) {
    const parameters = contract.parameters.filter(p => p.kind === kind);
    if (!parameters.length) continue;
    properties[field] = input.objectSchema(Object.fromEntries(parameters.map(p => [p.name, input.schema(p.type)])), parameters.filter(p => p.required).map(p => p.name));
    if (parameters.some(p => p.required)) required.push(field);
  }
  return {...contract, ...operationSummary(name),
    inputSchema: input.finish(input.objectSchema(properties, required)),
    outputSchema: output.finish(output.schema(contract.response)),
    example: structuredClone(discovery.operations[name].example ?? operationExample(name)),
    inputNotes: 'Path parameters and body are top-level JSON properties; query and headers are nested. --query key=value binds scalar query parameters. Examples contain placeholders, not verified data. Optional wire fields may still be required by the server.',
    responseNotes: 'Response schemas are advisory; additional server fields are retained. This catalog describes implemented contracts, not live verification of every operation.',
  };
}
