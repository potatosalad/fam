import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { Impit } from 'impit';
import { FamilySearchClient } from '../src/client.js';
import { CHURCH_CLIENT_ID } from '../src/auth.js';
import { HttpSession, MOBILE_USER_AGENT } from '../src/http.js';
import { ResearchClient, decodeTranscript, imageArk, dgsNumber, type ImageTranscript } from '../src/research.js';
import { ResearchError, ResearchTransport, researchUrl, retryDelay } from '../src/research-transport.js';
import { operationExample, operationQueryInput, prepareOperation } from '../src/operations.js';

const ark = 'https://www.familysearch.org/ark:/61903/3:1:TEST-IMAGE';
const storage = '/service/records/storage/dascloud/das/v2/TH-TEST-IMAGE';
const asset = 'https://ps-services-us-east-1-914248642252-pipe-storage-das-cloud.s3.amazonaws.com/s3/pipe-storage-das-cloud-prod-dasS3/TH-TEST-IMAGE/dist.jpg?X-Amz-Signature=private-signed-value';
const auth = { Authorization: 'Bearer private-test-token', 'User-Agent': MOBILE_USER_AGENT, 'FS-User-Agent-Chain': MOBILE_USER_AGENT };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function viewer(allow = 'true') {
  return { arkId: '3:1:TEST-IMAGE', dgsNum: '005764700', collections: [{ description: '#1999178', collections: [{ title: 'Test probate' }] }], meta: {
    description: 'image', sourceDescriptions: [{ id: 'image', about: ark, rights: [`http://familysearch.org/accessControl?authorized=true&allowDownload=${allow}`], citations: [{ value: 'Test citation' }] }],
    links: { 'image-node': { href: `https://sg30p0.familysearch.org${storage}` }, 'image-deepzoom': { href: 'https://sg30p0.familysearch.org/service/records/storage/deepzoomcloud/dz/v1/TH-TEST-IMAGE/image.xml' },
      'image-stream-image-dist': { href: `https://sg30p0.familysearch.org${storage}/dist.jpg` }, self: { href: ark, offset: 408, results: 736 } },
  } };
}
function client(delays: number[] = []) {
  const http = new HttpSession();
  return new ResearchClient(new ResearchTransport(action => action(http, auth), async delay => { delays.push(delay); }));
}
async function mocked<T>(fetch: (url: URL, init?: Parameters<Impit['fetch']>[1]) => Promise<Response> | Response, action: () => Promise<T>): Promise<T> {
  const original = Impit.prototype.fetch;
  Impit.prototype.fetch = async function(url, init) { return await fetch(new URL(String(url)), init) as never; };
  try { return await action(); } finally { Impit.prototype.fetch = original; }
}
const descriptor = '<Image xmlns="http://schemas.microsoft.com/deepzoom/2009"><Size Width="24" Height="16" /></Image>';
function imageResponses(url: URL, bytes: Uint8Array, allow = 'true') {
  if (url.pathname === '/search/filmdatainfo/image-data') return json(viewer(allow));
  if (url.pathname.endsWith('/image.xml')) return new Response(descriptor, { headers: { 'Content-Type': 'application/xml' } });
  if (url.host === 'www.familysearch.org' && url.pathname.endsWith('/dist.jpg')) return new Response(null, { status: 302, headers: { Location: asset } });
  return new Response(bytes as BodyInit, { headers: { 'Content-Type': 'image/jpeg' } });
}

test('research URL validation rejects credential destinations and normalizes image ARKs', () => {
  assert.equal(imageArk('https://familysearch.org/ark:/61903/3:1:test-image?view=fullText'), ark);
  assert.equal(dgsNumber('5764700'), '005764700');
  assert.equal(researchUrl(`https://sg30p0.familysearch.org${storage}`).host, 'www.familysearch.org');
  for (const value of ['//evil.test/service/cds/recapi/collections/123', '/service/cds/recapi/../../auth/logout', '/platform/tree/persons/XXXX-XXX', `${storage}?access_token=private`, `https://www.familysearch.org.evil.test${storage}`, `${storage}/%2e%2e/permission`, 'https://sg30p0.familysearch.org/service/records/rms/delete']) assert.throws(() => researchUrl(value));
  for (const value of ['https://evil.test/ark:/61903/3:1:TEST-IMAGE','https://user:pass@familysearch.org/ark:/61903/3:1:TEST-IMAGE','1:1:TEST-RECORD','3:1:../secret']) assert.throws(() => imageArk(value));
  assert.throws(() => dgsNumber('NaN'));
});

test('original download follows signed storage without credentials, validates pixels, and saves provenance privately', async () => {
  const directory = await mkdtemp(join(tmpdir(),'fs-image-'));
  const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#abc' } }).jpeg().toBuffer();
  const requests: string[] = [];
  try {
    await mocked((url, init) => {
      requests.push(url.hostname);
      const headers = new Headers(init?.headers as HeadersInit);
      if (url.hostname.endsWith('.s3.amazonaws.com')) {
        assert.equal(headers.get('authorization'), null);
        assert.equal(headers.get('cookie'), null);
        assert.equal(headers.get('referer'), null);
        assert.equal(init?.body, undefined);
      } else assert.equal(headers.get('authorization'), auth.Authorization);
      return imageResponses(url, bytes);
    }, async () => {
      const out = join(directory,'original.jpg');
      const result = await client().downloadOriginal(ark, out);
      assert.equal(result.imageNumber, 408);
      assert.equal(result.width, 24);
      assert.equal(result.height, 16);
      assert.deepEqual(await readFile(out), bytes);
      assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal((await stat(out)).mode & 0o777, 0o600);
      assert.equal((await stat(result.manifest)).mode & 0o777, 0o600);
      const manifest = await readFile(result.manifest, 'utf8');
      assert.ok(!manifest.includes('private-'));
      assert.deepEqual((await readdir(directory)).sort(), ['original.jpg','original.jpg.json']);
      await assert.rejects(client().downloadOriginal(ark, out), { code: 'EEXIST' });
      assert.deepEqual(await readFile(out), bytes);
    });
    assert.ok(requests.some(host => host.endsWith('.s3.amazonaws.com')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('HTML, disguised HTML, truncated images, and thumbnail dimensions never produce output artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(),'fs-invalid-'));
  const full = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#bca' } }).jpeg().toBuffer();
  const thumbnail = await sharp({ create: { width: 6, height: 4, channels: 3, background: '#bca' } }).jpeg().toBuffer();
  try {
    for (const [content, media] of [[Buffer.from('<html>Sign in</html>'),'text/html'], [Buffer.from('<html>Sign in</html>'),'image/jpeg'], [full.subarray(0,full.length-30),'image/jpeg'], [thumbnail,'image/jpeg']] as const) {
      await mocked(url => url.hostname.endsWith('.s3.amazonaws.com') ? new Response(content as BodyInit,{ headers: { 'Content-Type': media } }) : imageResponses(url, full), async () => {
        await assert.rejects(client().downloadOriginal(ark,join(directory,'invalid.jpg')), error => error instanceof ResearchError && error.code === 'unexpected-content');
        assert.deepEqual(await readdir(directory), []);
      });
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('download permissions and storage redirects are enforced before fetching image bytes', async () => {
  let calls = 0;
  await mocked(url => { calls++; return imageResponses(url,new Uint8Array(),'false'); }, async () => {
    await assert.rejects(client().downloadOriginal(ark,'unused.jpg'), error => error instanceof ResearchError && error.code === 'access-denied');
  });
  assert.equal(calls,1);
  for (const location of ['https://evil.test/image.jpg', 'http://www.familysearch.org/image.jpg', 'https://other.s3.amazonaws.com/image.jpg']) {
    calls=0;
    await mocked(() => { calls++; return new Response(null,{status:302,headers:{Location:location}}); }, async () => {
      await assert.rejects(client().transport.response(`${storage}/dist.jpg`,{image:true}), /unrecognized storage/);
    });
    assert.equal(calls,1);
  }
});

test('temporary reads retry with Retry-After; denials are classified and never blindly retried', async () => {
  const delays: number[] = [];
  let calls=0;
  await mocked(() => ++calls === 1 ? new Response('busy',{status:503,headers:{'Retry-After':'0'}}) : json({ok:true}), async () => {
    assert.deepEqual(await client(delays).transport.json(`${storage}/parents`),{ok:true});
  });
  assert.deepEqual(delays,[0]);
  for (const [status, body, code] of [[403,'Private denial response','access-denied'],[403,'This request was blocked by our security service','security-challenge'],[429,'Private throttling response','throttled']] as const) {
    calls=0;
    await mocked(() => {calls++;return new Response(body,{status,headers:{'Retry-After':'120'}});}, async()=>{
      await assert.rejects(client().transport.json(`${storage}/parents`), e=> e instanceof ResearchError && e.code===code && !e.message.includes(body));
    });
    assert.equal(calls,1);
  }
  assert.equal(retryDelay('Sun, 06 Sep 2026 22:00:02 GMT',0,Date.parse('2026-09-06T22:00:00Z')),2000);
});

test('document requests share existing 401 renewal and persist the rotated session', async () => {
  const session = { version:1, clientId:CHURCH_CLIENT_ID, tokens:{access_token:'old',refresh_token:'refresh-old'}, obtainedAt:new Date().toISOString(), cookies:new HttpSession().jar.serializeSync() };
  const c: FamilySearchClient = new (FamilySearchClient as any)(session);
  const internal = c as any;
  let refreshes=0;
  const saved: unknown[]=[];
  internal.persist = async(tokens?: typeof session.tokens)=>{if(tokens){session.tokens=tokens;saved.push(tokens);}};
  internal.http.json = async()=>{refreshes++;return {access_token:'new',refresh_token:'refresh-new'};};
  await mocked((_url,init)=>new Headers(init?.headers as HeadersInit).get('authorization')==='Bearer old' ? new Response('',{status:401}) : json({ok:true}), async()=>{
    assert.deepEqual(await c.get('/service/cds/recapi/collections/1999178/waypoints'),{ok:true});
  });
  assert.equal(refreshes,1); assert.equal(saved.length,1);
  assert.equal(session.tokens.refresh_token,'refresh-new');
  await assert.rejects(c.request('/service/cds/recapi/collections/1999178/waypoints',{method:'DELETE'}),/API paths/);
});

function waypointPage(url: URL, total=5, nextOverride?: string) {
  const offset=Number(url.searchParams.get('offset')??0),count=Number(url.searchParams.get('count')??2);
  const end=Math.min(total,offset+count),next=new URL(url);
  next.searchParams.set('offset',String(end));
  return json({description:'#root',links:{self:{href:url.href,results:total},...(end<total?{next:{href:nextOverride??next.href}}:{})},sourceDescriptions:[
    {id:'ancestor',titles:[{value:'Ancestor (must not be a child)'}]},
    {id:'root',componentOf:{description:'#ancestor'},titles:[{value:'Root'}]},
    ...Array.from({length:Math.max(0,end-offset)},(_,i)=>({id:`child${offset+i}`,componentOf:{description:'#root'},resourceType:'http://gedcomx.org/DigitalArtifact',about:`https://familysearch.org/ark:/61903/3:1:IMAGE-${offset+i}`})),
  ]});
}

test('waypoint pagination preserves order, honors limits, and resumes without dropping children', async()=>{
  await mocked(url=>waypointPage(url),async()=>{
    const c=client();
    const page=await c.browse('1999178',{count:2,all:true,limit:3});
    assert.equal(page.total,5);assert.equal(page.complete,false);
    assert.deepEqual(page.items.map(x=>x.imageNumber),[1,2,3]);
    assert.equal(new URL(page.next!).searchParams.get('offset'),'3');
    const resumed=await c.browse('1999178',{resume:page.next,all:true});
    assert.deepEqual(resumed.items.map(x=>x.imageNumber),[4,5]);assert.equal(resumed.complete,true);
    const all=await c.browse('1999178',{count:2,all:true});assert.equal(all.items.length,5);assert.equal(all.complete,true);
  });
});

test('pagination rejects cross-route links, repeated pages, and missing continuations',async()=>{
  for(const variant of ['wrong-route','loop','missing']) await mocked(url=>{
    if(variant==='wrong-route')return waypointPage(url,5,'https://www.familysearch.org/service/search/fulltext/search?count=2&offset=2');
    if(variant==='loop')return waypointPage(url,5,url.href);
    return json({description:'#root',links:{self:{href:url.href,results:5}},sourceDescriptions:[{id:'root'}]});
  },async()=>{await assert.rejects(client().browse('1999178',{count:2,all:true}),e=>e instanceof ResearchError&&e.code==='pagination');});
});

test('bulk DGS listing uses one-based image numbers and exposes a bounded continuation',async()=>{
  await mocked((_url,init)=>{
    const body=JSON.parse(String(init?.body));assert.equal(body.type,'film-data');assert.equal(body.args.dgsNum,'005764700');
    return json({dgsNum:'005764700',images:Array.from({length:4},(_,i)=>`https://familysearch.org/ark:/61903/3:1:IMAGE-${i}/image.xml`)});
  },async()=>{
    const page=await client().filmImages('5764700',{offset:1,count:2});
    assert.deepEqual(page.items.map(x=>x.imageNumber),[2,3]);assert.equal(page.nextOffset,3);assert.equal(page.complete,false);
    assert.equal((await client().filmImage('5764700',3)).imageArk.endsWith('IMAGE-2'),true);
    await assert.rejects(client().filmImage('5764700',5),/outside the film/);
  });
});

test('Full-Text Search requires all supplied terms and maps date/DGS/filter flags to observed wire parameters',async()=>{
  await mocked((url,init)=>{
    assert.equal(url.searchParams.get('m.queryRequireDefault'),'on');assert.equal(url.searchParams.get('q.groupName'),'005764700');
    assert.equal(url.searchParams.get('q.fullName'),'Walton');assert.equal(url.searchParams.get('q.anyYear.from'),'1820');
    assert.equal(url.searchParams.get('q.anyYear.to'),'1938');assert.equal(url.searchParams.get('f.collectionId'),'1999178');
    assert.ok(new Headers(init?.headers as HeadersInit).get('x-fs-feature-tag')?.includes('search_naturalLanguageSupport'));
    return json({index:0,results:1,entries:[{sourceUrl:ark,content:{title:'Example',textDocument:'Machine reading',highlightTexts:['Walton']}}]});
  },async()=>{
    const page=await client().fulltextSearch({name:'Walton',dgs:'5764700',fromYear:1820,toYear:1938,collection:'1999178'});
    assert.equal(page.items[0].machineTranscript,'Machine reading');assert.equal(page.complete,true);
  });
});

test('transcripts preserve service reading order, line breaks, coordinates, and redaction boundaries',()=>{
  const base:ImageTranscript={imageArk:ark,available:false,machineGenerated:true,text:'',citations:[],pages:[],regions:[],hasRedactions:false,retrievedAt:'2026-09-06',sourceUrl:'https://sg30p0.familysearch.org/service/records/volunteer/orchestration/sls/image/records/3:1:TEST-IMAGE'};
  const wire={stuff:{metadata:{properties:[{name:'IMAGE_ARK',value:ark},{name:'LANGUAGE',value:'en'}]},pages:[{pageWidth:24,pageHeight:16}],regions:[{id:'R1',lines:[{id:'L1',tokens:[{text:'John',rect:'1,2,3,4'},{text:'Hidden sensitive text',redacted:true}]},{id:'L2',tokens:[{text:'Second line'}]}]}]}};
  const data=decodeTranscript(wire,base);assert.equal(data.available,true);assert.equal(data.text,'John [REDACTED]\nSecond line');
  assert.equal(data.regions[0].lines[0].tokens[0].rect,'1,2,3,4');assert.equal(data.hasRedactions,true);
  assert.ok(!JSON.stringify(data).includes('Hidden sensitive text'));assert.equal(decodeTranscript({stuff:null},base).available,false);
  assert.throws(()=>decodeTranscript({} as never,base),/unfamiliar document/);
});

test('transcript reads authenticate on the observed host and distinguish absence from denied access',async()=>{
  for (const status of [200,404,403]) {
    let transcriptCalls=0;
    await mocked((url,init)=>{
      if(url.pathname.includes('/sls/image/records/')) {
        transcriptCalls++;
        assert.equal(url.origin,'https://sg30p0.familysearch.org');
        const headers=new Headers(init?.headers as HeadersInit);
        assert.equal(headers.get('authorization'),auth.Authorization);
        assert.equal(headers.get('cookie'),null);
        return status===200 ? json({stuff:{metadata:{properties:[{name:'IMAGE_ARK',value:ark}]},pages:[],regions:[{lines:[{tokens:[{text:'Machine transcript'}]}]}]}}) : new Response('Unavailable',{status});
      }
      return imageResponses(url,new Uint8Array());
    },async()=>{
      if(status===403) await assert.rejects(client().imageTranscript(ark),e=>e instanceof ResearchError&&e.code==='access-denied');
      else {const transcript=await client().imageTranscript(ark);assert.equal(transcript.available,status===200);if(status===200)assert.equal(transcript.text,'Machine transcript');}
    });
    assert.equal(transcriptCalls,1);
  }
});

test('pagination rejects an ignored initial offset and malformed resume offsets',async()=>{
  await mocked(url=>{url.searchParams.set('offset','0');return waypointPage(url);},async()=>{
    await assert.rejects(client().browse('1999178',{offset:2,count:2}),e=>e instanceof ResearchError&&e.code==='pagination');
  });
  await assert.rejects(client().browse('1999178',{resume:'https://www.familysearch.org/service/cds/recapi/collections/1999178/waypoints?offset=-1'}),/Resume offset/);
});

test('schema examples and query flags prevent the recordDetails nesting detour',()=>{
  const example=operationExample('sources.recordDetails');assert.ok(example.query);prepareOperation('sources.recordDetails',example);
  const input=operationQueryInput('sources.recordDetails',{},['recordUrl=https://www.familysearch.org/ark:/61903/1:1:EXAMPLE','hideSectionFields=false']);
  assert.equal((input.query as Record<string,unknown>).hideSectionFields,false);prepareOperation('sources.recordDetails',input);
  assert.throws(()=>prepareOperation('sources.recordDetails',{recordUrl:'secret'}),/recordUrl belongs under query/);
  assert.throws(()=>operationQueryInput('sources.recordDetails',{},['hideSectionFields=maybe']),/true or false/);
  assert.throws(()=>operationQueryInput('sources.recordDetails',input,['recordUrl=again']),/more than once/);
});

test('CLI help and schema examples use the installed command spelling; invalid research flags fail before network',async()=>{
  const run=promisify(execFile),options={cwd:resolveProject(),env:{...process.env},maxBuffer:1024*1024};
  const help=await run(process.execPath,['--import','tsx','src/cli.ts','--help'],options);
  assert.match(help.stdout,/familysearch image download/);assert.ok(!help.stdout.includes('npm run fs --'));
  const example=await run(process.execPath,['--import','tsx','src/cli.ts','schema','sources.recordDetails','--example'],options);
  assert.equal(typeof JSON.parse(example.stdout).query.recordUrl,'string');
  await assert.rejects(run(process.execPath,['--import','tsx','src/cli.ts','film','images','5764700','--name','ignored'],options),/not supported/);
  await assert.rejects(run(process.execPath,['--import','tsx','src/cli.ts','image','download','3:1:TEST'],options),/requires --out/);
});
function resolveProject(){return fileURLToPath(new URL('..',import.meta.url));}
