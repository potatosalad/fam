import { FamilySearchClient } from './client.js';
import { configureCredentials } from '../shared/credentials.js';
import { CREDENTIAL_DIR } from '../shared/storage.js';
import { listOperations, operationContract, operationExample, operationQueryInput } from './operations.js';
import { writeFile, chmod, readFile } from 'node:fs/promises';
import type { OperationName, OperationInput } from './generated/operations.js';
import { parseJson, stringifyJson } from '../shared/json.js';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { researchHelp, runResearchCli } from './research-cli.js';

const help = `FamilySearch CLI

fam familysearch auth                    Authenticate and save the session
fam familysearch status                  Inspect local session status (no tokens)
fam familysearch credentials [--stdin]   Save login details (helper, environment, hidden prompt, or JSON stdin)
fam familysearch refresh                 Renew the saved access token
fam familysearch verify                  Read-only live smoke test, summarized
fam familysearch whoami                  Read the current user
fam familysearch metadata                Read mobile login metadata (tokens removed)
fam familysearch person ID               Read a GEDCOM X person
fam familysearch ancestry ID [DEPTH]      Read GEDCOM X ancestors (default 2)
fam familysearch mobile-person ID        Read the mobile v2 person DTO
fam familysearch mobile-pedigree ID [DEPTH]
fam familysearch tree-status
fam familysearch get /platform/...       GET an API path (quote query strings)
fam familysearch ops [GROUP]             List typed genealogy operations
fam familysearch schema OPERATION [--example]  Show contract or correctly nested example
fam familysearch call OPERATION [FILE] [--input FILE|-] [--query key=value ...]
${researchHelp}

Append --out FILE to save JSON with mode 0600 instead of printing it.
Set FAM_CONFIG_DIR to an absolute path to override the user config directory.
Run status to see the directory. Credentials: FAMILYSEARCH_USERNAME + FAMILYSEARCH_PASSWORD.
`;

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--out');
  let output: string | undefined;
  if (outputIndex !== -1) {
    output = args[outputIndex + 1];
    if (!output || output.startsWith('--')) throw new Error('--out requires a file path.');
    args.splice(outputIndex, 2);
  }
  const [command, id, depth] = args;
  if (!command || command === 'help' || args.includes('--help') || args.includes('-h')) { console.log(help); return; }
  if (command === 'credentials') {
    if (args.length > 2 || id && id !== '--stdin') throw new Error('Use fam familysearch credentials [--stdin].');
    await configureCredentials('familysearch', { stdin: id === '--stdin' });
    console.log(stringifyJson({ saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam familysearch auth' }, 2));
    return;
  }
  if (args.includes('--stdin')) throw new Error('--stdin belongs to fam familysearch credentials.');
  if (await runResearchCli(args, output)) return;
  const supported = new Set(['auth','status','credentials','refresh','verify','whoami','metadata','person','ancestry','mobile-person','mobile-pedigree','tree-status','get','ops','schema','call']);
  if (!supported.has(command)) throw new Error(`Unknown command. Use "fam familysearch --help".`);
  const client = await FamilySearchClient.open();
  let result: unknown;
  switch (command) {
    case 'ops': result = listOperations(id).map(({ name, method, path }) => ({ name, method, path })); break;
    case 'schema': {
      if (args.length > 3 || depth && depth !== '--example') throw new Error('Use fam familysearch schema OPERATION [--example].');
      result = depth === '--example' ? operationExample(required(id)) : operationContract(required(id)); break;
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
    await writeFile(resolve(output), result instanceof Uint8Array ? result : `${stringifyJson(result ?? null, 2)}\n`, { mode: 0o600 });
    await chmod(resolve(output), 0o600);
    console.log(`Saved ${resolve(output)}`);
  } else console.log(stringifyJson(result instanceof Uint8Array ? { bytes: result.byteLength, note: 'Use --out to save the binary response.' } : result ?? { status: 'ok' }, 2));
}
function required(value?: string): string {
  if (!value) throw new Error('This command requires an ID or API path.');
  return value;
}
async function readStdin(): Promise<string> {
  let input = '', bytes = 0;
  // Preserve names with UTF-8 characters split across stream chunks.
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 16 * 1024 * 1024) throw new Error('JSON input exceeded 16 MiB.');
    input += chunk;
  }
  return input;
}
main().catch(error => {
  console.error((error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'Output or provenance file already exists; choose a new --out path.' : error instanceof Error ? error.message : 'Operation failed.');
  process.exitCode = 1;
});
