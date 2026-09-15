import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {writeFile, readFile, stat, mkdir, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {FamilySearchClient} from '../src/familysearch/client.js';
import {prepareApiInput} from '../src/familysearch/api-input.js';
import {prepareOperation} from '../src/familysearch/operations.js';
import {prepareRecordSearch, recordSearchPage, runRecordSearch} from '../src/familysearch/record-search.js';
import {prepareMemoryUpload, runMemoryUpload} from '../src/familysearch/memory-cli.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {setCommandInputSink, type CommandInput} from '../src/shared/command-input.js';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), cli, ...args], {
  cwd: CREDENTIAL_DIR, timeout: 15000, env: {...process.env, FAM_HISTORY: '0', FAM_CREDENTIALS_COMMAND: '["must-not-run"]'},
});
const flags = (action: string, ...args: string[]) => parseInvocation(['familysearch.record', action, ...args]).args.slice(2);

test('record flags build native name, relative, event, exact, and collection criteria', () => {
  const input = prepareRecordSearch(flags('search', '--first-name', 'Alex', '--last-name', 'Example', '--father-first-name', 'Parent',
    '--residence-year', '1850', '--residence-year-range', '0', '--residence-place', 'Example County', '--birth-year', '1820', '--birth-year-range', '3',
    '--exact', '--collection-id', '1234567', '--collection-type', '0', '--limit', '5', '--offset', '10'));
  assert.deepEqual(input, {body: {searchType: 'RECORDS', focusPerson: {givenName: {value: 'Alex', exact: true}, surname: {value: 'Example', exact: true}},
    fathers: [{givenName: {value: 'Parent', exact: true}}], events: [{eventType: 'birth', year: {value: '1820', range: 3}},
      {eventType: 'residence', year: {value: '1850', range: 0}, place: {value: 'Example County', exact: true}}], collectionId: 1234567, collectionType: 0}, query: {size: 5, from: 10}});
  for (const args of [[], ['--first-name', ' '], ['--birth-year-range', '3'], ['--collection-id', '1234567'], ['--last-name','Example','--limit','101']])
    assert.throws(() => prepareRecordSearch(args));
  assert.throws(() => prepareOperation('search.results', {body: {searchType: 'RECORDS', collectionId: 1234567}}), /collectionId requires collectionType/);
});

test('search results expose records and honest continuation when total is omitted', () => {
  const input = prepareRecordSearch(['--last-name', 'Example', '--offset', '10', '--limit', '2']);
  const results = [{id: 'result-1', type: 'RECORD', recordPerson: {id: 'record-1', fields: [], relationships: [], attachedTreePerson: null}}];
  const unknown = recordSearchPage({results} as never, input);
  assert.equal(unknown.total, null); assert.equal(unknown.complete, false); assert.equal(unknown.nextOffset, 11);
  assert.equal(unknown.items[0].id, 'record-1'); assert.equal(unknown.items[0].resultId, 'result-1');
  assert.deepEqual(unknown.items[0].relationships, []);
  assert.equal(recordSearchPage({results, total: 11}, input).complete, true);
  assert.equal(recordSearchPage({results: []} as never, input).nextOffset, null);
  assert.throws(() => recordSearchPage({results: [{type: 'TREE', treePerson: {id: 'XXXX-XXX'}}]} as never, input), /unexpected result/);
});

test('record search and collection discovery call the matching read operation', async t => {
  const calls: unknown[] = [];
  t.mock.method(FamilySearchClient, 'open', async () => ({operation: async (name: string, input: unknown) => {
    calls.push({name, input});
    return name === 'search.categories' ? {categoryFilters: [{collectionFilters: [{displayName: 'Censuses', collectionType: 0,
      subCollections: [{collectionId: 1234567, displayName: 'Example census', count: 2}]}]}]} : {results: [], total: 0};
  }}));
  const result = await runRecordSearch(['--last-name','Example'], 'search');
  assert.equal('complete' in result && result.complete, true);
  const collections = await runRecordSearch(['--last-name','Example'], 'collections');
  assert.deepEqual(collections.items, [{collectionId: 1234567, collectionType: 0, title: 'Example census', count: 2, category: 'Censuses'}]);
  assert.deepEqual(calls.map((x: any) => x.name), ['search.results','search.categories']);
});

test('operation errors identify wrong fields without echoing supplied field values', async () => {
  await assert.rejects(prepareApiInput('search.results', JSON.stringify({body: {searchType: 'RECORDS', events: [{type: 'do-not-echo'}]}})), e => {
    assert.match((e as Error).message, /body.events\[0\].*"type".*eventType/);
    assert.doesNotMatch((e as Error).message, /do-not-echo/); return true;
  });
  await assert.rejects(prepareApiInput('persons.addFact', JSON.stringify({pid: 'XXXX-XXX', body: {}, headers: {'X-Misspelled': 'private reason'}})), /X-Misspelled.*allowed: X-Reason/);
  await assert.rejects(prepareApiInput('persons.get', '{"path":{"pid":"XXXX-XXX"}}'), /Path parameters are top-level/);
});

test('API and record dry runs validate input outside the checkout without session lookup or output files', async () => {
  const input = join(CREDENTIAL_DIR, 'fact-input.json'), output = join(CREDENTIAL_DIR, 'dry-run-never-written.json');
  await writeFile(input, JSON.stringify({pid: 'XXXX-XXX', body: {conclusionType: 'FACT', value: {type: 'Death'}}, headers: {'X-Reason': 'Test evidence'}}));
  const result = JSON.parse((await invoke('familysearch.api','call','--operation','persons.addFact','--input',input,'--out',output,'--dry-run','--json')).stdout);
  assert.equal(result.data.validation.method, 'POST'); assert.equal(result.data.validation.input.body.value.type, 'Death');
  assert.equal(result.data.validation.input.headers['X-Reason'], 'Test evidence');
  const relationship = JSON.parse((await invoke('familysearch.api', 'call', '--operation', 'parentChildren.create', '--input',
    JSON.stringify({body: {childId: 'ABCD-123'}, headers: {'X-Reason': 'Test evidence'}}), '--dry-run', '--json')).stdout);
  assert.equal(relationship.data.validation.input.headers['X-Reason'], 'Test evidence');
  await assert.rejects(stat(output), {code: 'ENOENT'});
  await writeFile(input, '{"pid":"XXXX-XXX","body":{"wrong":true}}');
  await assert.rejects(invoke('familysearch.api','call','--operation','persons.addFact','--input',input,'--dry-run','--json'), (e: any) => {
    assert.equal(JSON.parse(e.stderr).ok, false); assert.doesNotMatch(e.stderr, /must-not-run/); return true;
  });
  const search = JSON.parse((await invoke('familysearch.record','search','--last-name','Example','--birth-year','1850','--dry-run','--json')).stdout);
  assert.equal(search.data.validation.input.body.events[0].year.value, '1850');
});

test('memory upload sends exact file bytes and multipart fields and retains large artifact IDs', async t => {
  const file = join(CREDENTIAL_DIR, 'upload-fixture.pdf'), receipt = join(CREDENTIAL_DIR, 'upload-receipt.json');
  const bytes = Buffer.from('%PDF-1.4\nsynthetic fixture\n'); await writeFile(file, bytes);
  const captured: CommandInput[] = []; setCommandInputSink(async input => {captured.push(input);});
  t.after(() => setCommandInputSink());
  let calls = 0;
  t.mock.method(FamilySearchClient, 'open', async () => ({operation: async (name: string, input: {body: FormData}) => {
    calls++; assert.equal(name, 'memories.upload');
    assert.equal(input.body.get('isPrivate'), 'true'); assert.equal(input.body.get('title'), 'Fixture');
    assert.equal(input.body.get('description'), 'Synthetic document'); assert.equal(input.body.get('filename'), 'upload-fixture.pdf');
    const upload = input.body.get('file') as File;
    assert.equal(upload.type, 'application/pdf'); assert.deepEqual(Buffer.from(await upload.arrayBuffer()), bytes);
    return {artifact: {id: 9223372036854775807n}, apid: 'fixture-artifact'};
  }}));
  const result = await runMemoryUpload(['--file',file,'--visibility','private','--title','Fixture','--description','Synthetic document'], receipt);
  assert.equal(result.artifact.id, 9223372036854775807n); assert.equal(result.upload.bytes, bytes.length); assert.equal(calls, 1);
  assert.match(await readFile(receipt,'utf8'), /9223372036854775807/); assert.equal((await stat(receipt)).mode & 0o777, 0o600);
  assert.equal(captured[0].complete, true); assert.deepEqual(captured[0].data, bytes);
  await assert.rejects(runMemoryUpload(['--file',file,'--visibility','private'],receipt), /already exists/);
  assert.equal(calls, 1);
});

test('upload validation and preview reject invalid files before contacting FamilySearch', async t => {
  const file = join(CREDENTIAL_DIR,'preview.pdf'), empty = join(CREDENTIAL_DIR,'empty.pdf');
  await writeFile(file,'%PDF-1.4 synthetic'); await writeFile(empty,'');
  t.mock.method(FamilySearchClient,'open',async () => {throw new Error('AUTH MUST NOT RUN');});
  for (const args of [['--file',file], ['--file',empty,'--visibility','public'], ['--file',CREDENTIAL_DIR,'--visibility','public','--media-type','application/pdf'],
    ['--file',file,'--visibility','private','--max-bytes','1'], ['--file',file,'--visibility','public','--media-type','bad\r\nheader']])
    await assert.rejects(runMemoryUpload(args), e => !String(e).includes('AUTH MUST NOT RUN'));
  const prepared = await prepareMemoryUpload(['--file',file,'--visibility','public']);
  assert.equal(prepared.body.get('isPrivate'), 'false');
  const out = join(CREDENTIAL_DIR,'preview-receipt.json');
  const result = JSON.parse((await invoke('familysearch.memory','upload','--file',file,'--visibility','private','--out',out,'--dry-run','--json')).stdout);
  assert.equal(result.data.validation.upload.visibility,'private'); assert.equal(result.data.validation.upload.filename,'preview.pdf');
  await assert.rejects(stat(out), {code:'ENOENT'});
});

test('a receipt race returns the completed upload result and preserves a recovery receipt', async t => {
  const directory=join(CREDENTIAL_DIR,'receipt-race'); await mkdir(directory);
  const file=join(directory,'fixture.txt'), receipt=join(directory,'receipt.json'); await writeFile(file,'synthetic story');
  t.mock.method(FamilySearchClient,'open',async () => ({operation:async () => {await writeFile(receipt,'existing'); return {artifact:{id:123n}};}}));
  const result=await runMemoryUpload(['--file',file,'--visibility','private'],receipt);
  assert.equal(result.artifact.id,123n); assert.match(result.receiptWarning!,/Upload completed/);
  assert.equal(await readFile(receipt,'utf8'),'existing');
  const recovery=(await readdir(directory)).find(name=>name.endsWith('.tmp'))!;
  assert.match(await readFile(join(directory,recovery),'utf8'),/"id": 123/);
});
