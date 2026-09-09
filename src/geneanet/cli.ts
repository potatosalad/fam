import {readCommandFile as readFile, readCommandStdin} from '../shared/command-input.js';
import {inspectResult} from '../shared/diagnostics.js';
import { parseArgs } from 'node:util';
import { configureCredentials } from '../shared/credentials.js';
import { CREDENTIAL_DIR } from '../shared/storage.js';
import { parseJson, stringifyJson } from '../shared/json.js';
import { authenticateGeneanet, loadSession, sessionStatus } from './auth.js';
import { GeneanetClient } from './client.js';
import { operations, routes, operation, integer, type SearchInput, type SearchKind } from './catalog.js';
import { downloadRecord, downloadMedia, saveDownload, saveOutput } from './download.js';

async function input(value?: string): Promise<SearchInput> {
  if (!value) return {};
  let text: string;
  if (value === '-') text = await readCommandStdin(65536, 'Input exceeded 64 KiB.');
  else text = value.trimStart().startsWith('{') ? value : await readFile(value, 'utf8');
  let result: unknown;
  try {result = parseJson(text);} catch {throw new Error('Search input must be valid JSON.');}
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Search input must be a JSON object.');
  return result as SearchInput;
}
export async function runProvider(argv: string[]): Promise<unknown> {
  const {values: v, positionals: p} = parseArgs({args: argv, allowPositionals: true, options: {
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, anonymous: {type: 'boolean'}, out: {type: 'string'},
    input: {type: 'string'}, 'last-name': {type: 'string'}, 'first-name': {type: 'string'}, place: {type: 'string'},
    from: {type: 'string'}, to: {type: 'string'}, event: {type: 'string'}, category: {type: 'string'}, keywords: {type: 'string'},
    'spouse-last-name': {type: 'string'}, 'spouse-first-name': {type: 'string'}, 'with-images': {type: 'boolean'},
    page: {type: 'string'}, limit: {type: 'string'}, index: {type: 'string'}, occurrence: {type: 'string'},
    'from-page': {type: 'string'}, 'to-page': {type: 'string'},
  }});
  const [command = 'help', first, second] = p;
  const arities: Record<string, [number, number]> = {credentials: [0,0], auth: [0,0], status: [0,0], me: [0,0], verify: [0,0],
    search: [0,0], photos: [0,0], library: [0,0], collections: [0,1], record: [1,1], person: [1,1], 'tree-media': [2,2],
    media: [1,1], 'media-references': [2,2], images: [1,1], download: [1,1], 'download-media': [2,2], ops: [0,1], schema: [1,1], routes: [0,1]};
  const arity = arities[command];
  if (!arity || p.length - 1 < arity[0] || p.length - 1 > arity[1]) throw new Error('Invalid command or arguments; run fam cli.command list --provider geneanet.');
  const search = ['search','photos','library'].includes(command);
  if (v.stdin && command !== 'credentials') throw new Error('--stdin belongs to credentials.');
  if (v.anonymous && ['credentials','auth','me','verify','status'].includes(command)) throw new Error('--anonymous is a research option.');
  if (!search && [v.input,v.place,v.from,v.to,v.event,v.category,v.keywords,v['spouse-last-name'],v['spouse-first-name'],v['with-images'],v.page,v.limit].some(x => x !== undefined)) throw new Error('Search options belong to search, photos, or library.');
  if (!search && command !== 'person' && [v['last-name'],v['first-name']].some(x => x !== undefined)) throw new Error('Name options belong to search or person.');
  if (command !== 'person' && [v.index,v.occurrence].some(x => x !== undefined)) throw new Error('--index and --occurrence belong to person.');
  if (command !== 'images' && [v['from-page'],v['to-page']].some(x => x !== undefined)) throw new Error('Page-range options belong to images.');
  if (command.startsWith('download') && !v.out) throw new Error('Downloads require --out FILE.');
  let result: unknown;
  if (command === 'credentials') {await configureCredentials('geneanet', {stdin: v.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam geneanet.session login'};}
  else if (command === 'auth') result = sessionStatus(await authenticateGeneanet());
  else if (command === 'status') result = {credentialDirectory: CREDENTIAL_DIR, ...sessionStatus(await loadSession())};
  else if (command === 'ops') result = operations.filter(o => JSON.stringify(o).toLowerCase().includes((first ?? '').toLowerCase()));
  else if (command === 'routes') result = routes.filter(o => JSON.stringify(o).toLowerCase().includes((first ?? '').toLowerCase()));
  else if (command === 'schema') result = operation(first!);
  else {
    const client = await GeneanetClient.open(v.anonymous);
    if (search) {
      const query = await input(v.input);
      for (const [key, value] of Object.entries({nom: v['last-name'], prenom: v['first-name'], place__0__: v.place,
        from: v.from, to: v.to, periode_mode: v.event, nom_conjoint: v['spouse-last-name'], prenom_conjoint: v['spouse-first-name'],
        restrict_images: v['with-images'], q: v.keywords, page: v.page, size: v.limit})) if (value !== undefined) query[key] = value;
      if (v.from || v.to) query.type_periode ??= v.from && v.to ? 'between' : v.from ? 'after' : 'before';
      if (v.category) {
        if (!/^[a-z_]+$/.test(v.category)) throw new Error('Invalid category.');
        query[`categories_1[${v.category}]`] = v.category;
      }
      result = await client.search(query, command as SearchKind);
    } else switch (command) {
      case 'me': result = await client.me(); break;
      case 'verify': await client.me(); result = {valid: true}; break;
      case 'collections': result = await client.collections(first); break;
      case 'record': result = await client.record(first!); break;
      case 'person': result = await client.person(first!, {firstName: v['first-name'], lastName: v['last-name'], index: v.index, occurrence: v.occurrence}); break;
      case 'tree-media': result = await client.treeMedia(first!, second!); break;
      case 'media': result = await client.media(first!); break;
      case 'media-references': result = await client.mediaReferences(first!, second!); break;
      case 'images': {const from = integer(v['from-page'], 1, 1, 100000); result = await client.images(first!, from, integer(v['to-page'], from, 1, 100000)); break;}
      case 'download': case 'download-media': {
        const data = command === 'download' ? await downloadRecord(client, first!) : await downloadMedia(client, first!, second!);
        await saveDownload(v.out!, data); return {saved: v.out, metadata: `${v.out}.json`, bytes: data.bytes.length};
      }
    }
  }
  const text = `${stringifyJson(result, 2)}\n`;
  if (v.out) inspectResult(result);
  if (v.out) {await saveOutput(v.out, text); return {saved: v.out};}
  return result;
}
