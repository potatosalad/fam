import { configureCredentials } from '../shared/credentials.js';
import { parseArgs } from 'node:util';
import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { parseJson, stringifyJson } from '../shared/json.js';
import { CREDENTIAL_DIR, readPrivateJson } from '../shared/storage.js';
import { AncestryClient } from './client.js';
import { authenticateAncestry, sendAncestryCode, verifyAncestryCode, type AncestrySession } from './auth.js';
import { aliases, contracts, graphqlOperation, restOperation, type GraphQLName, type RestArguments } from './catalog.js';

const help = `Usage: fam ancestry COMMAND [arguments] [options]

Account
  auth                         Sign in using configured or saved credentials
  auth --send-code              Send the pending email verification code
  auth --code CODE              Finish verification and save tokens
  credentials [--stdin]        Save login details (helper, environment, hidden prompt, or JSON stdin)
  status                       Show saved session metadata without tokens
  refresh                      Refresh and persist the session

Genealogy
  trees [--limit N] [--cursor CURSOR]
  tree TREE                    Tree metadata and root person ID
  persons TREE                 First person connection (see docs for bulk paging)
  person TREE PERSON           Person details
  relatives TREE PERSON        Ancestors, descendants, siblings, spouses
  research TREE PERSON         Facts, citations, and research details
  story TREE PERSON            Life story and person card
  hints TREE PERSON [--limit N]
  media TREE PERSON            Person media
  citations TREE [--page N]     Cached tree citations
  sources TREE [--page N]       Cached tree sources
  record COLLECTION RECORD     Record fields, collection metadata and rights
  search --given NAME --surname NAME [--birth-year YYYY] [--birth-place PLACE]
         [--death-year YYYY] [--death-place PLACE] [--limit N] [--page N]
         [--cursor TOKEN] [--filter EXPRESSION ...]
  places PREFIX                Place-name autocomplete

API catalog
  ops [FILTER]                 Search REST routes, aliases, and GraphQL names
  schema OPERATION             Show route/parameters or GraphQL document/variables
  gql NAME [JSON_OR_FILE]       Execute an embedded query or mutation
  call OPERATION [JSON_OR_FILE] Execute REST; input: {path,query,headers,body,base}
  get PATH                     Read an evidenced Ancestry API URL/path

Options
  --query JSON_OR_FILE          REST query parameters (also relatives/media/etc.)
  --out FILE                    Save JSON with owner-only file permissions
  --limit N                    Page size (default 20)
  --page N                     REST/search page (default 1)
  --cursor VALUE               Next-page cursor/token where supported
  --base URL                   Base for REST declarations without a confirmed mapping
  --help                       Show this help

Set FAM_CONFIG_DIR to override the user config directory (absolute path).
Credentials: ANCESTRY_USERNAME + ANCESTRY_PASSWORD. Run status to see storage. Credential helpers: fam --help.
JSON_OR_FILE accepts inline JSON, a filename, or - for stdin. IDs should be strings.
Pagination is explicit; responses contain the service's next-page information.
Mutations/writes run only when you explicitly select them. See docs/ancestry/README.md.
`;

async function jsonInput(value?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  let text: string;
  if (value === '-') { const chunks: Buffer[] = []; for await (const part of process.stdin) chunks.push(Buffer.from(part)); text = Buffer.concat(chunks).toString(); }
  else text = value.trimStart().startsWith('{') ? value : await readFile(value, 'utf8');
  let parsed: unknown;
  try { parsed = parseJson(text); } catch { throw new Error('Input must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Input must be a JSON object.');
  return parsed as Record<string, unknown>;
}
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, out: {type: 'string'}, code: {type: 'string'}, 'send-code': {type: 'boolean'},
    limit: {type: 'string'}, page: {type: 'string'}, cursor: {type: 'string'}, query: {type: 'string'}, base: {type: 'string'},
    given: {type: 'string'}, surname: {type: 'string'}, 'birth-year': {type: 'string'}, 'birth-place': {type: 'string'},
    'death-year': {type: 'string'}, 'death-place': {type: 'string'}, filter: {type: 'string', multiple: true},
  }});
  const [command = 'help', first, second] = positionals;
  if (command === 'help' || values.help) { console.log(help); return; }
  if (values.stdin && command !== 'credentials') throw new Error('--stdin belongs to fam ancestry credentials.');
  const arity: Record<string, number> = {status: 0, credentials: 0, auth: 0, refresh: 0, trees: 0, search: 0, ops: 1, schema: 1,
    tree: 1, persons: 1, person: 2, relatives: 2, research: 2, story: 2, hints: 2, media: 2, citations: 1, sources: 1,
    record: 2, places: 1, gql: 2, call: 2, get: 1};
  if (arity[command] !== undefined && positionals.length - 1 > arity[command]!) throw new Error(`Too many arguments for ancestry ${command}.`);
  if (command !== 'auth' && (values.code || values['send-code'])) throw new Error('Verification options belong to fam ancestry auth.');
  const need = (value: string | undefined, label: string): string => { if (!value) throw new Error(`Missing ${label}. See fam ancestry --help.`); return value; };
  const integer = (value: string | undefined, fallback: number): number => { const n = value === undefined ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error('Expected a positive integer.'); return n; };
  const limit = integer(values.limit, 20), page = integer(values.page, 1);
  let result: unknown;
  if (command === 'status') {
    const session = await readPrivateJson<AncestrySession>('ancestry/session.json');
    result = {credentialDirectory: CREDENTIAL_DIR, authenticated: Boolean(session?.tokens?.user_id && session.tokens.access_token), savedAt: session?.savedAt,
      expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      verificationPending: Boolean(await readPrivateJson('ancestry/pending-auth.json'))};
  } else if (command === 'credentials') { await configureCredentials('ancestry', {stdin: values.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam ancestry auth'}; }
  else if (command === 'auth') {
    if (values['send-code'] && values.code) throw new Error('Use --send-code or --code, one at a time.');
    if (values['send-code']) result = await sendAncestryCode();
    else { const session = values.code ? await verifyAncestryCode(values.code) : await authenticateAncestry(); result = new AncestryClient(session).status(); }
  } else if (command === 'ops') {
    const filter = (first ?? '').toLowerCase();
    result = [
      ...Object.entries(aliases).map(([name]) => ({name, kind: 'REST alias', method: restOperation(name).method, path: restOperation(name).path})),
      ...contracts.graphql.map(op => ({name: op.name, kind: op.kind, variables: op.variables})),
      ...contracts.rest.map(op => ({name: op.id, kind: 'REST declaration', method: op.method, path: op.path})),
    ].filter(op => stringifyJson(op).toLowerCase().includes(filter));
  } else if (command === 'schema') {
    const name = need(first, 'operation');
    result = contracts.graphql.some(op => op.name === name || op.id === name) ? graphqlOperation(name) : restOperation(name);
  } else {
    const known = ['refresh', 'trees', 'tree', 'persons', 'person', 'relatives', 'research', 'story', 'hints', 'media', 'citations', 'sources', 'record', 'search', 'places', 'gql', 'call', 'get'];
    if (!known.includes(command)) throw new Error(`Unknown command ${command}. See fam ancestry --help.`);
    if (!['refresh', 'trees', 'search'].includes(command)) need(first, command === 'call' || command === 'gql' ? 'operation' : 'argument');
    if (['person', 'relatives', 'research', 'story', 'hints', 'media'].includes(command)) need(second, 'person ID');
    if (command === 'record') need(second, 'record ID');
    const query = await jsonInput(values.query) as RestArguments['query'];
    const client = await AncestryClient.open();
    const path = {treeId: first!, personId: second!};
    switch (command) {
      case 'refresh': await client.refresh(); result = client.status(); break;
      case 'trees': result = await client.trees(limit, values.cursor); break;
      case 'tree': result = await client.tree(first!); break;
      case 'persons': result = await client.graphql('GetPersons', {treeId: first!}); break;
      case 'person': result = await client.person(first!, second!); break;
      case 'relatives': result = await client.relatives(first!, second!, query); break;
      case 'research': result = await client.research(first!, second!); break;
      case 'story': result = await client.call('persons.story', {path, query}); break;
      case 'hints': result = await client.hints(first!, second!, limit); break;
      case 'media': result = await client.call('media.forPerson', {path: {treeid: first!, personid: second!}, query: {limit, page, ...query}}); break;
      case 'citations': case 'sources': result = await client.call(`cache.${command}`, {path, query: {limit, page, ...query}}); break;
      case 'record': result = await client.record(first!, second!); break;
      case 'search': result = await client.search({given: values.given, surname: values.surname,
        birthYear: values['birth-year'] === undefined ? undefined : integer(values['birth-year'], 0), birthPlace: values['birth-place'],
        deathYear: values['death-year'] === undefined ? undefined : integer(values['death-year'], 0), deathPlace: values['death-place'],
        limit, page, pagingToken: values.cursor, filters: values.filter}); break;
      case 'places': result = await client.call('places.search', {query: {prefix: first, maxCount: limit, cultureId: 'en-US', ...query}}); break;
      case 'gql': result = await client.graphql(graphqlOperation(first!).name as GraphQLName, await jsonInput(second) as never); break;
      case 'call': { const args = await jsonInput(second) as RestArguments; result = await client.call(first!, {...args, ...(values.base ? {base: values.base} : {}), query: {...args.query, ...query}}); break; }
      case 'get': result = (await client.request(first!, {query})).data; break;
    }
  }
  const output = `${stringifyJson(result ?? null, 2)}\n`;
  if (values.out) {
    await mkdir(dirname(values.out), {recursive: true, mode: 0o700});
    const temporary = `${values.out}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, output, {mode: 0o600, flag: 'wx'}); await rename(temporary, values.out); }
    finally { await rm(temporary, {force: true}); }
    console.log(`Saved ${values.out}`);
  } else process.stdout.write(output);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Ancestry command failed.'); process.exitCode = 1; });
