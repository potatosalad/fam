import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { StoriedHttp, StoriedError, API_ORIGIN, AUTH_ORIGIN, API_CLIENT_ID } from '../src/storied/http.js';
import { StoriedClient, prepareCall } from '../src/storied/client.js';
import { contracts, aliases, operation, validate } from '../src/storied/catalog.js';
import { acceptAuthorizationCode, REDIRECT_URI, saveSession, sessionStatus, type StoriedSession } from '../src/storied/auth.js';
import { authorizationRequest, callbackCode } from '../src/storied/browser-auth.js';
import { CREDENTIAL_DIR } from '../src/shared/storage.js';

const uuid = '12345678-1234-1234-1234-123456789012';
const session = (): StoriedSession => ({accessToken: 'fixture-access', refreshToken: 'fixture-refresh', subject: 'auth0|fixture',
  sessionId: uuid, expiresAt: Date.now() + 3_600_000, savedAt: '2026-01-01T00:00:00.000Z'});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});

test('Storied never sends credentials to a different origin or follows a redirect', async () => {
  let calls = 0;
  const http = new StoriedHttp(async (url, options) => {
    calls++;
    assert.equal(new URL(String(url)).origin, API_ORIGIN);
    assert.equal(options?.redirect, 'manual');
    const headers = options?.headers as Record<string,string>;
    assert.equal(headers['wa-clientId'], API_CLIENT_ID);
    assert.match(headers['wa-requestId'], /^[a-f0-9-]{36}$/);
    assert.equal(headers.Authorization, 'Bearer fixture-access');
    return new Response('fixture-access https://private.example', {status: 302, headers: {location: 'https://private.example'}});
  });
  for (const path of ['//evil.example/api/test', 'https://evil.example/api/test', '/\\evil.example/api/test', '/api/test#secret', '/oauth/token']) {
    await assert.rejects(http.request(path, {token: 'fixture-access'}));
  }
  assert.equal(calls, 0);
  await assert.rejects(http.request('/api/Users/trees', {token: 'fixture-access'}), e => {
    assert.ok(e instanceof StoriedError); assert.equal(e.status, 302);
    assert.ok(!e.message.includes('fixture-access')); assert.ok(!e.message.includes('private.example')); return true;
  });
  assert.equal(calls, 1);
});

test('Storied PKCE uses a random verifier and rejects wrong states and callback origins', () => {
  const r = authorizationRequest(), s = authorizationRequest();
  assert.notEqual(r.verifier, s.verifier); assert.notEqual(r.state, s.state);
  assert.equal(r.url.origin, AUTH_ORIGIN);
  assert.equal(r.url.searchParams.get('code_challenge'), createHash('sha256').update(r.verifier).digest('base64url'));
  assert.equal(r.url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(callbackCode(`${REDIRECT_URI}?code=fixture-code&state=${r.state}`, r.state), 'fixture-code');
  assert.equal(callbackCode(`https://evil.example/callback?code=fixture-code&state=${r.state}`, r.state), undefined);
  assert.throws(() => callbackCode(`${REDIRECT_URI}?code=fixture-code&state=wrong`, r.state), /state/);
  assert.throws(() => callbackCode(`${REDIRECT_URI}?code=a&code=b&state=${r.state}`, r.state), /code/);
  assert.throws(() => callbackCode(`${REDIRECT_URI}?error=access_denied&state=${r.state}`, r.state), /rejected/);
});

test('authorization validates identity and account API before saving tokens privately', async () => {
  const requests: {path: string; body?: any}[] = [];
  const http = new StoriedHttp(async (url, options) => {
    const path = new URL(String(url)).pathname;
    requests.push({path, body: options?.body ? JSON.parse(String(options.body)) : undefined});
    if (path === '/oauth/token') return json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'Bearer'});
    if (path === '/userinfo') return json({sub:'auth0|fixture'});
    return json([]);
  });
  const s = await acceptAuthorizationCode('fixture-code','fixture-verifier',http,saveSession);
  assert.equal(requests[0].body.grant_type, 'authorization_code');
  assert.equal(requests[0].body.code_verifier, 'fixture-verifier');
  assert.equal(requests[0].body.redirect_uri, REDIRECT_URI);
  assert.deepEqual(requests.map(r=>r.path), ['/oauth/token','/userinfo','/api/Users/trees']);
  assert.equal(s.subject, 'auth0|fixture');
  assert.ok(!JSON.stringify(sessionStatus(s)).includes('fixture'));
  const path = join(CREDENTIAL_DIR,'storied/session.json');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(path,'utf8')).refreshToken,'fixture-refresh');
  let saved = false;
  await assert.rejects(acceptAuthorizationCode('code','verifier',new StoriedHttp(async () => json({access_token:'secret'})),async()=>{saved=true;}));
  assert.equal(saved,false);
});

test('reads refresh at most once, preserve refresh token when omitted, and do not refresh on 403', async () => {
  const paths: string[] = [], saved: StoriedSession[] = [];
  const http = new StoriedHttp(async (url) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    if (path === '/oauth/token') return json({access_token:'new-access',expires_in:3600,token_type:'Bearer'});
    if (paths.length === 1) return json({error:'invalid_token'},401);
    return json([]);
  });
  const c = new StoriedClient(session(),http,async s=>{saved.push(s);});
  assert.deepEqual(await c.trees(),[]);
  assert.deepEqual(paths,['/api/Users/trees','/oauth/token','/api/Users/trees']);
  assert.equal(saved[0].refreshToken,'fixture-refresh');
  let count = 0;
  const denied = new StoriedClient(session(),new StoriedHttp(async()=>{count++;return json({},403);}),async()=>{});
  await assert.rejects(denied.trees()); assert.equal(count,1);
  count = 0;
  const repeated = new StoriedClient(session(),new StoriedHttp(async url=>{
    count++;return new URL(String(url)).pathname === '/oauth/token' ? json({access_token:'new',expires_in:3600,token_type:'Bearer'}) : json({},401);
  }),async()=>{});
  await assert.rejects(repeated.trees()); assert.equal(count,3);
});

test('writes are not replayed and rotation is saved before the first API call', async () => {
  let calls = 0;
  const client = new StoriedClient(session(),new StoriedHttp(async()=>{calls++;return json({},401);}),async()=>{});
  await assert.rejects(client.call('search',{body:{givenName:{value:'Fixture'},pageNumber:1,pageSize:2}}));
  assert.equal(calls,1);
  let saved = false;
  const expired = new StoriedClient({...session(),expiresAt:Date.now()-1},new StoriedHttp(async url=>{
    if (new URL(String(url)).pathname === '/oauth/token') return json({access_token:'rotated',refresh_token:'rotated-refresh',token_type:'Bearer',expires_in:3600});
    assert.equal(saved,true); return json([]);
  }),async()=>{saved=true;});
  await expired.trees();
});

test('catalog aliases resolve; parameter contracts reject traversal and encode arrays correctly', () => {
  assert.ok(contracts.operations.length > 700);
  for (const name of Object.keys(aliases)) assert.ok(operation(name));
  assert.equal(operation('getFamilyTrees').id, aliases.trees);
  assert.equal(prepareCall(operation('tree'),{query:{treeIds:[uuid,uuid]}}).path,`/api/Trees/detail?treeIds=${uuid}&treeIds=${uuid}`);
  assert.throws(()=>prepareCall(operation('person'),{path:{personId:'../private'}}),/UUID/);
  assert.throws(()=>prepareCall(operation('trees'),{query:{unknown:true}}),/Unknown/);
  assert.throws(()=>prepareCall(operation('trees'),{query:{includePersonCount:'false'}}),/boolean/);
  assert.throws(()=>prepareCall(operation('person')),/required/);
  assert.throws(()=>operation('GET /api/admin/User/refresh_offline_access_tokens'),/Unknown/);
  assert.throws(()=>prepareCall(operation('trees'),{body:{}}),/no request body/);
  validate('Unknown',{enum:['Unknown'],type:'object'},'category');
  validate(9223372036854775807n,{type:'integer'},'large ID');
});
