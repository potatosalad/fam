import type {Invocation} from './command-runtime.js';

/** Local examples only: reporting a failed request must never issue another one. */
export async function badRequestHelp(invocation: Invocation) {
  const {command, values} = invocation;
  const help: {examples: string[]; hints: string[]; inputExample?: unknown} = {
    examples: command.examples.slice(0, 2), hints: [],
  };
  if (command.id === 'ancestry.record search') {
    help.examples = ['fam ancestry.record search --last-name Smith --filter "1|Category|SET=HistoricalRecords"'];
    help.hints.push('--filter uses Ancestry expressions such as 1|Category|SET=HistoricalRecords. Filters are sent unchanged.');
  }
  if (command.id === 'familysearch.api call' && typeof values.operation === 'string') {
    try {
      const {describeOperation} = await import('../familysearch/discovery.js');
      const operation = describeOperation(values.operation);
      help.examples = [operation.exampleCommand];
      help.inputExample = operation.example;
      help.hints.push(operation.inputNotes);
    } catch { /* Keep the original error even if local operation metadata is unavailable. */ }
  }
  return help;
}
