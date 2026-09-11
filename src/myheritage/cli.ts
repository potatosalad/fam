import {readCommandFile as readFile, readCommandStdin} from '../shared/command-input.js';
import {inspectResult} from '../shared/diagnostics.js';
import {loadProviderSession} from '../shared/browser-config.js';
import { configureCredentials } from '../shared/credentials.js';
import { captureOptions } from '../shared/browser-capture.js';
import {buildRecordSearch, recordUrl, contextId, researchPage, type RecordSearchOptions, type CatalogOptions, type ResearchEvent} from './research.js';
import {parse} from 'graphql';
import {transferMyHeritage} from './http.js';
import { parseArgs } from 'node:util';
import { writeFile, rename, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename } from 'node:path';
import { parseJson, stringifyJson } from '../shared/json.js';
import { CREDENTIAL_DIR, readPrivateJson } from '../shared/storage.js';
import { MyHeritageClient } from './client.js';
import { authenticateMyHeritage, importMyHeritageHar, type MyHeritageSession } from './auth.js';
import { aliases, contracts, graphqlOperation, restOperation, prepareRest, validateVariables, type RestArguments } from './catalog.js';
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
    help: {type: 'boolean', short: 'h'}, stdin: {type: 'boolean'}, out: {type: 'string'}, har: {type: 'string'},
    interactive: {type: 'boolean'}, 'no-autofill': {type: 'boolean'}, native: {type: 'boolean'}, capture: {type: 'boolean'}, 'browser-channel': {type: 'string'}, 'capture-timeout': {type: 'string'}, 'tree-url': {type: 'string'},
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
  if (values.stdin && command !== 'credentials') throw new Error('--stdin belongs to fam myheritage.credential set.');
  const arity: Record<string, number> = {auth: 0, status: 0, credentials: 0, refresh: 0, me: 0, sites: 0, catalog: 0,
    search: 1, record: 1, collection: 1, 'search-fields': 1, document: 1, 'download-document': 1, insights: 1, trees: 1, tree: 1, people: 1, person: 1, family: 1, events: 1, timeline: 1, facts: 1, matches: 1, records: 1,
    media: 1, albums: 1, consistency: 1, collections: 1, get: 1, find: 2, gql: 2, call: 2, query: 2, ops: 1, schema: 1, models: 1};
  if (!(command in arity)) throw new Error(`Unknown command ${command}; see fam cli.command list --provider myheritage.`);
  if (positionals.length - 1 > arity[command]!) throw new Error(`Too many arguments for myheritage ${command}.`);
  if (command !== 'auth' && (values.capture || values.har || values.code || values['verification-code'] || values['recaptcha-token-file'])) throw new Error('Authentication flags belong to fam myheritage.session login.');
  if (command !== 'auth' && (values['browser-channel'] !== undefined || values['capture-timeout'] !== undefined || values['tree-url'] !== undefined)) throw new Error('Browser capture options require auth --capture.');
  const need = (v: string | undefined, label: string) => {if (!v) throw new Error(`Missing ${label}; see fam cli.command list --provider myheritage.`); return v;};
  if (arity[command] && !['ops', 'models', 'search'].includes(command)) need(first, 'argument');
  if (command === 'find') need(second, 'name');
  const integer = (v: string | undefined, fallback: number, min: number) => {const n = v === undefined ? fallback : Number(v); if (!Number.isSafeInteger(n) || n < min) throw new Error(`Expected an integer >= ${min}.`); return n;};
  const limit = integer(values.limit, 20, 1), offset = integer(values.offset, 0, 0);
  const searchFlags = ['first-name','last-name','birth-year','birth-place','death-year','death-place','place','keyword','exact','collection','record-type','after','gender','first-name-match','last-name-match','no-translations','field','residence-year','residence-place','marriage-year','marriage-place','birth-year-range','death-year-range','residence-year-range','marriage-year-range'];
  const flags = values as Record<string, unknown>;
  if (command !== 'search' && searchFlags.some(k => flags[k] !== undefined)) throw new Error('Record-search flags belong to fam myheritage.record search.');
  if (!['search','catalog','collections'].includes(command) && values.category) throw new Error('--category belongs to search, catalog or collections.');
  if (!['catalog','collections'].includes(command) && ['location','years','images'].some(k => flags[k] !== undefined)) throw new Error('Catalog filters belong to catalog or collections.');
  if (values.related && command !== 'record') throw new Error('--related belongs to fam myheritage.record get.');
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
    const s = await loadProviderSession<MyHeritageSession>('myheritage');
    result = {credentialDirectory: CREDENTIAL_DIR, authenticated: !!s?.accessToken, mode: s?.mode ?? 'native', savedAt: s?.savedAt,
      verificationPending: !!await readPrivateJson('myheritage/pending-auth.json'), blockedUntil: (await readPrivateJson<{blockedUntil?: string}>('myheritage/login-block.json'))?.blockedUntil};
  } else if (command === 'credentials') {await configureCredentials('myheritage', {stdin: values.stdin}); result = {saved: true, credentialDirectory: CREDENTIAL_DIR, next: 'fam myheritage.session login'};}
  else if (command === 'auth') {
    if (values.native && (values.capture || values.har || values.interactive || values['no-autofill'])) throw new Error('Choose native sign-in or browser/HAR sign-in.');
    if ((values.capture && values.har) || ((values.capture || values.har) && (values.code || values['verification-code'] || values['recaptcha-token-file']))) throw new Error('Use --capture, --har, or native login flags, one at a time.');
    if (!values.har && !values.native && !values.code && !values['verification-code'] && !values['recaptcha-token-file']) {
      const {loginMyHeritage} = await import('./browser-login.js');
      if (values['browser-channel'] && !['camofox', 'cloakbrowser'].includes(String(values['browser-channel']))) throw new Error('Select the browser with fam browser use --engine cloakbrowser or --engine camofox.');
      const session = await loginMyHeritage({interactive: values.interactive, autofill: !values['no-autofill'], timeoutMs: values['capture-timeout'] === undefined ? undefined : Number(values['capture-timeout']) * 1000, treeUrl: values['tree-url']});
      result = new MyHeritageClient(session).status();
    } else {
      const session = values.har ? await importMyHeritageHar(await readFile(values.har, 'utf8')) : await authenticateMyHeritage({code: values.code,
        verificationCode: values['verification-code'], recaptchaToken: values['recaptcha-token-file'] ? (await readFile(values['recaptcha-token-file'], 'utf8')).trim() : undefined});
      result = new MyHeritageClient(session).status();
    }
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
        return await client.downloadDocument(first!, values.out!, documentPage, values['related-document']); // --out is the image destination, not the JSON summary destination.
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
  if (values.out) inspectResult(result);
  if (values.out) {
    await mkdir(dirname(values.out), {recursive: true, mode: 0o700});
    const temporary = `${values.out}.${randomUUID()}.tmp`;
    try {await writeFile(temporary, output, {mode: 0o600, flag: 'wx'}); await rename(temporary, values.out);}
    finally {await rm(temporary, {force: true});}
    return {saved: values.out, ...(result instanceof Uint8Array ? {bytes: result.byteLength} : {})};
  }
  return result;
}
