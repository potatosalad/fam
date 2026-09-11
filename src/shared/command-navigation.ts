import {commands, commonTasks, commandById, providerInfo, namespaceNames, objectDescriptions, syntax, type Command} from './command-registry.js';
import {operationGroups} from '../familysearch/discovery.js';

export const knownProvider = (name: string): boolean => Object.hasOwn(providerInfo, name);
const identity = (command: Command): string => `${command.provider}.${command.object}`;
export const commandSummary = (command: Command) => ({command: command.id, description: command.description, syntax: syntax(command),
  options: command.flags.filter(f => f.required || !['help', 'dry-run', 'json', 'out'].includes(f.name))
    .sort((a, b) => Number(b.required) - Number(a.required)).slice(0, 3).map(f => ({name: f.name, required: f.required}))});
export type CommandSummary = ReturnType<typeof commandSummary>;
const objectSummary = (name: string) => ({name, description: objectDescriptions[name.split('.').slice(1).join('.')] ?? 'Provider operations.'});
function objects(provider: string) {
  return [...new Set(commands.filter(c => c.provider === provider).map(identity))].sort().map(objectSummary);
}
function nextCommands(pool: readonly Command[]): CommandSummary[] {
  const curated = commonTasks.map(task => commandById.get(task.command)!).filter(command => pool.includes(command));
  const preferred = pool.filter(c => ['list', 'search', 'get', 'describe'].includes(c.action));
  const research = preferred.filter(c => !['session', 'credential'].includes(c.object) && !c.object.startsWith('api'));
  return [...new Set([...curated, ...research, ...preferred, ...pool])].slice(0, 5).map(commandSummary);
}

/** A namespace is an exact provider, object, or dotted parent of registered objects. */
export function namespaceInfo(name: string) {
  const provider = name.split('.')[0];
  if (!knownProvider(provider)) return undefined;
  const isProvider = name === provider;
  const pool = commands.filter(c => c.provider === provider && (isProvider || identity(c) === name || identity(c).startsWith(`${name}.`)));
  if (!pool.length) return undefined;
  return {kind: isProvider ? 'provider' as const : 'object' as const, name, provider,
    description: isProvider ? providerInfo[provider].description : objectSummary(name).description,
    documentation: `fam cli.doc read --provider ${provider}`,
    usage: isProvider ? `fam ${provider}.<object> <action> [options]` : `fam ${name} <action> [options]`,
    objects: objects(provider).filter(item => isProvider || item.name.startsWith(`${name}.`)),
    actions: isProvider ? [] : pool.filter(c => identity(c) === name).map(commandSummary),
    ...(provider === 'familysearch' && (isProvider || name === 'familysearch.api') ? {operationGroups} : {}),
    nextCommands: nextCommands(pool)};
}
export type NamespaceInfo = NonNullable<ReturnType<typeof namespaceInfo>>;

// Edit distance with adjacent transpositions, plus a prefix bonus for abbreviated names.
function similarity(input: string, target: string): number {
  const a = input.toLowerCase().slice(0, 128), b = target.toLowerCase();
  if (!a || !b) return 0;
  const matrix = Array.from({length: a.length + 1}, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
  }
  const score = 1 - matrix[a.length][b.length] / Math.max(a.length, b.length);
  return a.length >= 2 && b.startsWith(a) ? Math.max(score, 0.85) : score;
}
function suggestions(name: string, action?: string): CommandSummary[] {
  let [provider, ...parts] = name.split('.');
  if (!knownProvider(provider)) {
    const match = Object.keys(providerInfo).map(p => ({provider: p, score: similarity(provider, p)}))
      .sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider, 'en'))[0];
    if (match.score < 0.5) return [];
    provider = match.provider;
  }
  // Old space-separated spelling is a useful hint, but never an executable alias.
  const object = parts.join('.') || action || '';
  const requestedAction = parts.length ? action : undefined;
  let pool = commands.filter(c => c.provider === provider);
  if (pool.some(c => c.object === object)) pool = pool.filter(c => c.object === object);
  if (!object && !requestedAction) return nextCommands(pool);
  return pool.map(command => ({command, objectScore: similarity(object, command.object),
    score: similarity(object, command.object) * 10 + (requestedAction ? similarity(requestedAction, command.action) * 4
      : command.action === 'list' ? 1 : ['get', 'search'].includes(command.action) ? 0.5 : 0)}))
    .filter(result => result.objectScore >= 0.4)
    .sort((a, b) => b.score - a.score || a.command.id.localeCompare(b.command.id, 'en'))
    .slice(0, 5).map(({command}) => commandSummary(command));
}

export function lookupFailure(name: string, action?: string) {
  const provider = name.split('.')[0], namespace = namespaceInfo(name);
  let message: string, title: string, available: {name: string; description: string}[], help: string;
  if (!knownProvider(provider)) {
    message = `${JSON.stringify(provider)} is not a valid provider.`;
    title = 'Available providers';
    available = namespaceNames.map(name => ({name, description: providerInfo[name].description}));
    help = 'Use "fam <provider> --help" to see available object types.';
  } else if (!namespace || namespace.kind === 'provider') {
    message = namespace ? `Choose an object before the action ${JSON.stringify(action ?? '')} for provider ${JSON.stringify(provider)}.`
      : `${JSON.stringify(name.slice(provider.length + 1))} is not a valid object type for provider ${JSON.stringify(provider)}.`;
    title = 'Available object types'; available = objects(provider);
    help = `Use "fam ${provider}.<object> --help" to see available actions.`;
  } else {
    message = `${JSON.stringify(action ?? '')} is not a valid action for object type ${JSON.stringify(name)}.`;
    title = namespace.actions.length ? 'Available actions' : 'Available object types';
    available = namespace.actions.length ? namespace.actions.map(c => ({name: c.command, description: c.description})) : namespace.objects;
    help = `Use "fam ${name} --help" for options and examples.`;
  }
  const matches = suggestions(name, action);
  return {message, title, available, help, suggestions: matches,
    description: knownProvider(provider) ? providerInfo[provider].description : 'Genealogy providers and CLI utilities.',
    suggestedInvocation: matches[0]?.syntax ?? (knownProvider(provider) ? `fam ${provider} --help` : 'fam --help')};
}
export type LookupFailure = ReturnType<typeof lookupFailure>;
