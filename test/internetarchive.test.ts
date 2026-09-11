import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InternetArchiveClient} from '../src/internetarchive/client.js';
import {ArchiveHttp, fileUrl, readBytes} from '../src/internetarchive/http.js';
import {diagnose} from '../src/internetarchive/doctor.js';
import {commands, commandById, authenticatedProviderNames} from '../src/shared/command-registry.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {resolveContext} from '../src/shared/command-search.js';
import {humanOutput} from '../src/shared/command-output.js';
import {complete, completionCatalog} from '../src/shared/completion.js';
import {runProvider} from '../src/internetarchive/cli.js';

const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {'content-type': 'application/json'}});
const md5 = (data: string) => createHash('md5').update(data).digest('hex');
const contents = 'SYNTHETIC OCR\nJohn Example lived in Example County.\n';
const item = (extra = {}) => ({metadata: {identifier: 'synthetic-book', title: 'Synthetic county history', creator: ['Example Author'], date: '1900'},
  files: [{name: 'book_djvu.txt', format: 'DjVuTXT', source: 'derivative', size: String(Buffer.byteLength(contents)), md5: md5(contents)},
    {name: 'private.pdf', format: 'Text PDF', private: 'true'}, {name: 'folder/map #1.jpg', format: 'JPEG', source: 'original'}], ...extra});
function client(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return new InternetArchiveClient({fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), null); assert.equal(headers.get('cookie'), null);
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'manual');
    assert.match(headers.get('user-agent')!, /^fam\/\d/);
    return handler(new URL(String(input)), init!);
  }});
}

test('catalog search preserves bibliographic arrays, large totals, URL parameters and page continuation', async () => {
  const c = client((url, init) => {
    assert.equal(url.origin, 'https://archive.org'); assert.equal(url.pathname, '/advancedsearch.php'); assert.equal(init.method, 'GET');
    assert.equal(url.searchParams.get('q'), 'title:"city directory" AND year:[1880 TO 1920]');
    assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('rows'), '2');
    assert.equal(url.searchParams.get('fl[0]'), 'identifier'); assert.equal(url.searchParams.get('fl[1]'), 'title');
    assert.equal(url.searchParams.get('sort[0]'), 'date asc'); assert.equal(url.searchParams.get('output'), 'json');
    return new Response('{"response":{"numFound":9007199254740993,"start":2,"docs":[{"identifier":"synthetic-book","title":["Volume one","Volume two"]}]}}');
  });
  const result = await c.search('title:"city directory" AND year:[1880 TO 1920]', {limit: 2, page: 2, fields: ['title'], sort: ['date asc']});
  assert.equal(result.total, 9007199254740993n); assert.equal(result.nextPage, 3); assert.equal(result.hasMore, true);
  assert.deepEqual(result.items[0].title, ['Volume one', 'Volume two']); assert.equal(result.items[0].url, 'https://archive.org/details/synthetic-book');
});

test('collection filter preserves grouping and catalog search distinguishes empty results', async () => {
  const c = client(url => {
    assert.equal(url.searchParams.get('q'), 'collection:genealogy AND (title:history OR title:directory)');
    return json({response: {numFound: 0, docs: []}});
  });
  const result = await c.collection('genealogy', 'title:history OR title:directory');
  assert.deepEqual(result.items, []); assert.equal(result.hasMore, false); assert.equal(result.nextPage, null);
});

test('cursor scan returns one page and preserves opaque cursor without dropping below-minimum results', async () => {
  const cursor = 'a+b/c==';
  let calls = 0;
  const c = client(url => {
    calls++; assert.equal(url.pathname, '/services/search/v1/scrape');
    assert.equal(url.searchParams.get('count'), '100'); assert.equal(url.searchParams.get('cursor'), cursor);
    assert.equal(url.searchParams.get('fields'), 'identifier,title');
    assert.equal(url.searchParams.get('sorts'), 'date asc,identifier');
    return json({items: [{identifier: 'synthetic-book'}], count: 1, total: 20, cursor: 'next+/='});
  });
  const result = await c.scan('collection:genealogy', {cursor, fields: ['title'], sort: ['date asc', 'identifier']});
  assert.equal(result.cursor, 'next+/='); assert.equal(result.hasMore, true); assert.equal(result.total, 20); assert.equal(calls, 1);
});

test('full-text uses the upstream Lucene POST contract and preserves hit fields, highlights, totals, and partial status', async () => {
  const c = client((url, init) => {
    assert.equal(url.href, 'https://be-api.us.archive.org/ia-pub-fts-api'); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), {q: '!L "John Example"', size: 2, from: 4, scroll: false});
    return json({timed_out: true, hits: {total: {value: 100, relation: 'gte'}, hits: [
      {_id: 'synthetic-book|hit', fields: {identifier: ['synthetic-book'], meta_title: ['Synthetic history'], page_num: [[42]]}, highlight: {text: ['{{{John Example}}}']}}
    ]}});
  });
  const result = await c.fulltext('"John Example"', {limit: 2, offset: 4});
  assert.equal(result.nextOffset, 6); assert.equal(result.timedOut, true); assert.match(result.warning!, /partial/);
  assert.equal(result.items[0].url, 'https://archive.org/details/synthetic-book');
  assert.deepEqual(result.total, {value: 100, relation: 'gte'});
  const rendered = humanOutput(commandById.get('internetarchive.fulltext search')!, result, {});
  assert.match(rendered, /Synthetic history/); assert.match(rendered, /John Example/); assert.match(rendered, /Warning:.*partial/);
});

test('invalid inputs fail before contacting the service', async () => {
  const c = client(() => {throw new Error('must not fetch');});
  await Promise.all([c.search(' '), c.search('a', {limit: NaN}), c.search('a', {limit: 100, page: 101}),
    c.search('a', {fields: ['title&secret']}), c.search('a', {sort: ['date,secret']}), c.scan('a', {count: 20}),
    c.scan('a', {sort: ['identifier', 'date']}), c.fulltext('a', {limit: 101}), c.fulltext('a', {limit: 2, offset: 9999}),
    c.item('../outside'), c.item('https://archive.org/details/book'), c.collection('genealogy OR *:*'),
    c.download('book', '../outside', 'unused'), c.download('book', 'file', 'unused', {maxBytes: -1}),
    c.text('book', {limit: 0})].map(pending => assert.rejects(pending, {code: 'INVALID_ARGUMENT'})));
});

test('HTTP-200 API failures, missing metadata, malformed JSON, and malformed search shapes are errors', async () => {
  for (const response of [json({error: 'bad query'}), json({success: false}), new Response('<html>challenge</html>'), json({response: {docs: []}})])
    await assert.rejects(client(() => response).search('example'));
  for (const response of [json([]), json({}), json({error: 'Item deleted', errcode: 104})])
    await assert.rejects(client(() => response).item('missing-item'));
  await assert.rejects(client(() => json({hits: {hits: [null]}})).fulltext('example'), {code: 'INVALID_RESPONSE'});
});

test('metadata and file filtering preserve access flags and encode nested file names', async () => {
  const c = client(url => {assert.equal(url.searchParams.get('extended_err'), '1'); return json(item());});
  const data = await c.item('synthetic-book');
  assert.equal(data.files[1].private, 'true');
  assert.equal(data.files[2].downloadUrl, 'https://archive.org/download/synthetic-book/folder/map%20%231.jpg?cnt=0');
  const filtered = await c.files('synthetic-book', {format: 'djvutxt', name: 'BOOK', source: 'derivative'});
  assert.equal(filtered.files.length, 1); assert.equal(filtered.files[0].name, 'book_djvu.txt');
  for (const name of ['../bad', '/absolute', 'a/../../bad', 'a\\bad', 'a\0bad', 'a//bad']) assert.throws(() => fileUrl('book', name));
});

test('OCR selection, exact UTF-16 excerpt continuation, private files and ambiguous volumes', async () => {
  const c = client(url => url.pathname.startsWith('/metadata/') ? json(item()) : new Response(contents));
  const result = await c.text('synthetic-book', {offset: 4, limit: 10});
  assert.equal(result.text, contents.slice(4, 14)); assert.equal(result.nextOffset, 14); assert.equal(result.hasMore, true);
  assert.equal((await c.text('synthetic-book', {offset: 1000})).hasMore, false);
  await assert.rejects(c.text('synthetic-book', {file: 'private.pdf'}), {code: 'ACCESS_DENIED'});
  const ambiguous = client(() => json(item({files: [...item().files, {name: 'volume2_djvu.txt', format: 'DjVuTXT'}]})));
  await assert.rejects(ambiguous.text('synthetic-book'), /Multiple OCR/);
  const missing = client(() => json(item({files: []})));
  await assert.rejects(missing.text('synthetic-book'), /No selected public OCR/);
});

test('download streams bytes, verifies metadata, writes private provenance and never overwrites destinations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fam-ia-download-')), out = join(dir, 'book.txt');
  const c = client(url => url.pathname.startsWith('/metadata/') ? json(item()) : new Response(contents));
  try {
    const result = await c.download('synthetic-book', 'book_djvu.txt', out);
    assert.equal(await readFile(out, 'utf8'), contents); assert.equal(result.bytes, Buffer.byteLength(contents));
    const side = JSON.parse(await readFile(`${out}.json`, 'utf8'));
    assert.equal(side.identifier, 'synthetic-book'); assert.equal(side.md5, md5(contents));
    assert.equal(side.sha256, createHash('sha256').update(contents).digest('hex'));
    assert.equal((await stat(out)).mode & 0o777, 0o600); assert.equal((await stat(`${out}.json`)).mode & 0o777, 0o600);
    await assert.rejects(c.download('synthetic-book', 'book_djvu.txt', out), {code: 'EEXIST'});
    assert.equal(await readFile(out, 'utf8'), contents);
    assert.deepEqual((await readdir(dir)).sort(), ['book.txt', 'book.txt.json']);
    const second = join(dir, 'second.txt'); await writeFile(`${second}.json`, 'existing');
    await assert.rejects(c.download('synthetic-book', 'book_djvu.txt', second), {code: 'EEXIST'});
    await assert.rejects(stat(second), {code: 'ENOENT'}); assert.equal(await readFile(`${second}.json`, 'utf8'), 'existing');
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('size limits, checksum mismatches, interrupted downloads and private files leave no artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fam-ia-failure-')), out = join(dir, 'book.txt');
  try {
    for (const response of [() => new Response('bad'), () => new Response(new ReadableStream({start(controller) {controller.error(new Error('interrupted'));}}))]) {
      const c = client(url => url.pathname.startsWith('/metadata/') ? json(item()) : response());
      await assert.rejects(c.download('synthetic-book', 'book_djvu.txt', out));
      assert.deepEqual(await readdir(dir), []);
    }
    const c = client(url => url.pathname.startsWith('/metadata/') ? json(item()) : new Response(contents));
    await assert.rejects(c.download('synthetic-book', 'book_djvu.txt', out, {maxBytes: 3}), {code: 'SIZE_LIMIT'});
    await assert.rejects(c.download('synthetic-book', 'private.pdf', out), {code: 'ACCESS_DENIED'});
    await assert.rejects(c.download('synthetic-book', 'absent.txt', out), {code: 'NOT_FOUND'});
    const wrongMd5 = client(url => url.pathname.startsWith('/metadata/') ? json(item({files: [{name: 'book.txt', md5: '0'.repeat(32)}]})) : new Response(contents));
    await assert.rejects(wrongMd5.download('synthetic-book', 'book.txt', out), {code: 'INTEGRITY_ERROR'});
    const html = client(url => url.pathname.startsWith('/metadata/') ? json(item({files: [{name: 'book.pdf'}]}))
      : new Response('<html>Login required</html>', {headers: {'content-type': 'text/html'}}));
    await assert.rejects(html.download('synthetic-book', 'book.pdf', out), {code: 'ACCESS_DENIED'});
    assert.deepEqual(await readdir(dir), []);
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('only approved HTTPS download redirects are followed; no account cookies are used', async () => {
  for (const location of ['https://evil.example/file', 'https://archive.org.evil.example/file', 'http://ia800001.us.archive.org/file',
    'https://user:password@archive.org/download/book/file', 'https://archive.org/account/login', 'https://archive.org:8443/download/book/file']) {
    let calls = 0;
    const c = client(() => {calls++; return new Response(null, {status: 302, headers: {location}});});
    await assert.rejects(c.http.request('https://archive.org/download/book/file', {download: true}));
    assert.equal(calls, 1);
  }
  const c = client(url => url.hostname === 'archive.org' ? new Response(null, {status: 302, headers: {location: 'https://ia800001.us.archive.org/1/items/book/file'}}) : new Response(contents));
  assert.equal((await readBytes(await c.http.request('https://archive.org/download/book/file', {download: true}), 1000)).toString(), contents);
});

test('retries are bounded, long Retry-After fails without retrying, and access errors are actionable', async () => {
  let calls = 0;
  const c = client(() => {calls++; return new Response(null, {status: 429, headers: {'retry-after': '0'}});});
  await assert.rejects(c.search('example'), {code: 'RATE_LIMITED'}); assert.equal(calls, 3);
  calls = 0;
  const long = client(() => {calls++; return new Response(null, {status: 503, headers: {'retry-after': '120'}});});
  await assert.rejects(long.search('example'), /Retry-After: 120/); assert.equal(calls, 1);
  await assert.rejects(client(() => new Response(null, {status: 403})).search('example'), /anonymous access/);
  assert.throws(() => new ArchiveHttp({userAgentSuffix: 'bad\r\nHeader: bad'}));
  await assert.rejects(readBytes(new Response(contents, {headers: {'content-length': '9999'}}), 10), {code: 'SIZE_LIMIT'});
});

test('CLI adapters, provider discovery, completion, URL resolution, offline doctor and anonymous-only help agree', async t => {
  t.mock.method(globalThis, 'fetch', async () => json({response: {numFound: 0, docs: []}}));
  const invocation = parseInvocation(['internetarchive.item', 'search', '--query', 'genealogy', '--field', 'title', '--field', 'creator', '--json']);
  const result = await runProvider(invocation.args) as {items: unknown[]}; assert.deepEqual(result.items, []);
  const providerCommands = commands.filter(command => command.provider === 'internetarchive');
  assert.equal(providerCommands.length, 8);
  assert.ok(providerCommands.every(command => command.risk.level === 'read'));
  assert.ok(!authenticatedProviderNames.some(name => String(name) === 'internetarchive'));
  assert.ok(complete(completionCatalog(), ['internetarchive.item', '']).candidates.includes('search'));
  assert.throws(() => parseInvocation(['internetarchive.file', 'download', '--identifier', 'book', '--file', 'book.pdf']));
  const resolved = resolveContext('https://archive.org/details/synthetic-book/page/n3/mode/2up');
  assert.equal(resolved.provider, 'internetarchive'); assert.deepEqual(resolved.flags, {identifier: 'synthetic-book'});
  assert.deepEqual(resolveContext('https://archive.org/download/book/folder/a%20b.txt').flags, {identifier: 'book', file: 'folder/a b.txt'});
  assert.deepEqual(resolveContext('https://archive.org/details/book', 'geneanet').flags, {});
  assert.equal(resolveContext('https://archive.org.evil.example/details/book').provider, undefined);
  const report = await diagnose(false); assert.equal(report.status, 'ok'); assert.match(report.checks[0].message, /Anonymous/);
});
