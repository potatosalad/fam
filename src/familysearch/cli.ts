import {readCommandFile as readFile, readCommandStdin} from '../shared/command-input.js';
import {inspectResult} from '../shared/diagnostics.js';
import { FamilySearchClient } from './client.js';
import { configureCredentials } from '../shared/credentials.js';
import { CREDENTIAL_DIR } from '../shared/storage.js';
import { operationContract, operationQueryInput } from './operations.js';
import { writeFile, chmod } from 'node:fs/promises';
import type { OperationName, OperationInput } from './generated/operations.js';
import { parseJson, stringifyJson } from '../shared/json.js';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { runResearchCli } from './research-cli.js';
import {describeOperation, discoverOperations} from './discovery.js';


export async function runProvider(argv: string[]): Promise<unknown> {
  const args = [...argv];
  const outputIndex = args.indexOf('--out');
  let output: string | undefined;
  if (outputIndex !== -1) {
    output = args[outputIndex + 1];
    if (!output || output.startsWith('--')) throw new Error('--out requires a file path.');
    args.splice(outputIndex, 2);
  }
  const [command, id, depth] = args;
  if (command === 'credentials') {
    if (args.length > 2 || id && id !== '--stdin') throw new Error('Use fam familysearch.credential set [--stdin].');
    await configureCredentials('familysearch', { stdin: id === '--stdin' });
    const data = { saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam familysearch.session login' };
    if (output) {await writeFile(resolve(output), stringifyJson(data, 2) + '\n', {mode: 0o600}); await chmod(resolve(output), 0o600); return {saved: resolve(output)};}
    return data;
  }
  if (args.includes('--stdin')) throw new Error('--stdin belongs to fam familysearch.credential set.');
  const research = await runResearchCli(args, output);
  if (research) return research.data;
  const supported = new Set(['auth','status','credentials','refresh','verify','whoami','metadata','person','ancestry','mobile-person','mobile-pedigree','tree-status','get','ops','schema','call']);
  if (!supported.has(command)) throw new Error(`Unknown command. Use "fam cli.command list --provider familysearch".`);
  const client = ['ops', 'schema'].includes(command) ? undefined! : await FamilySearchClient.open();
  let result: unknown;
  switch (command) {
    case 'ops': result = discoverOperations(id); break;
    case 'schema': {
      if (args.length > 3 || depth && depth !== '--example') throw new Error('Use fam familysearch.api describe --operation OPERATION [--example].');
      const description = describeOperation(required(id));
      result = depth === '--example' ? description.example : description; break;
    }
    case 'call': {
      const { positionals, values } = parseArgs({ args: args.slice(1), allowPositionals: true, options: { input: { type: 'string' }, query: { type: 'string', multiple: true } } });
      const [name, file] = positionals;
      required(name);
      if (positionals.length > 2 || file && values.input) throw new Error('Use one input file: a positional FILE or --input FILE|-.');
      operationContract(name);
      const source = values.input ?? file;
      const base = source ? parseJson(source === '-' ? await readStdin() : await readFile(resolve(source), 'utf8')) : {};
      const input = operationQueryInput(name, base, values.query ?? []);
      result = await client.operation(name as OperationName, input as OperationInput<OperationName>);
      break;
    }
    case 'auth': await client.login(); result = client.status(); break;
    case 'refresh': await client.refresh(); result = client.status(); break;
    case 'status': result = { ...client.status(), credentialDirectory: CREDENTIAL_DIR, note: 'Local status; use verify to check server access.' }; break;
    case 'whoami': result = await client.currentUser(); break;
    case 'metadata': result = await client.loginMetadata(); break;
    case 'tree-status': result = await client.treeStatus(); break;
    case 'person': result = await client.person(required(id)); break;
    case 'ancestry': result = await client.ancestry(required(id), depth === undefined ? 2 : Number(depth)); break;
    case 'mobile-person': result = await client.mobilePerson(required(id)); break;
    case 'mobile-pedigree': result = await client.mobilePedigree(required(id), depth === undefined ? 2 : Number(depth)); break;
    case 'get': result = await client.get(required(id)); break;
    case 'verify': {
      const user = await client.currentUser();
      if (!user.personId) throw new Error('Current user has no associated person ID.');
      const person = await client.person(user.personId);
      const ancestry = await client.ancestry(user.personId, 2);
      const mobilePerson = await client.mobilePerson(user.personId);
      const mobilePedigree = await client.mobilePedigree(user.personId, 2);
      result = { currentUser: 'ok', personCount: person.persons?.length, ancestryPersonCount: ancestry.persons?.length,
        mobilePerson: { status: 'ok', fields: Object.keys(mobilePerson) },
        mobilePedigree: { status: 'ok', fields: Object.keys(mobilePedigree) }, session: client.status() };
      break;
    }
  }
  if (output) {
    inspectResult(result);
    await writeFile(resolve(output), result instanceof Uint8Array ? result : `${stringifyJson(result ?? null, 2)}\n`, { mode: 0o600 });
    await chmod(resolve(output), 0o600);
    return {saved: resolve(output), ...(result instanceof Uint8Array ? {bytes: result.byteLength} : {})};
  }
  if (result instanceof Uint8Array) throw new Error('Binary responses require --out FILE.');
  return result ?? null;
}
function required(value?: string): string {
  if (!value) throw new Error('This command requires an ID or API path.');
  return value;
}
const readStdin = () => readCommandStdin(16 * 1024 * 1024, 'JSON input exceeded 16 MiB.');
