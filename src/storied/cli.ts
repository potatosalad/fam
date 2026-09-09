import {inspectResult} from '../shared/diagnostics.js';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configureCredentials } from '../shared/credentials.js';
import { CREDENTIAL_DIR } from '../shared/storage.js';
import { parseJson, stringifyJson } from '../shared/json.js';
import { loadSession, sessionStatus } from './auth.js';
import { aliases, contracts, operation, model } from './catalog.js';
import { StoriedClient, prepareCall, type CallInput } from './client.js';


async function input(value?: string): Promise<Record<string, unknown>> {
  if (value === undefined) return {};
  let text: string;
  if (value === '-') {const parts: Buffer[] = []; for await (const chunk of process.stdin) parts.push(Buffer.from(chunk)); text = Buffer.concat(parts).toString();}
  else text = value.trimStart().startsWith('{') ? value : await readFile(value, 'utf8');
  let obj: unknown;
  try {obj = parseJson(text);} catch {throw new Error('Input must be valid JSON.');}
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Input must be a JSON object.');
  return obj as Record<string, unknown>;
}
function integer(value: string | undefined, fallback: number, max = 1_000_000) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Numeric option must be an integer between 1 and ${max}.`);
  return n;
}
export async function runProvider(argv: string[]): Promise<unknown> {
  const {values: v, positionals: p} = parseArgs({args: argv, allowPositionals: true, options: {
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, out: {type: 'string'}, input: {type: 'string'},
    anonymous: {type: 'boolean'}, page: {type: 'string'}, limit: {type: 'string'}, generations: {type: 'string'},
    'first-name': {type: 'string'}, 'last-name': {type: 'string'}, keyword: {type: 'string'}, interactive: {type: 'boolean'}, 'no-autofill': {type: 'boolean'},
    'browser-channel': {type: 'string'},
  }});
  const [command = 'help', first, second] = p;
  const arities: Record<string, [number, number]> = {
    credentials: [0,0], auth: [0,0], status: [0,0], verify: [0,0], refresh: [0,0], me: [0,0],
    trees: [0,0], tree: [1,1], people: [1,1], 'find-people': [1,1], person: [1,1], pedigree: [2,2], family: [2,2], events: [2,2],
    hints: [1,1], records: [1,1], stories: [0,0], 'person-stories': [1,1], story: [1,1], comments: [1,1], feed: [0,0],
    media: [0,0], 'media-item': [1,1], groups: [0,0], notifications: [0,0], subscription: [0,0], 'recent-people': [0,0],
    'home-hints': [0,0], 'mobile-version': [0,0], search: [0,0], ops: [0,1], schema: [1,1], models: [0,1], model: [1,1], call: [1,2],
  };
  const arity = Object.hasOwn(arities, command) ? arities[command] : undefined;
  if (!arity || p.length - 1 < arity[0] || p.length - 1 > arity[1]) throw new Error('Invalid Storied command or arguments. Run fam cli.command list --provider storied.');
  const paginated = ['stories', 'person-stories', 'comments', 'feed', 'media', 'notifications', 'search', 'find-people'];
  if ((v.page !== undefined || v.limit !== undefined) && !paginated.includes(command)) throw new Error('Pagination options do not apply to this command.');
  if (v.limit !== undefined && command === 'find-people') throw new Error('find-people does not accept --limit.');
  if (v.stdin && command !== 'credentials') throw new Error('--stdin belongs to credentials.');
  if (v.generations !== undefined && command !== 'pedigree') throw new Error('--generations belongs to pedigree.');
  if ([v['first-name'], v['last-name'], v.keyword].some(x => x !== undefined) && command !== 'search') throw new Error('Search fields belong to search.');
  if ((v.interactive || v['no-autofill'] || v['browser-channel']) && command !== 'auth') throw new Error('Browser options belong to auth.');
  if (v.anonymous && ['auth', 'credentials', 'refresh', 'verify', 'me'].includes(command)) throw new Error('This command requires an account.');
  if (v.input !== undefined && !Object.hasOwn(aliases, command)) throw new Error('--input belongs to a named API command. call takes its input as an argument.');
  const pageNumber = integer(v.page, 1), pageSize = integer(v.limit, 20, 100);
  let result: unknown;
  if (command === 'status') result = {credentialDirectory: CREDENTIAL_DIR, ...sessionStatus(await loadSession())};
  else if (command === 'credentials') {await configureCredentials('storied', {stdin: v.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam storied.session login'};}
  else if (command === 'auth') {
    const {authenticateBrowser} = await import('./browser-auth.js');
    result = sessionStatus(await authenticateBrowser({interactive: v.interactive, autofill: !v['no-autofill'], channel: v['browser-channel']}));
  }
  else if (command === 'ops') result = contracts.operations.filter(o => JSON.stringify(o).toLowerCase().includes((first ?? '').toLowerCase())).map(o => ({
    id: o.id, aliases: Object.keys(aliases).filter(k => aliases[k] === o.id), apkMethods: o.apkMethods, hasBody: !!o.requestBody,
  }));
  else if (command === 'schema') result = operation(first!);
  else if (command === 'models') result = Object.keys(contracts.models).filter(n => n.toLowerCase().includes((first ?? '').toLowerCase()));
  else if (command === 'model') result = model(first!);
  else {
    let request: CallInput = {}, name = command;
    const query = await input(v.input);
    if (command === 'call') {name = first!; request = await input(second) as CallInput;}
    else if (Object.hasOwn(aliases, command)) {
      request.query = query;
      if (['person','hints','records','person-stories'].includes(command)) request.path = {personId: first};
      if (['story','comments'].includes(command)) request.path = {storyId: first};
      if (command === 'media-item') request.path = {mediaId: first};
      if (command === 'people') request.path = {treeId: first};
      if (command === 'tree') request.query = {...query, treeIds: [first]};
      if (['pedigree','events'].includes(command)) request.path = {treeId: first, personId: second};
      if (command === 'family') request.query = {...query, treeId: first, personId: second};
      if (command === 'pedigree') request.path!.generations = integer(v.generations, 4, 8);
      if (paginated.includes(command) && !['search', 'find-people', 'media'].includes(command)) request.path = {...request.path, pageNumber, pageSize};
      if (command === 'media') request = {body: {sortBy: {field: 'creationdate', direction: 'descending'}, taggedPersonIds: [], mediaTypes: [], contributorSources: [], ...query, pageNumber, pageSize}};
      if (command === 'find-people') request.path = {requestId: randomUUID(), pageNumber, searchString: first};
      if (command === 'search') {
        request = {body: {...query, ...(v['first-name'] ? {givenName: {value: v['first-name']}} : {}),
          ...(v['last-name'] ? {surname: {value: v['last-name']}} : {}), ...(v.keyword ? {keyword: v.keyword} : {}), pageNumber, pageSize}};
        if (!Object.keys(query).length && !v['first-name'] && !v['last-name'] && !v.keyword) throw new Error('Provide search criteria.');
      }
    }
    if (Object.hasOwn(aliases, command) || command === 'call') prepareCall(operation(name), request);
    const client = await StoriedClient.open(v.anonymous || command === 'mobile-version');
    if (command === 'me') result = await client.me();
    else if (command === 'verify') result = await client.verify();
    else if (command === 'refresh') {await client.refresh(); result = await client.verify();}
    else result = await client.call(name, request);
  }
  const text = stringifyJson(result, 2) + '\n';
  if (v.out) inspectResult(result);
  if (v.out) {
    await mkdir(dirname(v.out), {recursive: true, mode: 0o700});
    const temp = `${v.out}.${randomUUID()}.tmp`;
    try {await writeFile(temp, text, {mode: 0o600, flag: 'wx'}); await rename(temp, v.out);} finally {await rm(temp, {force: true});}
    return {saved: v.out};
  }
  return result;
}
