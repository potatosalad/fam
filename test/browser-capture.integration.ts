import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { chromium, type BrowserContext } from 'playwright';
import { Impit } from 'impit';
import { captureAuthentication } from '../src/shared/browser-capture.js';
import { myHeritageCaptureRecipe } from '../src/myheritage/capture.js';
import { findmypastCaptureRecipe } from '../src/findmypast/capture.js';
import { sessionFromHar } from '../src/myheritage/auth.js';
import { browserSessionFromHar } from '../src/findmypast/har.js';
import { readPrivateJson, writePrivateJson } from '../src/shared/storage.js';

const treeHtml = `<script>${Object.entries({isLoggedIn: true, currentUserAccountID: 'ACCOUNT', siteID: 'SITE', familyTreeID: 1,
  rootIndividualID: 10, homeIndividualID: 10, familyTreeTitle: 'Fixture tree', familyTreeSize: 2, mhXsrfToken: 'fixture-csrf',
  mediaUploaderData: {fgToken: 'fixture+token='}, displayLang: 'EN', dataLang: 'EN', clientVersion: 2, familyTreeRevision: 4,
  maxProximityLevel: 5, maxIndividualsAfterPrune: 100, treeSelectionMenuEntries: [{id: 1, name: 'Fixture', count: 2}],
}).map(([k,v]) => `var ${k} = ${JSON.stringify(v)};`).join('\n')}</script><p>Synthetic tree</p>`;

// These tests run a real browser, but every website and importer request is synthetic.
// Unexpected browser requests are aborted and unexpected direct requests fail locally.
for (const provider of ['myheritage', 'myheritage-no-links', 'myheritage-empty-tree', 'findmypast', 'findmypast-uk'] as const) {
  test(`real browser captures sensitive ${provider} HAR after interactive login and imports it`, {timeout: 30_000}, async () => {
    const mh = provider.startsWith('myheritage');
    const html = provider === 'myheritage-empty-tree' ? treeHtml.replace('var homeIndividualID = 10;', 'var homeIndividualID = 0;').replace('var rootIndividualID = 10;', 'var rootIndividualID = 0;') : treeHtml;
    const recipe = mh ? myHeritageCaptureRecipe() : findmypastCaptureRecipe(provider.endsWith('-uk') ? 'co.uk' : 'com');
    const origin = new URL(recipe.startUrl).origin;
    const cookieName = mh ? 'PHPSESSID' : 'FixtureSession';
    let context: BrowserContext | undefined, user: Promise<void> | undefined, apiCalls = 0, imported = 0, finalPage = '';
    const advance = recipe.advance;
    recipe.advance = async (page, report) => {const ready = await advance(page, report); if (ready) finalPage = page.url(); return ready;};
    const originalFetch = Impit.prototype.fetch;
    Impit.prototype.fetch = async function (value, init) {
      const url = new URL(String(value));
      assert.equal(url.origin, origin); imported++;
      assert.match(new Headers(init?.headers as HeadersInit).get('cookie') ?? '', new RegExp(`${cookieName}=fixture-http-only`));
      if (mh && (url.pathname.startsWith('/family-trees/') || url.pathname === '/FP/family-tree.php')) return new Response(html) as never;
      if (mh && url.pathname.endsWith('/get-current-user-permissions.php')) return Response.json({isMember: true, associatedIndividualId: 10}) as never;
      assert(!mh); assert.equal(url.pathname, '/titan/marshal/graphql');
      return Response.json({data: {currentUserProfile: {id: 'fixture-user'}}}) as never;
    };
    try {
      const result = await captureAuthentication<any>(recipe, {timeoutMs: 15_000}, {progress: () => {}, pollMs: 50,
        launch: async (profile, harPath) => {
          context = await chromium.launchPersistentContext(profile, {channel: process.env.FAM_TEST_BROWSER_CHANNEL, headless: true,
            recordHar: {path: harPath, mode: 'full', content: 'embed', urlFilter: recipe.urlFilter}});
          await context.clearCookies();
          await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin !== origin) return route.abort();
            const cookies = await context!.cookies(origin);
            const signedIn = cookies.some(c => c.name === cookieName);
            if (url.pathname === '/login' && request.method() === 'POST') {
              assert.equal(new URLSearchParams(request.postData()!).get('password'), 'synthetic-password');
              await context!.addCookies([{name: cookieName, value: 'fixture-http-only', url: origin, httpOnly: true, secure: true}]);
              return route.fulfill({contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(mh ? '/research' : '/family-tree')})</script>`});
            }
            if (url.pathname === '/login') return route.fulfill({contentType: 'text/html', body: '<form method="post"><input name="password" type="password"><button>Sign in</button></form>'});
            if (url.pathname === '/titan/marshal/graphql' || url.pathname.endsWith('/get-current-user-permissions.php')) {
              apiCalls++;
              if (!signedIn) return route.fulfill({json: {data: {currentUserProfile: null}}});
              assert.match((await request.allHeaders()).cookie, /fixture-http-only/);
              if (mh) {
                assert.equal(request.method(), 'GET');
                assert.equal(url.searchParams.get('csrf_token'), 'fixture-csrf');
                return route.fulfill({json: {isMember: true, associatedIndividualId: 0}});
              }
              return route.fulfill({json: {data: {currentUserProfile: {id: 'fixture-user'}}}});
            }
            if (!signedIn) return route.fulfill({contentType: 'text/html', body: '<script>location.replace("/login")</script>'});
            if (mh && url.pathname === '/research') return route.fulfill({contentType: 'text/html', body: provider === 'myheritage-no-links' ? '<p>Research results; no login marker, sign-out link, or tree link</p>' : '<p>Research results without tree variables</p><a href="https://evil.example/family-trees/fixture">Untrusted tree</a><a href="/family-trees/fixture/SITE">Family tree</a>'});
            return route.fulfill({contentType: 'text/html', body: mh ? html : '<p>Signed in</p>'});
          });
          const page = context.pages()[0];
          user = (async () => {
            await page.waitForURL(`${origin}/login`);
            // Login remains interactive: the capture code itself never fills a password.
            await page.locator('input').fill('synthetic-password');
            await page.getByRole('button', {name: 'Sign in'}).click();
          })();
          // Attach a handler immediately so test failures cannot become unhandled rejections.
          void user.catch(() => {});
          return context;
        },
      });
      await user;
      if (mh) assert.equal(finalPage, `${origin}/research`, 'capture must not navigate the user away from research');
      assert.equal(result.session.mode, 'browser'); assert(apiCalls > 0); assert(imported > 0);
      const text = await readFile(result.harPath, 'utf8'), har = JSON.parse(text);
      assert.equal(har.log.version, '1.2'); assert(text.includes('fixture-http-only'));
      assert(!text.includes('synthetic-password'));
      for (const entry of har.log.entries) assert(recipe.urlFilter.test(entry.request.url));
      if (mh) {const session = sessionFromHar(text); assert.equal(session.accessToken, 'fixture+token='); assert(session.browser);}
      else assert.equal(browserSessionFromHar(text).apiBase, `${origin}/titan/marshal`);
      assert.deepEqual(await readPrivateJson(`${recipe.provider}/session.json`), result.session);
      assert.equal(await readPrivateJson(`${recipe.provider}/login.json`), undefined);
      if (process.platform !== 'win32') assert.equal((await stat(result.harPath)).mode & 0o777, 0o600);
    } finally {Impit.prototype.fetch = originalFetch; await context?.close(); await user?.catch(() => {});}
  });
}

test('a browser HTTP 200 with no signed-in identity cannot replace a session', {timeout: 15_000}, async () => {
  const recipe = findmypastCaptureRecipe();
  const previous = {fixture: 'previous session'};
  await writePrivateJson('findmypast/session.json', previous);
  let context: BrowserContext | undefined, imported = false;
  recipe.importHar = async () => {imported = true; throw new Error('Must not import');};
  try {
    await assert.rejects(captureAuthentication(recipe, {timeoutMs: 1000}, {progress: () => {}, pollMs: 50,
      launch: async (profile, harPath) => {
        context = await chromium.launchPersistentContext(profile, {channel: process.env.FAM_TEST_BROWSER_CHANNEL, headless: true,
          recordHar: {path: harPath, mode: 'full', content: 'embed', urlFilter: recipe.urlFilter}});
        await context.route('**/*', route => route.request().url().endsWith('/graphql')
          ? route.fulfill({json: {data: {currentUserProfile: null}}})
          : route.fulfill({contentType: 'text/html', body: '<p>Verification required</p>'}));
        return context;
      },
    }), /Capture timed out.*HAR saved privately/);
    assert.equal(imported, false);
    assert.deepEqual(await readPrivateJson('findmypast/session.json'), previous);
  } finally {await context?.close();}
});
