import {readCommandFile as readFile, readCommandStdin} from '../shared/command-input.js';
import {inspectResult} from '../shared/diagnostics.js';
import { configureCredentials } from '../shared/credentials.js';
import { parseArgs } from 'node:util';
import { writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { parseJson, stringifyJson } from '../shared/json.js';
import { CREDENTIAL_DIR, readPrivateJson } from '../shared/storage.js';
import { AncestryClient } from './client.js';
import { authenticateAncestry, sendAncestryCode, verifyAncestryCode, type AncestrySession } from './auth.js';
import { aliases, contracts, graphqlOperation, restOperation, type GraphQLName, type RestArguments } from './catalog.js';


async function jsonInput(value?: string): Promise<Record<string, unknown>> {
  if (!value) return {};
  let text: string;
  if (value === '-') text = await readCommandStdin();
  else text = value.trimStart().startsWith('{') ? value : await readFile(value, 'utf8');
  let parsed: unknown;
  try { parsed = parseJson(text); } catch { throw new Error('Input must be valid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Input must be a JSON object.');
  return parsed as Record<string, unknown>;
}
export async function runProvider(argv: string[]): Promise<unknown> {
  const {values, positionals} = parseArgs({args: argv, allowPositionals: true, options: {
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, out: {type: 'string'}, code: {type: 'string'}, 'send-code': {type: 'boolean'},
    limit: {type: 'string'}, page: {type: 'string'}, cursor: {type: 'string'}, query: {type: 'string'}, base: {type: 'string'},
    given: {type: 'string'}, surname: {type: 'string'}, 'birth-year': {type: 'string'}, 'birth-place': {type: 'string'},
    'death-year': {type: 'string'}, 'death-place': {type: 'string'}, filter: {type: 'string', multiple: true},
  }});
  const [command = 'help', first, second] = positionals;
  if (values.stdin && command !== 'credentials') throw new Error('--stdin belongs to fam ancestry.credential set.');
  const arity: Record<string, number> = {status: 0, credentials: 0, auth: 0, refresh: 0, trees: 0, search: 0, ops: 1, schema: 1,
    tree: 1, persons: 1, person: 2, relatives: 2, research: 2, story: 2, hints: 2, media: 2, citations: 1, sources: 1,
    record: 2, places: 1, gql: 2, call: 2, get: 1};
  if (arity[command] !== undefined && positionals.length - 1 > arity[command]!) throw new Error(`Too many arguments for ancestry ${command}.`);
  if (command !== 'auth' && (values.code || values['send-code'])) throw new Error('Verification options belong to fam ancestry.session login.');
  const need = (value: string | undefined, label: string): string => { if (!value) throw new Error(`Missing ${label}. See fam cli.command list --provider ancestry.`); return value; };
  const integer = (value: string | undefined, fallback: number): number => { const n = value === undefined ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error('Expected a positive integer.'); return n; };
  const limit = integer(values.limit, 20), page = integer(values.page, 1);
  let result: unknown;
  if (command === 'status') {
    const session = await readPrivateJson<AncestrySession>('ancestry/session.json');
    result = {credentialDirectory: CREDENTIAL_DIR, authenticated: Boolean(session?.tokens?.user_id && session.tokens.access_token), savedAt: session?.savedAt,
      expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
      verificationPending: Boolean(await readPrivateJson('ancestry/pending-auth.json'))};
  } else if (command === 'credentials') { await configureCredentials('ancestry', {stdin: values.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam ancestry.session login'}; }
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
    if (!known.includes(command)) throw new Error(`Unknown command ${command}. See fam cli.command list --provider ancestry.`);
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
  if (values.out) inspectResult(result);
  if (values.out) {
    await mkdir(dirname(values.out), {recursive: true, mode: 0o700});
    const temporary = `${values.out}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, output, {mode: 0o600, flag: 'wx'}); await rename(temporary, values.out); }
    finally { await rm(temporary, {force: true}); }
    return {saved: values.out};
  }
  return result;
}
