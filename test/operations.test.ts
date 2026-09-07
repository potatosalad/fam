import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Impit } from 'impit';
import { FamilySearchClient, factPayload, notePayload, memoryUpload, groupImageUpload, listOperations, validateOperationResponse, personChanges, searchResults } from '../src/index.js';
import { HttpError, HttpSession } from '../src/familysearch/http.js';
import { CHURCH_CLIENT_ID } from '../src/familysearch/auth.js';
import { contracts } from '../src/familysearch/generated/schema.js';
import type { WireType } from '../src/familysearch/contract-types.js';
import { prepareOperation } from '../src/familysearch/operations.js';
import { parseJson, stringifyJson } from '../src/shared/json.js';

function client() {
  const session = { version: 1, clientId: CHURCH_CLIENT_ID, tokens: { access_token: 'test-only-access', refresh_token: 'test-only-refresh' }, obtainedAt: new Date().toISOString(), cookies: new HttpSession().jar.serializeSync() };
  const result: FamilySearchClient = new (FamilySearchClient as any)(session);
  (result as any).persist = async (tokens?: any) => { if (tokens) session.tokens = tokens; };
  return result;
}

function example(type: WireType): any {
  switch (type.kind) {
    case 'ref': return Object.fromEntries(Object.entries(contracts.models[type.name]).filter(([,f]) => f.required).map(([k,f]) => [k, example(f.type)]));
    case 'array': return [];
    case 'record': return {};
    case 'string': return 'Test & café';
    case 'number': case 'integer': return 123;
    case 'boolean': return false;
    case 'void': return undefined;
    case 'json': return { acknowledged: true };
    case 'binary': return new Uint8Array([0, 1, 254, 255]);
    case 'upload': return new Blob(['test-file'], { type: 'text/plain' });
  }
}

test('every selected operation traverses the authenticated transport with the APK verb, route, parameters, and response mode', async () => {
  const endpoints = JSON.parse(readFileSync(new URL('../docs/familysearch/endpoints.json', import.meta.url), 'utf8')).endpoints;
  const selection = JSON.parse(readFileSync(new URL('../docs/familysearch/operation-selection.json', import.meta.url), 'utf8')).operations;
  assert.equal(listOperations().length, selection.filter((s: any) => !s.unsupported).length);
  const original = Impit.prototype.fetch;
  let count = 0;
  try {
    const fs = client();
    for (const op of listOperations()) {
      const evidence = endpoints.find((e: any) => e.path === op.path && e.method === op.method);
      assert.ok(evidence, op.name);
      const input: any = {};
      for (const p of op.parameters) {
        const value = p.kind === 'path' ? (p.type.kind === 'string' ? 'ABCD-123' : 123) : example(p.type);
        if (p.kind === 'query') (input.query ??= {})[p.name] = value;
        else if (p.kind === 'header') (input.headers ??= {})[p.name] = 'Test reason';
        else input[p.name] = value;
      }
      if (op.name === 'memories.replaceFile') input.body = 'A family story.';
      const expected = example(op.response);
      Impit.prototype.fetch = async function (target, init) {
        count++;
        const url = new URL(String(target));
        const requestHeaders = new Headers(init?.headers as any);
        assert.equal(url.origin, 'https://www.familysearch.org', op.name);
        assert.equal(init?.method, evidence.method, op.name);
        assert.equal(requestHeaders.get('authorization'), 'Bearer test-only-access');
        let route = evidence.path;
        for (const p of evidence.parameters.filter((p: any) => p.kind === 'path')) route = route.replaceAll(`{${p.name}}`, encodeURIComponent(input[p.name]));
        const expectedUrl = new URL(route, url.origin);
        assert.equal(url.pathname, expectedUrl.pathname, op.name);
        for (const [key,value] of expectedUrl.searchParams) assert.equal(url.searchParams.get(key), value, op.name);
        for (const p of evidence.parameters) {
          if (p.kind === 'query') assert.deepEqual(url.searchParams.getAll(p.name), Array.isArray(input.query[p.name]) ? input.query[p.name].map(String) : [String(input.query[p.name])], op.name);
          if (p.kind === 'header') assert.equal(requestHeaders.get(p.name), p.name === 'X-Reason' ? 'Test+reason' : input.headers[p.name], op.name);
        }
        if (input.body !== undefined) {
          if (op.parameters.find(p => p.kind === 'body')?.type.kind === 'upload') assert.equal(init?.body, input.body, op.name);
          else assert.deepEqual(JSON.parse(init?.body as string), input.body, op.name);
        } else assert.equal(init?.body, undefined, op.name);
        return op.response.kind === 'void' ? new Response(null, { status: 204 }) as never
          : op.response.kind === 'binary' ? new Response(expected, { headers: { 'content-type': 'application/pdf' } }) as never
          : new Response(JSON.stringify(expected), { headers: { 'content-type': 'application/json' } }) as never;
      };
      const [group, name] = op.name.split('.');
      const actual = await (fs.genealogy as any)[group][name](input);
      assert.deepEqual(actual, expected, op.name);
      validateOperationResponse(op.name as any, actual);
    }
    assert.equal(count, listOperations().length);
  } finally { Impit.prototype.fetch = original; }
});

test('concrete genealogy mutations preserve nested payloads, reasons and fixed parameters', () => {
  const fact = factPayload('http://gedcomx.org/Birth', { date: { original: '1 January 1900' }, place: { original: 'London, England' } }, 'Civil registration');
  const add = prepareOperation('persons.addFact', { pid: 'ABCD-123', body: fact });
  assert.equal(add.options.method, 'POST');
  assert.deepEqual(add.options.body, { conclusionType: 'http://gedcomx.org/Birth', value: { date: { original: '1 January 1900' }, place: { original: 'London, England' } }, attribution: { changeMessage: 'Civil registration' } });
  const note = notePayload('Research', 'Check the 1901 census.', 'Research log');
  assert.deepEqual(prepareOperation('couples.addNote', { id: 'relationship-1', body: note }).options.body, note);
  const deletion = prepareOperation('persons.deleteNote', { pid: 'ABCD-123', noteId: 'note-1', headers: { 'X-Reason': 'Duplicate note' } });
  assert.equal(deletion.options.method, 'DELETE');
  assert.equal(deletion.options.headers?.['X-Reason'], 'Duplicate+note');
  const unicode = prepareOperation('sources.detach', { personId: 'ABCD-123', sourceReferenceId: 'source-1', headers: { 'X-Reason': 'État civil: 同一人' } });
  assert.equal(unicode.options.headers?.['X-Reason'], '%C3%89tat+civil%3A+%E5%90%8C%E4%B8%80%E4%BA%BA');
  assert.equal(unicode.options.headers?.['Content-Type'], 'application/x-gedcomx-v1+json');
  const attach = prepareOperation('sources.attachRecord', { body: { personId: 'ABCD-123', recordUrl: 'https://www.familysearch.org/ark:/61903/1:1:TEST', attachmentReason: 'Same household' } });
  assert.equal(attach.options.method, 'POST');
  assert.match(prepareOperation('hints.duplicates', { personId: 'ABCD-123' }).path, /unmergeableMatches=true$/);
  const analysis = prepareOperation('persons.mergeAnalysis', { survivorId: 'ABCD-123', duplicateId: 'WXYZ-456' });
  assert.equal(analysis.options.method, 'GET');
  const changes = prepareOperation('history.changes', { pid: 'ABCD-123', query: { from: 'cursor/with+=symbols' } });
  assert.equal(changes.options.query?.from, 'cursor/with+=symbols');
});

test('invalid bodies, misspelled parameters, traversal and header injection fail before authentication', async () => {
  const fs = client();
  (fs as any).ensureSession = async () => { throw new Error('AUTH MUST NOT RUN'); };
  for (const [name, input] of [
    ['persons.get', {}], ['persons.get', { pid: '..' }], ['persons.get', { pid: '%2e%2e' }],
    ['persons.get', { pid: 'a/b' }], ['persons.get', { pid: 'ABCD-123', query: { oneHop: true } }],
    ['persons.addFact', { pid: 'ABCD-123', body: { conclusionType: 'Birth' } }],
    ['persons.addNote', { pid: 'ABCD-123', body: { noteId: '', value: { title: 'x', text: 1 }, attribution: {} } }],
    ['persons.delete', { personId: 'ABCD-123', headers: { 'X-Reason': 'value\r\nInjected: yes' } }],
    ['memories.get', { artifactId: Number.MAX_SAFE_INTEGER + 1 }],
  ] as const) await assert.rejects((fs.operation as any)(name, input), e => e instanceof Error && !e.message.includes('AUTH MUST NOT RUN'));
  await assert.rejects(fs.request('/platform/users/current', { headers: { Authorization: 'secret' } }), /managed/);
});

test('multipart builders and story replacement reproduce the recovered upload formats', async () => {
  const data = memoryUpload({ file: new Blob(['image'], { type: 'image/jpeg' }), filename: 'portrait.jpg', title: 'Portrait', description: 'Family photo', isPrivate: true });
  assert.deepEqual([...data.keys()], ['file','filename','title','description','isPrivate']);
  assert.equal(data.get('isPrivate'), 'true');
  assert.equal((data.get('file') as File).name, 'portrait.jpg');
  const wire = new Request('https://www.familysearch.org/', { method: 'POST', body: data });
  assert.match(wire.headers.get('content-type')!, /multipart\/form-data; boundary=/);
  const encoded = await wire.text();
  assert.match(encoded, /name="file"; filename="portrait.jpg"/);
  assert.match(encoded, /Content-Type: image\/jpeg/i);
  assert.equal(groupImageUpload(new Blob(['jpeg'], { type: 'image/jpeg' }), 'group.jpg').get('width'), '1');
  const story = prepareOperation('memories.replaceFile', { artifactId: 123, body: 'A story with "quotes".' });
  assert.equal(story.options.encoding, 'raw');
  assert.equal(story.options.headers?.['Content-Type'], 'text/plain');
  assert.equal(story.options.body, 'A story with "quotes".');
});

test('HTTP preserves status, location, pagination headers, binary bytes and empty bodies', async () => {
  const original = Impit.prototype.fetch;
  try {
    Impit.prototype.fetch = async () => new Response(new Uint8Array([0,255,128]), { status: 201, headers: { location: '/platform/new', link: '</platform/next>; rel="next"', 'set-cookie': 'private=1; Secure; Path=/' } }) as never;
    const result = await new HttpSession().exchange<Uint8Array>('https://www.familysearch.org/platform/test', { method: 'POST', response: 'binary' });
    assert.equal(result.status, 201);
    assert.deepEqual(result.data, new Uint8Array([0,255,128]));
    assert.equal(result.headers.location, '/platform/new');
    assert.equal(result.headers['set-cookie'], undefined);
    assert.match(result.headers.link, /rel="next"/);
    Impit.prototype.fetch = async () => new Response(null, { status: 204 }) as never;
    assert.equal((await new HttpSession().exchange('https://www.familysearch.org/platform/test', { method: 'DELETE' })).data, undefined);
  } finally { Impit.prototype.fetch = original; }
});

test('Java long values round-trip exactly and typed responses match Moshi numeric/string decoding', async () => {
  const json = '{"version":9007199254740993,"lastModified":123}';
  assert.deepEqual(parseJson(json), { version: 9007199254740993n, lastModified: 123 });
  assert.equal(stringifyJson(parseJson(json)), json);
  const original = Impit.prototype.fetch;
  try {
    Impit.prototype.fetch = async () => new Response('{"version":9007199254740993,"lastPage":true,"id":123,"lastModified":"456","extraServerField":true}') as never;
    const result = await client().genealogy.history.changes({ pid: 'ABCD-123' });
    assert.equal(result.version, 9007199254740993n);
    assert.equal(result.id, '123');
    assert.equal(result.lastModified, 456);
    assert.equal((result as any).extraServerField, true);
    validateOperationResponse('history.changes', result);
    Impit.prototype.fetch = async () => new Response(null, { status: 204 }) as never;
    assert.equal(await client().genealogy.hints.recordMatches({ pid: 'ABCD-123' }), undefined);
  } finally { Impit.prototype.fetch = original; }
});

test('writes replay only once after a definitive 401, never after network, permission, rate-limit or server errors', async () => {
  const original = Impit.prototype.fetch;
  try {
    for (const status of [401,403,429,500,'network'] as const) {
      const fs = client();
      const payloads: unknown[] = [];
      let refreshes = 0;
      (fs as any).renew = async () => { refreshes++; (fs as any).session.tokens.access_token = 'new-test-token'; };
      Impit.prototype.fetch = async (_url, init) => {
        payloads.push(init?.body);
        if (status === 'network') throw new Error('Ambiguous network failure');
        if (status === 401 && payloads.length === 2) return new Response(null, { status: 204 }) as never;
        return new Response('private response', { status, headers: { 'retry-after': '12' } }) as never;
      };
      const action = fs.genealogy.following.follow({ body: { personId: 'ABCD-123' } } as any);
      if (status === 401) { await action; assert.deepEqual(payloads[0], payloads[1]); }
      else await assert.rejects(action, e => status === 'network' ? e instanceof Error : e instanceof HttpError && e.status === status && e.retryAfter === '12' && !e.message.includes('private'));
      assert.equal(payloads.length, status === 401 ? 2 : 1);
      assert.equal(refreshes, status === 401 ? 1 : 0);
    }
  } finally { Impit.prototype.fetch = original; }
});

test('history and search iterators follow cursor/offset contracts and stop safely', async () => {
  const fs = client();
  const cursors: unknown[] = [];
  (fs.genealogy.history as any).changes = async (input: any) => { cursors.push(input.query.from); return { changes: [{ id: String(cursors.length) }], lastPage: cursors.length === 2, nextPageToken: 'next' }; };
  assert.equal((await Array.fromAsync(personChanges(fs, 'ABCD-123'))).length, 2);
  assert.deepEqual(cursors, [undefined,'next']);
  (fs.genealogy.history as any).changes = async () => ({ changes: [], lastPage: false, nextPageToken: 'repeat' });
  await assert.rejects(Array.fromAsync(personChanges(fs, 'ABCD-123')), /repeated/);
  const offsets: number[] = [];
  (fs.genealogy.search as any).results = async (input: any) => { offsets.push(input.query.from); return { total: 3, results: input.query.from === 0 ? [{},{}] : [{}] }; };
  assert.equal((await Array.fromAsync(searchResults(fs, {} as any, { size: 2 }))).length, 3);
  assert.deepEqual(offsets, [0,2]);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(Array.fromAsync(personChanges(fs, 'ABCD-123', { signal: cancelled.signal })), /abort/i);
});
