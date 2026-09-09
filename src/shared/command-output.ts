import {humanCyndisList} from '../cyndislist/output.js';
import {commandById, commonTasks, providerInfo, providerNames, syntax, type Command, type Flag} from './command-registry.js';
import type {Values} from './command-runtime.js';
import type {NamespaceInfo, LookupFailure, CommandSummary} from './command-navigation.js';
import {fileURLToPath} from 'node:url';

export const wantsJson = (values: Values): boolean => values.json === true || values.format === 'json';
const label = (key: string): string => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll(/[_-]/g, ' ').replace(/^./, s => s.toUpperCase());
const scalar = (value: unknown): string => value === null || value === undefined ? '—' : typeof value === 'boolean' ? value ? 'yes' : 'no' : String(value);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const simple = (value: unknown): boolean => value === null || typeof value !== 'object';
const quote = (value: string): string => /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

function wrap(text: string, width: number): string[] {
  return text.split('\n').flatMap(paragraph => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > width) {lines.push(line); line = '';}
      line += `${line ? ' ' : ''}${word}`;
    }
    lines.push(line); return lines;
  });
}
function rows(items: [string, string][], width = 100): string {
  const left = Math.min(48, Math.max(0, ...items.map(([name]) => name.length)));
  return items.map(([name, value]) => {
    const indent = ' '.repeat(left + 4), lines = wrap(value, Math.max(30, width - left - 4));
    return name.length > left ? `  ${name}\n${lines.map(line => indent + line).join('\n')}`
      : `  ${name.padEnd(left)}  ${lines.join(`\n${indent}`)}`;
  }).join('\n');
}

/** Render all values without depth limits, ellipses, or JSON punctuation. */
export function renderData(value: unknown, indent = ''): string {
  if (simple(value)) return indent + scalar(value);
  if (Array.isArray(value)) {
    if (!value.length) return indent + 'None';
    if (value.every(simple)) return value.map(item => `${indent}• ${scalar(item)}`).join('\n');
    return value.map((item, i) => `${indent}${i + 1}.\n${renderData(item, indent + '  ')}`).join('\n\n');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return indent + 'None';
  return entries.map(([key, item]) => simple(item) ? `${indent}${label(key)}: ${scalar(item)}`
    : `${indent}${label(key)}:\n${renderData(item, indent + '  ')}`).join('\n');
}

function flagDetail(flag: Flag): string {
  const details = [flag.required ? 'Required.' : '', flag.description,
    flag.choices ? `Choices: ${flag.choices.join(', ')}.` : '',
    flag.default !== undefined && flag.default !== false ? `Default: ${flag.default}.` : '',
    flag.multiple ? 'Repeatable.' : ''];
  return details.filter(Boolean).join(' ');
}
const flagName = (flag: Flag): string => `--${flag.name}${flag.name === 'help' ? ' / -h' : ''}${flag.type === 'boolean' ? '' : ` <${flag.type}>`}`;
export function commandDescription(command: Command, width = 100): string {
  const field = (key: string, value: string) => {
    const prefix = `  ${key}: `;
    return prefix + wrap(value, Math.max(30, width - prefix.length)).join(`\n${' '.repeat(prefix.length)}`);
  };
  return [`command: ${command.id}`, field('provider', command.provider), field('object_type', command.object),
    field('action', command.action), field('description', command.description),
    field('operation_type', command.risk.level.toUpperCase().replaceAll('-', '_')),
    field('confirmation_requirement', command.confirmationRequirement.toUpperCase()), field('effects', command.risk.description),
    field('schema_mode', command.schemaMode),
    ...(command.pagination ? [field('pagination', command.pagination.description)] : []),
    '  options:', ...rows(command.flags.map(flag => [flagName(flag), flagDetail(flag)]), width - 2).split('\n').map(line => `  ${line}`),
    '  examples:', ...command.examples.map(example => `    ${example}`), '',
  ].join('\n');
}
const section = (title: string): string => `${title}\n${'-'.repeat(title.length)}`;
function commandPreviews(commands: CommandSummary[]): string {
  return commands.map(command => `  fam ${command.command}${command.options.length
    ? ` (some options include: ${command.options.map(f => `--${f.name}${f.required ? ' (required)' : ''}`).join(', ')})` : ''}`).join('\n');
}
export function namespaceHelp(namespace: NamespaceInfo, width = 100): string {
  const title = `${namespace.name} - ${namespace.kind === 'provider' ? providerInfo[namespace.provider].name : namespace.description}`;
  return [title, '='.repeat(title.length), '', namespace.description, '',
    `Documentation: ${fileURLToPath(new URL(`../../${namespace.documentation}`, import.meta.url))}`, '', `Usage: ${namespace.usage}`,
    ...(namespace.objects.length ? ['', section(`Available object types (${namespace.objects.length})`),
      rows(namespace.objects.map(item => [item.name, item.description]), width)] : []),
    ...(namespace.actions.length ? ['', section(`Available actions (${namespace.actions.length})`),
      rows(namespace.actions.map(item => [item.command, item.description]), width)] : []), '',
    namespace.kind === 'provider' ? `Use "fam ${namespace.name}.<object> --help" to see available actions.`
      : `Use "fam ${namespace.name} <action> --help" to see command flags and examples.`,
    '', section('Suggested next commands'), commandPreviews(namespace.nextCommands), '',
  ].join('\n');
}
export function commandError(failure: LookupFailure, width = 100): string {
  return [`Error: ${failure.message}`, '', failure.description, '', section(`${failure.title} (${failure.available.length})`),
    rows(failure.available.map(item => [item.name, item.description]), width), '', failure.help,
    ...(failure.suggestions.length ? ['', section('Did you mean?'), commandPreviews(failure.suggestions)] : []), '',
  ].join('\n');
}
export function commandHelp(command: Command, schema = false, width = 100): string {
  const required = command.flags.filter(flag => flag.required), optional = command.flags.filter(flag => !flag.required);
  const table = (flags: Flag[]) => rows(flags.map(flag => [`--${flag.name}${flag.type === 'boolean' ? '' : ` <${flag.type}>`}`, flagDetail(flag)]), width);
  return [`${syntax(command)}\n`, command.description,
    ...(required.length ? ['\nRequired flags', table(required)] : []), '\nOptions', table(optional),
    '\nExamples', ...command.examples.map(example => `  ${example}`),
    `\nEffects: ${command.risk.description}`, ...(command.pagination ? [`Pagination: ${command.pagination.description}`] : []),
    ...(schema ? ['\nExpected response (advisory)', renderData(command.outputSchema), '\nExit codes: 0 success · 1 execution failure or health issues · 2 invalid arguments'] : []),
    '\nUse --json for machine-readable output.',
  ].join('\n') + '\n';
}

export function overview(): string {
  return ['fam - Genealogy CLI', '===================', '',
    'Usage: fam <provider>.<object> <action> [options]', '', 'Available providers:',
    rows(providerNames.map(provider => [provider, providerInfo[provider].description])),
    '', 'Browse provider commands and documentation: fam <provider> --help', '', 'Common tasks:',
    ...commonTasks.flatMap(task => [`  ${task.title}`, `    ${task.example}`]), '',
    'Persistent browser: fam browser setup --local | fam browser setup --remote URL',
    'Manage it with fam browser use, start, stop, status, open, configure, or reset.',
    'Inspect starting HTTP/browser routes: fam cli.browser.transport list --transport auto', '',
    'Global options', '--------------',
    rows([
      ['--help, -h', 'Show help, including command flags and examples.'],
      ['--json', 'Return structured JSON instead of readable text.'],
      ['--out <FILE>', 'Save results or downloads to a file.'],
      ['--dry-run', 'Show an invocation without executing it.'],
      ['--transport <MODE>', 'Use auto, http, or browser for a provider command.'],
      ['--browser-timeout <SECONDS>', 'Wait for browser verification; zero returns when interaction is needed.'],
      ['--completions <SHELL>', 'Print a shell completion script (bash or zsh).'],
    ]),
    '', 'Place command options after the action. Credentials and sessions use the active fam profile.',
    'Set FAM_CONFIG_DIR to use a different profile.', '',
    'Find a command:', '  fam cli.command search --query "what you want to accomplish"',
    'Inspect command options:', '  fam cli.command describe --command "provider.object action"',
    'Browse commands for a provider:', '  fam cli.command list --provider familysearch',
    'Browse provider and object help:', '  fam familysearch', '  fam familysearch.image --help',
    'List available providers:', '  fam cli.provider list',
    'Enable completion in the current shell:', '  eval "$(fam --completions bash)"  # Use zsh in zsh.',
    'Install completion for future shells:', '  fam cli.completion install', '',
  ].join('\n');
}
function commandList(data: {command: string; description: string}[], width: number): string {
  const groups = new Map<string, typeof data>();
  for (const item of data) {const provider = item.command.split('.')[0]; if (!groups.has(provider)) groups.set(provider, []); groups.get(provider)!.push(item);}
  const sections = [...groups].map(([provider, items]) => `${providerInfo[provider]?.name ?? provider} (${items.length})\n${rows(items.map(item => [item.command, item.description]), width)}`);
  return `${data.length} commands\n\n${sections.join('\n\n')}\n\nRun fam <provider>.<object> <action> --help for flags and examples.\n`;
}
interface Candidate {command: string; description: string; invocation: string; missingFlags: string[]; examples: string[]; risk: {level: string; description: string}}
function candidates(results: Candidate[], width: number): string {
  return results.map((result, i) => [`${i + 1}. ${result.command}`,
    ...wrap(result.description, width - 3).map(line => `   ${line}`), '', `   ${result.invocation}`,
    ...(result.missingFlags.length ? [`   Needs: ${result.missingFlags.map(name => `--${name}`).join(', ')}`] : []),
    ...(result.examples[0] && result.examples[0] !== result.invocation ? [`   Example: ${result.examples[0]}`] : []),
    ...(result.risk.level === 'operation-dependent' || result.risk.level === 'write' ? [`   Effects: ${result.risk.description}`] : []),
  ].join('\n')).join('\n\n');
}

export function humanOutput(command: Command, data: unknown, values: Values, width = 100): string {
  if (object(data) && typeof data.saved === 'string') {
    const {saved, metadata, ...details} = data;
    return `Saved ${saved}\n${metadata ? `Metadata: ${metadata}\n` : ''}${Object.keys(details).length ? renderData(details) + '\n' : ''}`;
  }
  if (values['dry-run'] && object(data)) return `Dry run: fam ${command.id}\n\n${renderData(data.flags)}\n\n${data.note}\n`;
  if (command.id === 'cli.command list') return commandList(data as {command: string; description: string}[], width);
  if (['cli.browser.transport list', 'cli.browser.transport get'].includes(command.id)) {
    const report = data as {policy:string;source:string;configured:boolean;mode?:string;session?:string;note:string;
      routes:Array<{provider:string;origin:string|null;transport:string;reason:string}>};
    return [`Transport policy: ${report.policy} (${report.source})`,
      report.configured ? `Browser: ${report.mode}, session ${report.session}` : 'Browser: not configured', '',
      ...report.routes.flatMap(route=>[`${route.provider}  ${route.origin ?? '(all other origins)'}`,
        `  ${route.transport} — ${route.reason}`]), '', ...wrap(report.note,width), ''].join('\n');
  }
  if (command.id === 'cli.provider list') return `Available providers\n\n${rows((data as {provider: string; name: string; description: string}[]).map(p => [p.provider, `${p.name} — ${p.description}`]), width)}\n\nBrowse commands: fam cli.command list --provider <PROVIDER>\n`;
  if (command.id === 'cli.command describe') {
    const found = commandById.get((data as {id: string}).id);
    if (found) return commandDescription(found, width);
  }
  if (command.id === 'cli.command search') {
    const result = data as {query: string; total: number; offset: number; results: Candidate[]; hasMore: boolean; nextOffset: number; context?: {note?: string}};
    if (!result.results.length) return `No commands found for “${result.query}”.\nTry fewer words, or browse with fam cli.command list.\n`;
    const next = ['fam cli.command search', '--query', quote(result.query),
      ...(values.provider ? ['--provider', quote(String(values.provider))] : []),
      ...(values.context ? ['--context', quote(String(values.context))] : []),
      ...(values.limit !== undefined ? ['--limit', String(values.limit)] : []), '--offset', String(result.nextOffset)].join(' ');
    return `Commands ${result.offset + 1}–${result.offset + result.results.length} of ${result.total} for “${result.query}”\n\n${candidates(result.results, width)}\n`
      + (result.context?.note ? `\n${result.context.note}\n` : '') + (result.hasMore ? `\nMore: ${next}\n` : '');
  }
  if (command.id === 'cli.context resolve') {
    const result = data as {context: {input: string; provider?: string; note?: string}; commands: Candidate[]};
    return `Context: ${result.context.input}\nProvider: ${result.context.provider ?? 'unresolved'}\n`
      + (result.context.note ? `${result.context.note}\n` : '')
      + (result.commands.length ? `\n${candidates(result.commands, width)}\n` : 'No command parameters could be resolved.\n');
  }
  if (command.id === 'cli.version get') return `${(data as {version: string}).version}\n`;
  if (object(data) && typeof data.text === 'string' && (command.provider === 'cli' || command.action === 'transcript')) return data.text.endsWith('\n') ? data.text : data.text + '\n';
  if (command.id === 'cli.completion install') {
    const result = data as {shell: string; files: string[]; next: string};
    return `Enabled ${result.shell} completion in:\n${result.files.map(file => `  ${file}`).join('\n')}\n\nOpen a new shell, or run:\n  ${result.next}\n`;
  }
  if (command.provider === 'cyndislist' && !values['dry-run']) return humanCyndisList(data);
  return `${renderData(data)}\n${command.pagination ? `\nPagination: ${command.pagination.description}\n` : ''}`;
}
