import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NaraClient} from '../src/nara/client.js';
import {ready, readPage, type Snapshot} from '../src/nara/browser.js';
import {recordId, recordUrl, searchUrl, mediaUrl, ORIGIN} from '../src/nara/url.js';
import {downloadObject} from '../src/nara/download.js';
import {setBrowserOverrides} from '../src/shared/browser-config.js';
import type {Camofox} from '../src/shared/browser-runtime.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {resolveContext} from '../src/shared/command-search.js';
import {authenticatedProviderNames, commands, commandById} from '../src/shared/command-registry.js';
import {humanOutput} from '../src/shared/command-output.js';
import {runDoctor} from '../src/shared/doctor.js';

const id = '9007199254740993123', media = `${ORIGIN}/medialz/example/scan.jpg`;
function snapshot(): Snapshot {
  return {url: recordUrl(id), title: 'Example record', text: 'Example record', alerts: [], challenge: false,
    search: {present: false, summary: '', page: '', pages: '', limit: '', sort: '', online: false, results: []},
    record: {title: 'Example record', header: `Item\nExample record\nNAID: ${id}`, level: 'Item', text: 'Dates: 1900\nAccess: Unrestricted',
      breadcrumbs: [{title: 'Series: Example series', url: recordUrl('12')}], links: []},
    objects: {page: '1', total: '2', selected: '1', downloadUrl: media,
      items: [{page: '1', label: 'Image 1', thumbnailUrl: `${ORIGIN}/iiif/3/example/full/150,/0/default.jpg`}, {page: '2', label: 'Image 2', thumbnailUrl: null}],
      transcriptionLabel: 'The transcription for this object is available.', transcriptionOpen: true, transcription: 'First line\nSecond line'}};
}
function searchSnapshot(query = 'Example'): Snapshot {
  const s = snapshot(); s.url = searchUrl(query);
  s.search = {present: true, summary: '1–20 of 25 results for Example', page: '1', pages: '2', limit: '20', sort: 'relevant', online: false,
    results: [{title: 'Example record', url: recordUrl(id), level: 'Item', description: 'Matched text', text: 'Select result 1\nItem\nExample record', thumbnailUrl: null}]};
  return s;
}

test('NARA identifiers stay exact and provider URLs reject unsafe origins', () => {
  assert.equal(recordId(recordUrl(id)), id);
  assert.equal(recordUrl(`${ORIGIN}/id/${id}?objectId=456&objectPage=2`), `${ORIGIN}/id/${id}`);
  for (const value of ['0', '-2', '1e9', `${ORIGIN}.evil.test/id/1`, 'https://user:pass@catalog.archives.gov/id/1', `${ORIGIN}:444/id/1`, `${ORIGIN}/api/v2/records/search`]) assert.throws(() => recordId(value));
  assert.equal(new URL(searchUrl('"John Smith" AND pension', {availableOnline: true, page: 2, limit: 50, sort: 'naId:asc'})).searchParams.get('q'), '"John Smith" AND pension');
  for (const options of [{page: 0}, {page: NaN}, {limit: 10}, {sort: 'arbitrary' as any}]) assert.throws(() => searchUrl('test', options));
  assert.throws(() => searchUrl(' '));
  assert.throws(() => mediaUrl('https://example.test/scan.jpg'));
  assert.throws(() => mediaUrl(`${ORIGIN}/api/v2/records/search`));
  assert.throws(() => mediaUrl(`${media}?key=secret`));
});

test('search retains provider warnings, exact IDs, and explicit continuation', async () => {
  const s = searchSnapshot(); s.alerts = ['The search took too long and timed out. Only some results are listed here.'];
  const result = await new NaraClient({read: async () => s}).search('Example');
  assert.equal(result.results[0].naid, id); assert.equal(result.total, 25); assert.equal(result.nextPage, 2);
  assert.equal(result.partial, true); assert.equal(result.complete, false); assert.equal(result.warnings.length, 1);
  assert.match(result.nextUrl!, /page=2/); assert.doesNotMatch(result.results[0].text, /Select result/);
  const human = humanOutput(commandById.get('nara.record search')!, result, {}, 100);
  assert.match(human, /Warning:.*timed out/); assert.match(human, /NAID 9007199254740993123/);
});

test('unrecognized search, altered filters, and off-origin result links fail closed', async () => {
  const s = searchSnapshot(); const client = new NaraClient({read: async () => s});
  await assert.rejects(client.search('Different query'), /query/);
  await assert.rejects(client.search('Example', {page: 2}), /requested page/);
  await assert.rejects(client.search('Example', {availableOnline: true}), /online filter/);
  s.search.results[0].url = 'https://evil.test/id/1'; await assert.rejects(client.search('Example'), /Only https/);
  s.search.results = []; s.search.summary = 'Loading'; await assert.rejects(client.search('Example'), /confirmed empty/);
  assert.equal(ready(s, s.url, 'search'), false);
  s.search.summary = '0 results for Example'; assert.equal(ready(s, s.url, 'search'), true);
  const empty = await client.search('Example'); assert.equal(empty.total, 0); assert.equal(empty.complete, true); assert.equal(empty.nextPage, null);
  s.search.summary = 'There are no search results found using the search term: Example';
  assert.equal(ready(s, s.url, 'search'), true); assert.equal((await client.search('Example')).total, 0);
});

test('record hierarchy and rendered object lists keep completeness explicit', async () => {
  const s = snapshot(); s.record.links.push({title: 'Unexpected', url: 'https://evil.test/id/1'});
  const client = new NaraClient({read: async () => s}); const record = await client.record(id);
  assert.equal(record.naid, id); assert.equal(record.hierarchy[0].url, recordUrl('12')); assert.equal(record.relatedLinks.length, 0);
  assert.equal((await client.objects(id)).complete, true);
  s.objects.items.pop(); const subset = await client.objects(id); assert.equal(subset.complete, false); assert.equal(subset.warnings.length, 1);
  s.record.header = 'NAID: 123'; await assert.rejects(client.record(id), /requested NAID/);
});

test('object selection never substitutes the first page; transcriptions preserve line breaks', async () => {
  const s = snapshot(), client = new NaraClient({read: async () => s});
  await assert.rejects(client.object(id, 2), /requested object page/);
  assert.equal(ready(s, recordUrl(id, 2), 'object'), false);
  assert.throws(() => ready(s, recordUrl(id, 3), 'object'), /exceeds/);
  s.objects.page = s.objects.selected = '2'; s.url = recordUrl(id, 2, true);
  assert.equal(ready(s, s.url, 'transcription'), true);
  const result = await client.object(id, 2, true);
  assert.equal(result.transcription, 'First line\nSecond line'); assert.equal(result.transcriptionKind, 'citizen-contributed');
  s.objects.transcription = null; s.objects.transcriptionLabel = 'The transcription for this object is not available.';
  assert.equal(ready(s, s.url, 'transcription'), true);
  s.objects.transcriptionOpen = false; assert.equal(ready(s, s.url, 'transcription'), false);
});

test('browser reads close their tab after success, rendering failure, and verification', async () => {
  const s = snapshot(); let closed = 0;
  const get = async () => ({tab: async (provider: string) => {assert.equal(provider, 'nara'); return {evaluate: async () => s, close: async () => {closed++;}};}} as unknown as Camofox);
  setBrowserOverrides({transport: 'browser'});
  try {
    assert.equal((await readPage(recordUrl(id), 'record', 0, get)).record.title, 'Example record');
    s.challenge = true; await assert.rejects(readPage(recordUrl(id), 'record', 0, get), /verification/);
    s.challenge = false; s.record.title = ''; await assert.rejects(readPage(recordUrl(id), 'record', 0, get), /not a confirmed empty/);
    assert.equal(closed, 3);
  } finally {setBrowserOverrides({});}
  await assert.rejects(readPage(recordUrl(id), 'record', 0, get), /require the rendered Catalog/);
  assert.equal(closed, 3);
});

test('original downloads omit credentials, save checksums, and never overwrite files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-nara-')), out = join(directory, 'scan.jpg');
  try {
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(String(url), media); assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
      assert.equal(new Headers(init?.headers).has('x-api-key'), false);
      return new Response(new Uint8Array([255, 216, 255, 0, 255, 217]), {headers: {'content-type': 'image/jpeg', 'content-length': '6'}});
    };
    const s = snapshot(); const client = new NaraClient({read: async () => s, fetch: fetcher});
    const saved = await client.download(id, out);
    assert.equal(saved.bytes, 6); assert.match(saved.sha256, /^[a-f0-9]{64}$/);
    assert.equal((await stat(out)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(saved.provenance, 'utf8')).naid, id);
    await assert.rejects(client.download(id, out), /already exists/);
    assert.equal((await readFile(out)).length, 6);
    assert.deepEqual((await readdir(directory)).sort(), ['scan.jpg', 'scan.jpg.provenance.json']);
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('unsafe redirects, oversized streams, error HTML, and truncation leave no downloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fam-nara-')), out = join(directory, 'scan.jpg');
  try {
    const responses = [
      () => new Response(null, {status: 302, headers: {location: 'https://evil.test/scan.jpg'}}),
      () => new Response('012345', {headers: {'content-type': 'image/jpeg'}}),
      () => new Response('<html>Error</html>', {headers: {'content-type': 'text/html'}}),
      () => new Response('xx', {headers: {'content-type': 'image/jpeg', 'content-length': '4'}}),
      () => new Response('', {headers: {'content-type': 'image/jpeg'}}),
    ];
    for (const make of responses) {
      await assert.rejects(downloadObject({downloadUrl: media}, out, {fetch: async () => make(), timeout: 2, maxBytes: 4}));
      assert.deepEqual(await readdir(directory), []);
    }
    await writeFile(`${out}.provenance.json`, 'keep');
    await assert.rejects(downloadObject({downloadUrl: media}, out, {fetch: async () => {throw new Error('Must not fetch');}, timeout: 2, maxBytes: 4}), /already exists/);
    assert.equal(await readFile(`${out}.provenance.json`, 'utf8'), 'keep');
  } finally {await rm(directory, {recursive: true, force: true});}
});

test('NARA discovery has six public commands, typed flags, URL resolution, and offline health', async () => {
  assert.equal(commands.filter(c => c.provider === 'nara').length, 6);
  assert.equal((authenticatedProviderNames as readonly string[]).includes('nara'), false);
  const call = await parseInvocation(['nara.record', 'search', '--query', 'pension', '--available-online', '--limit', '50']);
  assert.equal(call.values.limit, 50); assert.equal(call.values['available-online'], true);
  assert.throws(() => parseInvocation(['nara.record', 'search', '--query', 'pension', '--limit', '10']), /one of/);
  assert.deepEqual(resolveContext(recordUrl(id, 2)).flags, {naid: id, page: '2'});
  assert.equal(resolveContext(recordUrl(id), 'familysearch').provider, 'familysearch');
  assert.equal(resolveContext(`${ORIGIN}.evil.test/id/1`).provider, undefined);
  const report = await runDoctor(['nara'], false);
  assert.equal(report.providers[0].checks[0].code, 'public-access');
  assert.ok(report.providers[0].checks.some(c => c.code === 'live-not-requested'));
});
