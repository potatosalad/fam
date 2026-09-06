import { configureCredentials } from '../credentials.js';
import {buildRecordSearch, recordUrl, contextId, researchPage, type RecordSearchOptions, type CatalogOptions, type ResearchEvent} from './research.js';
import {parse} from 'graphql';
import {transferMyHeritage} from './http.js';
import { parseArgs } from 'node:util';
import { readFile, writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { parseJson, stringifyJson } from '../json.js';
import { CREDENTIAL_DIR, readPrivateJson } from '../storage.js';
import { MyHeritageClient } from './client.js';
import { authenticateMyHeritage, importMyHeritageHar, type MyHeritageSession } from './auth.js';
import { aliases, contracts, graphqlOperation, restOperation, prepareRest, validateVariables, type RestArguments } from './catalog.js';
const help = `Usage: myheritage COMMAND [arguments] [options]

Account
  auth                         Native login using environment or saved credentials
  auth --har FILE              Import your own successful browser API session from HAR
  auth --code CODE              Native MFA; --verification-code CODE for verification
  credentials [--stdin]        Save login details (hidden prompt, environment, or JSON stdin)
  status                       Show saved session metadata without secrets
  refresh                      Renew the saved API token

Historical record research
  search [JSON_OR_FILE]         Search historical records by name, dates, places, relatives
  record URL                   Record fields, citation and image links; --related for leads
  catalog                      Browse/filter historical record collections
  collections NAME             Find collections by title/description
  collection ID                Collection details and supported search fields
  search-fields COLLECTION     Discover collection-specific field names, types and choices
  document URL                 Original document pages, image URLs and embedded text
  download-document URL        Download a page; --page N --out FILE (plus FILE.json source)

Genealogy
  me                           Account and default tree
  sites                        Family sites
  trees SITE                   Trees in a family site
  tree TREE                    Tree details
  people TREE                  People, with --offset and --limit
  find TREE NAME               Find a person in that tree
  person PERSON                Full details, relatives, facts and record counts
  insights PERSON              Website family groups, event facts, citations and notes
  family FAMILY                Family object
  events PERSON                Events for a person
  timeline PERSON              Timeline events
  facts PERSON                 Existing facts
  matches PERSON               Smart and record matches
  records PERSON               Attached records (--match-status confirmed)
  media PARENT                 Photos/media for a person, tree or site
  albums SITE                  Photo albums
  consistency TREE             Cached tree consistency issues

Complete APK catalog
  ops [FILTER]                 Search aliases, REST declarations and GraphQL documents
  schema OPERATION             Parameters, types, route and complete query document
  models [FILTER]              Recovered FamilyGraph model fields
  gql OPERATION [JSON_OR_FILE]  Execute any recovered query or mutation
  call OPERATION [JSON_OR_FILE] Execute REST: {path,query,headers,body,bodyFile,url,response}
  query DOCUMENT_FILE [JSON]   Execute a custom GraphQL document and variables
  get PATH                     Read a FamilyGraph URL/path; --query JSON

Options
  --first-name NAME --last-name NAME --gender M|F
  --first-name-match MODE       exact, similar, initials, prefix
  --last-name-match MODE        exact, similar, soundex, metaphone, prefix
  --no-translations            Disable translated-name matching
  --field NAME=VALUE           Collection-specific criterion; repeatable, accepts JSON
  --birth-year YEAR --birth-place PLACE
  --death-year YEAR --death-place PLACE
  --residence-year YEAR --residence-place PLACE
  --marriage-year YEAR --marriage-place PLACE
  --birth-year-range N          +/- years; also death/residence/marriage-year-range
  --place PLACE --keyword TEXT  Any-event place and keywords for record search
  --exact                      Exact names, years and places
  --collection ID --category ID Select one scope for record search
  --record-type TYPE           historical (default without scope), family-trees, all
  Scoped search includes all record types; do not combine a type filter with a scope.
  --after CURSOR               Continue within a split result page; preserve original offset
  --location ID --years ID --images  Collection-catalog filters
  --related                    Include related record/person leads with record
  --page N                     Document page to download (starts at 1; default 1)
  --related-document KEY       Select a related document from the viewer manifest
  --query JSON_OR_FILE          Additional REST query parameters, e.g. fields
  --limit N --offset N          Explicit pagination (defaults: 20, 0)
  --out FILE                    Save results with owner-only permissions
  --recaptcha-token-file FILE   Native login token obtained through legitimate verification
  --help                       Show help

Browser sessions: me, sites, trees, tree, people, find, person, events, timeline,
facts, media (person), insights, matches (counts), and all historical record research commands.
The remaining APK catalog operations need native auth.
Browser sites covers the captured site; people lists its visible tree neighborhood.

Set FAMILYSEARCH_CONFIG_DIR to override the user config directory (absolute path).
Credentials: MYHERITAGE_USERNAME + MYHERITAGE_PASSWORD. Run status to see storage.
JSON_OR_FILE accepts inline JSON, a filename, or - for stdin. Keep IDs as strings.
Multipart call input: {parts:{data:{value:"JSON"},file:{file:"photo.jpg",type:"image/jpeg"}}}.
Writes run when you select a mutation or write operation. API access follows your account rights.
See docs/myheritage/README.md for installation, authentication and coverage limits.
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
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, out: {type: 'string'}, har: {type: 'string'},
    code: {type: 'string'}, 'verification-code': {type: 'string'}, 'recaptcha-token-file': {type: 'string'},
    'first-name': {type: 'string'}, 'last-name': {type: 'string'}, 'birth-year': {type: 'string'}, 'birth-place': {type: 'string'},
    'death-year': {type: 'string'}, 'death-place': {type: 'string'}, place: {type: 'string'}, keyword: {type: 'string'},
    gender: {type: 'string'}, 'first-name-match': {type: 'string'}, 'last-name-match': {type: 'string'},
    'no-translations': {type: 'boolean'}, field: {type: 'string', multiple: true},
    'residence-year': {type: 'string'}, 'residence-place': {type: 'string'},
    'marriage-year': {type: 'string'}, 'marriage-place': {type: 'string'},
    'birth-year-range': {type: 'string'}, 'death-year-range': {type: 'string'},
    'residence-year-range': {type: 'string'}, 'marriage-year-range': {type: 'string'},
    page: {type: 'string'}, 'related-document': {type: 'string'},
    exact: {type: 'boolean'}, collection: {type: 'string'}, category: {type: 'string'}, 'record-type': {type: 'string'}, after: {type: 'string'},
    location: {type: 'string'}, years: {type: 'string'}, images: {type: 'boolean'}, related: {type: 'boolean'},
    limit: {type: 'string'}, offset: {type: 'string'}, query: {type: 'string'}, 'match-status': {type: 'string'},
  }});
  const [command = 'help', first, second] = positionals;
  if (command === 'help' || values.help) {console.log(help); return;}
  if (values.stdin && command !== 'credentials') throw new Error('--stdin belongs to myheritage credentials.');
  const arity: Record<string, number> = {auth: 0, status: 0, credentials: 0, refresh: 0, me: 0, sites: 0, catalog: 0,
    search: 1, record: 1, collection: 1, 'search-fields': 1, document: 1, 'download-document': 1, insights: 1, trees: 1, tree: 1, people: 1, person: 1, family: 1, events: 1, timeline: 1, facts: 1, matches: 1, records: 1,
    media: 1, albums: 1, consistency: 1, collections: 1, get: 1, find: 2, gql: 2, call: 2, query: 2, ops: 1, schema: 1, models: 1};
  if (!(command in arity)) throw new Error(`Unknown command ${command}; see myheritage --help.`);
  if (positionals.length - 1 > arity[command]!) throw new Error(`Too many arguments for myheritage ${command}.`);
  if (command !== 'auth' && (values.har || values.code || values['verification-code'] || values['recaptcha-token-file'])) throw new Error('Authentication flags belong to myheritage auth.');
  const need = (v: string | undefined, label: string) => {if (!v) throw new Error(`Missing ${label}; see myheritage --help.`); return v;};
  if (arity[command] && !['ops', 'models', 'search'].includes(command)) need(first, 'argument');
  if (command === 'find') need(second, 'name');
  const integer = (v: string | undefined, fallback: number, min: number) => {const n = v === undefined ? fallback : Number(v); if (!Number.isSafeInteger(n) || n < min) throw new Error(`Expected an integer >= ${min}.`); return n;};
  const limit = integer(values.limit, 20, 1), offset = integer(values.offset, 0, 0);
  const searchFlags = ['first-name','last-name','birth-year','birth-place','death-year','death-place','place','keyword','exact','collection','record-type','after','gender','first-name-match','last-name-match','no-translations','field','residence-year','residence-place','marriage-year','marriage-place','birth-year-range','death-year-range','residence-year-range','marriage-year-range'];
  const flags = values as Record<string, unknown>;
  if (command !== 'search' && searchFlags.some(k => flags[k] !== undefined)) throw new Error('Record-search flags belong to myheritage search.');
  if (!['search','catalog','collections'].includes(command) && values.category) throw new Error('--category belongs to search, catalog or collections.');
  if (!['catalog','collections'].includes(command) && ['location','years','images'].some(k => flags[k] !== undefined)) throw new Error('Catalog filters belong to catalog or collections.');
  if (values.related && command !== 'record') throw new Error('--related belongs to myheritage record.');
  if (['search','record','catalog','collections','collection','search-fields'].includes(command) && (values.query || values['match-status'])) throw new Error('--query and --match-status are not research filters; use the documented search JSON or flags.');
  const documentCommands = ['document','download-document'];
  if (values.page !== undefined && command !== 'download-document') throw new Error('--page belongs to download-document.');
  if (values['related-document'] && !documentCommands.includes(command)) throw new Error('--related-document belongs to document or download-document.');
  if (documentCommands.includes(command) && (values.query || values.limit || values.offset || values['match-status'])) throw new Error('Document commands use --page, not query or result pagination.');
  const documentPage = integer(values.page, 1, 1);
  if (command === 'download-document') need(values.out, '--out FILE');
  let searchOptions: RecordSearchOptions | undefined;
  if (command === 'search') {
    searchOptions = await jsonInput(first) as RecordSearchOptions;
    const input = searchOptions as Record<string, unknown>;
    for (const [flag, key] of Object.entries({'first-name':'firstName','last-name':'lastName',keyword:'keywords',exact:'exact',collection:'collection',category:'category','record-type':'recordType',after:'after',gender:'gender','first-name-match':'firstNameMatch','last-name-match':'lastNameMatch'})) {
      if (flags[flag] !== undefined) input[key] = flags[flag];
    }
    if (values['no-translations']) searchOptions.translations = false;
    if (values.field) {
      const fields = {...searchOptions.fields};
      for (const item of values.field) {
        const equal = item.indexOf('=');
        if (equal < 1 || equal === item.length - 1) throw new Error('--field requires NAME=VALUE.');
        const key = item.slice(0,equal), raw = item.slice(equal+1);
        let value: unknown = raw;
        try {value = JSON.parse(raw);} catch {if (/^[{[]/.test(raw)) throw new Error('Structured --field values must be valid JSON.');}
        Object.defineProperty(fields,key,{value,enumerable:true,configurable:true,writable:true});
      }
      searchOptions.fields = fields;
    }
    const extraEvents: ResearchEvent[] = [];
    for (const type of ['birth','death','residence','marriage'] as const) {
      const year = values[`${type}-year`], place = values[`${type}-place`], range = values[`${type}-year-range`];
      if (range !== undefined && year === undefined) throw new Error(`--${type}-year-range requires --${type}-year.`);
      if (year !== undefined || place) extraEvents.push({type, ...(year !== undefined ? {year: Number(year)} : {}), ...(place ? {place} : {}), ...(range !== undefined ? {yearRange: Number(range)} : {})});
    }
    if (values.place) extraEvents.push({type: 'any', place: values.place});
    if (extraEvents.length) searchOptions.events = [...(searchOptions.events ?? []), ...extraEvents];
    if (values.limit !== undefined) searchOptions.limit = limit;
    if (values.offset !== undefined) searchOptions.offset = offset;
    buildRecordSearch(searchOptions); // Validate before loading a session or making a request.
  }
  if (command === 'record' || documentCommands.includes(command)) recordUrl(first!);
  if (['collection','search-fields'].includes(command)) contextId(first!, 'collection');
  const catalogOptions: CatalogOptions = {limit, offset, ...(values.category ? {category: values.category} : {}), ...(values.location ? {location: values.location} : {}), ...(values.years ? {years: values.years} : {}), ...(values.images ? {images: true} : {})};
  if (['catalog','collections'].includes(command)) {researchPage(limit, offset); if (values.category) contextId(values.category, 'category');}
  let result: unknown;
  if (command === 'status') {
    const s = await readPrivateJson<MyHeritageSession>('myheritage/session.json');
    result = {credentialDirectory: CREDENTIAL_DIR, authenticated: !!s?.accessToken, mode: s?.mode ?? 'native', savedAt: s?.savedAt,
      verificationPending: !!await readPrivateJson('myheritage/pending-auth.json'), blockedUntil: (await readPrivateJson<{blockedUntil?: string}>('myheritage/login-block.json'))?.blockedUntil};
  } else if (command === 'credentials') {await configureCredentials('myheritage', {stdin: values.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'myheritage auth'};}
  else if (command === 'auth') {
    if (values.har && (values.code || values['verification-code'] || values['recaptcha-token-file'])) throw new Error('HAR import and native login flags cannot be combined.');
    const session = values.har ? await importMyHeritageHar(await readFile(values.har, 'utf8')) : await authenticateMyHeritage({code: values.code,
      verificationCode: values['verification-code'], recaptchaToken: values['recaptcha-token-file'] ? (await readFile(values['recaptcha-token-file'], 'utf8')).trim() : undefined});
    result = new MyHeritageClient(session).status();
  } else if (command === 'ops') {
    result = [...Object.keys(aliases).map(id => ({id, kind: 'alias', path: restOperation(id).path})),
      ...contracts.rest.map(op => ({id: op.id, kind: 'REST', method: op.method, path: op.path})),
      ...contracts.graphql.map(op => ({id: op.id, name: op.name, kind: op.kind, variables: op.variables}))]
      .filter(op => stringifyJson(op).toLowerCase().includes((first ?? '').toLowerCase()));
  } else if (command === 'schema') {
    result = contracts.graphql.some(op => op.id === first || op.name === first) ? graphqlOperation(first!) : restOperation(first!);
  } else if (command === 'models') result = contracts.models.filter(m => m.name.toLowerCase().includes((first ?? '').toLowerCase()));
  else {
    const query = await jsonInput(values.query) as RestArguments['query'];
    const page = {limit, offset, ...query};
    let args: RestArguments = {}, variables: Record<string, unknown> = {}, document = '';
    if (command === 'gql') {variables = await jsonInput(second); validateVariables(graphqlOperation(first!), variables);}
    if (command === 'call') {
      const input = await jsonInput(second); args = {...input, query: {...(input.query as object), ...query}};
      if (input.bodyFile) {
        if (input.body !== undefined || input.parts || !restOperation(first!).parameters.some(p => p.kind === 'Url')) throw new Error('bodyFile is only for dynamic file uploads and cannot be combined with body or parts.');
        args.body = await readFile(String(input.bodyFile));
      }
      if (input.parts) {
        const form = new FormData();
        for (const [key, part] of Object.entries(input.parts as Record<string, {file?: string; value?: string; type?: string}>)) {
          if (part.file) form.append(key, new Blob([await readFile(part.file)], {type: part.type ?? 'application/octet-stream'}), basename(part.file));
          else if (part.value !== undefined) form.append(key, part.value);
          else throw new Error(`Part ${key} requires file or value.`);
        }
        args.body = form;
      }
      prepareRest(first!, args); // Reject malformed calls before loading credentials.
    }
    if (command === 'query') {document = await readFile(first!, 'utf8'); parse(document); variables = await jsonInput(second);}
    const transfer = command === 'call' ? prepareRest(first!, args) : undefined;
    if (transfer?.anonymous) result = (await transferMyHeritage(transfer.url, transfer.options)).data;
    else {
    const client = await MyHeritageClient.open();
    switch (command) {
      case 'search': result = await client.searchRecords(searchOptions!); break;
      case 'record': result = await client.record(first!, values.related); break;
      case 'document': result = await client.document(first!, values['related-document']); break;
      case 'download-document':
        console.log(stringifyJson(await client.downloadDocument(first!, values.out!, documentPage, values['related-document']), 2));
        return; // --out is the image destination, not the JSON summary destination.
      case 'search-fields': result = await client.searchFields(first!); break;
      case 'collection': result = await client.collection(first!); break;
      case 'refresh': await client.refresh(); result = client.status(); break;
      case 'me': result = await client.me(query); break;
      case 'sites': result = await client.sites(page); break;
      case 'trees': result = await client.trees(first!, page); break;
      case 'tree': result = await client.tree(first!, query); break;
      case 'people': result = await client.people(first!, offset, limit); break;
      case 'find': result = await client.find(first!, second!); break;
      case 'insights': result = await client.insights(first!); break;
      case 'person': result = await client.person(first!); break;
      case 'family': result = await client.call('family', {path: {family_id: first!}, query}); break;
      case 'events': result = await client.events(first!, page); break;
      case 'timeline': result = await client.timeline(first!); break;
      case 'facts': result = await client.facts(first!); break;
      case 'matches': result = await client.matches(first!, page); break;
      case 'records': result = await client.records(first!, offset, limit, values['match-status']); break;
      case 'media': result = await client.media(first!, page); break;
      case 'albums': result = await client.albums(first!); break;
      case 'consistency': result = await client.consistency(first!, offset, limit); break;
      case 'catalog': result = await client.researchCatalog(catalogOptions); break;
      case 'collections': result = await client.researchCatalog({...catalogOptions, text: first!}); break;
      case 'get': result = (await client.request(first!, {query})).data; break;
      case 'gql': result = await client.graphql(graphqlOperation(first!).id, variables as never); break;
      case 'call': result = await client.call(first!, args); break;
      case 'query': result = await client.query(document, variables); break;
    }
    }
  }
  if (result instanceof Uint8Array && !values.out) throw new Error('Binary responses require --out FILE.');
  const output = result instanceof Uint8Array ? result : `${stringifyJson(result ?? null, 2)}\n`;
  if (values.out) {
    await mkdir(dirname(values.out), {recursive: true, mode: 0o700});
    const temporary = `${values.out}.${randomUUID()}.tmp`;
    try {await writeFile(temporary, output, {mode: 0o600, flag: 'wx'}); await rename(temporary, values.out);}
    finally {await rm(temporary, {force: true});}
    console.log(`Saved ${values.out}`);
  } else process.stdout.write(output);
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'MyHeritage command failed.'); process.exitCode = 1;});
