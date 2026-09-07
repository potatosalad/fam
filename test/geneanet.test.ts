import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { GeneanetHttp, GeneanetError, WEB, TREE, API, checkUrl, type Transport } from '../src/geneanet/http.js';
import { authenticateGeneanet, readAccount, type GeneanetSession } from '../src/geneanet/auth.js';
import { pageKeys, parseSearch, parsePage, researchUrl } from '../src/geneanet/parse.js';
import { searchUrl } from '../src/geneanet/catalog.js';
import { GeneanetClient } from '../src/geneanet/client.js';
import { downloadMedia, downloadRecord, saveDownload } from '../src/geneanet/download.js';
import { CREDENTIAL_DIR } from '../src/shared/storage.js';

const keys = (value: unknown) => `<script>$.extend(true, keys.elements, ${JSON.stringify(value)});</script>`;
const homepage = keys({user: {username: 'fixture-user', jwt_token: 'fixture-jwt'}});
const response = (text: string, status = 200, headers: Record<string,string> = {}) => new Response(text, {status, headers});
const loginPage = `<form action="${WEB}/connexion/login_check"><input name="_password"><input name="_csrf_token" value="fixture-csrf"></form>`;
const jar = new GeneanetHttp().jar;
jar.setCookieSync('gntsess5=fixture-session; Domain=.geneanet.org; Path=/; Secure', WEB);
const session: GeneanetSession = {version: 1, username: 'fixture-user', savedAt: '2026-01-01', validatedAt: '2026-01-01', cookies: jar.serializeSync()};

test('Geneanet web login submits CSRF once, propagates cookies and validates identity before saving', async () => {
  let posts = 0, saved: GeneanetSession | undefined;
  const transport: Transport = async (url, init) => {
    if (url === `${WEB}/connexion/`) return response(loginPage, 200, {'set-cookie': 'gntsess5=fixture-session; Path=/; Secure'});
    if (init.method === 'POST') {
      posts++; assert.equal(url, `${WEB}/connexion/login_check`);
      assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), {_username: 'user@example.invalid', _password: 'private & unicode é', _remember_me: 'on', _csrf_token: 'fixture-csrf'});
      assert.match(init.headers.Cookie, /gntsess5=fixture-session/);
      return response('', 302, {location: '/', 'set-cookie': 'REMEMBERME=fixture-remember; Path=/; Secure'});
    }
    if (url === `${WEB}/`) return response(homepage);
    assert.equal(url, `${API}/user/current`); assert.equal(init.headers.Authorization, 'Bearer fixture-jwt');
    return response(JSON.stringify({username: 'fixture-user', premium: true, jwt_token: 'another-secret'}));
  };
  await authenticateGeneanet(new GeneanetHttp(undefined, transport), {username: 'user@example.invalid', password: 'private & unicode é'}, async s => {saved = s;});
  assert.equal(posts, 1); assert.equal(saved?.username, 'fixture-user');
  assert.ok(saved?.cookies.cookies.some(c => c.key === 'REMEMBERME'));
  assert.ok(!JSON.stringify(saved).includes('jwt') && !JSON.stringify(saved).includes('private &'));
});

test('Geneanet rejects failed login, missing CSRF, account mismatch, and password-preserving redirects without saving', async () => {
  for (const mode of ['csrf','rejected','mismatch','redirect']) {
    let posts = 0, saves = 0;
    const transport: Transport = async (url, init) => {
      if (url === `${WEB}/connexion/`) return response(mode === 'csrf' ? loginPage.replace('name="_csrf_token"', 'name="wrong"') : loginPage);
      if (init.method === 'POST') {posts++; return mode === 'redirect' ? response('', 307, {location: '/'}) : response(mode === 'rejected' ? loginPage : homepage);}
      if (url === `${WEB}/`) return response(homepage);
      return response('{"username":"wrong-account"}');
    };
    await assert.rejects(authenticateGeneanet(new GeneanetHttp(undefined, transport), {username: 'test', password: 'not-printed'}, async () => {saves++;}));
    assert.equal(saves, 0); assert.equal(posts, mode === 'csrf' ? 0 : 1);
  }
});

test('Geneanet origins, paths, redirects, and credential destinations fail closed', async () => {
  for (const url of ['https://geneanet.org.evil.invalid/', 'http://en.geneanet.org/', 'https://en.geneanet.org:444/', 'https://user:pass@en.geneanet.org/', 'https://en.geneanet.org/#token']) assert.throws(() => checkUrl(url));
  for (const path of ['/profile/delete','/connexion/logout','/media/delete/','/my-tree/settings/api/maintenance/tree/delete']) assert.throws(() => researchUrl(`${WEB}${path}`));
  for (const query of ['m=MOD_IND','type=edit','p=name&n=name&delete=1']) assert.throws(() => researchUrl(`${TREE}/fixture?${query}`));
  let count = 0;
  const http = new GeneanetHttp(session.cookies, async (_url, init) => {count++; assert.ok(!init.headers.Authorization); return response('', 302, {location: 'https://foreign.invalid/'});});
  await assert.rejects(http.text(WEB), /outside/); assert.equal(count, 1);
  await assert.rejects(http.text(WEB, {token: 'not-sent'}), /bearer tokens/); assert.equal(count, 1);
  await assert.rejects(http.text(`${WEB}/media/delete/`, {body: new URLSearchParams({id: '1'})}), /sign-in form/); assert.equal(count, 1);
  const staticHttp = new GeneanetHttp(session.cookies, async (_url, init) => {assert.equal(init.headers.Cookie, undefined); assert.equal(init.headers.Authorization, undefined); return response('ok');});
  await staticHttp.text('https://static.geneanet.org/example');
});

test('Geneanet challenges, error bodies, and malformed JSON never expose response secrets', async () => {
  for (const [status, body, code] of [[403,'<title>Just a moment...</title>secret-body','verification-required'],[429,'secret-body','http'],[200,'secret-body','api-changed']] as const) {
    const http = new GeneanetHttp(undefined, async () => response(body, status));
    await assert.rejects(http.json(WEB), e => e instanceof GeneanetError && e.code === code && !e.message.includes('secret-body'));
  }
  const account = await readAccount(new GeneanetHttp(undefined, async url => url === `${WEB}/` ? response(homepage) : response('{"username":"fixture-user","jwt_token":"do-not-print","profile":{"email":"private"}}')));
  assert.deepEqual(account, {username: 'fixture-user'});
  await assert.rejects(readAccount(new GeneanetHttp(undefined, async () => response(homepage)), 'different-user'), /expected signed-in/);
});

test('Geneanet search parses exact IDs, pagination, provenance, access labels and empty results', () => {
  const html = `<span data-nb-results="9007199254740993"></span><a class="ligne-resultat non-privilege" data-id-es="fixture_9007199254740993" data-type-fonds="registres" href="/archival-registers/view/123/2"><div class="vignette"><img src="/public/photo.jpg"></div><div class="info-resultat"><div class="content-individu"><p class="fake-a">DOE Jane</p><em>Test register</em></div><div class="content-periode"><p>Birth 1800</p></div><p class="ligne-lieu"><span title="Birth"></span><span class="title-lieu">Example Town</span></p></div></a><a href="?page=2">Next »</a><input id="filter" data-url="?restrict_images=1"><label for="filter">Pictures</label>`;
  const page = parseSearch(html, `${WEB}/fonds/individus/?page=1`);
  assert.equal(page.total, '9007199254740993'); assert.equal(page.results[0].id, 'fixture_9007199254740993');
  assert.equal(page.results[0].source, 'Test register'); assert.deepEqual(page.results[0].accessMarkers, ['non-privilege']);
  assert.deepEqual(page.results[0].places, [{event: 'Birth', place: 'Example Town'}]);
  assert.ok(page.next?.endsWith('?page=2')); assert.equal(page.filters[0].label, 'Pictures');
  assert.deepEqual(parseSearch('<span data-nb-results="0">0 results</span>', WEB).results, []);
  assert.equal(parseSearch('<div id="no-results-container">No individuals were found matching your criteria.</div>', WEB).total, '0');
  assert.throws(() => parseSearch('<html>Access denied</html>', WEB), /format changed/);
  assert.throws(() => parseSearch('<span data-nb-results="1"></span>', WEB), /format changed/);
});

test('Geneanet search parameters retain spelling, accents, year filters and explicit page sizes', () => {
  const url = searchUrl('search', {nom: 'Dœ & Smith', prenom: 'Jane', page: 2, size: 20, 'categories_1[archives]': 'archives', 'place__0__': 'Paris', periode_mode: 'birth', from: 1800, to: 1850});
  assert.equal(url.searchParams.get('nom'), 'Dœ & Smith'); assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('categories_1[archives]'), 'archives');
  for (const input of [{nom: 'Test', size: 5}, {nom: 'Test', page: 0}, {nom: 'Test', from: 1900, to: 1800}, {nom: 'Test', redirect: 'bad'}, {nom: 'Test', periode_mode: 'marriage'}, {}]) assert.throws(() => searchUrl('search', input));
  assert.equal(searchUrl('photos', {nom: 'Test'}).pathname, '/old-photos/search/');
  assert.equal(searchUrl('library', {q: 'Test'}).pathname, '/fonds/bibliotheque/');
});

test('Geneanet JSON page literals are parsed without evaluation; profile media uses distinct IDs', () => {
  const html = keys({gntGeneweb: {basename: 'fixture', person: {index: 4, firstname: 'Jane', lastname: 'Doe'}, media: [{doc_id: 20, doc_part_id: 21}]}, user: {jwt_token: 'secret'}}) + keys({gntGeneweb: {indexZ: 1}});
  assert.equal(pageKeys(html).gntGeneweb.basename, 'fixture');
  const page = parsePage(`<html><title>Jane Doe</title><body><div id="content"><h1>Jane Doe</h1><a href="?p=Parent&n=Doe">Parent</a></div>${html}</body></html>`, `${TREE}/fixture?p=Jane&n=Doe`);
  assert.equal(page.person?.index, '4'); assert.deepEqual(page.media, [{doc_id: 20, doc_part_id: 21}]);
  assert.ok(!JSON.stringify(page).includes('secret'));
  assert.deepEqual(pageKeys('<script>throw new Error("must never execute")</script>'), {});
});

test('Geneanet register and PDF viewer metadata reflect page scope and download permission', () => {
  const register = parsePage('<div id="viewer-map" data-doc-id="10" data-max-page="20" data-api-url="/registres/api/images/10"></div><button class="svg-icon-viewer-download" data-url="/archival-registers/download/10/3"></button>', `${WEB}/archival-registers/view/10/3`);
  assert.equal(register.viewer?.page, '3'); assert.equal(register.viewer?.pages, '20');
  const pdf = '<div id="viewer-meta" data-livre-id="4" data-page="7" data-livre-nb-pages="30" data-single-page-mode="true" data-telechargeable="1" data-pdf-url="/library/viewer/pdf/4?page=7"></div>';
  assert.equal(parsePage(pdf, `${WEB}/library/viewer/4?page=7`).viewer?.singlePage, true);
  assert.equal(parsePage(pdf.replace('data-telechargeable="1"','data-telechargeable="0"'), WEB).viewer?.downloadUrl, undefined);
});

test('Geneanet downloads resolve view membership and decode the returned original image', async () => {
  const png = await sharp({create: {width: 3, height: 2, channels: 3, background: 'white'}}).png().toBuffer();
  let binaryRequests = 0;
  const http = new GeneanetHttp(undefined, async url => {
    if (url.includes('/media/api/')) return response('{"id":10,"title":"Test portrait","username":"fixture","views":[{"id":11,"page":1}]}');
    binaryRequests++; assert.equal(url, `${WEB}/media/download/10/11`);
    return new Response(png, {headers: {'content-type': 'image/png'}});
  });
  const client = new GeneanetClient(http), image = await downloadMedia(client, '10', '11');
  assert.equal(image.metadata.width, 3); assert.equal(image.metadata.height, 2); assert.match(String(image.metadata.sha256), /^[a-f0-9]{64}$/);
  await assert.rejects(downloadMedia(client, '10', '99'), /does not belong/); assert.equal(binaryRequests, 1);
  const path = join(CREDENTIAL_DIR, 'geneanet-download.png');
  await saveDownload(path, image); assert.deepEqual(await readFile(path), png);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
  await assert.rejects(saveDownload(path, image), /already exists/); assert.deepEqual(await readFile(path), png);
  await rm(path); await assert.rejects(saveDownload(path, image), /already exists/);
  await assert.rejects(stat(path)); // Existing sidecar rolls back only our new image.
});

test('Geneanet denied, HTML, truncated PDF and corrupt image downloads create no artifact', async () => {
  for (const [type, body] of [['text/html','Login'],['application/pdf','%PDF-1.7 truncated'],['image/jpeg','bad-image']]) {
    const client = new GeneanetClient(new GeneanetHttp(undefined, async url => url.includes('/media/api/') ? response('{"id":1,"views":[{"id":2,"page":1}]}') : response(body, 200, {'content-type': type})));
    await assert.rejects(downloadMedia(client, '1', '2'));
  }
  const client = new GeneanetClient(new GeneanetHttp(undefined, async () => response('<div id="viewer-meta" data-livre-id="4" data-page="7" data-livre-nb-pages="30" data-single-page-mode="true" data-telechargeable="0"></div>')));
  await assert.rejects(downloadRecord(client, `${WEB}/library/viewer/4?page=7`), /no permitted/);
});
