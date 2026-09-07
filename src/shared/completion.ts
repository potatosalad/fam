import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

interface Option { value: boolean; file?: boolean; choices?: string[] }
export interface CompletionNode {
  commands: Record<string, CompletionNode>;
  options: Record<string, Option>;
  arguments: ('file' | 'value' | string[])[];
}
export interface Completion { kind: 'words' | 'files' | 'none'; prefix: string; candidates: string[] }
const none = (): Completion => ({ kind: 'none', prefix: '', candidates: [] });
const own = <T>(object: Record<string, T>, key: string): T | undefined => Object.hasOwn(object, key) ? object[key] : undefined;

/** Words exclude the executable and end with the word under the cursor (possibly empty). */
export function complete(catalog: CompletionNode, input: string[]): Completion {
  const words: string[] = [];
  // Bash normally splits '=' into a separate COMP_WORDS entry. Reassemble it
  // without interpreting shell syntax or evaluating anything from the command line.
  for (let i = 0; i < input.length; i++) {
    if (input[i] === '=' && words.at(-1)?.startsWith('--')) words[words.length - 1] += `=${input[++i] ?? ''}`;
    else words.push(input[i]);
  }
  const current = words.pop() ?? '';
  let target = catalog;
  let options = { ...target.options };
  let pending: Option | undefined;
  let positional = 0;
  let endedOptions = false;
  for (const word of words) {
    if (pending) { pending = undefined; continue; }
    if (!endedOptions && word === '--') { endedOptions = true; continue; }
    if (!endedOptions && word.startsWith('-')) {
      const [flag] = word.split('=', 1);
      const option = own(options, flag);
      if (!option) return none();
      if (option.value && !word.includes('=')) pending = option;
      continue;
    }
    const child = positional === 0 ? own(target.commands, word) : undefined;
    if (child) {
      target = child;
      // Root flags do not propagate to providers; provider flags do propagate
      // to their nested commands because the parsers accept them in either order.
      options = target === catalog.commands[word] ? { ...target.options } : { ...options, ...target.options };
    } else positional++;
  }
  const matches = (values: string[], prefix = current, leading = ''): Completion => ({
    kind: 'words', prefix, candidates: [...new Set(values)].filter(value => value.startsWith(prefix)).sort().map(value => leading + value),
  });
  const valueCompletion = (option: Option, prefix: string, leading = ''): Completion => {
    if (option.choices) return matches(option.choices, prefix, leading);
    return option.file ? { kind: 'files', prefix, candidates: [] } : none();
  };
  if (pending) return valueCompletion(pending, current);
  if (!endedOptions && current.startsWith('--') && current.includes('=')) {
    const equals = current.indexOf('=');
    const option = own(options, current.slice(0, equals));
    if (!option?.value) return none();
    // zsh (and bash with custom word breaks) keeps --flag=value in one word.
    const leading = input.at(-1)?.startsWith('--') ? current.slice(0, equals + 1) : '';
    return valueCompletion(option, current.slice(equals + 1), leading);
  }
  if (!endedOptions && current.startsWith('-')) return matches(Object.keys(options));
  if (positional === 0 && Object.keys(target.commands).length) return matches(Object.keys(target.commands));
  const argument = target.arguments[positional];
  if (Array.isArray(argument)) return matches(argument);
  if (argument === 'file') return { kind: 'files', prefix: current, candidates: [] };
  return none();
}

export function completionScript(shell: string): string {
  if (shell === 'bash') return `# fam bash completion (bash 3.2+, no bash-completion dependency)
_fam_complete() {
  local kind prefix candidate leading='' index=0 split_equals=false
  local -a response
  COMPREPLY=()
  while IFS= read -r candidate; do
    response[index]="$candidate"
    index=$((index + 1))
  done < <(command "\${COMP_WORDS[0]}" __complete "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null)
  kind=\${response[0]-none}
  prefix=\${response[1]-}
  # Bash 3.2 may keep '=' in COMP_WORDS even though Readline splits there.
  [[ $COMP_WORDBREAKS == *=* && \${COMP_WORDS[COMP_CWORD]} == --*=* ]] && split_equals=true
  if [[ $kind == files ]]; then
    [[ $split_equals == false && \${COMP_WORDS[COMP_CWORD]} == --*=* ]] && leading="\${COMP_WORDS[COMP_CWORD]%%=*}="
    while IFS= read -r candidate; do
      COMPREPLY[\${#COMPREPLY[@]}]="$leading$candidate"
    done < <(compgen -f -- "$prefix")
  elif [[ $kind == words ]]; then
    for candidate in "\${response[@]:2}"; do
      [[ $split_equals == true && $candidate == --*=* ]] && candidate="\${candidate#*=}"
      COMPREPLY[\${#COMPREPLY[@]}]="$candidate"
    done
  fi
}
complete -o filenames -F _fam_complete fam
`;
  if (shell === 'zsh') return `# fam native zsh completion
if ! (( $+functions[compdef] )); then
  autoload -Uz compinit
  compinit
fi
_fam_complete() {
  local -a response
  response=("\${(@f)$(command "\${words[1]}" __complete "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  case \${response[1]-none} in
    files)
      [[ $PREFIX == --*=* ]] && compset -P '*='
      _files
      ;;
    words)
      (( \${#response} > 2 )) && compadd -Q -- "\${(@)response[3,-1]}"
      ;;
  esac
}
compdef _fam_complete fam
`;
  throw new Error('Choose bash or zsh. Run fam completion --help.');
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Append a guarded, repeatable hook, preserving existing shell configuration. */
export async function installCompletion(shell: string, home = homedir(), zdotdir = process.env.ZDOTDIR): Promise<string[]> {
  completionScript(shell); // Validate before touching startup files.
  const files = shell === 'zsh' ? [join(zdotdir ? resolve(zdotdir) : home, '.zshrc')] : [join(home, '.bashrc')];
  if (shell === 'bash') {
    // Login bash reads only the first existing file from this list. Install in
    // both startup modes; sourcing bashrc from a profile is safe and repeatable.
    let profile = join(home, '.bash_profile');
    for (const name of ['.bash_profile', '.bash_login', '.profile']) {
      const path = join(home, name);
      if (await readOptional(path) !== undefined) { profile = path; break; }
    }
    files.push(profile);
  }
  const marker = `# fam ${shell} completion`;
  const variable = shell === 'bash' ? 'BASH_VERSION' : 'ZSH_VERSION';
  const block = `${marker}\nif [ -n "\${${variable}-}" ] && [ -n "\${PS1-}" ] && command -v fam >/dev/null 2>&1; then\n  eval "$(fam completion ${shell})"\nfi\n# end fam ${shell} completion\n`;
  for (const file of files) {
    const content = await readOptional(file) ?? '';
    if (content.split('\n').includes(marker)) continue;
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${content.endsWith('\n') || !content ? '' : '\n'}\n${block}`, { mode: 0o600 });
  }
  return files;
}

const help = `Usage: fam completion bash|zsh
       fam completion install [bash|zsh]

Print a shell script, or install a startup hook for your current user.
Install detects $SHELL by default; zsh respects $ZDOTDIR.
Bash setup covers interactive login and non-login shells.

Enable TAB completion in the current shell:
  eval "$(fam completion bash)"   # bash
  eval "$(fam completion zsh)"    # zsh

After installing, open a new shell. To uninstall, remove the marked fam
completion block from the startup file(s) printed by the installer.
Completions use a local catalog; no credentials or network access are needed.
`;

export async function completionMain(args: string[]): Promise<void> {
  if (args[0] === '--query') {
    const catalog = JSON.parse(await readFile(new URL('../../dist/shared/completion-data.json', import.meta.url), 'utf8')) as CompletionNode;
    const result = complete(catalog, args.slice(1));
    process.stdout.write(`${[result.kind, result.prefix, ...result.candidates].join('\n')}\n`);
  } else if (!args.length || args.length === 1 && ['help', '--help', '-h'].includes(args[0])) {
    process.stdout.write(help);
  } else if (args[0] === 'install' && args.length <= 2) {
    const shell = args[1] ?? basename(process.env.SHELL ?? '');
    const files = await installCompletion(shell);
    console.log(`Enabled ${shell} TAB completion in ${files.join(', ')}.\nOpen a new shell, or run: eval "$(fam completion ${shell})"`);
  } else if (args.length === 1 && ['bash', 'zsh'].includes(args[0])) {
    process.stdout.write(completionScript(args[0]));
  } else throw new Error('Use fam completion bash|zsh or fam completion install [bash|zsh].');
}
