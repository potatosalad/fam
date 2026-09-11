import type {searchCommands} from './command-search.js';
import {compareCliNames} from './command-registry.js';
type Result = Awaited<ReturnType<typeof searchCommands>>['results'][number];
const identity = (item: Result) => item.command + ('operation' in item ? ` --operation ${item.operation}` : '');
const clipped = (text: string, width: number) => text.length <= width ? text : text.slice(0, width - 1) + '…';

export function searchTable(results: Result[], width: number, scores = false): string {
  const names = results.map(identity), nameWidth = Math.max(7, ...names.map(name => name.length));
  const descriptionWidth = Math.max(60, Math.min(100, width - nameWidth - 65));
  const columns = [nameWidth, 9, ...(scores ? [8] : []), descriptionWidth];
  const row = (values: string[]) => values.map((value, i) => columns[i] ? value.padEnd(columns[i]) : value).join('  ');
  return [row(['command', 'type', ...(scores ? ['score'] : []), 'description', 'top_args']),
    row([...columns.map(n => '-'.repeat(n)), '--------']),
    ...results.map((item, i) => row([names[i], item.type, ...(scores ? [item.score.toFixed(6)] : []), clipped(item.description, descriptionWidth), item.topArgs.join(', ')])),
    ...results.filter(item => item.documentation).flatMap(item => ['', `Guide for ${item.command}: ${item.documentation!.read}`])].join('\n');
}

export function searchTree(results: Result[], scores = false): string {
  const groups = new Map<string, Map<string, Result[]>>();
  for (const item of results) {
    const namespace = item.command.split(' ')[0], provider = namespace.split('.')[0];
    if (!groups.has(provider)) groups.set(provider, new Map());
    const objects = groups.get(provider)!;
    if (!objects.has(namespace)) objects.set(namespace, []);
    objects.get(namespace)!.push(item);
  }
  return [...groups].sort(([a], [b]) => compareCliNames(a, b)).map(([provider, objects]) => [provider,
    ...[...objects].sort(([a], [b]) => compareCliNames(a, b)).flatMap(([namespace, items], oi) => {
      const lastObject = oi === objects.size - 1, indent = lastObject ? '      ' : '  │   ';
      return [`  ${lastObject ? '└──' : '├──'} ${namespace}`, ...items.flatMap((item, i) => {
        const last = i === items.length - 1, childIndent = indent + (last ? '    ' : '│   ');
        const action = item.command.split(' ')[1] + ('operation' in item ? ` --operation ${item.operation}` : '');
        return [`${indent}${last ? '└──' : '├──'} ${action}  ${item.description}${scores ? `  (score: ${item.score.toFixed(6)})` : ''}`,
          `${childIndent}top args: ${item.topArgs.join(', ') || '(none)'}`,
          ...(item.documentation ? [`${childIndent}Guide: ${item.documentation.read}`] : []),
          ...('operation' in item ? [`${childIndent}Inspect: ${item.describe}`] : [])];
      })];
    }),
  ].join('\n')).join('\n\n');
}
