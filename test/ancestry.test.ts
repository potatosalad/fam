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
import type { ApiRequest } from '../src/familysearch/transport-types.js';

test('search rejects plain key-value filters and preserves native expressions', () => {
  assert.throws(() => recordSearchBody({surname:'Example',filters:['collectionId=1234']},'synthetic'), /Ancestry-native expression/);
  const filters=['1|Category|SET=HistoricalRecords'];
  assert.deepEqual(recordSearchBody({surname:'Example',filters},'synthetic').FilterCriteria,filters);
});

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

test('record get reports absent, failed, and mismatched household fields honestly', async () => {
  for (const variant of ['no-household', 'failed', 'wrong-record', 'denied']) {
    const mock = mockClient(async options => {
      if ((options.body as any).Features) return {Status: 'Successful', selected: 'retained'};
      if (variant === 'denied') throw new AncestryHttpError(403, '/fields');
      return {Status: variant === 'failed' ? 'Failed' : 'Successful', DocumentFields: [{CollectionId: 1234,
        RecordId: variant === 'wrong-record' ? 999 : 100, Fields: [{Name: 'SelfGivenName', Assertion: 'GivenName', Value: 'Example', Relationship: 'Self'}]}]};
    });
    const result = await mock.client.record('1234', '100') as any;
    assert.equal(result.selected, 'retained');
    assert.equal(result.household.status, variant === 'no-household' ? 'not-supplied' : 'unavailable');
    assert.equal(result.household.complete, null); assert.deepEqual(result.household.members, []);
    if (variant !== 'no-household') assert.match(result.warnings.join(' '), /could not be retrieved.*empty member list does not establish/i);
  }
});

test('record get adds structured indexed household members while retaining the selected persona', async () => {
  const selected = {Status: 'Successful', RecordView: {Records: [{Gid: {Value: '100:1234'}}]}};
  const fields = [
    {Name: 'SelfGivenName', Assertion: 'GivenName', Value: 'Alex', Relationship: 'Self', Source: 'transcribed'},
    {Name: 'SelfSurname', Assertion: 'Surname', Value: 'Example', Relationship: 'Self', Source: 'transcribed'},
    {Name: 'ChildGivenName', Assertion: 'GivenName', Value: 'First', Relationship: 'Child', Source: 'historic_inferred'},
    {Name: 'ChildSurname', Assertion: 'Surname', Value: 'Example', Relationship: 'Child', Source: 'historic_inferred'},
    {Name: 'ChildPid', Assertion: 'Pid', Value: '9007199254740993', Relationship: 'Child', Source: 'historic_inferred'},
    {Name: 'ChildGivenName', Assertion: 'GivenName', Value: 'Second', Relationship: 'Child', Source: 'historic_inferred'},
    {Name: 'ChildSurname', Assertion: 'Surname', Value: 'Example', Relationship: 'Child', Source: 'historic_inferred'},
    {Name: 'ChildPid', Assertion: 'Pid', Value: '-9223372036854775808', Relationship: 'Child', Source: 'historic_inferred'},
    {Name: 'MotherBirthPlace', Assertion: 'Place', Value: 'Elsewhere', Relationship: 'Mother', Source: 'transcribed'},
    {Name: 'HouseholdId', Assertion: 'HouseholdId', Value: '99', Source: 'historic_inferred'},
  ];
  const bodies: any[] = [];
  const mock = mockClient(async options => {
    const body = options.body as any; bodies.push(body);
    return body.Features ? selected : {Status: 'Successful', DocumentFields: [{CollectionId: 1234, RecordId: 100, Fields: fields}]};
  });
  const result = await mock.client.record('1234', '100') as any;
  assert.deepEqual(result.RecordView, selected.RecordView);
  assert.equal(result.household.householdId, '99');
  assert.equal(result.household.source, 'records.fields');
  assert.equal(result.household.complete, null);
  assert.deepEqual(result.household.members.map((m: any) => [m.recordId, m.givenName, m.surname, m.relationship]), [
    ['100', 'Alex', 'Example', 'Self'], ['9007199254740993', 'First', 'Example', 'Child'], ['-9223372036854775808', 'Second', 'Example', 'Child'],
  ]);
  assert.equal(result.household.members[1].fields[0].Source, 'historic_inferred');
  assert.equal(result.household.members[1].collectionId, '1234');
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1].Documents, [{CollectionId: '1234', RecordId: '100'}]);
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

test('person hints distinguish returned nodes from limit-dependent provider totals',async()=>{
  const mock=mockClient(async options=>{
    const limit=(options.body as any).variables.limit;
    return {data:{discoveries:{discoveryFeed:{hints:{personsHints:{nodes:Array.from({length:limit},(_,i)=>({id:String(i)})),totalHintsCount:limit}}}}}};
  });
  for(const limit of [1,10]) {
    const result=await mock.client.hints('1','2',limit) as any;
    const hints=result.discoveries.discoveryFeed.hints.personsHints;
    assert.equal(hints.returned,limit);assert.equal(hints.providerTotalHintsCount,limit);
    assert.equal(hints.totalHintsCount,null);assert.equal(hints.hasMore,null);
    assert.match(hints.countNote,/limit-dependent.*unknown/i);
  }
});

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

test('Ancestry commands recover GraphQL authentication errors and persist renewal before a failed retry', async () => {
  const denied = {errors: [{extensions: {code: 'UNAUTHENTICATED'}}]};
  const mock = mockClient(async options => options.headers?.Authorization === 'Bearer old-test' ? denied
    : {data: {trees: {treeConnection: {nodes: []}}}});
  assert.deepEqual((await mock.client.trees()).trees.treeConnection.nodes, []);
  assert.equal(mock.refreshes(), 1);
  for (const expired of [false, true]) {
    let calls = 0;
    const failed = mockClient(async () => {calls++; return denied;}, expired ? 1 : Date.now() + 3600_000);
    await assert.rejects(failed.client.trees());
    assert.equal(failed.refreshes(), 1); assert.equal(calls, expired ? 1 : 2);
    assert.equal(failed.saved[0]?.tokens.refresh_token, 'rotated-test');
  }
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
