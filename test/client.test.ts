import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { stat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Impit } from 'impit';
import { apiUrl, FamilySearchClient } from '../src/familysearch/client.js';
import { CHURCH_CLIENT_ID, createAuthorization, extractStateToken, parseCallback, REDIRECT_URI, validateTokens } from '../src/familysearch/auth.js';
import { checkOrigin, HttpError, HttpSession } from '../src/familysearch/http.js';
import { CREDENTIAL_DIR, writePrivateJson } from '../src/shared/storage.js';

test('OAuth requests use unique state and a correct S256 challenge', () => {
  const a = createAuthorization();
  const b = createAuthorization();
  const query = new URL(a.url).searchParams;
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.verifier, b.verifier);
  assert.match(a.verifier, /^[\w-]{43,128}$/);
  assert.equal(query.get('code_challenge'), createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(query.get('code_challenge_method'), 'S256');
  assert.equal(query.get('client_id'), CHURCH_CLIENT_ID);
  assert.equal(query.get('redirect_uri'), REDIRECT_URI);
});

test('OAuth callback rejects swapped state, origin, errors, and missing codes', () => {
  assert.equal(parseCallback(`${REDIRECT_URI}?code=example&state=expected`, 'expected'), 'example');
  for (const callback of [
    `${REDIRECT_URI}?code=example&state=wrong`,
    'https://evil.example/redirect?code=example&state=expected',
    `${REDIRECT_URI}?error=access_denied&state=expected`,
    `${REDIRECT_URI}?state=expected`,
  ]) assert.throws(() => parseCallback(callback, 'expected'));
});

test('extracts escaped Okta state as data without executing page scripts', () => {
  assert.equal(extractStateToken(String.raw`var data={"stateToken":"abc\x2Ddef\u002Eghi"}; malicious();`), 'abc-def.ghi');
  assert.throws(() => extractStateToken('<html>No sign-in state</html>'));
});

test('rejects token exfiltration through URLs, path traversal, or untrusted auth hosts', () => {
  for (const path of ['https://evil.example', '//evil.example/a', '/platform/../../auth/logout', '/platform/\\evil.example', '/platform/users/current?access_token=secret']) {
    assert.throws(() => apiUrl(path));
  }
  for (const url of ['http://www.familysearch.org/platform/users/current', 'https://www.familysearch.org.evil.example/', 'https://name:password@ident.familysearch.org/']) assert.throws(() => checkOrigin(new URL(url)));
  assert.equal(apiUrl('/platform/tree/ancestry', { person: 'ABCD-123', generations: 2 }).searchParams.get('person'), 'ABCD-123');
  assert.throws(() => validateTokens({ access_token: 'x\r\nInjected: header' }));
  assert.throws(() => validateTokens({ access_token: '' }));
});

test('private writes replace atomically and preserve owner-only permissions', async () => {
  const name = `test-${randomUUID()}.json`;
  const file = join(CREDENTIAL_DIR, name);
  try {
    await writePrivateJson(name, { refresh_token: 'old-test-token' });
    await writePrivateJson(name, { refresh_token: 'rotated-test-token' });
    if (process.platform !== 'win32') {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      assert.equal((await stat(CREDENTIAL_DIR)).mode & 0o777, 0o700);
    }
    assert.equal(JSON.parse(await readFile(file, 'utf8')).refresh_token, 'rotated-test-token');
  } finally { await rm(file, { force: true }); }
});

test('HTTP redirects preserve domain-scoped cookies and stop at the native callback', async () => {
  const original = Impit.prototype.fetch;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  Impit.prototype.fetch = async function (url, init) {
    const href = String(url);
    calls.push({ url: href, headers: init?.headers as Record<string, string> });
    const index = calls.length;
    return new Response('', { status: 302, headers: index === 1
      ? { location: 'https://id.churchofjesuschrist.org/login', 'set-cookie': 'fs-test=private; Secure; HttpOnly; Path=/' }
      : { location: `${REDIRECT_URI}?code=test&state=test` } }) as never;
  };
  try {
    const http = new HttpSession();
    const result = await http.follow('https://ident.familysearch.org/start', REDIRECT_URI);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].headers.Cookie, undefined);
    assert.equal(await http.jar.getCookieString('https://ident.familysearch.org/'), 'fs-test=private');
    assert.equal(result.url, `${REDIRECT_URI}?code=test&state=test`);
  } finally { Impit.prototype.fetch = original; }
});

test('untrusted redirects never receive a request; HTTP errors omit body and query tokens', async () => {
  const original = Impit.prototype.fetch;
  let requests = 0;
  Impit.prototype.fetch = async function () { requests++; return new Response('', { status: 302, headers: { location: 'https://evil.example/steal' } }) as never; };
  try {
    await assert.rejects(new HttpSession().follow('https://ident.familysearch.org/start'), /outside/);
    assert.equal(requests, 1);
    Impit.prototype.fetch = async function () { return new Response('secret response body', { status: 401 }) as never; };
    await assert.rejects(new HttpSession().json('https://ident.familysearch.org/token?code=secret'), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  } finally { Impit.prototype.fetch = original; }
});

// Use the real client state machine with a synthetic session and transport.
// Replace disk persistence so tests cannot replace the user's real session.
function syntheticClient() {
  const session = { version: 1, clientId: CHURCH_CLIENT_ID, tokens: { access_token: 'old', refresh_token: 'refresh-1' }, obtainedAt: new Date().toISOString(), cookies: new HttpSession().jar.serializeSync() };
  const client: FamilySearchClient = new (FamilySearchClient as any)(session);
  const internal = client as any;
  const persisted: unknown[] = [];
  internal.persist = async (tokens?: any) => { if (tokens) { persisted.push(tokens); session.tokens = tokens; } };
  return { client, internal, session, persisted };
}

test('401 renews once, saves rotated credentials, and retries with the new token', async () => {
  const { client, internal, persisted } = syntheticClient();
  const events: string[] = [];
  internal.http.json = async (url: URL | string, body: any, headers: Record<string, string>) => {
    if (body) {
      events.push('refresh');
      assert.equal(body.refresh_token, 'refresh-1');
      return { access_token: 'new', refresh_token: 'refresh-2' };
    }
    events.push(headers.Authorization);
    if (headers.Authorization === 'Bearer old') throw new HttpError(401, new URL(url).pathname);
    return { ok: true };
  };
  assert.deepEqual(await client.get('/platform/users/current'), { ok: true });
  assert.deepEqual(events, ['Bearer old', 'refresh', 'Bearer new']);
  assert.deepEqual(persisted, [{ access_token: 'new', refresh_token: 'refresh-2', token_type: undefined }]);
});

test('concurrent unauthorized reads share a single refresh', async () => {
  const { client, internal } = syntheticClient();
  let refreshes = 0;
  internal.http.json = async (_url: unknown, body: any, headers: Record<string, string>) => {
    if (body) { refreshes++; return { access_token: 'new' }; }
    if (headers.Authorization === 'Bearer old') throw new HttpError(401, '/platform/users/current');
    return { ok: true };
  };
  await Promise.all([client.get('/platform/users/current'), client.get('/platform/users/current')]);
  assert.equal(refreshes, 1);
});

test('permission errors are not refreshed and repeated 401s have a bounded retry', async () => {
  for (const status of [401, 403, 429]) {
    const { client, internal } = syntheticClient();
    let requests = 0;
    let refreshes = 0;
    internal.http.json = async (_url: unknown, body: any) => {
      if (body) { refreshes++; return { access_token: 'new' }; }
      requests++;
      throw new HttpError(status, '/platform/users/current');
    };
    await assert.rejects(client.get('/platform/users/current'), error => error instanceof HttpError && error.status === status);
    assert.equal(requests, status === 401 ? 2 : 1);
    assert.equal(refreshes, status === 401 ? 1 : 0);
  }
});
