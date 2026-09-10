import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CookieJar} from 'tough-cookie';
import {parse, visit, Kind, print} from 'graphql';
import {contracts, aliases, graphqlOperation, validateVariables, prepareRest, restOperation} from '../src/myheritage/catalog.js';
import {parseAuthResponse, deviceFields, sessionFromHar, type MyHeritageSession} from '../src/myheritage/auth.js';
import {MyHeritageClient, MyHeritageGraphQLError} from '../src/myheritage/client.js';
import {MyHeritageHttpError, checkMyHeritageUrl, FAMILYGRAPH, GRAPHQL} from '../src/myheritage/http.js';
import type {ApiRequest, ApiResponse} from '../src/familysearch/transport-types.js';

const session = (): MyHeritageSession => ({accessToken: 'fixture-token', accountId: 'fixture-account', userId: 'user-12',
  savedAt: '2026-09-06T00:00:00Z', deviceId: 'fixture-device', cookies: new CookieJar().serializeSync()});
function mock(send: (url: string, request: ApiRequest) => Promise<unknown>) {
  return {jar: new CookieJar(), exchange: async <T>(url: string | URL, request: ApiRequest = {}): Promise<ApiResponse<T>> => ({data: await send(String(url), request) as T, status: 200, headers: {}})};
}
const noSave = async () => {};

test('all recovered documents parse, resolve fragments and match the variable inventory and hashes', () => {
  assert.equal(contracts.rest.length, 164); assert.equal(contracts.graphql.length, 135);
  assert.equal(new Set(contracts.rest.map(o => o.id)).size, contracts.rest.length);
  assert.equal(new Set(contracts.graphql.map(o => o.id)).size, contracts.graphql.length);
  for (const op of contracts.graphql) {
    const ast = parse(op.document);
    const definition = ast.definitions.find(d => d.kind === Kind.OPERATION_DEFINITION)!;
    assert.equal(definition.name?.value, op.name); assert.equal(definition.operation, op.kind);
    assert.deepEqual((definition.variableDefinitions ?? []).map(v => ({name: v.variable.name.value, type: print(v.type)})), op.variables.map(v => ({name: v.name, type: v.type})));
    const fragments = new Set(ast.definitions.filter(d => d.kind === Kind.FRAGMENT_DEFINITION).map(d => d.name.value));
    visit(ast, {FragmentSpread(node) {assert(fragments.has(node.name.value), `${op.id}: missing ${node.name.value}`);}});
    assert.equal(createHash('sha256').update(op.document).digest('hex'), op.sha256);
    assert(op.route); if (op.route !== '/') assert(contracts.rest.some(r => r.path === op.route));
  }
});
test('every REST declaration builds with its recovered parameter encoding', () => {
  for (const op of contracts.rest) {
    const path = Object.fromEntries([...op.path.matchAll(/\{([^}]+)\}/g)].map(m => [m[1]!, 'fixture-id']));
    const body = op.encoding === 'multipart' ? new FormData() : op.parameters.some(p => p.kind === 'Body' || p.kind === 'FieldMap') ? {} : undefined;
    const request = prepareRest(op.id, {path, body, ...(op.parameters.some(p => p.kind === 'Url') ? {url: `${FAMILYGRAPH}/fixture`} : {})});
    assert.equal(request.options.method, op.method);
    if (op.encoding === 'form') {assert.equal(request.options.encoding, 'raw'); assert.equal(typeof request.options.body, 'string');}
    assert(!request.url.includes('{'));
  }
  for (const alias of Object.keys(aliases)) assert(restOperation(alias));
});
test('duplicate operation names and overloaded REST methods remain independently addressable', () => {
  assert.throws(() => graphqlOperation('getPhotosCount'), /Ambiguous/);
  assert.equal(graphqlOperation('graphql.tree.get_individual_count_for_tree').route, 'mobile_getIndividualCountForTree/');
  assert.equal(graphqlOperation('graphql.site.get_photos_count').route, 'mobile_getSitePhotos/');
  assert.equal(contracts.rest.filter(r => r.id.includes('.getFamilyListIndividuals.')).length, 2);
});
test('Gson wire names, not obfuscated field names, are captured', () => {
  const user = contracts.models.find(m => m.name.endsWith('.User'))!;
  assert(user.fields.some(f => f.name === 'default_site' && f.field === 'defaultSite'));
  assert(user.fields.some(f => f.name === 'memberships' && f.field === 'mMemberships'));
});
test('variables reject missing, misspelled and unsafe numeric values', () => {
  const op = graphqlOperation('graphql.individual.search_individuals');
  assert.throws(() => validateVariables(op, {}), /treeId/);
  assert.throws(() => validateVariables(op, {treeId: 'x', query: 'x', lang: 'EN', limit: 1, typo: 1}), /Unknown variable/);
  assert.throws(() => validateVariables(op, {treeId: 'x', query: 'x', lang: 'EN', limit: 9007199254740992}), /Invalid limit/);
  validateVariables(op, {treeId: 'x', query: 'x', lang: 'EN', limit: 20n});
});
test('REST path encoding prevents escaping IDs, missing bodies and unsafe destinations fail locally', () => {
  assert.match(prepareRest('person', {path: {individualId: 'a/b?#'}}).url, /a%2Fb%3F%23$/);
  assert.throws(() => prepareRest('person'), /parameter/);
  assert.throws(() => prepareRest('person', {path: {individualId: '..'}}), /parameter/);
  assert.throws(() => prepareRest('person.update', {path: {individualId: 'x'}}), /requires body/);
  assert.throws(() => checkMyHeritageUrl(new URL('https://familygraph.myheritage.com.attacker.example/me')), /outside/);
  assert.throws(() => checkMyHeritageUrl(new URL('https://user:pass@familygraph.myheritage.com/me')), /outside/);
  const file = contracts.rest.find(r => r.id.endsWith('.downloadFile'))!;
  assert.equal(prepareRest(file.id, {url: 'https://media.example/signed'}).anonymous, true);
  assert.throws(() => prepareRest(file.id, {url: 'http://media.example/signed'}), /HTTPS/);
});
test('native XML auth decodes entities and carries MFA/verification results without evaluating XML', () => {
  const auth = parseAuthResponse('<MyHeritage><Result desc="OK &amp; ready">0</Result><AccountID>a&amp;b</AccountID><PlaintextAccountID>12</PlaintextAccountID><FamilyGraphAccessToken><![CDATA[a<b&c]]></FamilyGraphAccessToken></MyHeritage>');
  assert.equal(auth.accountId, 'a&b'); assert.equal(auth.accessToken, 'a<b&c'); assert.equal(auth.description, 'OK & ready');
  assert.equal(parseAuthResponse('<MyHeritage><Result desc="MFA">-106</Result><TfaMethod>EMAIL</TfaMethod></MyHeritage>').tfaMethod, 'EMAIL');
  for (const bad of ['<html>oops</html>', '<MyHeritage/>', '<!DOCTYPE x SYSTEM "file:///secret"><MyHeritage/>']) assert.throws(() => parseAuthResponse(bad));
  assert.equal(deviceFields('fixture').DeviceID, 'fixture');
});
test('HAR import only accepts successful MyHeritage API requests and excludes unrelated cookies', () => {
  const entry = (url: string, token: string, status = 200) => ({request: {url, headers: [{name: 'Authorization', value: `Bearer ${token}`}], cookies: [{name: 'fixture', value: token}]}, response: {status}});
  const parsed = sessionFromHar(JSON.stringify({log: {entries: [entry(`${FAMILYGRAPH}/me`, 'good'), entry('https://evil.example/me', 'evil'), entry(`${FAMILYGRAPH}/me`, 'expired', 401)]}}));
  assert.equal(parsed.accessToken, 'good'); assert.equal(parsed.http.jar.getCookieStringSync('https://evil.example/'), '');
  assert.throws(() => sessionFromHar('null'), /HAR/);
  assert.throws(() => sessionFromHar(JSON.stringify({log: {entries: [entry('https://evil.example/', 'evil')]}})), /No successful/);
});
test('GraphQL uses the exact asset route and keeps partial errors inspectable', async () => {
  const client = new MyHeritageClient(session(), mock(async (url, r) => {
    assert.equal(url, `${GRAPHQL}/mobile_getIndividualCountForTree/`);
    assert.equal(new Headers(r.headers).get('authorization'), 'Bearer fixture-token');
    assert.equal((r.body as {operationName: string}).operationName, 'getPhotosCount');
    return {data: {tree: null}, errors: [{message: 'fixture denied'}]};
  }), {save: noSave});
  await assert.rejects(client.graphql('graphql.tree.get_individual_count_for_tree', {treeId: 'tree-1-1'}), (error: unknown) => {
    assert(error instanceof MyHeritageGraphQLError); assert.equal(error.result.errors?.[0]?.message, 'fixture denied'); return true;
  });
});
test('401 refreshes once, 429 does not refresh or retry, and caller headers cannot replace bearer', async () => {
  let calls = 0, refreshes = 0;
  const client = new MyHeritageClient(session(), mock(async (_, r) => {
    calls++; const bearer = new Headers(r.headers).get('authorization');
    if (calls === 1) {assert.equal(bearer, 'Bearer fixture-token'); throw new MyHeritageHttpError(401, '/me');}
    assert.equal(bearer, 'Bearer new-token'); return {id: 'user-12'};
  }), {save: noSave, refresh: async s => {refreshes++; return {...s, accessToken: 'new-token'};}});
  await client.request('me', {headers: {authorization: 'bad'}});
  assert.equal(calls, 2); assert.equal(refreshes, 1);
  const limited = new MyHeritageClient(session(), mock(async () => {throw new MyHeritageHttpError(429, '/me');}), {save: noSave, refresh: async () => {assert.fail('must not refresh on 429');}});
  await assert.rejects(limited.me(), /429/);
});

test('MyHeritage GraphQL commands renew explicit authentication rejection and save before retry', async () => {
  let calls = 0, refreshes = 0, saves = 0;
  const client = new MyHeritageClient(session(), mock(async () => {
    calls++;
    if (calls === 1) return {errors: [{extensions: {code: 'UNAUTHENTICATED'}}]};
    assert.equal(saves, 1);
    return {data: {ok: true}};
  }), {save: async () => {saves++;}, refresh: async s => {refreshes++; return {...s, accessToken: 'renewed'};}});
  assert.deepEqual(await client.query('query { me { id } }'), {ok: true});
  assert.equal(calls, 2); assert.equal(refreshes, 1);
});
test('concurrent authentication failures share one refresh and invalid origins never send', async () => {
  let refreshes = 0, sends = 0;
  const client = new MyHeritageClient(session(), mock(async (_, r) => {
    sends++; if (new Headers(r.headers).get('authorization') === 'Bearer fixture-token') throw new MyHeritageHttpError(401, '/me');
    return {id: 'user-12'};
  }), {save: noSave, refresh: async s => {refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return {...s, accessToken: 'new-token'};}});
  await Promise.all([client.me(), client.me()]); assert.equal(refreshes, 1); assert.equal(sends, 4);
  await assert.rejects(client.request('https://evil.example/'), /outside/); assert.equal(sends, 4);
});

test('HAR import recovers the website GraphQL bearer_token form field', () => {
  const har = {log: {entries: [{request: {url: 'https://www.myheritage.com/web-family-graphql/tree/', postData: {
    mimeType: 'application/x-www-form-urlencoded', text: 'query=fixture&bearer_token=form%2Btoken%3D'
  }}, response: {status: 200}}]}};
  assert.equal(sessionFromHar(JSON.stringify(har)).accessToken, 'form+token=');
});

test('signed file transfers strip credentials and never follow redirects', async () => {
  const {transferMyHeritage} = await import('../src/myheritage/http.js');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.redirect, 'manual');
      assert.equal(new Headers(options?.headers).get('authorization'), null);
      assert.equal(new Headers(options?.headers).get('cookie'), null);
      return new Response(new Uint8Array([1, 2, 3]));
    };
    const result = await transferMyHeritage('https://media.example/file?signature=fixture', {headers: {Authorization: 'fixture-secret', Cookie: 'fixture=secret'}});
    assert.deepEqual(result.data, new Uint8Array([1, 2, 3]));
    globalThis.fetch = async () => new Response(null, {status: 302, headers: {location: 'https://elsewhere.example/'}});
    await assert.rejects(transferMyHeritage('https://media.example/file?signature=fixture'), error => {
      assert(error instanceof Error); assert.match(error.message, /302/); assert(!error.message.includes('signature')); return true;
    });
  } finally {globalThis.fetch = original;}
});
test('CLI help and invalid catalog requests work without authentication', async () => {
  const {execFile} = await import('node:child_process');
  const {promisify} = await import('node:util'); const exec = promisify(execFile);
  const {stdout} = await exec(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'myheritage.api', 'call', '--help']);
  assert.match(stdout, /fam myheritage\.api call/); assert(!stdout.includes('npm run fs'));
  await assert.rejects(exec(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'myheritage.api', 'call', '--operation', 'person']), (e: unknown) => {
    assert.match((e as {stderr: string}).stderr, /Missing or invalid path parameter individualId/); return true;
  });
});

import {parseTreePage, pageValue, checkTreePageUrl} from '../src/myheritage/browser.js';
const browserPage = Object.entries({isLoggedIn: true, currentUserAccountID: 'ACCOUNT', siteID: 'SITE', familyTreeID: 1,
  rootIndividualID: 10, homeIndividualID: 10, familyTreeTitle: 'Fixture tree', familyTreeSize: 2, mhXsrfToken: 'fixture-csrf',
  mediaUploaderData: {fgToken: 'fresh-token'}, displayLang: 'EN', dataLang: 'EN', clientVersion: 2, familyTreeRevision: 4,
  maxProximityLevel: 5, maxIndividualsAfterPrune: 100, treeSelectionMenuEntries: [{id: 1, name: 'Fixture tree', count: 2, url: '/family-trees/fixture/SITE?familyTreeID=1'}],
}).map(([key, value]) => `var ${key} = ${JSON.stringify(value)};`).join('\n');

test('browser page parsing accepts JSON literals, never executes scripts and rejects signed-out pages', () => {
  assert.equal(parseTreePage(browserPage).siteId, 'SITE');
  assert.equal(pageValue('var sample = {"nested":["a; b",{"x":"brace }"}]};', 'sample') instanceof Object, true);
  assert.equal(pageValue('var sample = (() => { throw new Error("must not execute") })();', 'sample'), undefined);
  assert.throws(() => parseTreePage(browserPage.replace('isLoggedIn = true', 'isLoggedIn = false')), /expired/);
  assert.throws(() => checkTreePageUrl('https://evil.example/family-trees/a'), /family-tree/);
  assert.throws(() => checkTreePageUrl('https://www.myheritage.com/FP/API/Mobile/login.php'), /family-tree/);
});

test('HAR import accepts signed-in tree response credentials without requiring a person request', () => {
  const entry = {request: {url: 'https://www.myheritage.com/family-trees/fixture/SITE', headers: [{name: 'Cookie', value: 'PHPSESSID=fixture-session'}]},
    response: {status: 200, content: {text: browserPage}}};
  const serialize = (value: unknown) => JSON.stringify({log: {entries: [value]}});
  const parsed = sessionFromHar(serialize(entry));
  assert.equal(parsed.accessToken, 'fresh-token');
  assert.equal(parsed.http.jar.getCookieStringSync('https://www.myheritage.com'), 'PHPSESSID=fixture-session');
  assert(parsed.browser);
  assert.equal(sessionFromHar(serialize({...entry, response: {status: 200, content: {text: Buffer.from(browserPage).toString('base64'), encoding: 'base64'}}})).accessToken, 'fresh-token');
  assert.throws(() => sessionFromHar(serialize({...entry, response: {status: 200, content: {text: browserPage.replace('isLoggedIn = true', 'isLoggedIn = false')}}})), /No successful/);
  assert.throws(() => sessionFromHar(serialize({...entry, request: {...entry.request, url: 'https://evil.example/family-trees/fixture/SITE'}})), /No successful/);
});

test('HAR import retains only browser API cookies, user agent and a permitted tree page URL', () => {
  const text = JSON.stringify({log: {entries: [
    {request: {url: 'https://www.myheritage.com/family-trees/fixture/SITE'}, response: {status: 200}},
    {request: {url: 'https://www.myheritage.com/web-family-graphql/individual_data_with_hints_query/',
      headers: [{name: 'User-Agent', value: 'fixture-browser'}, {name: 'Cookie', value: 'PHPSESSID=fixture-session; lang=EN'}],
      postData: {text: '', params: [{name: 'bearer_token', value: 'fixture-token'}]}}, response: {status: 200}},
  ]}});
  const parsed = sessionFromHar(text);
  assert.equal(parsed.browser?.userAgent, 'fixture-browser'); assert.match(parsed.browser!.pageUrl, /family-trees/);
  assert.equal(parsed.http.jar.getCookiesSync('https://www.myheritage.com').find(c => c.key === 'PHPSESSID')?.value, 'fixture-session');
  assert.equal(parsed.http.jar.getCookieStringSync(FAMILYGRAPH), '');
});

test('browser reads refresh page credentials, attach CSRF, preserve scopes, and never fall back to native login', async () => {
  let pages = 0, saves = 0;
  const current = {...session(), mode: 'browser' as const, browser: {pageUrl: 'https://www.myheritage.com/family-trees/fixture/SITE', userAgent: 'fixture-browser'}};
  const http = mock(async (url, request) => {
    assert(!request.headers?.Authorization);
    if (url.includes('/family-trees/')) {pages++; return browserPage;}
    if (url.includes('/web-family-graphql/')) {
      const params = new URLSearchParams(String(request.body));
      assert.equal(params.get('bearer_token'), 'fresh-token'); assert.equal(params.get('mhc#PHPSESSID'), 'fixture-session');
      assert.equal(JSON.parse(params.get('variables')!).individualId, 'individual-SITE-10');
      assert.doesNotThrow(() => parse(JSON.parse(params.get('query')!)));
      return {data: {individual: {family_groups: []}}};
    }
    assert.equal(request.query?.csrf_token, 'fixture-csrf');
    if (url.endsWith('get-current-user-permissions.php')) return {isMember: true, associatedIndividualId: 10};
    if (url.endsWith('get-tree-layout.php')) return {status: 'success', data: {familyTreeSize: 25, personCards: [{id: '10', n: 'Test person'}, {id: '10', n: 'Test person'}]}};
    if (url.endsWith('get-extended-card-content.php')) return {success: true, name: 'Test person', facts: [{type: 'BIRT'}]};
    throw new Error('Unexpected route');
  });
  http.jar.setCookieSync('PHPSESSID=fixture-session; Path=/; Secure', 'https://www.myheritage.com');
  const client = new MyHeritageClient(current, http, {save: async () => {saves++;}, refresh: async () => {throw new Error('Native refresh must not run');}});
  const me = await client.me() as any; assert.equal(me.default_individual.id, 'individual-SITE-10');
  const people = await client.people('1') as any; assert.equal(people.scope, 'tree-neighborhood'); assert.equal(people.data.length, 1); assert.equal(people.total_tree_people, 25);
  await client.person('individual-SITE-10'); await client.insights('10');
  await assert.rejects(client.person('individual-OTHER-10'), /current site/);
  await assert.rejects(client.request('/me'), /requires a native/);
  assert.equal(pages, 1); await client.refresh(); assert.equal(pages, 2); assert(saves >= 5);
});

test('Camofox tree session rejection renews once and leaves other failures alone', async () => {
  for (const failure of ['expired', '403', 'network'] as const) {
    let reads = 0, renewals = 0;
    const current = {...session(), mode:'browser' as const, browserInstance:'a'.repeat(24), browser:{pageUrl:'https://www.myheritage.com/FP/family-tree.php'}};
    const http = mock(async url => {
      if (!url.endsWith('family-tree.php')) return {isMember:true};
      reads++;
      if (failure === '403') throw new MyHeritageHttpError(403, '/FP/family-tree.php');
      if (failure === 'network') throw new Error('network');
      return reads === 1 ? browserPage.replace('isLoggedIn = true','isLoggedIn = false') : browserPage;
    });
    const client = new MyHeritageClient(current, http, {save:noSave, browserLogin:async value=>{renewals++;return value;}});
    if (failure === 'expired') {await client.me();assert.equal(reads,2);assert.equal(renewals,1);}
    else {await assert.rejects(client.me());assert.equal(reads,1);assert.equal(renewals,0);}
  }
});

test('browser login renewal replaces the active cookies before retrying research', async () => {
  const origin = 'https://www.myheritage.com';
  let reads = 0, renewals = 0;
  const current = {...session(), mode:'browser' as const, browserInstance:'a'.repeat(24), browser:{pageUrl:`${origin}/FP/family-tree.php`}};
  const http = mock(async (url, request) => {
    if (url.endsWith('/research')) {
      reads++;
      if (reads === 1) return 'var clientData = {"user":{"isLoggedIn":false}};';
      assert.equal(http.jar.getCookieStringSync(origin), 'PHPSESSID=renewed-cookie');
      assert.equal(http.jar.getCookieStringSync(FAMILYGRAPH), '');
      return 'var clientData = {"user":{"isLoggedIn":true,"siteId":"site","guestId":"guest"},"fgToken":"renewed-token","lang":"EN"}; var mhXsrfToken = "csrf";';
    }
    const form = new URLSearchParams(String(request.body));
    assert.equal(form.get('mhc#PHPSESSID'), 'renewed-cookie');
    assert.equal(form.get('bearer_token'), 'renewed-token');
    return {data:{search_query_upload:{response:{summary:{},results:{count:0,data:[]}}}}};
  });
  http.jar.setCookieSync('PHPSESSID=old-cookie; Path=/; Secure', origin);
  http.jar.setCookieSync('obsolete=old-cookie; Path=/; Secure', FAMILYGRAPH);
  const fresh = new CookieJar(); fresh.setCookieSync('PHPSESSID=renewed-cookie; Path=/; Secure; HttpOnly', origin);
  const client = new MyHeritageClient(current, http, {save:noSave, browserLogin:async value=>{
    renewals++; return {...value,cookies:fresh.serializeSync()};
  }});
  assert.equal((await client.searchRecords({lastName:'Fixture'})).returned,0);
  assert.equal(reads,2); assert.equal(renewals,1);
  assert.equal(http.jar.getCookiesSync(origin)[0].httpOnly,true);
});
