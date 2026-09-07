import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { captureAuthentication, captureOptions, type CaptureRecipe } from '../src/shared/browser-capture.js';
import { myHeritageCaptureRecipe } from '../src/myheritage/capture.js';
import { findmypastCaptureRecipe } from '../src/findmypast/capture.js';

function fixture() {
  const events = new EventEmitter();
  let path = '', closes = 0, imported = 0;
  const pages = [{goto: async () => {}} as unknown as Page];
  const context = Object.assign(events, {pages: () => pages, close: async () => {
    closes++; await writeFile(path, JSON.stringify({log: {version: '1.2', entries: []}})); events.emit('close');
  }}) as unknown as BrowserContext;
  const recipe: CaptureRecipe<{ok: true}> = {provider: 'findmypast', startUrl: 'https://www.findmypast.com/family-tree',
    instructions: 'Fixture login.', urlFilter: /fixture/, advance: async () => true,
    importHar: async file => {imported++; assert.equal(closes, 1); JSON.parse(await readFile(file, 'utf8')); return {ok: true};},
  };
  return {recipe, context, pages, closes: () => closes, imported: () => imported, path: () => path,
    launch: async (_profile: string, harPath: string) => {path = harPath; return context;}};
}

test('capture flushes before import, keeps private permissions and does not leak browser errors', async () => {
  const f = fixture(), messages: string[] = [];
  let attempts = 0;
  f.recipe.advance = async () => {if (attempts++ === 0) throw new Error('cookie=synthetic-secret'); return true;};
  const result = await captureAuthentication(f.recipe, {}, {...f, progress: m => messages.push(m), pollMs: 1});
  assert.deepEqual(result.session, {ok: true});
  assert.equal(f.closes(), 1); assert.equal(f.imported(), 1);
  if (process.platform !== 'win32') {
    assert.equal((await stat(result.harPath)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(result.harPath))).mode & 0o777, 0o700);
    assert.equal((await stat(dirname(dirname(result.harPath)))).mode & 0o777, 0o700);
  }
  assert(!messages.join('\n').includes('synthetic-secret'));
});

test('timeout, closed window, and cancellation flush HAR without importing an unverified session', async () => {
  for (const mode of ['timeout', 'closed', 'abort']) {
    const f = fixture(), controller = new AbortController();
    f.recipe.advance = async () => {
      if (mode === 'closed') f.context.emit('close');
      if (mode === 'abort') controller.abort();
      return false;
    };
    await assert.rejects(captureAuthentication(f.recipe, {timeoutMs: 20}, {...f, progress: () => {}, pollMs: 1, signal: controller.signal}), /HAR saved privately/);
    assert.equal(f.imported(), 0); assert.equal(f.closes(), 1);
    assert.ok(JSON.parse(await readFile(f.path(), 'utf8')).log);
  }
});

test('a failed final validation retains the HAR and suppresses sensitive exception text', async () => {
  const f = fixture();
  f.recipe.importHar = async () => {throw new Error('Authorization: secret');};
  await assert.rejects(captureAuthentication(f.recipe, {}, {...f, progress: () => {}}), error => {
    assert.match(String(error), /did not pass account validation/);
    assert(!String(error).includes('Authorization')); return true;
  });
  assert.ok((await stat(f.path())).isFile());
});

test('capture covers replacement tabs and cleans up signal listeners on failed launches', async () => {
  const f = fixture(), second = {} as Page;
  f.pages.push(second);
  f.recipe.advance = async p => p === second;
  await captureAuthentication(f.recipe, {}, {...f, progress: () => {}});
  const before = process.listenerCount('SIGINT');
  await assert.rejects(captureAuthentication(f.recipe, {}, {launch: async () => {throw new Error('token=secret');}, progress: () => {}}), /Cannot launch/);
  assert.equal(process.listenerCount('SIGINT'), before);
});

test('HAR recording is limited to exact provider authentication routes', () => {
  const mh = myHeritageCaptureRecipe().urlFilter, fmp = findmypastCaptureRecipe().urlFilter;
  for (const path of ['/FP/family-tree.php', '/family-trees/fixture/SITE?tree=1', '/web-family-graphql/individual_data_with_hints_query/']) assert(mh.test(`https://www.myheritage.com${path}`));
  for (const url of ['https://www.myheritage.com.evil.example/family-trees/a', 'https://www.myheritage.com/login', 'https://www.myheritage.com/FP/API/Mobile/login.php', 'https://user:secret@www.myheritage.com/family-trees/a', 'http://www.myheritage.com/family-trees/a']) assert(!mh.test(url));
  for (const region of ['com', 'co.uk']) assert(fmp.test(`https://www.findmypast.${region}/titan/marshal/graphql`));
  for (const url of ['https://www.findmypast.com.evil.example/titan/marshal/graphql', 'https://auth.findmypast.com/oauth/token', 'https://www.findmypast.com/titan/marshal/graphql/evil', 'https://user:secret@www.findmypast.com/titan/marshal/graphql']) assert(!fmp.test(url));
  assert.throws(() => findmypastCaptureRecipe('evil.example'), /region/);
  assert.throws(() => myHeritageCaptureRecipe('https://evil.example/family-trees/fixture'), /family-tree/);
  assert.throws(() => myHeritageCaptureRecipe('https://www.myheritage.com/login'), /family-tree/);
  assert.equal(myHeritageCaptureRecipe('https://www.myheritage.com/family-trees/fixture/SITE').startUrl, 'https://www.myheritage.com/family-trees/fixture/SITE');
  assert.throws(() => captureOptions('firefox'), /browser-channel/);
  for (const value of ['0', 'NaN', '-1', '1.5', '3601', 'Infinity']) assert.throws(() => captureOptions(undefined, value), /capture-timeout/);
  assert.deepEqual(captureOptions(), {channel: undefined, timeoutMs: 600_000});
});
