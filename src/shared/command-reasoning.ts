import {InputError} from './input-error.js';

/** Extract invocation metadata before command/shortcut dispatch, keeping argv intact for history. */
export function extractReasoning(argv: string[]): {args: string[]; reasoning: string[]; error?: InputError} {
  const args: string[] = [], reasoning: string[] = [];
  let error: InputError | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {args.push(...argv.slice(i)); break;}
    if (arg !== '--reasoning' && !arg.startsWith('--reasoning=')) {args.push(arg); continue;}
    const value = arg === '--reasoning'
      ? (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-') ? argv[++i] : undefined)
      : arg.slice('--reasoning='.length);
    if (!value?.trim()) error ??= new InputError('--reasoning requires non-empty text explaining why this command is being run.');
    else reasoning.push(value);
  }
  return {args, reasoning, ...(error ? {error} : {})};
}
