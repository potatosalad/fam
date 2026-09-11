import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, readdir, rm, stat, writeFile, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {InternetArchiveClient} from '../src/internetarchive/client.js';
import {parseOcr, sha256} from '../src/internetarchive/books.js';
import {readerUrl} from '../src/internetarchive/http.js';
import {CREDENTIAL_DIR, readPrivateFile, writePrivateFile} from '../src/shared/storage.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {runProvider} from '../src/internetarchive/cli.js';
import {humanInternetArchive} from '../src/internetarchive/output.js';
import {resolveContext} from '../src/shared/command-search.js';

const id = 'synthetic-genealogy', volume = 'volume-one', server = 'ia800001.us.archive.org', itemPath = `/1/items/${id}`;
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {'content-type': 'application/json'}});
const xmlPage = (leaf: number, text = 'John Examp1e of Example County') => `<OBJECT width="100" height="150" usemap="${volume}_${String(leaf).padStart(4, '0')}.djvu"><HIDDENTEXT><PARAGRAPH><LINE>${text.split(' ').map(word => `<WORD coords="1,20,10,2">${word}</WORD>`).join('')}</LINE></PARAGRAPH></HIDDENTEXT></OBJECT>`;
const xml = (body: string) => `<?xml version="1.0"?><DjVuXML><BODY>${body}</BODY></DjVuXML>`;
const fullXml = xml(xmlPage(1, '') + xmlPage(3) + xmlPage(4, 'John Example'));
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const metadata = () => ({server, dir: itemPath, metadata: {identifier: id, title: 'Synthetic county history', creator: ['Example Author'], date: '1900', publisher: 'Example Press'},
  files: [{name: `${volume}_jp2.zip`}, {name: `${volume}_scandata.xml`}, {name: `${volume}_djvu.xml`, size: String(Buffer.byteLength(fullXml)), md5: md5(fullXml)}]});
const reader = () => ({data: {data: {id, subPrefix: volume, bookUrl: `/details/${id}/${volume}`, isRestricted: false, streamOnly: false},
  lendingInfo: {shouldProtectImages: false, isLendingRequired: false}, brOptions: {bookId: id, subPrefix: volume, bookPath: `${itemPath}/${volume}`,
    plugins: {search: {enabled: true}, textSelection: {enabled: true}}, data: [[1,3,4].map((leaf, i) => ({leafNum: leaf, width: 100, height: 150, pageNum: i ? '1' : 'i',
      uri: `https://${server}/BookReader/BookReaderImages.php?id=${id}&zip=${itemPath}/${volume}_jp2.zip&file=${volume}_jp2/${volume}_${String(leaf).padStart(4, '0')}.jp2`}))]}}});
const jpeg = () => sharp({create: {width: 100, height: 150, channels: 3, background: '#eeeeee'}}).jpeg().toBuffer();
function client(overrides: {metadata?: ReturnType<typeof metadata>; reader?: ReturnType<typeof reader>; response?: (url: URL) => Response | Promise<Response> | undefined} = {}) {
  const calls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers); calls.push(url);
    assert.equal(init?.credentials, 'omit'); assert.equal(headers.get('authorization'), null); assert.equal(headers.get('cookie'), null);
    if (url.pathname.startsWith('/metadata/')) return json(overrides.metadata ?? metadata());
    if (url.pathname.endsWith('BookReaderJSIA.php')) {
      assert.equal(url.searchParams.get('subPrefix'), volume); assert.equal(url.searchParams.get('format'), 'json');
      return json(overrides.reader ?? reader());
    }
    const response = await overrides.response?.(url); if (response) return response;
    if (url.pathname.endsWith('inside.php')) return json({ia: id, indexed: true, matches: [{text: '{{{John}}}', par: [{page: 3, boxes: [{page: 3, l: 1, r: 10, t: 2, b: 20}]}]}]});
    if (url.pathname.endsWith('BookReaderGetTextWrapper.php')) {
      assert.equal(url.searchParams.get('mode'), 'djvu_xml'); assert.equal(url.searchParams.get('path'), `${itemPath}/${volume}_djvu.xml`);
      return new Response(xml(xmlPage([1,3,4][Number(url.searchParams.get('page'))])));
    }
    if (url.pathname.endsWith('BookReaderImages.php')) return new Response(new Uint8Array(await jpeg()));
    if (url.pathname.startsWith('/download/')) return new Response(fullXml);
    throw new Error(`Unexpected request: ${url}`);
  };
  return {c: new InternetArchiveClient({fetch: fetcher}), calls, fetcher};
}

test('book map distinguishes reader position, excluded scan leaves, and duplicate printed labels', async () => {
  const {c} = client();
  assert.deepEqual((await c.books.list(id)).volumes, [volume]);
  const book = await c.books.get(id);
  assert.equal(book.pageCount, 3); assert.equal(book.access.publicContent, true);
  const page = await c.books.page(id, {page: 2});
  assert.equal(page.leaf, 3); assert.equal(page.pageIndex, 1); assert.equal(page.pageLabel, '1');
  assert.equal(page.url, `https://archive.org/details/${id}/${volume}/page/n1/mode/1up`);
  assert.equal((await c.books.page(id, {leaf: 4})).page, 3);
  await assert.rejects(c.books.page(id, {pageLabel: '1'}), {code: 'AMBIGUOUS_PAGE'});
  await assert.rejects(c.books.page(id, {leaf: 2}), {code: 'NOT_FOUND'});
  const list = await c.books.pages(id, {limit: 1, offset: 1}); assert.equal(list.nextOffset, 2); assert.equal(list.pages[0].leaf, 3);
  assert.deepEqual(resolveContext(page.url).flags, {identifier: id, volume, page: '2'});
});

test('ambiguous volume selection and invalid selectors fail before requesting page content', async () => {
  const m = metadata(); m.files.push({name: 'second_scandata.xml'});
  const {c, calls} = client({metadata: m});
  await assert.rejects(c.books.get(id), {code: 'VOLUME_REQUIRED'}); assert.equal(calls.length, 1);
  await c.books.get(id, {volume});
  for (const selector of [{}, {page: 2, leaf: 3}, {page: 0}, {leaf: -1}, {pageLabel: ''}]) await assert.rejects(c.books.page(id, selector), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls.length, 3);
  await assert.rejects(c.books.get(id, {volume: '../bad'}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(c.books.download(id, 'unused.jpg', {leaf: 3, scale: 3}), {code: 'INVALID_ARGUMENT'});
  await assert.rejects(c.books.evidence(id, 'unused-dir', {leaf: 3, maxBytes: 0}), {code: 'INVALID_ARGUMENT'});
  assert.equal(calls.length, 3);
});

test('volume citation links retain nested prefixes even when BookReader reports only the main item URL', async () => {
  const prefix = `nested/books/${volume}`, m = metadata(), r = reader();
  m.files = m.files.map(file => ({...file, name: `nested/books/${file.name}`}));
  r.data.data.bookUrl = `/details/${id}`; r.data.data.subPrefix = prefix;
  r.data.brOptions.subPrefix = prefix; r.data.brOptions.bookPath = `${itemPath}/${prefix}`;
  r.data.brOptions.data[0].forEach(page => {page.uri = page.uri.replace(`${itemPath}/${volume}_jp2.zip`, `${itemPath}/${prefix}_jp2.zip`);});
  const c = new InternetArchiveClient({fetch: async input => new URL(String(input)).pathname.startsWith('/metadata/') ? json(m) : json(r)});
  const book = await c.books.get(id, {volume: prefix});
  assert.equal(book.url, `https://archive.org/details/${id}/${prefix}`);
  assert.deepEqual(resolveContext(book.pages[0].url).flags, {identifier: id, volume: prefix, page: '1'});
});

test('book search retains coordinates and maps leaves; empty matches are valid and indexing failure is explicit', async () => {
  const {c} = client();
  const result = await c.books.search(id, 'John');
  assert.equal(result.matches[0].pages[0].leaf, 3); assert.equal(result.matches[0].pages[0].url, `https://archive.org/details/${id}/${volume}/page/n1/mode/1up`);
  assert.equal(result.totalReturned, 1); assert.equal(result.nextOffset, null); assert.match(humanInternetArchive(result), /John/);
  assert.equal((await client({response: () => json({ia: id, indexed: true, matches: []})}).c.books.search(id, 'none')).totalReturned, 0);
  await assert.rejects(client({response: () => json({ia: id, indexed: false, matches: []})}).c.books.search(id, 'John'), {code: 'NOT_INDEXED'});
  const unknown = await client({response: () => json({ia: id, indexed: true, matches: [{text: 'John', par: [{page: 999}]}]})}).c.books.search(id, 'John');
  assert.equal(unknown.matches[0].pages[0].url, null);
});

test('page OCR validates leaf and dimensions, retains words and boxes, and supports empty pages', async () => {
  const {c, calls} = client();
  const result = await c.books.ocr(id, {leaf: 3});
  assert.equal(calls.at(-1)!.searchParams.get('page'), '1'); assert.equal(result.text, 'John Examp1e of Example County');
  assert.deepEqual(result.paragraphs[0].words[0], {text: 'John', box: [1,20,10,2]});
  assert.match(humanInternetArchive(result), /Reader page 2 · leaf 3/);
  const empty = client({response: () => new Response(xml(xmlPage(3, '')))});
  assert.equal((await empty.c.books.ocr(id, {leaf: 3})).text, '');
  await assert.rejects(client({response: () => new Response(xml(xmlPage(4)))}).c.books.ocr(id, {leaf: 3}), {code: 'INTEGRITY_ERROR'});
  assert.throws(() => parseOcr('<html>Login</html>', volume));
  assert.throws(() => parseOcr('<?xml version="1.0"?><!ENTITY x SYSTEM "file:///private">', volume));
  assert.throws(() => parseOcr(xml(xmlPage(3) + xmlPage(3)), volume), /Duplicate/);
});

test('restricted and streaming books expose metadata but never request page content', async () => {
  for (const field of ['isRestricted', 'streamOnly'] as const) {
    const r = reader(); r.data.data[field] = true;
    const {c, calls} = client({reader: r});
    const book = await c.books.get(id); assert.equal(book.access.publicContent, false); assert.equal(book.pages[0].imageUrl, null);
    await assert.rejects(c.books.ocr(id, {leaf: 3}), {code: 'ACCESS_DENIED'});
    assert.ok(calls.every(u => u.pathname.includes('/metadata/') || u.pathname.endsWith('BookReaderJSIA.php')));
    const citation = await c.books.citation(id, {leaf: 3}); assert.equal(citation.page!.leaf, 3);
  }
});

test('BookReader origin, route, identity, and storage path restrictions reject unexpected requests', async () => {
  for (const url of ['https://evil.example/BookReader/BookReaderJSIA.php', 'http://ia800001.us.archive.org/BookReader/BookReaderJSIA.php',
    'https://ia800001.us.archive.org/account/login', 'https://archive.org:8443/BookReader/BookReaderJSIA.php', 'https://user:pass@archive.org/BookReader/BookReaderJSIA.php']) assert.throws(() => readerUrl(url));
  const m = metadata(); m.server = 'evil.example'; await assert.rejects(client({metadata: m}).c.books.get(id), {code: 'UNSAFE_URL'});
  const r = reader(); r.data.brOptions.subPrefix = 'wrong'; await assert.rejects(client({reader: r}).c.books.get(id), {code: 'INVALID_RESPONSE'});
  const redirected = client({response: () => new Response(null, {status: 302, headers: {location: 'https://archive.org/account/login'}})});
  await assert.rejects(redirected.c.books.ocr(id, {leaf: 3}), {code: 'UNSAFE_URL'});
});

test('page downloads and evidence exports verify images, create private provenance, and refuse existing outputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fam-ia-evidence-')), out = join(dir, 'page.jpg'), bundle = join(dir, 'evidence');
  try {
    const {c} = client();
    const result = await c.books.download(id, out, {leaf: 3});
    assert.equal(result.sha256, sha256(await readFile(out))); assert.equal((await stat(out)).mode & 0o777, 0o600);
    const side = JSON.parse(await readFile(`${out}.json`, 'utf8')); assert.equal(side.page.leaf, 3); assert.equal(side.page.page, 2);
    await assert.rejects(c.books.download(id, out, {leaf: 3}), {code: 'EEXIST'});
    await c.books.evidence(id, bundle, {leaf: 3});
    const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) {const bytes = await readFile(join(bundle, file.name)); assert.equal(file.sha256, sha256(bytes)); assert.equal(file.bytes, bytes.length);}
    assert.equal((await stat(bundle)).mode & 0o777, 0o700);
    const citation = JSON.parse(await readFile(join(bundle, 'citation.json'), 'utf8'));
    assert.match(citation.text, /Example Author.*Synthetic county history.*1900/); assert.match(citation.text, /p\. 1, reader page 2, scan leaf 3/);
    await assert.rejects(c.books.evidence(id, bundle, {leaf: 3}), {code: 'EEXIST'});
    assert.deepEqual((await readdir(dir)).sort(), ['evidence', 'page.jpg', 'page.jpg.json']);
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('bad images, mismatched dimensions, size limits, and interrupted OCR leave no export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fam-ia-invalid-'));
  try {
    const out = join(dir, 'failed.jpg');
    await assert.rejects(client({response: () => new Response('<html>Login</html>')}).c.books.download(id, out, {leaf: 3}), {code: 'INVALID_RESPONSE'});
    const wrong = await sharp({create: {width: 50, height: 50, channels: 3, background: 'white'}}).jpeg().toBuffer();
    await assert.rejects(client({response: () => new Response(new Uint8Array(wrong))}).c.books.download(id, out, {leaf: 3}), {code: 'INTEGRITY_ERROR'});
    await assert.rejects(client().c.books.download(id, out, {leaf: 3, maxBytes: 1}), {code: 'SIZE_LIMIT'});
    await assert.rejects(client({response: () => new Response(new ReadableStream({start(c) {c.error(new Error('interrupted'));}}))}).c.books.evidence(id, join(dir, 'failed'), {leaf: 3}));
    assert.deepEqual(await readdir(dir), []);
  } finally {await rm(dir, {recursive: true, force: true});}
});

test('cache verifies whole OCR once, resumes completed books, and searches literal variants and labelled fuzzy leads offline', async () => {
  const reference = `${id}/${volume}`;
  const {c, calls} = client();
  const result = await c.research.cache([reference], {refresh: true});
  assert.equal(result.status, 'complete'); assert.equal(result.results[0].missingOcrPages, 0);
  const requestCount = calls.length;
  assert.equal((await c.research.cache([reference])).results[0].status, 'reused'); assert.equal(calls.length, requestCount);
  const literal = await c.research.search([reference], ['John Example', 'John Examp1e']);
  assert.equal(literal.total, 2); assert.equal(literal.offline, true); assert.equal(calls.length, requestCount);
  const fuzzy = await c.research.search([reference], ['Example'], {fuzzy: true, limit: 1});
  assert.equal(fuzzy.matches[0].matchType, 'literal'); // Exact word elsewhere on the page wins over the approximate spelling.
  assert.equal(fuzzy.nextOffset, 1);
  const approximate = await c.research.search([reference], ['Examp1e'], {fuzzy: true, offset: 1});
  assert.equal(approximate.matches[0].matchType, 'approximate-one-edit'); assert.equal(approximate.matches[0].matched, 'example');
  await assert.rejects(c.research.search([reference], ['John Example'], {fuzzy: true}), {code: 'INVALID_ARGUMENT'});
  const missing = await c.research.search([reference, 'not-cached'], ['John']); assert.equal(missing.status, 'partial'); assert.equal(missing.errors[0].code, 'CACHE_MISSING');
});

test('failed refresh retains the prior cache; missing/excluded OCR pages and failed books report partial coverage', async () => {
  const reference = id;
  await client().c.research.cache([reference], {refresh: true});
  const broken = client({response: () => new Response('damaged')});
  const failure = await broken.c.research.cache([reference], {refresh: true}); assert.equal(failure.status, 'partial'); assert.equal(failure.errors[0].code, 'INTEGRITY_ERROR');
  assert.equal((await broken.c.research.search([reference], ['John'])).total, 2);
  const partialXml = xml(xmlPage(3) + xmlPage(2, 'An excluded leaf'));
  const m = metadata(); m.files[2] = {name: `${volume}_djvu.xml`, size: String(Buffer.byteLength(partialXml)), md5: md5(partialXml)};
  const partial = client({metadata: m, response: () => new Response(partialXml)});
  assert.equal((await partial.c.research.cache([reference], {refresh: true})).results[0].missingOcrPages, 2);
  const result = await partial.c.research.search([reference], ['John']); assert.equal(result.status, 'partial'); assert.deepEqual(result.books[0].unmappedOcrLeaves, [2]);
  const cachePath = join(CREDENTIAL_DIR, `internetarchive/books/${sha256(reference)}.json`);
  await writeFile(cachePath, 'corrupted'); assert.equal((await partial.c.research.search([reference], ['John'])).errors[0].code, 'INVALID_CACHE');
});

test('bounded private cache reads reject traversal, symlinks, and oversized data', async () => {
  const name = 'internetarchive/test-private-file';
  const path = await writePrivateFile(name, 'example');
  assert.equal((await readPrivateFile(name, 7))!.toString(), 'example');
  await assert.rejects(readPrivateFile(name, 6)); await assert.rejects(readPrivateFile('../escape', 10));
  await symlink(path, `${path}-link`); await assert.rejects(readPrivateFile(`${name}-link`, 10));
});

test('new CLI commands preserve explicit page selectors, repeatable queries, and source citations', async t => {
  const {fetcher} = client(); t.mock.method(globalThis, 'fetch', fetcher);
  const invocation = parseInvocation(['internetarchive.page', 'ocr', '--identifier', id, '--leaf', '3']);
  assert.ok(!invocation.args.includes('--page'));
  const ocr = await runProvider(invocation.args) as {text: string}; assert.match(ocr.text, /John/);
  const citation = await runProvider(parseInvocation(['internetarchive.citation', 'get', '--identifier', id]).args) as {page: unknown; text: string};
  assert.equal(citation.page, null); assert.match(citation.text, /Synthetic county history/);
  const search = parseInvocation(['internetarchive.research', 'search', '--book', id, '--query', 'Example', '--query', 'Examp1e', '--fuzzy']);
  assert.deepEqual(search.args.filter(v => v === '--term'), ['--term', '--term']);
  assert.throws(() => parseInvocation(['internetarchive.evidence', 'export', '--identifier', id, '--page', '1']));
});

test('CLI evidence --out writes a directory without central output handling replacing it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fam-ia-cli-export-'));
  try {
    const fixture = join(dir, 'fetch.mjs'), out = join(dir, 'bundle');
    const image = (await jpeg()).toString('base64');
    await writeFile(fixture, `const metadata=${JSON.stringify(metadata())}; const reader=${JSON.stringify(reader())}; const xml=${JSON.stringify(xml(xmlPage(3)))};\nglobalThis.fetch=async input=>{const u=new URL(String(input)); if(u.pathname.startsWith('/metadata/'))return Response.json(metadata); if(u.pathname.endsWith('BookReaderJSIA.php'))return Response.json(reader); if(u.pathname.endsWith('BookReaderGetTextWrapper.php'))return new Response(xml); if(u.pathname.endsWith('BookReaderImages.php'))return new Response(Buffer.from('${image}','base64')); throw new Error('Unexpected request');};`);
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--import', fixture, 'src/cli.ts', 'internetarchive.evidence', 'export', '--identifier', id, '--leaf', '3', '--out', out, '--json'],
      {cwd: process.cwd(), env: {...process.env, FAM_HISTORY: '0', FAM_AUTO_UPDATE: '0'}});
    assert.equal(JSON.parse(result.stdout).data.saved, out); assert.equal((await stat(out)).isDirectory(), true);
    assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')).page.leaf, 3);
  } finally {await rm(dir, {recursive: true, force: true});}
});
