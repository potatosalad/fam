import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Impit } from 'impit';
import { CookieJar } from 'tough-cookie';
import { AncestryHttp, AncestryHttpError, checkAncestryUrl } from '../src/ancestry/http.js';
import { AncestryClient, AncestryGraphQLError } from '../src/ancestry/client.js';
import { solvePreAuth, tokenRequest, type AncestrySession } from '../src/ancestry/auth.js';
import { aliases, contracts, graphqlOperation, prepareRest, restOperation, validateVariables } from '../src/ancestry/catalog.js';
import { recordSearchBody } from '../src/ancestry/search.js';
import type { ApiRequest } from '../src/transport-types.js';

test('Ancestry pre-auth proof hashes the APK field order and satisfies the modulus', () => {
  const challenge = {algorithm: 'sha256-mod-v1', sessionId: 'test-session', algorithmParameters: {n: 31, r: 7}};
  const proof = JSON.parse(Buffer.from(solvePreAuth(challenge, 'test-identity', 'test-device'), 'base64').toString());
  const hash = createHash('sha256').update(`test-session${proof.key}test-identitytest-device`).digest('hex').toUpperCase();
  assert.equal(proof.solution_hash, hash);
  assert.equal(BigInt(`0x${hash}`) % 31n, 7n);
  assert.equal(proof.session_id, 'test-session');
  for (let key = 0; key < proof.key; key++) assert.notEqual(BigInt(`0x${createHash('sha256').update(`test-session${key}test-identitytest-device`).digest('hex')}`) % 31n, 7n);
  assert.throws(() => solvePreAuth({...challenge, algorithm: 'unknown'}, 'a', 'b'));
  assert.throws(() => solvePreAuth({...challenge, algorithmParameters: {n: 0, r: 0}}, 'a', 'b'));
  assert.throws(() => solvePreAuth(challenge, 'a', 'b', -1), /timed out/);
});

test('Ancestry transport keeps its origin boundary separate from FamilySearch', async () => {
  for (const url of ['https://evil.example/', 'http://gateway.ancestry.com/', 'https://gateway.ancestry.com.evil.example/',
    'https://user:password@gateway.ancestry.com/', 'https://api.familysearch.org/']) assert.throws(() => checkAncestryUrl(new URL(url)));
  const original = Impit.prototype.fetch;
  const calls: {url: string; init: any}[] = [];
  Impit.prototype.fetch = async function (url, init) {
    calls.push({url: String(url), init});
    return new Response('secret error body', {status: 302, headers: {Location: 'https://evil.example/steal'}}) as never;
  };
  try {
    await assert.rejects(new AncestryHttp().exchange('https://gateway.ancestry.com/path?secret=value', {headers: {Authorization: 'Bearer test'}}), error => {
      assert.ok(error instanceof AncestryHttpError); assert.equal(error.status, 302); assert.ok(!error.message.includes('secret')); return true;
    });
    assert.equal(calls.length, 1); assert.equal(calls[0]!.init.redirect, 'manual');
  } finally { Impit.prototype.fetch = original; }
});

test('Ancestry JSON transport preserves large IDs, negotiated media types, repeated queries and cookies', async () => {
  const original = Impit.prototype.fetch;
  Impit.prototype.fetch = async function (url, init) {
    assert.deepEqual(new URL(String(url)).searchParams.getAll('id'), ['1', '2']);
    assert.equal((init!.headers as Record<string, string>)['content-type'], 'application/v1+json');
    assert.match(String(init!.body), /9007199254740993/);
    return new Response('{"id":9007199254740993}', {headers: {'set-cookie': 'test-cookie=private; Secure; Path=/'}}) as never;
  };
  try {
    const http = new AncestryHttp();
    const response = await http.exchange<{id: bigint}>('https://gateway.ancestry.com/test', {method: 'POST', query: {id: ['1', '2']}, body: {id: 9007199254740993n}, headers: {'Content-Type': 'application/v1+json'}});
    assert.equal(response.data.id, 9007199254740993n);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.equal(await http.jar.getCookieString('https://gateway.ancestry.com/'), 'test-cookie=private');
  } finally { Impit.prototype.fetch = original; }
});

test('auth and refresh requests use distinct endpoints and form encoding', async () => {
  const calls: {url: string; options: ApiRequest}[] = [];
  const http = {exchange: async (url: string, options: ApiRequest) => {calls.push({url, options}); return {data: {access_token: 'test-access', refresh_token: 'test-refresh'}};}};
  await tokenRequest(http as never, {service_provider: 'client_credentials', scope: '*'});
  await tokenRequest(http as never, {grant_type: 'refresh_token', refresh_token: 'test-refresh'}, true);
  assert.equal(calls[0]!.url, 'https://auth.ancestry.com/ancauth/tokens');
  assert.equal(calls[1]!.url, 'https://auth.ancestry.com/oauth20/tokens');
  assert.equal(new URLSearchParams(String(calls[1]!.options.body)).get('refresh_token'), 'test-refresh');
  assert.equal(calls[0]!.options.encoding, 'raw');
});

function mockClient(send: (options: ApiRequest) => Promise<unknown>, expiresAt = Date.now() + 60_000) {
  let refreshes = 0;
  const saved: AncestrySession[] = [];
  const jar = new CookieJar();
  const session: AncestrySession = {tokens: {access_token: 'old-test', refresh_token: 'refresh-test', user_id: 'user-test', token_type: 'bearer', scope: '*'},
    expiresAt, savedAt: '2026-01-01T00:00:00Z', deviceId: 'test-device', cookies: jar.serializeSync()};
  const client = new AncestryClient(session, {jar, exchange: async <T>(_url: unknown, options: ApiRequest = {}) => ({data: await send(options) as T, status: 200, headers: {}})}, {
    refresh: async s => { refreshes++; await new Promise(resolve => setTimeout(resolve, 1)); return {...s, expiresAt: Date.now() + 3600_000, tokens: {...s.tokens, access_token: 'new-test', refresh_token: 'rotated-test'}}; },
    save: async s => {saved.push(s);},
  });
  return {client, saved, refreshes: () => refreshes};
}

test('concurrent Ancestry 401s share refresh and save rotated session without changing its expiration', async () => {
  const seen: string[] = [];
  const mock = mockClient(async options => {
    seen.push(options.headers!.Authorization!);
    if (options.headers!.Authorization === 'Bearer old-test') throw new AncestryHttpError(401, '/test');
    return {ok: true};
  });
  await Promise.all([mock.client.request('/test'), mock.client.request('/test')]);
  assert.equal(mock.refreshes(), 1); assert.equal(seen.length, 4);
  assert.equal(mock.saved[0]!.tokens.refresh_token, 'rotated-test');
  assert.equal(mock.saved[0]!.expiresAt, mock.saved[1]!.expiresAt);
});

test('Ancestry bounds retries and does not refresh on permission/rate-limit/server failures', async () => {
  for (const status of [401, 403, 429, 500]) {
    let attempts = 0;
    const mock = mockClient(async () => {attempts++; throw new AncestryHttpError(status, '/test');});
    await assert.rejects(mock.client.request('/test'), error => error instanceof AncestryHttpError && error.status === status);
    assert.equal(attempts, status === 401 ? 2 : 1); assert.equal(mock.refreshes(), status === 401 ? 1 : 0);
  }
  const expired = mockClient(async () => ({}), 1);
  await assert.rejects(expired.client.request('https://evil.example/'), /outside/);
  assert.equal(expired.refreshes(), 0);
  await expired.client.request('/test'); assert.equal(expired.refreshes(), 1);
});

test('catalog aliases resolve, IDs are unique and embedded documents match their hashes', () => {
  assert.equal(contracts.rest.length, 267); assert.equal(contracts.graphql.length, 208);
  assert.equal(new Set(contracts.rest.map(op => op.id)).size, contracts.rest.length);
  for (const alias of Object.keys(aliases)) assert.ok(restOperation(alias));
  for (const op of contracts.graphql) assert.equal(createHash('sha256').update(op.document).digest('hex'), op.sha256);
});

test('REST binding preserves routes, encodes path IDs and binds signed-in user', () => {
  const request = prepareRest('persons.research', {path: {treeId: 'tree space', personId: 'person/part'}, query: {showAltParents: true}}, 'user-test');
  assert.equal(request.url, 'https://gateway.ancestry.com/personprovider/v1/userid/user-test/tree/tree%20space/person/person%2Fpart/person/getpersonresearch');
  assert.equal(request.options.query!.showAltParents, true);
  assert.throws(() => prepareRest('persons.get'), /path parameter/);
  assert.throws(() => prepareRest('persons.get', {path: {treeId: '..', personId: 'p'}}), /invalid/);
  assert.throws(() => prepareRest('search.records'), /requires body/);
  assert.throws(() => prepareRest('rest.ak.a.a', {path: {screenerId: 'x'}}), /base mapping/);
  assert.throws(() => prepareRest('persons.get', {path: {treeId: 't', personId: 'p'}, base: 'https://evil.example'}), /outside/);
  assert.equal(prepareRest('search.records', {body: {test: true}}).options.headers!.Accept, 'application/ssv_rcd.v4+json');
});

test('GraphQL catches missing/unknown variables, preserves defaults and reports partial errors', async () => {
  assert.throws(() => validateVariables(graphqlOperation('GetTree'), {}), /treeId/);
  assert.throws(() => validateVariables(graphqlOperation('GetTree'), {treeId: 't', typo: true}), /Unknown variable/);
  validateVariables(graphqlOperation('PersonAlbumListConnection'), {treeId: 't', personId: 'p'});
  const mock = mockClient(async options => {
    const body = options.body as any;
    assert.equal(body.operationName, 'GetTree'); assert.match(body.query, /query GetTree/);
    return {data: {trees: null}, errors: [{message: 'private server detail'}]};
  });
  await assert.rejects(mock.client.graphql('GetTree', {treeId: 't'}), error => {
    assert.ok(error instanceof AncestryGraphQLError); assert.ok(!error.message.includes('private'));
    assert.deepEqual(error.result.data, {trees: null}); return true;
  });
});

test('record search uses native discriminators, lowercase default and bounded explicit pagination', () => {
  const body = recordSearchBody({given: 'Abraham', surname: 'Lincoln', birthYear: 1809, limit: 5}, 'test-user');
  assert.equal(body.CollectionFocus, 'default');
  assert.equal(body.QueryTerms[0]!.type, 'GivenNameQueryTerm');
  assert.deepEqual(body.PagingInfo, {PageNumber: 1, RecordsPerPage: 5, PagingToken: ''});
  assert.equal(body.RequestContext.Data.UserId, 'test-user');
  assert.throws(() => recordSearchBody({}, 'u'), /Supply/);
  assert.throws(() => recordSearchBody({surname: 'x', limit: 0}, 'u'), /limit/);
});
