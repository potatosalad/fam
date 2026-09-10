import test from 'node:test';
import assert from 'node:assert/strict';
import {CHALLENGE_PREFIX_LIMIT, isChallenge, isChallengeResponse} from '../src/shared/browser-challenge.js';

const interruption = '<!doctype html><html><title>Pardon Our Interruption</title><body>Something about your browser made us think you were a bot. Please enable JavaScript and cookies.</body></html>';
const cloudflare = '<html><title>Attention Required! | Cloudflare</title><body>Sorry, you have been blocked.</body></html>';

test('shared detection recognizes vendor interstitials across status codes and misleading MIME types', async () => {
  for (const html of [interruption, cloudflare, '<html><title>Request Rejected</title><body>Imperva security service rejected this request.</body></html>', '<html><title>Custom site title</title><body>Access denied by Incapsula.</body></html>']) {
    for (const status of [200, 403, 429, 503]) {
      for (const contentType of ['text/html', 'application/octet-stream', 'application/json', 'image/jpeg']) {
        const response = new Response(html, {status, headers:{'content-type':contentType}});
        assert.equal(await isChallengeResponse(response), true, `${status} ${contentType}`);
        assert.equal(await response.text(), html); // Inspection preserves the caller's body.
      }
    }
  }
});

test('normal CDN pages, account restrictions, rate limits and JSON vendor mentions are not challenges', async () => {
  for (const [status, body] of [[200,'<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script><h1>Normal page</h1></html>'],
    [200,'<html><script src="/_Incapsula_Resource?normal-integration=1"></script><h1>Welcome</h1></html>'],
    [403,'{"message":"subscription required","vendor":"cloudflare"}'],
    [429,'<html><title>Too many requests</title><body>Try again later.</body></html>'],
    [403,'<html><title>Access denied</title><body>Your subscription does not include this collection.</body></html>']] as const) {
    const response = new Response(body, {status, headers:{server:'cloudflare','cf-ray':'synthetic','content-type':'text/html'}});
    assert.equal(await isChallengeResponse(response), false);
    assert.equal(await response.text(), body);
  }
  assert.equal(isChallenge(new Headers(), '<title>Pardon Our Interruption</title><p>Scheduled maintenance</p>'), false);
});

test('inspection handles chunk boundaries, missing headers, large bodies and binary data without consuming them', async () => {
  const chunks = [interruption.slice(0,17), interruption.slice(17,80), interruption.slice(80)];
  const stream = new ReadableStream<Uint8Array>({start(controller) {for (const part of chunks) controller.enqueue(Buffer.from(part));controller.close();}});
  const response = new Response(stream);
  assert.equal(await isChallengeResponse(response), true);
  assert.equal(await response.text(), interruption);
  const large = ' '.repeat(CHALLENGE_PREFIX_LIMIT) + cloudflare;
  const bounded = new Response(large);
  assert.equal(await isChallengeResponse(bounded), false);
  assert.equal(await bounded.text(), large);
  const bytes = Buffer.alloc(4096, 255);
  const binary = new Response(bytes);
  assert.equal(await isChallengeResponse(binary), false);
  assert.deepEqual(Buffer.from(await binary.arrayBuffer()), bytes);
});

test('signed-in pages with cookie descriptions and scripted error translations are not interstitials', async () => {
  const script = '<script>var translations = {"cookie":"Set by Imperva, a cyber security service.","error":"Access denied", "verification":"Security check"};';
  for (const html of [
    `<html><title>Search historical records</title>${script}</script><body>Search records</body></html>`,
    `<html><title>Search historical records</title><body>Cookies are set by Imperva, a cyber security service.</body></html>`,
    `<html><title>Search historical records</title>${script}`,
  ]) {
    const response = new Response(html, {headers:{'content-type':'text/html'}});
    assert.equal(isChallenge(new Headers(), html), false);
    assert.equal(await isChallengeResponse(response), false);
    assert.equal(await response.text(), html);
  }
  const stream = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(Buffer.from(`<html>${script}`));
    controller.enqueue(Buffer.from('</script><body>Search records</body></html>'));
    controller.close();
  }});
  assert.equal(await isChallengeResponse(new Response(stream)), false);
  assert.equal(isChallenge(new Headers(), '<html><title>Website</title><body>Access denied by Imperva.</body></html>'), true);
});
