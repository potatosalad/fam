import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {browserFetchOptions, browserFetchResult, extractBrowserContent, renderBrowserFetch} from '../src/shared/browser-fetch.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {browserResponseHeaders} from '../src/shared/browser-response.js';
import {BrowserTab, Camofox} from '../src/shared/browser-runtime.js';

test('generic fetch parses headers, scoped cookies, binary bodies and meaningful modes', async () => {
  const headersFile=join(CREDENTIAL_DIR,'headers.json'),cookiesFile=join(CREDENTIAL_DIR,'cookies.json'),bodyFile=join(CREDENTIAL_DIR,'body.bin');
  await writeFile(headersFile,JSON.stringify({'X-Test':'first',Authorization:'Bearer synthetic','Cookie':'fromheader=one'}));
  await writeFile(cookiesFile,JSON.stringify({cookies:[{name:'session',value:'synthetic',domain:'.example.test',path:'/private',httpOnly:true,secure:true,expires:2000000000}]}));
  await writeFile(bodyFile,Buffer.from([0,255,128,42]));
  const options=await browserFetchOptions({url:'https://example.test/a#fragment','headers-file':headersFile,'cookies-file':cookiesFile,'body-file':bodyFile,
    header:['X-Test: second','Content-Type: application/octet-stream'],cookie:['one=two; token=with=equals'],'user-agent':'test-agent',referer:'https://example.test/'});
  assert.equal(options.mode,'request');assert.equal(options.method,'POST');assert.equal(options.context,'web');
  assert.equal(options.headers['x-test'],'second');assert.equal(options.headers.authorization,'Bearer synthetic');assert.equal(options.headers.cookie,undefined);
  assert.equal(options.headers['user-agent'],'test-agent');assert.equal(options.cookies[0].path,'/private');
  assert.deepEqual(options.cookies.slice(1).map(c=>[c.name,c.value,c.url]),[['one','two','https://example.test/'],['token','with=equals','https://example.test/'],['fromheader','one','https://example.test/']]);
  assert.deepEqual(Buffer.from(options.bodyBase64!,'base64'),Buffer.from([0,255,128,42]));
  assert.equal((await browserFetchOptions({url:'https://example.test',format:'raw'})).mode,'request');
  assert.equal((await browserFetchOptions({url:'https://example.test',format:'html'})).mode,'navigate');
  assert.equal((await browserFetchOptions({url:'https://example.test',body:''})).method,'POST');
});

test('invalid URLs, browser-controlled headers and incompatible modes fail before browser startup', async () => {
  for (const values of [{url:'file:///private'}, {url:'https://user:password@example.test'}, {header:'no-colon'}, {header:'Host: wrong.test'},
    {header:'Sec-Fetch-Site: none'}, {header:'Origin: https://other.test'}, {header:'Content-Length: 7'}, {body:'text',method:'GET'}, {method:'TRACE'}, {mode:'navigate',method:'POST'},
    {mode:'request','wait-for':'article'}, {body:'text','body-file':'unused'}, {mode:'navigate',redirects:'manual'}, {cookie:'invalid'}]) {
    await assert.rejects(browserFetchOptions({url:'https://example.test',...values}),{code:'INVALID_ARGUMENT'});
  }
  assert.throws(()=>parseInvocation(['cli.browser','fetch','--url','https://example.test','--timeout','0']),/valid integer/);
  assert.throws(()=>parseInvocation(['cli.browser','fetch','--url','https://example.test','--format','raw','--json']),/conflict/);
  const parsed=parseInvocation(['cli.browser','fetch','--url','https://example.test','--header','X-One: 1','--header','X-Two: 2','--json']);
  assert.deepEqual(parsed.values.header,['X-One: 1','X-Two: 2']);
});

test('content extraction preserves prose, links, tables and exact JSON metadata', () => {
  const html='<!doctype html><title>Example</title><base href="/base/"><meta name="description" content="A page"><script type="application/ld+json">{"id":9223372036854775807}</script><body><nav>Menu</nav><article><h1>Heading</h1><p>A <strong>bold</strong> paragraph <a href="record">record</a>.</p><ul><li>One</li><li>Two</li></ul><table><tr><th>Name</th><th>Year</th></tr><tr><td>Example</td><td>1900</td></tr></table><p hidden>Hidden</p><script>secret()</script></article></body>';
  const content=extractBrowserContent(html,'https://example.test/page');
  assert.equal(content.title,'Example');assert.equal(content.metadata.description,'A page');
  assert.equal((content.jsonLd[0] as any).id,9223372036854775807n);
  assert.match(content.markdown,/# Heading/);assert.match(content.markdown,/\*\*bold\*\*/);assert.match(content.markdown,/\| Name \| Year \|/);
  assert.match(content.markdown,/https:\/\/example.test\/base\/record/);assert.doesNotMatch(content.markdown,/Hidden|secret/);
  assert.equal(extractBrowserContent(html,'https://example.test','Visible only','<p>Selected</p>').text,'Visible only');
});

test('response conversion preserves raw bytes, HTTP failures, JSON integers and charset', async () => {
  const options=await browserFetchOptions({url:'https://example.test',format:'raw'});
  const bytes=Buffer.from([0,255,128,42]);
  const wire={url:options.url,status:404,statusText:'Not Found',headers:[['Content-Type','application/octet-stream']] as [string,string][],bodyBase64:bytes.toString('base64')};
  const raw=browserFetchResult(options,wire);
  assert.equal(raw.status,404);assert.deepEqual(renderBrowserFetch(raw,'raw'),bytes);
  assert.equal(browserFetchResult({...options,format:'json'},wire).bodyBase64,wire.bodyBase64);
  assert.throws(()=>browserFetchResult({...options,format:'text'},wire),/binary/);
  const json=browserFetchResult({...options,format:'json'},{...wire,headers:[['content-type','application/json']],bodyBase64:Buffer.from('{"id":9223372036854775807}').toString('base64')});
  assert.equal((json.json as any).id,9223372036854775807n);
  const latin=browserFetchResult({...options,format:'text'},{...wire,headers:[['content-type','text/plain; charset=iso-8859-1']],bodyBase64:Buffer.from([99,97,102,233]).toString('base64')});
  assert.equal(latin.text,'café');assert.throws(()=>renderBrowserFetch(latin,'html'),/not HTML/);
});

test('browser response normalization preserves duplicate values and cookie boundaries', async () => {
  const headers: [string, string][] = [['Content-Type', 'text/plain'], ['Server-Timing', 'first;dur=1\nsecond;dur=2'],
    ['Set-Cookie', 'one=synthetic; Expires=Wed, 21 Oct 2030 07:28:00 GMT\r\ntwo=synthetic; Path=/'], ['Set-Cookie', 'three=synthetic; Path=/']];
  const normalized = browserResponseHeaders(headers);
  const parsed = new Headers(normalized);
  assert.equal(parsed.get('server-timing'), 'first;dur=1, second;dur=2');
  assert.deepEqual(parsed.getSetCookie(), ['one=synthetic; Expires=Wed, 21 Oct 2030 07:28:00 GMT', 'two=synthetic; Path=/', 'three=synthetic; Path=/']);
  const options = await browserFetchOptions({url: 'https://example.test', format: 'text'});
  const result = browserFetchResult(options, {url: options.url, status: 200, statusText: 'OK', headers, bodyBase64: Buffer.from('Readable page').toString('base64')});
  assert.equal(result.text, 'Readable page');
  assert.deepEqual(result.headers, normalized);
  assert.equal(headers[1][1], 'first;dur=1\nsecond;dur=2');
  assert.deepEqual(browserResponseHeaders({'Server-Timing': 'one\ntwo'}), [['server-timing', 'one'], ['server-timing', 'two']]);
  for (const bad of [null, {'x-test': 42}, [['Invalid Name', 'value']], [['x-test', 'mid\0value']], [['x-test', 'mid\rvalue']], [['x-test', 42]]])
    assert.throws(() => browserResponseHeaders(bad), {code: 'BROWSER_RESPONSE_HEADERS'});
  await assert.rejects(browserFetchOptions({url: 'https://example.test', header: 'X-Test: one\ntwo'}), {code: 'INVALID_ARGUMENT'});
});

test('browser API normalizes navigation and request headers before provider consumption', async t => {
  const wire = {status: 200, headers: [['server-timing', 'one\ntwo'], ['set-cookie', 'a=one\nb=two']], bodyBase64: Buffer.from('content').toString('base64')};
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(wire)));
  const browser = new Camofox({version: 1, mode: 'remote', remote: {url: 'https://browser.example.test', vncUrl: 'https://browser.example.test/viewer'}, timeout: 1, transport: 'auto', session: 'synthetic', open: false});
  for (const path of ['/fam/page-result', '/fam/fetch-request', '/fam/request']) {
    const data = await browser.api(path, {});
    assert.equal(new Headers(data.headers).get('server-timing'), 'one, two');
    assert.deepEqual(new Headers(data.headers).getSetCookie(), ['a=one', 'b=two']);
  }
  const response = await new BrowserTab(browser, 'familysearch', 'synthetic').request('https://www.familysearch.org/platform/users/current');
  assert.equal(await response.text(), 'content');
  assert.deepEqual(response.headers.getSetCookie(), ['a=one', 'b=two']);
});
