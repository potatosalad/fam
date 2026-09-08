import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Impit } from 'impit';
import { parse, Kind } from 'graphql';
import { FindmypastHttp, FindmypastHttpError, checkFindmypastUrl, GRAPHQL, AUTH, CONTENT } from '../src/findmypast/http.js';
import { FindmypastClient, FindmypastGraphQLError, searchFilters } from '../src/findmypast/client.js';
import { contracts, graphqlOperation, validateDocument, prepareRest } from '../src/findmypast/catalog.js';
import { CLIENT_ID, AUDIENCE, REDIRECT_URI, authenticateFindmypast, loadFindmypastCredentials, loginBody, sessionFromTokens, validateCallback, type FindmypastSession } from '../src/findmypast/auth.js';
import type { ApiRequest } from '../src/familysearch/transport-types.js';
import { browserSessionFromHar, importFindmypastHar } from '../src/findmypast/har.js';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../src/shared/storage.js';
import { CookieJar } from 'tough-cookie';
import sharp from 'sharp';
import { downloadRecordImage, newspaperVariables, recordOrder } from '../src/findmypast/research.js';

test('all recovered documents parse, preserve hashes, and have matching names/variables', () => {
  assert.equal(contracts.graphql.length, 110); assert.equal(contracts.rest.length, 17);
  assert.equal(new Set(contracts.graphql.map(o => o.name)).size, 110);
  for (const op of contracts.graphql) {
    assert.equal(createHash('sha256').update(op.document).digest('hex'), op.sha256);
    const definition = parse(op.document).definitions.find(d => d.kind === Kind.OPERATION_DEFINITION);
    assert.equal(definition?.name?.value, op.name);
    assert.deepEqual(definition?.variableDefinitions?.map(v => v.variable.name.value) ?? [], op.variables.map(v => v.name));
  }
});
test('GraphQL validation checks list items, nullable/default values, scalar bounds and misspellings', () => {
  const op = graphqlOperation('GetTreeAssistFlan');
  validateDocument(op.document, {focus: 'a', mother: 'b', father: 'c'});
  assert.throws(() => validateDocument(op.document, {focus: 'a', mother: 'b', father: 'c', withMother: null}), /withMother/);
  assert.throws(() => validateDocument(graphqlOperation('GetListOfTrees').document, {offset: 0, limit: 1.2}), /limit/);
  assert.throws(() => validateDocument(graphqlOperation('GetListOfTrees').document, {offset: 0, limit: 2147483648}), /limit/);
  assert.throws(() => validateDocument(graphqlOperation('GetSearchResults').document, {filter: [null], page: 0}), /filter/);
  assert.throws(() => validateDocument(graphqlOperation('GetCurrentUserProfile').document, {typo: true}), /Unknown variable/);
  assert.throws(() => validateDocument('query A { a } query B { b }', {}), /one named/);
});
test('native authentication matches the APK client, realm, audience and effective scope', () => {
  assert.deepEqual(loginBody({username: 'test@example.invalid', password: 'test-password'}), {
    username: 'test@example.invalid', password: 'test-password', client_id: CLIENT_ID, audience: AUDIENCE,
    grant_type: 'http://auth0.com/oauth/grant-type/password-realm', realm: 'account', scope: 'openid offline_access',
  });
  const old = sessionFromTokens({access_token: 'test', refresh_token: 'old-refresh', expires_in: 3600, token_type: 'Bearer'});
  assert.equal(sessionFromTokens({access_token: 'new-test', expires_in: 3600, token_type: 'Bearer'}, old).tokens.refresh_token, 'old-refresh');
  assert.equal(sessionFromTokens({access_token: 'new-test', refresh_token: 'rotated-test', expires_in: 3600, token_type: 'Bearer'}, old).tokens.refresh_token, 'rotated-test');
  for (const expires_in of [0, -1, NaN, Infinity]) assert.throws(() => sessionFromTokens({access_token: 'test', expires_in, token_type: 'Bearer'}));
  assert.throws(() => sessionFromTokens({access_token: 'test', expires_in: 3600, token_type: 'DPoP'}));
});
test('native login uses public credential storage and stops password attempts after verification is required', async () => {
  const original = Impit.prototype.fetch;
  let requests = 0;
  Impit.prototype.fetch = async function (url, init) {
    requests++;
    assert.equal(String(url), `${AUTH}/oauth/token`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.username, 'fixture-user');
    assert.equal(body.password, ' fixture-password ');
    return new Response('{"error":"requires_verification"}', {status: 401}) as never;
  };
  try {
    await assert.rejects(loadFindmypastCredentials(), /findmypast credentials/);
    await writePrivateJson('findmypast/login.json', {username: 'fixture-user', password: ' fixture-password '});
    await assert.rejects(FindmypastClient.open(), /No Findmypast session/);
    assert.equal(requests, 0);
    await assert.rejects(authenticateFindmypast(), /requires_verification/);
    await assert.rejects(authenticateFindmypast(), /browser verification/);
    assert.equal(requests, 1);
    assert.equal(await readPrivateJson('findmypast/session.json'), undefined);
    assert.ok(await readPrivateJson('findmypast/verification-required.json'));
  } finally {
    Impit.prototype.fetch = original;
    await rm(join(CREDENTIAL_DIR, 'findmypast'), {recursive: true, force: true});
  }
});
test('browser callback binds redirect, state, lifetime, unique code and error result', () => {
  const pending = {state: 'test-state', verifier: 'test-verifier', createdAt: Date.now()};
  assert.equal(validateCallback(`${REDIRECT_URI}?state=test-state&code=test-code`, pending), 'test-code');
  for (const url of [`${REDIRECT_URI}?state=other&code=test`, `${REDIRECT_URI}?state=test-state&code=1&code=2`,
    `${REDIRECT_URI}?state=test-state&error=access_denied`, 'https://evil.example/?state=test-state&code=test']) assert.throws(() => validateCallback(url, pending));
  assert.throws(() => validateCallback(`${REDIRECT_URI}?state=test-state&code=test`, {...pending, createdAt: 0}), /expired/);
});
test('transport refuses foreign origins, credentials, ambiguous paths and redirects', async () => {
  for (const url of ['https://evil.example/', 'https://www.findmypast.co.uk/account', `${AUTH}/authorize`,
    'http://www.findmypast.co.uk/titan/marshal/graphql', 'https://user:password@www.findmypast.co.uk/titan/marshal/graphql',
    'https://www.findmypast.co.uk/titan/marshal/../../account']) assert.throws(() => checkFindmypastUrl(new URL(url)));
  const original = Impit.prototype.fetch; let calls = 0;
  Impit.prototype.fetch = async function (_url, init) {calls++; assert.equal(init?.redirect, 'manual'); return new Response('secret', {status: 302, headers: {Location: 'https://evil.example/'}}) as never;};
  try { await assert.rejects(new FindmypastHttp().exchange(`${GRAPHQL}?secret=test`), e => e instanceof FindmypastHttpError && e.status === 302 && !e.message.includes('secret')); assert.equal(calls, 1); }
  finally { Impit.prototype.fetch = original; }
});
test('HTTP preserves large IDs, strips account headers for content, and redacts auth errors', async () => {
  const original = Impit.prototype.fetch;
  Impit.prototype.fetch = async function (url, init) {
    if (String(url).startsWith(AUTH)) return new Response('{"error":"requires_verification","error_description":"secret"}', {status: 401}) as never;
    assert.equal(new Headers(init?.headers as HeadersInit).get('authorization'), null);
    assert.equal(new Headers(init?.headers as HeadersInit).get('cookie'), null);
    return new Response('{"id":9007199254740993}', {headers: {'set-cookie': 'private=test'}}) as never;
  };
  try {
    const h = new FindmypastHttp();
    const response = await h.exchange<{id: bigint}>(`${CONTENT}api/v2`, {headers: {Authorization: 'Bearer test', Cookie: 'test'}});
    assert.equal(response.data.id, 9007199254740993n); assert.equal(response.headers['set-cookie'], undefined);
    await assert.rejects(h.exchange(`${AUTH}/oauth/token`), e => e instanceof FindmypastHttpError && e.code === 'requires_verification' && !e.message.includes('secret'));
  } finally { Impit.prototype.fetch = original; }
});
function mockClient(send: (url: string, options: ApiRequest) => Promise<unknown>, expiresAt = Date.now() + 3600_000) {
  let refreshes = 0; const saved: FindmypastSession[] = [];
  const session: FindmypastSession = {tokens: {access_token: 'old-test', refresh_token: 'refresh-test', expires_in: 3600, token_type: 'Bearer'}, expiresAt, savedAt: '2026-01-01T00:00:00Z'};
  const client = new FindmypastClient(session, {exchange: async <T>(url: string | URL, options: ApiRequest = {}) => ({data: await send(String(url), options) as T, status: 200, headers: {}})}, {
    refresh: async s => {refreshes++; await new Promise(resolve => setTimeout(resolve, 1)); return {...s, expiresAt: Date.now() + 3600_000, tokens: {...s.tokens, access_token: 'new-test', refresh_token: 'rotated-test'}};},
    save: async s => {saved.push(s);},
  });
  return {client, saved, refreshes: () => refreshes};
}
test('401 requests share refresh; permission, rate limits, network and server failures do not refresh', async () => {
  const mock = mockClient(async (_u, o) => {if (o.headers?.Authorization === 'Bearer old-test') throw new FindmypastHttpError(401, '/test'); return {ok:true};});
  await Promise.all([mock.client.request('/test'), mock.client.request('/test')]);
  assert.equal(mock.refreshes(), 1); assert.equal(mock.saved[0]?.tokens.refresh_token, 'rotated-test');
  for (const status of [401, 403, 429, 500]) {
    let attempts = 0; const m = mockClient(async () => {attempts++; throw new FindmypastHttpError(status, '/test');});
    await assert.rejects(m.client.request('/test'));
    assert.equal(attempts, status === 401 ? 2 : 1); assert.equal(m.refreshes(), status === 401 ? 1 : 0);
  }
  const m = mockClient(async () => {throw new Error('network');}); await assert.rejects(m.client.request('/test')); assert.equal(m.refreshes(), 0);
});
test('bad routes and input fail before refresh; public content does not refresh an expired session', async () => {
  const m = mockClient(async () => ({}), 1);
  await assert.rejects(m.client.request('https://evil.example/'), /outside/);
  await assert.rejects(m.client.graphql('GetListOfTrees', {limit: 1}), /offset/);
  await m.client.call('content.repository'); assert.equal(m.refreshes(), 0);
  await m.client.request('/test'); assert.equal(m.refreshes(), 1);
});

test('Findmypast commands renew GraphQL authentication failures, including proactive expiry without a second renewal', async () => {
  const denied = {errors: [{extensions: {code: 'UNAUTHENTICATED'}}]};
  const mock = mockClient(async (_url, options) => options.headers?.Authorization === 'Bearer old-test' ? denied : {data: {currentUserProfile: {id: '123'}}});
  assert.deepEqual(await mock.client.me(), {currentUserProfile: {id: '123'}}); assert.equal(mock.refreshes(), 1);
  for (const expired of [false, true]) {
    let calls = 0;
    const failed = mockClient(async () => {calls++; return denied;}, expired ? 1 : Date.now() + 3600_000);
    await assert.rejects(failed.client.me());
    assert.equal(failed.refreshes(), 1); assert.equal(calls, expired ? 1 : 2);
    assert.equal(failed.saved[0]?.tokens.refresh_token, 'rotated-test');
  }
});
test('GraphQL errors keep partial data available but never masquerade as success', async () => {
  const m = mockClient(async () => ({data: {person: null}, errors: [{message: 'private diagnostic'}]}));
  await assert.rejects(m.client.graphql('GetCurrentUserProfile'), e => {
    assert.ok(e instanceof FindmypastGraphQLError); assert.ok(!e.message.includes('private')); assert.deepEqual(e.result.data, {person: null}); return true;
  });
});
test('search filters preserve field spellings and exact-name options; record does not confirm purchases', async () => {
  assert.deepEqual(searchFilters({firstName:'Ada',lastName:'Lovelace',birthYear:1815,exact:true}), [
    {field:'FirstName',values:['Ada'],variants:false},{field:'LastName',values:['Lovelace'],variants:false},{field:'YearOfBirth',values:['1815'],offset:0},
  ]);
  assert.throws(() => searchFilters({}), /Provide/);
  const m = mockClient(async (_u, o) => {assert.match((o.body as any).query, /confirmedPurchase: false/); return {data: {fulfillTranscript: {action:'SUCCESS_USING_FREE'}}};});
  await m.client.record('test-record');
  assert.match(graphqlOperation('GetTranscriptById').document, /confirmedPurchase: true/);
});
test('REST binding encodes identifiers, maps bases, requires body and isolates telemetry', () => {
  assert.equal(prepareRest('image.details', {path:{id:'A/B C'}}).url, 'https://www.findmypast.co.uk/titan/marshal/record-gateway/image/A%2FB%20C/detail.json');
  assert.equal(prepareRest('asset').url, 'https://tree.findmypast.co.uk/api/asset/GetAsset');
  assert.equal(prepareRest('content.repository').anonymous, true);
  assert.throws(() => prepareRest('image.details', {path:{id:'..'}}), /invalid/);
  assert.throws(() => prepareRest('newspaper.clip'), /requires body/);
  assert.throws(() => prepareRest('rest.cj.b', {body:[]}), /telemetry/);
  assert.throws(() => prepareRest('asset', {headers:{authorization:'test'}}), /managed/);
  assert.throws(() => prepareRest('asset.create', {body:{}}), /FormData/);
});

test('HAR import selects a successful first-party API request and retains only its cookie scope', () => {
  const entry = {request:{url:'https://www.findmypast.com/titan/marshal/graphql', headers:[
    {name:'Cookie',value:'FmpTestSession=test-only; Preferences=en'}, {name:'Authorization',value:'Bearer ignored-test'},
    {name:'x-csrf-token',value:'csrf-test'}, {name:'X-Unrelated',value:'ignored'},
  ]},response:{status:200}};
  const session = browserSessionFromHar(JSON.stringify({log:{entries:[entry]}}));
  assert.equal(session.apiBase,'https://www.findmypast.com/titan/marshal');
  assert.deepEqual(session.headers,{'x-csrf-token':'csrf-test'});
  const jar=CookieJar.deserializeSync(session.cookies);
  assert.match(jar.getCookieStringSync(entry.request.url),/FmpTestSession=test-only/);
  assert.equal(jar.getCookieStringSync(GRAPHQL),'');
  assert.throws(() => browserSessionFromHar(JSON.stringify({log:{entries:[{...entry,response:{status:401}}]}})),/successful/);
  assert.throws(() => browserSessionFromHar(JSON.stringify({log:{entries:[{...entry,request:{...entry.request,url:'https://evil.example/titan/marshal/graphql'}}]}})),/successful/);
  assert.throws(() => browserSessionFromHar(JSON.stringify({log:{entries:[{...entry,request:{url:entry.request.url}}]}})),/cookies/);
});
test('HAR import validates the account before replacing a saved session', async () => {
  const original = Impit.prototype.fetch;
  const directory = await mkdtemp(join(CREDENTIAL_DIR, 'har-'));
  const path = join(directory, 'fixture.har');
  const previous = {fixture: 'previous-session'};
  let validProfile = false, requests = 0;
  Impit.prototype.fetch = async function (url, init) {
    requests++;
    assert.equal(String(url), 'https://www.findmypast.com/titan/marshal/graphql');
    assert.equal(new Headers(init?.headers as HeadersInit).get('cookie'), 'FixtureSession=synthetic-cookie');
    assert.equal(JSON.parse(String(init?.body)).operationName, 'GetCurrentUserProfile');
    return new Response(JSON.stringify({data: {currentUserProfile: validProfile ? {id: 'fixture-id'} : null}})) as never;
  };
  try {
    await writeFile(path, JSON.stringify({log: {entries: [{request: {
      url: 'https://www.findmypast.com/titan/marshal/graphql', cookies: [{name: 'FixtureSession', value: 'synthetic-cookie'}],
    }, response: {status: 200}}]}}));
    await writePrivateJson('findmypast/session.json', previous);
    await writePrivateJson('findmypast/pending-auth.json', {fixture: 'pending'});
    await assert.rejects(importFindmypastHar(path), /do not authenticate/);
    assert.deepEqual(await readPrivateJson('findmypast/session.json'), previous);
    assert.ok(await readPrivateJson('findmypast/pending-auth.json'));
    validProfile = true;
    const session = await importFindmypastHar(path);
    assert.equal(session.mode, 'browser');
    assert.deepEqual(await readPrivateJson('findmypast/session.json'), session);
    assert.equal(await readPrivateJson('findmypast/pending-auth.json'), undefined);
    assert.equal(await readPrivateJson('findmypast/login.json'), undefined);
    assert.equal(requests, 2);
  } finally {
    Impit.prototype.fetch = original;
    await rm(directory, {recursive: true, force: true});
    await rm(join(CREDENTIAL_DIR, 'findmypast'), {recursive: true, force: true});
  }
});
test('browser sessions use their validated region and never attempt native refresh on expiry', async () => {
  const session=browserSessionFromHar(JSON.stringify({log:{entries:[{request:{url:'https://www.findmypast.com/titan/marshal/graphql',cookies:[{name:'test',value:'test-value'}]},response:{status:200}}]}}));
  let refreshes=0;
  const client=new FindmypastClient(session,{exchange:async <T>(url:string|URL,options:ApiRequest={})=> {
    assert.equal(String(url),'https://www.findmypast.com/titan/marshal/graphql');
    assert.equal(options.headers?.Authorization,undefined);
    throw new FindmypastHttpError(401,'/graphql');
  }},{refresh:async()=>{refreshes++;throw new Error('Unexpected');},save:async()=>{}});
  await assert.rejects(client.me());assert.equal(refreshes,0);
  await assert.rejects(client.call('asset'),/native authentication/);
});
test('search uses one-based pages from the working service contract', async () => {
  const client=mockClient(async(_url,o)=>{assert.equal((o.body as any).variables.page,1);return {data:{}};});
  await client.client.search([{field:'LastName',values:['Lovelace']}]);
});

test('research searches preserve year offsets, country, sort direction, and newspaper date/location filters', async () => {
  assert.deepEqual(searchFilters({year:1901,yearRange:2,country:'England'}), [
    {field:'EventYear',values:['1901'],offset:2}, {field:'SourceCountry',values:['England']},
  ]);
  assert.throws(() => searchFilters({lastName:'Smith',yearRange:2}), /requires/);
  assert.throws(() => recordOrder('typo'), /sort/);
  const order = recordOrder('birth',true);
  const m = mockClient(async (_u,o) => {
    assert.equal((o.body as any).operationName, 'GetSearchResultsWithSort');
    assert.deepEqual((o.body as any).variables.orderBy, {by:'YearOfBirth',direction:'DESCENDING'});
    return {data:{}};
  });
  await m.client.search([{field:'LastName',values:['Smith']}],2,order);
  const variables = newspaperVariables({names:['Ada Lovelace'],country:'England',publications:['Example Gazette'],from:'1839-01-01',to:'1852-12-31',sort:'date',limit:5});
  assert.deepEqual(variables.date,{from:'1839-01-01',to:'1852-12-31'});
  assert.deepEqual(variables.publicationPlace,[{country:'England'}]);
  assert.deepEqual(variables.sort,{by:'PUBLICATION_DATE',direction:'ASC'});
  assert.equal(variables.pageSize,5);
  for (const options of [{}, {from:'1900-01-01'}, {from:'1900-02-30',to:'1901-01-01'}, {from:'1901-01-01',to:'1900-01-01'}, {names:['Smith'],limit:0}]) assert.throws(() => newspaperVariables(options));
});

const sampleImageRecord = {id:'test/record', fields:[{fieldId:'DatasetName',value:'Test Collection'}], image:{id:'test/image',recordMetadataId:'test-images',creditCost:0,mediaSource:'image'}};
function imageClient(bytes: Uint8Array, width = 2, height = 3, creditCost = 0, fulfilled = false) {
  let binaryRequests = 0;
  const client = mockClient(async (url,options) => {
    if (url.endsWith('/graphql')) {
      const body=options.body as any;
      if (body.operationName === 'GetRecordFulfillment') return {data:{fulfillableItems:[{id:'test/image',isFulfilled:fulfilled}]}};
      assert.deepEqual(body.variables.filter,[{field:'Id',values:['test/record']}]);
      return {data:{root:{search:{recordSearch:{records:[{...sampleImageRecord,image:{...sampleImageRecord.image,creditCost}}]}}}}};
    }
    assert.ok(url.includes('/test%2Fimage/'));
    assert.equal(options.query?.confirmedPurchase,false);
    if (url.endsWith('/info.json')) return {width,height,'@id':'https://evil.example/image'};
    assert.ok(url.endsWith('/full/max/0/default.jpg'));
    binaryRequests++; return bytes;
  }).client;
  return {client, requests:()=>binaryRequests};
}
test('downloads verify JPEG dimensions/checksum and never follow URLs from metadata', async () => {
  const bytes=await sharp({create:{width:2,height:3,channels:3,background:'#fff'}}).jpeg().toBuffer();
  const m=imageClient(bytes);
  const result=await downloadRecordImage(m.client,'test/record');
  assert.equal(m.requests(),1);
  assert.equal(result.metadata.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.metadata.width,2); assert.equal(result.metadata.height,3);
  assert.equal(result.metadata.collection,'Test Collection');
  assert.equal(new URL(result.metadata.sourceUrl).searchParams.get('id'),'test/record');
  await assert.rejects(downloadRecordImage(imageClient(Buffer.from('<html>sign in</html>')).client,'test/record'),/JPEG/);
  await assert.rejects(downloadRecordImage(imageClient(bytes,5,6).client,'test/record'),/dimensions/);
  await assert.rejects(downloadRecordImage(imageClient(bytes.subarray(0,40)).client,'test/record'),/incomplete/);
});
test('downloads refuse new credit-priced images but allow already-unlocked images', async () => {
  const bytes=await sharp({create:{width:2,height:3,channels:3,background:'#fff'}}).jpeg().toBuffer();
  const locked=imageClient(bytes,2,3,7);
  await assert.rejects(downloadRecordImage(locked.client,'test/record'),/already unlocked/);
  assert.equal(locked.requests(),0);
  await downloadRecordImage(imageClient(bytes,2,3,7,true).client,'test/record');
});

test('Camofox Findmypast sessions renew at most once on an authentication rejection', async () => {
  const session={...browserSessionFromHar(JSON.stringify({log:{entries:[{request:{url:'https://www.findmypast.com/titan/marshal/graphql',cookies:[{name:'test',value:'test-value'}]},response:{status:200}}]}})),browserInstance:'a'.repeat(24)};
  for (const status of [401,403,429,500]) {
    let sends=0,renewals=0;
    const client=new FindmypastClient(session,{exchange:async()=>{sends++;throw new FindmypastHttpError(status,'/graphql');}},
      {refresh:async()=>{throw new Error('Native refresh must not run');},save:async()=>{},browserLogin:async value=>{renewals++;return value;}});
    await assert.rejects(client.me());
    assert.equal(sends,status===401?2:1);assert.equal(renewals,status===401?1:0);
  }
});
