import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CyndisListClient} from '../src/cyndislist/client.js';
import {PageCache, type CacheStore} from '../src/cyndislist/cache.js';
import {parsePage} from '../src/cyndislist/parse.js';
import {CyndisListHttp} from '../src/cyndislist/http.js';
import {CATEGORY_INDEX, ORIGIN, siteUrl} from '../src/cyndislist/url.js';
import {search, searchUrl, googleQuery, resolveGoogleLink, checkContinuation, type SearchSnapshot} from '../src/cyndislist/search.js';
import {setBrowserOverrides, BrowserError} from '../src/shared/browser-config.js';
import type {Camofox} from '../src/shared/browser-runtime.js';
import {commandById, providerNames} from '../src/shared/command-registry.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {humanOutput} from '../src/shared/command-output.js';
import {runDoctor} from '../src/shared/doctor.js';
import {resolveContext} from '../src/shared/command-search.js';

const root = `${ORIGIN}/example/`, child = root + 'wills/';
const document = (text: string, url = root) => ({url, text, contentType: 'text/html'});
const html = (body: string, title = 'Example') => `<html><head><title>${title}</title></head><body><div id="contentarea-inner"><h1>${title}</h1>${body}</div></body></html>`;
const index = (date = 'January 1, 2026', count = 12) => html(`<ul><li><a href="/example/">Example</a> (${count})<div class="updateText">Updated ${date}</div><ul><li><a href="/example/sub/">Subcategory shortcut</a></li></ul></li></ul>`, 'Genealogy Categories');
const listing = (id: string, title = 'Archive', nested = '') => `<li><div><p><a href="/openurl/?url=${id}">${title}</a><sup>FREE</sup></p><p class="linkDesc">LDS film # 0094108.<br> A description. <a href="https://archive.example/guide">Guide</a></p></div>${nested}</li>`;
function memory(): CacheStore {
  const files = new Map<string, unknown>();
  return {async read<T>(name: string) {return structuredClone(files.get(name)) as T | undefined;}, async write(name, value) {files.set(name, structuredClone(value));}};
}

test('category metadata, nested headings, opaque IDs, and malformed list placement survive parsing', () => {
  const p = parsePage(document(index(), CATEGORY_INDEX));
  assert.deepEqual(p.categories, [{title: 'Example', url: root, linkCount: 12, updated: '2026-01-01', updatedText: 'Updated January 1, 2026'}]);
  const body = `<ul class="link1">${listing('9007199254740993123', 'Parent', `<ul><li><div><p><span class="nolink">Court books</span></p></div><ul>${listing('0002','1694–1699')}</ul></li></ul>`)}</ul>`;
  const page = parsePage(document(html(body) + `<ul>${listing('0003','Outside the main container')}</ul>`));
  assert.equal(page.resources.length, 2);
  const child = page.resources[0].children[0].children[0];
  assert.equal(child.id, '0002'); assert.equal(child.parentId, '9007199254740993123');
  assert.deepEqual(child.parentTitles, ['Parent','Court books']);
  assert.match(child.description!, /0094108\. A description/);
  assert.equal(child.descriptionLinks[0].url, 'https://archive.example/guide');
});

test('category children, related links, breadcrumbs, and same-category pagination are distinct', () => {
  const p = parsePage(document(html(`<div id="catindex"><ul><li><a href="/example/wills/">Wills</a></li></ul></div>
    <h2>Related Categories</h2><ul><li><a href="/elsewhere/">Elsewhere</a></li></ul>
    <div class="pagination"><a href="?page=1">1</a><a href="?page=2">2</a><a href="/elsewhere/?page=3">Wrong branch</a></div>`, '<a href="/categories/">Categories</a> » Example')));
  assert.equal(p.categories[0].url, child); assert.equal(p.related[0].url, ORIGIN+'/elsewhere/');
  assert.equal(p.breadcrumbs[0].url, CATEGORY_INDEX); assert.equal(p.nextUrl, root+'?page=2'); assert.equal(p.pagination.length, 1);
  const generic = parsePage(document('<html><title>Research advice</title><body><article><h1>Advice</h1><p>Read the original.</p><a href="/example/">Example</a></article></body></html>'));
  assert.equal(generic.kind, 'page'); assert.match(generic.text, /Read the original/); assert.equal(generic.links[0].url, root);
  const file = parsePage({url: root+'guide.pdf', text: 'binary', contentType: 'application/pdf'}); assert.equal(file.kind, 'file');
  assert.throws(() => parsePage(document(html('', 'Page not found'))), /error page/);
});

test('HTTP normalizes aliases, preserves query values, and stops at external redirects', async () => {
  assert.equal(siteUrl('http://cyndislist.com/example/?page=1&letter=A#heading'), root+'?letter=A');
  for (const url of ['https://cyndislist.com.evil.test/','https://evil.test/','https://user:pass@cyndislist.com/','https://cyndislist.com:444/','file:///etc/passwd']) assert.throws(() => siteUrl(url));
  const calls: string[] = [];
  const http = new CyndisListHttp(async (url, init) => {
    calls.push(url); assert.equal(init.redirect, 'manual');
    return new Response(null, {status: 302, headers: {location: calls.length === 1 ? '/openurl/?url=123' : 'https://archive.example/guide'}});
  });
  assert.equal((await http.get(root)).destinationUrl, 'https://archive.example/guide'); assert.equal(calls.length, 2);
  await assert.rejects(new CyndisListHttp(async () => new Response(null,{status:302,headers:{location:root}})).get(root), /loop/);
  await assert.rejects(new CyndisListHttp(async () => new Response('bad',{status:503})).get(root), /HTTP 503/);
  await assert.rejects(new CyndisListHttp(async () => new Response('small',{headers:{'content-length':String(17*1024*1024)}})).get(root), /16 MiB/);
  await assert.rejects(new CyndisListHttp(async () => new Response('<html><title>Just a moment</title><script>_cf_chl_opt={}</script></html>')).get(root), /verification/);
});

test('hourly index checks preserve old unchanged content and invalidate descendants on date or count changes', async () => {
  const storage = memory(); let now = Date.parse('2026-03-01T12:00:00Z'), date = 'January 1, 2026', count = 12;
  const calls: string[] = [];
  const fetchPage = async (url: string) => {calls.push(url); return parsePage(document(url === CATEGORY_INDEX ? index(date,count) : html(listing('1')),url));};
  const cache = () => new PageCache(fetchPage,storage,()=>now);
  assert.equal((await cache().get(child)).cache.status, 'fresh'); assert.equal(calls.length, 2);
  now += 1800000; await cache().get(child); assert.equal(calls.length, 2);
  now += 10*86400000; assert.equal((await cache().get(child)).cache.status, 'cached'); assert.equal(calls.length, 3);
  count++; now+=3600000; assert.equal((await cache().get(child)).cache.status, 'fresh'); assert.equal(calls.length, 5);
  date='February 3, 2026'; now+=3600000; await cache().get(child); assert.equal(calls.length, 7);
  await cache().get(child, true); assert.equal(calls.length, 9);
});

test('same-day content, undated pages, and removed category markers are revalidated', async () => {
  const storage = memory(); let now = Date.parse('2026-01-01T12:00:00Z'), hasMarker = true;
  const calls: string[] = [];
  const fetchPage = async (url: string) => {calls.push(url); return parsePage(document(url === CATEGORY_INDEX ? (hasMarker ? index() : index().replaceAll('/example/','/other/')) : html('Content'),url));};
  const cache = () => new PageCache(fetchPage,storage,()=>now);
  await cache().get(child); now+=25*3600000; await cache().get(child); assert.equal(calls.filter(u=>u===child).length,2);
  now+=25*3600000; await cache().get(child); now+=25*3600000; await cache().get(child); assert.equal(calls.filter(u=>u===child).length,3);
  const info = ORIGIN+'/faqs/'; await cache().get(info); now+=25*3600000; await cache().get(info); assert.equal(calls.filter(u=>u===info).length,2);
  hasMarker=false; now+=3600000; await cache().get(child); assert.equal(calls.filter(u=>u===child).length,4);
});

test('failed refresh returns labeled stale content without replacing its age or saved generation', async () => {
  const storage=memory(); let now=Date.parse('2026-03-01'), fail=false;
  const fetchPage=async(url:string)=>{if(fail)throw new Error('Offline');return parsePage(document(url===CATEGORY_INDEX?index():html('Saved content'),url));};
  const cache=()=>new PageCache(fetchPage,storage,()=>now);
  const first=await cache().get(child); now+=86400000; fail=true;
  const stale=await cache().get(child,true); assert.equal(stale.cache.status,'stale'); assert.equal(stale.cache.fetchedAt,first.cache.fetchedAt);
  assert.equal(stale.cache.ageSeconds,86400); assert.equal(stale.cache.warnings.length,2);
  await assert.rejects(cache().get(root+'unknown/'),/Offline/);
});

test('depth expands children with resources, handles pagination, and never follows related/ancestor links', async () => {
  const seen: string[]=[];
  const pages: Record<string,string> = {
    [CATEGORY_INDEX]:index(), [root]:html(`<div id="catindex"><a href="${child}">Wills</a></div><h2>Related Categories</h2><ul><li><a href="/unrelated/">Elsewhere</a></li></ul>`),
    [child]:html(`<span class="linkcount">2 Links</span><ul>${listing('1')}</ul><div class="pagination"><a href="?page=2">2</a></div>`),
    [child+'?page=2']:html(`<ul>${listing('2')}</ul><div class="pagination"><a href="?page=1">1</a></div>`),
  };
  const client=new CyndisListClient({store:memory(),transport:async url=>{seen.push(url);assert.ok(pages[url],url);return new Response(pages[url]);}});
  const result=await client.read(root,{depth:1,allPages:true}); assert.equal(result.children.length,1);
  assert.deepEqual(result.children[0].resources.map(r=>r.id),['1','2']);assert.equal(result.complete,true);
  assert.deepEqual(seen,[CATEGORY_INDEX,root,child,child+'?page=2']);
  const one=await client.read(child);assert.equal(one.complete,false);assert.equal(one.nextUrl,child+'?page=2');
  const partial=new CyndisListClient({store:memory(),transport:async url=>new Response(pages[url],{status:url.includes('?page=2')?503:200})});
  const p=await partial.read(child,{allPages:true});assert.equal(p.pages.length,1);assert.equal(p.complete,false);assert.match(p.errors[0].message,/503/);
});

test('Google URLs are derived from actual hrefs/redirects; abbreviated displayed paths are never guessed', async () => {
  const urls: string[]=[];
  const tab={request:async(url:string)=>{urls.push(url);return new Response(null,{status:302,headers:{location:child}});}};
  assert.equal(await resolveGoogleLink('https://www.google.com/goto?url=opaque',tab),child);assert.equal(urls.length,1);
  assert.equal(await resolveGoogleLink('https://www.google.com/url?q='+encodeURIComponent(root),tab),root);assert.equal(urls.length,1);
  await assert.rejects(resolveGoogleLink('https://evil.test/goto?url=x',tab),/supported/);
  const next=new URL(searchUrl('probate'));next.searchParams.set('start','10');assert.equal(checkContinuation(next.href,'probate'),next.href);
  assert.throws(()=>checkContinuation(next.href,'births'),/same/);
  assert.throws(()=>checkContinuation('https://evil.test/search?q='+encodeURIComponent(googleQuery('probate')),'probate'),/same/);
});

test('Camofox search follows observed continuation, distinguishes challenges, and closes only its own tab',async()=>{
  setBrowserOverrides({transport:'browser'});
  try {
    const initial=searchUrl('probate'),next=initial+'&start=10';let current=initial,closed=0,challenge=false;
    const browser:any={config:{timeout:0},endpoint:{vncUrl:'https://viewer.example/'},notify:async()=>{},api:async(path:string)=>{assert.equal(path,'/fam/close-tab');closed++;},
      tab:async()=>tab};
    const tab:any={browser,id:'owned',userId:'test',navigate:async(url:string)=>{current=url;},evaluate:async():Promise<SearchSnapshot>=>({url:current,title:'Google',ready:true,challenge,empty:false,
      hits:challenge?[]:[{href:current===initial?root:child,title:'Result',snippet:'A snippet'}],nextUrl:current===initial?next:null})};
    const result=await search('probate',{allPages:true},async()=>browser as Camofox);
    assert.deepEqual(result.results.map(r=>r.url),[root,child]);assert.equal(result.complete,true);assert.equal(closed,1);
    challenge=true; await assert.rejects(search('probate',{},async()=>browser),(e:any)=>e.code==='BROWSER_INTERACTION_REQUIRED');assert.equal(closed,1);
  } finally {setBrowserOverrides({});}
});

test('public CLI discovery has no fake login/catalog, validates flags, renders resources, and supports offline health',async()=>{
  assert.ok(providerNames.includes('cyndislist'));
  assert.equal(commandById.has('cyndislist.session login'),false);assert.equal(commandById.has('cyndislist.api list'),false);
  assert.equal(parseInvocation(['cyndislist.category','get','--url',root,'--depth','1','--all-pages']).values.depth,1);
  assert.throws(()=>parseInvocation(['cyndislist.category','get','--url',root,'--depth=-1']),/integer/);
  assert.throws(()=>parseInvocation(['cyndislist.resource','search','--query','test','--transport','http']),/one of/);
  assert.equal(resolveContext(root).provider,'cyndislist');assert.deepEqual(resolveContext(root).flags,{url:root});
  const report=await runDoctor(['cyndislist'],false);assert.ok(report.providers[0].checks.some(c=>c.code==='public-access'));
  assert.equal(report.providers[0].checks.some(c=>c.id==='session'||c.id==='credentials'),false);
  const client=new CyndisListClient({store:memory(),transport:async url=>new Response(url===CATEGORY_INDEX?index():html(`<ul>${listing('0002')}</ul>`))});
  const p=await client.read(root);const text=humanOutput(commandById.get('cyndislist.page get')!,p,{},100);
  assert.match(text,/ID 0002/);assert.match(text,/LDS film # 0094108/);assert.doesNotMatch(text,/"schemaVersion"/);
});
