import { configureCredentials } from '../shared/credentials.js';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJson, stringifyJson } from '../shared/json.js';
import { CREDENTIAL_DIR, readPrivateJson } from '../shared/storage.js';
import { authenticateFindmypast, beginBrowserAuthorization, finishBrowserAuthorization, sessionStatus, type SavedFindmypastSession } from './auth.js';
import { importFindmypastHar } from './har.js';
import { FindmypastClient, searchFilters, type SearchFilter } from './client.js';
import { aliases, contracts, graphqlOperation, restOperation, type RestArguments } from './catalog.js';
import { downloadRecordImage, newspaperVariables, recordOrder, searchNewspapers } from './research.js';

const help = `Usage: fam findmypast COMMAND [arguments] [options]

Account
  credentials [--stdin]        Save login details (helper, environment, hidden prompt, or JSON stdin)
  auth                         Native password sign-in; never retried automatically
  auth --browser               Start the app's browser verification flow (PKCE)
  auth --callback-file FILE     Exchange the completed browser callback URL
  auth --har FILE               Import and validate a signed-in website HAR
  status                       Saved-session metadata; no tokens or live login
  refresh                      Renew native tokens or revalidate browser cookies
  me                           Current user profile
  subscription                 Current plan and subscription status

Genealogy and records
  trees [--limit N --offset N]
  tree TREE                    Tree settings
  people TREE                  People, tree metadata and root/last-viewed person IDs
  person TREE PERSON           Summary from the tree's family view
  relatives TREE PERSON        Family view around a person
  facts PERSON                 Personal/family/name facts and source citations
  hints TREE PERSON [--limit N --offset N]
  media PERSON [--limit N --offset N]
  search --first-name NAME --last-name NAME [--birth-year YYYY --death-year YYYY]
         [--year YYYY --keywords WORDS --collection NAME --exact --page N]
         [--country COUNTRY --year-range N --sort FIELD --descending]
         [--filters JSON_OR_FILE]   Extra input: {"filter":[{"field":"...","values":["..."]}]}
         Sort: relevance, first-name, last-name, birth, death, year, collection
  collections [TEXT] [--limit N --offset N]
  collection ID                Record-set metadata
  entitlement RECORD           Transcript access decision
  record RECORD                Transcript; does not confirm a credit purchase
  image RECORD                 Image details from the record gateway
  download RECORD --out FILE.jpg  Full-resolution image plus FILE.jpg.json source/checksum
  newspapers [--name NAME --keywords WORDS --exact --publication TITLE]
             [--country COUNTRY --county COUNTY --place PLACE]
             [--from YYYY-MM-DD --to YYYY-MM-DD --sort relevance|date --descending]
             [--limit N --offset N]  Repeat --name/--publication for multiple values
  newspaper-manifest ID         Newspaper image manifest

API catalog
  ops [FILTER]                 Search 110 GraphQL operations and 17 REST declarations
  schema NAME                  Exact APK document/variables or REST parameters
  models [FILTER]              Recovered input-object field inventories
  gql NAME [JSON_OR_FILE]       Execute an embedded query or mutation
  query FILE [JSON_OR_FILE]     Execute one named custom GraphQL operation
  call NAME [JSON_OR_FILE]      REST input: {path,query,headers,body,parts}
  get PATH                     Read a Titan path or approved API URL

Options
  --anonymous                  Use public endpoints without a saved session
  --query JSON_OR_FILE         REST query object
  --out FILE                   Atomic owner-only output (required for binary)
  --limit N                    Page size (default 20)
  --offset N                   List offset (default 0)
  --page N                     Record-search page number (default 1)
  --help                       Show this help

Credentials: FINDMYPAST_USERNAME + FINDMYPAST_PASSWORD. Run status to see storage. Credential helpers: fam --help.
JSON_OR_FILE accepts an inline object, a filename, or - for stdin. Keep IDs as strings.
Catalog mutations run when selected; GetTranscriptById has confirmedPurchase:true.
Use record for a transcript read without confirming a purchase.
See docs/findmypast/README.md for setup, examples, and limitations.
`;
async function writeOutput(path: string, output: string | Uint8Array) {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, output, {mode: 0o600, flag: 'wx'}); await rename(temporary, path); }
  finally { await rm(temporary, {force: true}); }
}
async function jsonInput(value?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  let text: string;
  if (value === '-') { const chunks: Buffer[] = []; for await (const part of process.stdin) chunks.push(Buffer.from(part)); text = Buffer.concat(chunks).toString(); }
  else text = value.trimStart().startsWith('{') ? value : await readFile(value, 'utf8');
  let parsed: unknown; try { parsed = parseJson(text); } catch { throw new Error('Input must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Input must be a JSON object.');
  return parsed as Record<string, unknown>;
}
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, out: {type: 'string'}, anonymous: {type: 'boolean'}, browser: {type: 'boolean'},
    'callback-file': {type: 'string'}, har: {type: 'string'}, limit: {type: 'string'}, offset: {type: 'string'}, page: {type: 'string'},
    query: {type: 'string'}, 'first-name': {type: 'string'}, 'last-name': {type: 'string'},
    'birth-year': {type: 'string'}, 'death-year': {type: 'string'}, year: {type: 'string'}, keywords: {type: 'string'},
    collection: {type: 'string'}, exact: {type: 'boolean'}, filters: {type: 'string'},
    country: {type: 'string'}, 'year-range': {type: 'string'}, sort: {type: 'string'}, descending: {type: 'boolean'},
    name: {type: 'string', multiple: true}, publication: {type: 'string', multiple: true},
    county: {type: 'string'}, place: {type: 'string'}, from: {type: 'string'}, to: {type: 'string'},
  }});
  const [command = 'help', first, second] = positionals;
  if (command === 'help' || values.help) { console.log(help); return; }
  if (values.stdin && command !== 'credentials') throw new Error('--stdin belongs to fam findmypast credentials.');
  const arity: Record<string, [number, number]> = {credentials: [0,0], auth: [0,0], status: [0,0], refresh: [0,0], me: [0,0], subscription: [0,0], trees: [0,0],
    tree: [1,1], people: [1,1], person: [2,2], relatives: [2,2], facts: [1,1], hints: [2,2], media: [1,1], search: [0,0],
    collections: [0,1], collection: [1,1], entitlement: [1,1], record: [1,1], image: [1,1], download: [1,1], newspapers: [0,0], 'newspaper-manifest': [1,1],
    ops: [0,1], models: [0,1], schema: [1,1], gql: [1,2], query: [1,2], call: [1,2], get: [1,1]};
  const expected = arity[command];
  if (!expected) throw new Error(`Unknown command ${command}; see fam findmypast --help.`);
  if (positionals.length - 1 < expected[0] || positionals.length - 1 > expected[1]) throw new Error(`Invalid arguments for findmypast ${command}; see --help.`);
  if (command !== 'auth' && (values.browser || values['callback-file'] || values.har)) throw new Error('Browser authorization options belong to auth.');
  if ([values.browser, values['callback-file'], values.har].filter(Boolean).length > 1) throw new Error('Use --browser, --callback-file, or --har, one at a time.');
  if (command === 'download' && (!values.out || !/\.jpe?g$/i.test(values.out))) throw new Error('download requires --out FILE.jpg (JPEG output).');
  if (command !== 'newspapers' && [values.name, values.publication, values.county, values.place, values.from, values.to].some(v => v !== undefined)) throw new Error('--name, --publication, --county, --place, --from and --to belong to newspapers.');
  if (command !== 'search' && values['year-range'] !== undefined) throw new Error('--year-range belongs to search.');
  if (!['search', 'newspapers'].includes(command) && (values.sort !== undefined || values.descending || values.country !== undefined)) throw new Error('--sort, --descending and --country belong to search or newspapers.');
  if (command === 'newspapers' && [values['first-name'], values['last-name'], values['birth-year'], values['death-year'], values.year, values.collection, values.filters, values.page].some(v => v !== undefined)) throw new Error('For newspapers use --name, --publication, --from/--to and --offset; record-search flags do not apply.');
  if (command === 'search' && (values.limit !== undefined || values.offset !== undefined)) throw new Error('Record search uses --page with the service page size; --limit/--offset do not apply.');
  const integer = (value: string | undefined, fallback: number, min: number) => {
    const n = value === undefined ? fallback : Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > 2147483647) throw new Error(`Expected an integer of at least ${min}.`);
    return n;
  };
  const limit = integer(values.limit, 20, 1), offset = integer(values.offset, 0, 0), page = integer(values.page, 1, 1);
  const year = (value?: string) => value === undefined ? undefined : integer(value, 0, 1);
  let result: unknown;
  let sidecar: unknown;
  if (command === 'status') result = {credentialDirectory: CREDENTIAL_DIR, ...sessionStatus(await readPrivateJson<SavedFindmypastSession>('findmypast/session.json')),
    browserAuthorizationPending: Boolean(await readPrivateJson('findmypast/pending-auth.json')),
    nativeVerificationRequired: Boolean(await readPrivateJson('findmypast/verification-required.json'))};
  else if (command === 'credentials') { await configureCredentials('findmypast', {stdin: values.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam findmypast auth'}; }
  else if (command === 'auth') {
    result = values.har ? sessionStatus(await importFindmypastHar(values.har)) : values.browser ? await beginBrowserAuthorization() : sessionStatus(values['callback-file'] ?
      await finishBrowserAuthorization(await readFile(values['callback-file'], 'utf8')) : await authenticateFindmypast());
  } else if (command === 'ops') {
    result = [...contracts.graphql.map(op => ({name: op.name, kind: op.kind, variables: op.variables})),
      ...contracts.rest.map(op => ({name: op.id, kind: op.method, path: op.path, aliases: Object.keys(aliases).filter(k => aliases[k] === op.id)}))]
      .filter(op => stringifyJson(op).toLowerCase().includes((first ?? '').toLowerCase()));
  } else if (command === 'models') result = contracts.models.filter(m => m.name.toLowerCase().includes((first ?? '').toLowerCase()));
  else if (command === 'schema') result = contracts.graphql.some(op => op.name === first || op.id === first) ? graphqlOperation(first!) : restOperation(first!);
  else {
    const query = await jsonInput(values.query) as RestArguments['query'];
    const input = ['gql', 'query', 'call'].includes(command) ? await jsonInput(second) : {};
    const filter = command === 'search' ? searchFilters({firstName: values['first-name'], lastName: values['last-name'],
      birthYear: year(values['birth-year']), deathYear: year(values['death-year']), year: year(values.year), keywords: values.keywords,
      country: values.country, yearRange: values['year-range'] === undefined ? undefined : integer(values['year-range'], 0, 0),
      collection: values.collection, exact: values.exact, filters: (await jsonInput(values.filters)).filter as SearchFilter[] | undefined}) : [];
    const order = command === 'search' ? recordOrder(values.sort, values.descending) : undefined;
    const newspaperOptions = {names: values.name, keywords: values.keywords, exact: values.exact, publications: values.publication,
      country: values.country, county: values.county, place: values.place, from: values.from, to: values.to, sort: values.sort, descending: values.descending, limit, offset};
    if (command === 'newspapers') newspaperVariables(newspaperOptions);
    const client = await FindmypastClient.open(values.anonymous);
    switch (command) {
      case 'refresh': await client.refresh(); result = client.status(); break;
      case 'me': result = await client.me(); break;
      case 'subscription': result = await client.graphql('GetSubscription'); break;
      case 'trees': result = await client.trees(limit, offset); break;
      case 'tree': result = await client.tree(first!); break;
      case 'people': result = await client.people(first!); break;
      case 'person': result = await client.person(first!, second!); break;
      case 'relatives': result = await client.relatives(first!, second!); break;
      case 'facts': result = await client.facts(first!); break;
      case 'hints': result = await client.hints(first!, second!, limit, offset); break;
      case 'media': result = await client.media(first!, limit, offset); break;
      case 'search': result = await client.search(filter, page, order); break;
      case 'newspapers': result = await searchNewspapers(client, newspaperOptions); break;
      case 'download': { const download = await downloadRecordImage(client, first!); result = download.bytes; sidecar = download.metadata; break; }
      case 'collections': result = await client.collections(first, limit, offset); break;
      case 'collection': result = await client.graphql('recordSetInformation', {recordMetadataId: first}); break;
      case 'entitlement': result = await client.graphql('GetTranscriptEntitlement', {recordId: first}); break;
      case 'record': result = await client.record(first!); break;
      case 'image': result = await client.call('image.details', {path: {id: first!}}); break;
      case 'newspaper-manifest': result = await client.call('newspaper.manifest', {path: {id: first!}}); break;
      case 'gql': result = await client.graphql(first!, input); break;
      case 'query': result = await client.query(await readFile(first!, 'utf8'), input); break;
      case 'call': {
        const args = input as RestArguments & {parts?: Record<string, {file?: string; value?: string; type?: string}>};
        if (args.parts) {
          const form = new FormData();
          for (const [key, part] of Object.entries(args.parts)) {
            if (part.file) form.append(key, new Blob([new Uint8Array(await readFile(part.file))], {type: part.type ?? 'application/octet-stream'}), basename(part.file));
            else if (part.value !== undefined) form.append(key, part.value);
            else throw new Error('Each multipart part requires file or value.');
          }
          args.body = form;
        }
        result = await client.call(first!, {...args, query: {...args.query, ...query}}); break;
      }
      case 'get': result = (await client.request(first!, {query})).data; break;
    }
  }
  if (result instanceof Uint8Array && !values.out) throw new Error('Binary results require --out FILE.');
  const output = result instanceof Uint8Array ? result : `${stringifyJson(result ?? null, 2)}\n`;
  if (values.out) {
    await writeOutput(values.out, output);
    if (sidecar) await writeOutput(`${values.out}.json`, `${stringifyJson(sidecar, 2)}\n`);
    console.log(`Saved ${values.out}`);
    if (sidecar) console.log(`Saved ${values.out}.json`);
  } else process.stdout.write(output as string);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Findmypast command failed.'); process.exitCode = 1; });
