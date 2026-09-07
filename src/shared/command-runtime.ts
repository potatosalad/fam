import {parseArgs} from 'node:util';
import {commandById, syntax, type Command} from './command-registry.js';
import {commandHelp, overview} from './command-output.js';
import {namespaceInfo, lookupFailure, type LookupFailure} from './command-navigation.js';

export class UsageError extends Error {
  readonly code = 'INVALID_ARGUMENT';
  constructor(message: string, readonly suggestedInvocation?: string, readonly navigation?: LookupFailure) {super(message);}
}
export function unknownCommand(name: string, action?: string): UsageError {
  const failure = lookupFailure(name, action);
  return new UsageError(failure.message, failure.suggestedInvocation, failure);
}
export function parseNamespaceHelp(args: string[]) {
  if (args[1] && !args[1].startsWith('-')) return undefined;
  const namespace = namespaceInfo(args[0]);
  if (!namespace) return undefined;
  try {
    const {values} = parseArgs({args: args.slice(1), allowPositionals: false, options: {help: {type: 'boolean', short: 'h'}, json: {type: 'boolean'}}});
    return {namespace, json: values.json === true};
  } catch (error) {throw new UsageError(error instanceof Error ? error.message : 'Invalid help options.', `fam ${namespace.name} --help`);}
}
export type Values = Record<string, string | boolean | number | string[] | undefined>;
export interface Invocation {command: Command; values: Values; args: string[]}
export function parseInvocation(args: string[]): Invocation {
  const [object, action, ...rest] = args, command = commandById.get(`${object} ${action}`);
  if (!command) throw unknownCommand(object ?? '', action?.startsWith('-') ? undefined : action);
  const options = Object.fromEntries(command.flags.map(flag => [flag.name, {type: flag.type === 'boolean' ? 'boolean' as const : 'string' as const,
    ...(flag.multiple ? {multiple: true} : {}), ...(flag.name === 'help' ? {short: 'h'} : {})}]));
  let values: Values;
  try {values = parseArgs({args: rest, allowPositionals: false, options}).values as Values;}
  catch (error) {throw new UsageError(error instanceof Error ? error.message : 'Invalid flags.', syntax(command));}
  if (values.json && values.format !== undefined && values.format !== 'json')
    throw new UsageError('Use --json by itself or with --format json; other formats conflict with --json.', `${syntax(command)} --json`);
  if (!values.help) for (const flag of command.flags) {
    const value = values[flag.name];
    if (flag.required && (value === undefined || value === '')) throw new UsageError(`Missing required flag --${flag.name}.`, syntax(command));
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (flag.choices && !flag.choices.includes(String(item))) throw new UsageError(`--${flag.name} must be one of: ${flag.choices.join(', ')}.`, syntax(command));
      if (flag.type === 'integer' || flag.type === 'number') {
        const number = Number(item);
        if (String(item).trim() === '' || !Number.isFinite(number) || flag.type === 'integer' && !Number.isSafeInteger(number)
          || flag.minimum !== undefined && number < flag.minimum || flag.maximum !== undefined && number > flag.maximum)
          throw new UsageError(`--${flag.name} requires a valid ${flag.type}${flag.minimum !== undefined ? ` >= ${flag.minimum}` : ''}${flag.maximum !== undefined ? ` <= ${flag.maximum}` : ''}.`, syntax(command));
        if (!Array.isArray(value)) values[flag.name] = number;
      }
    }
  }
  const bound = [...command.binding.command];
  for (const name of command.binding.positionals) if (values[name] !== undefined) bound.push(String(values[name]));
  for (const flag of command.flags) {
    if (flag.binding === false || command.binding.positionals.includes(flag.name)) continue;
    const value = values[flag.name];
    if (value === undefined || value === false) continue;
    for (const item of Array.isArray(value) ? value : [value]) {bound.push(`--${flag.binding || flag.name}`); if (item !== true) bound.push(String(item));}
  }
  return {command, values, args: bound};
}
export function describe(command: Command) {
  const {binding: _binding, ...schema} = command;
  return {...schema, syntax: syntax(command), flags: schema.flags.map(({binding: _flagBinding, ...flag}) => flag),
    output: {description: 'Readable text by default. --json emits structured results on stdout and structured failures on stderr. Provider response schemas are advisory.',
      envelope: {schemaVersion: 1, ok: true, command: command.id, data: 'Provider result or file receipt', pagination: 'Included for documented paginated commands'},
      exitCodes: {'0': 'Success', '1': 'Execution failure or health issues', '2': 'Invalid command or flags'}}};
}
export function help(command?: Command): string {
  return command ? commandHelp(command, false, process.stdout.columns ?? 100) : overview();
}
