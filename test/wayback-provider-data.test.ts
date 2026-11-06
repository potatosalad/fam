import {test} from 'node:test';
import assert from 'node:assert/strict';
import {humanWayback} from '../src/wayback/output.js';
import {WaybackClient} from '../src/wayback/client.js';

const header=['timestamp','original','statuscode','mimetype','digest'];
const row=(url:string,time='20150101000000')=>[time,url,'200','text/html','SYNTHETIC'];

test('Wayback skips unsafe CDX originals without blaming the caller or leaking credentials',async t=>{
  const client=new WaybackClient();
  t.mock.method(client as any,'json',async()=>[header,row('https://example.invalid/'),row('http://fixture-secret@example.invalid/'),row('https://example.invalid/','20160101000000')]);
  const result=await client.list('https://example.invalid/',{from:'2015',to:'2016',limit:2});
  assert.equal(result.snapshots.length,2);assert.equal(result.skipped,1);assert.equal(result.partial,true);
  assert.equal(result.truncated,true); // The raw CDX window filled limit + 1, even after filtering.
  assert.match(result.warnings.join(' '),/CDX.*skipped|skipped.*CDX/i);
  assert.doesNotMatch(JSON.stringify(result),/fixture-secret/);
  await assert.rejects(client.list('http://fixture-secret@example.invalid/'),{code:'INVALID_ARGUMENT'});
});

test('Wayback reports skipped-only find windows as partial and safe short windows as untruncated',async t=>{
  const client=new WaybackClient();
  const mock=t.mock.method(client as any,'json',async()=>[header,row('javascript:alert(1)')]);
  const found=await client.find('https://example.invalid/');
  assert.equal(found.snapshot,null);assert.equal(found.partial,true);assert.equal(found.skipped,1);
  assert.match(humanWayback(found),/Warning:.*CDX/);
  assert.doesNotMatch(humanWayback(found),/No successful capture indexed/);
  const partialList=await client.list('https://example.invalid/',{limit:2});
  assert.match(humanWayback(partialList),/Warning:.*CDX/);
  assert.doesNotMatch(humanWayback(partialList),/No captures found/);
  mock.mock.mockImplementation(async()=>[header,row('https://example.invalid/')]);
  const listed=await client.list('https://example.invalid/',{limit:2});
  assert.equal(listed.truncated,false);assert.equal(listed.partial,false);assert.deepEqual(listed.warnings,[]);
});
