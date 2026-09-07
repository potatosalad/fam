// Read source declarations and help only: generation never imports a provider
// client, loads credentials, or contacts a service. Keep CLI options literal.
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const node = () => ({ commands: {}, options: {}, arguments: [] });
const source = path => readFile(new URL(path, root), 'utf8');
function helpText(text) {
  return [...text.matchAll(/(?:const|let) (?:help|researchHelp) = `([\s\S]*?)`;/g)].map(match => match[1]).join('\n');
}
function readOptions(text, target) {
  for (const match of text.matchAll(/(?:'([a-z][a-z-]*)'|\b([a-z][a-z]*)):\s*\{\s*type:\s*'(string|boolean)'([^}]*?)\}/g)) {
    const [, quoted, plain, type, rest] = match;
    const name = quoted ?? plain;
    const option = { value: type === 'string', file: /^(out|input|query|har)$|file$/.test(name) };
    target.options[`--${name}`] = option;
    const short = rest.match(/short:\s*'(.)'/)?.[1];
    if (short) target.options[`-${short}`] = option;
  }
}
function readHelp(text, target, prefix) {
  // Options in help supply enum choices and cover the few hand-parsed flags.
  for (const match of text.matchAll(/(--[a-z][a-z-]*)(?:[ \t]+([\w.-]+(?:\|[\w.-]+)+|[A-Z][A-Z_]*\b))?/g)) {
    const [, name, value] = match;
    const option = target.options[name] ??= { value: Boolean(value), file: /FILE/.test(value ?? '') };
    if (value?.includes('|')) option.choices = value.split('|');
  }
  for (let line of text.split('\n')) {
    if (prefix) {
      if (!line.startsWith(prefix)) continue;
      line = line.slice(prefix.length);
    } else {
      if (!/^  [a-z]/.test(line)) continue;
      line = line.slice(2);
    }
    const match = line.match(/^([a-z][a-z-]*(?: \| [a-z][a-z-]*)*)(?:\s+(.*))?$/);
    if (!match) continue;
    for (const name of match[1].split(' | ')) {
      let command = target.commands[name] ??= node();
      const synopsis = (match[2] ?? '').split(/\s{2,}/)[0];
      for (const token of synopsis.split(/\s+/).filter(Boolean)) {
        if (/^--|^\[--/.test(token)) break;
        if (/^[a-z][a-z-]*$/.test(token)) command = command.commands[token] ??= node();
        else {
          const argument = token.replace(/^\[|\]$/g, '');
          if (/^[A-Z][A-Z_]*(?:\|[A-Z_]+)?$/.test(argument)) command.arguments.push(/FILE|^JSON$/.test(argument) ? 'file' : 'value');
          else if (/^[a-z]+(?:\|[a-z]+)+$/.test(argument)) command.arguments.push(argument.split('|'));
        }
      }
    }
  }
}

const cli = await source('src/cli.ts');
const catalog = node();
const registry = cli.match(/const providers = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const providers = [...registry.matchAll(/^\s+([a-z]+):/gm)].map(match => match[1]);
if (!providers?.length) throw new Error('Missing provider registry.');
for (const provider of providers) {
  const tree = await source(`src/${provider}/cli.ts`);
  const target = catalog.commands[provider] = node();
  readOptions(tree, target);
  readHelp(helpText(tree), target, provider === 'familysearch' ? 'fam familysearch ' : undefined);
  if (provider === 'familysearch') {
    const research = await source('src/familysearch/research-cli.ts');
    readOptions(research, target);
    readHelp(helpText(research), target, 'fam familysearch ');
  }
  target.options['--help'] = { value: false };
  target.options['-h'] = { value: false };
  target.commands.help = node();
  if (cli.includes("args[0] === 'sync'")) target.commands.sync = node();
  if (Object.keys(target.commands).length < 5) throw new Error(`No commands found for ${provider}.`);
}
// Root commands are described by the dispatcher's help, including optional ones
// added by later versions of fam. Their flags remain scoped to that command.
for (const line of helpText(cli).split('\n')) {
  const match = line.trim().match(/^fam ([a-z][a-z-]*)\b(.*)/);
  if (!match || providers.includes(match[1])) continue;
  const target = catalog.commands[match[1]] ??= node();
  readHelp(match[2], target);
  if (match[2].includes('PROVIDER')) target.arguments = Array.from({ length: match[2].includes('...') ? providers.length : 1 }, () => providers);
}
catalog.commands.help = { ...node(), arguments: [providers] };
catalog.commands.completion = node();
for (const shell of ['bash', 'zsh']) catalog.commands.completion.commands[shell] = node();
catalog.commands.completion.commands.install = { ...node(), arguments: [['bash', 'zsh']] };
for (const flag of ['--help', '-h', '--version', '-v']) catalog.options[flag] = { value: false };
await mkdir(new URL('dist/shared/', root), { recursive: true });
await writeFile(new URL('dist/shared/completion-data.json', root), `${JSON.stringify(catalog)}\n`);
