import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configureCredentials } from '../shared/credentials.js';
import { CREDENTIAL_DIR } from '../shared/storage.js';
import { parseJson, stringifyJson } from '../shared/json.js';
import type { CallInput } from '../storied/client.js';
import { authenticateBrowser, loadSession, sessionStatus } from './auth.js';
import { NewspaperArchiveClient, operations, describeOperation, searchQuery, type SearchOptions } from './client.js';

const stringNames = ['first-name','last-name','keyword','phrase','any-words','exclude-words','country-id','state-id','city-id','publication-id','from','to','page','limit','year','month','article-id','browser-channel','out'] as const;
const stringOptions = Object.fromEntries(stringNames.map(name => [name, {type: 'string'}])) as Record<typeof stringNames[number], {type: 'string'}>;
async function input(arg?: string): Promise<CallInput> {
  if (arg === undefined) return {};
  let text: string;
  if (arg === '-') {const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); text = Buffer.concat(chunks).toString();}
  else text = arg.trimStart().startsWith('{') ? arg : await readFile(arg, 'utf8');
  try {return parseJson(text) as CallInput;} catch {throw new Error('Input must be valid JSON.');}
}
export async function runProvider(argv: string[]): Promise<unknown> {
  const {values: v, positionals: [command, arg, extra]} = parseArgs({args: argv, allowPositionals: true, options: {
    ...stringOptions, anonymous: {type: 'boolean'}, interactive: {type: 'boolean'}, 'no-autofill': {type: 'boolean'}, stdin: {type: 'boolean'},
  }});
  let result: unknown;
  if (command === 'credentials') {await configureCredentials('newspaperarchive', {stdin: v.stdin}); result = {saved: true, credentialProvider: 'storied'};}
  else if (command === 'status') result = {...sessionStatus(await loadSession()), credentialDirectory: CREDENTIAL_DIR};
  else if (command === 'auth') result = sessionStatus(await authenticateBrowser({interactive: v.interactive, autofill: !v['no-autofill'], channel: v['browser-channel']}));
  else if (command === 'ops') result = Object.entries(operations).map(([alias, operation]) => ({alias, operation})).filter(op => !arg || JSON.stringify(op).toLowerCase().includes(arg.toLowerCase()));
  else if (command === 'schema') result = describeOperation(arg);
  else {
    const options: SearchOptions = {firstName: v['first-name'], lastName: v['last-name'], keyword: v.keyword, phrase: v.phrase, anyWords: v['any-words'], excludeWords: v['exclude-words'],
      countryId: v['country-id'], stateId: v['state-id'], cityId: v['city-id'], publicationId: v['publication-id'], from: v.from, to: v.to,
      page: v.page === undefined ? 1 : Number(v.page), limit: v.limit === undefined ? 20 : Number(v.limit)};
    if (command === 'search') searchQuery(options);
    if (command === 'call') describeOperation(arg);
    const client = await NewspaperArchiveClient.open(v.anonymous);
    if (command === 'search') result = await client.search(options);
    else if (command === 'publications') result = await client.publications(arg, options.page, options.limit);
    else if (command === 'locations') result = await client.locations(options);
    else if (command === 'dates') result = await client.dates(arg, v.year, v.month);
    else if (command === 'page' || command === 'transcript') {
      const page = await client.page(arg);
      if (command === 'transcript' && !page.ocrAvailable) throw new Error('NewspaperArchive did not expose OCR for this page. Open its source URL to check access.');
      result = page;
    } else if (command === 'ocr') result = await client.ocr(arg, v['article-id']);
    else if (command === 'me') result = await client.me();
    else if (command === 'verify') result = await client.verify();
    else if (command === 'refresh') {await client.refresh(); result = await client.verify();}
    else if (command === 'call') result = await client.call(arg, await input(extra));
    else throw new Error('Unknown NewspaperArchive command.');
  }
  if (v.out) {
    await mkdir(dirname(v.out), {recursive: true, mode: 0o700});
    const temporary = `${v.out}.${randomUUID()}.tmp`;
    try {await writeFile(temporary, stringifyJson(result, 2) + '\n', {mode: 0o600, flag: 'wx'}); await rename(temporary, v.out);}
    finally {await rm(temporary, {force: true});}
    return {saved: v.out};
  }
  return result;
}
