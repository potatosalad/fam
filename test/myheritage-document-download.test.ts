import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {CookieJar} from 'tough-cookie';
import {MyHeritageDocuments} from '../src/myheritage/documents.js';
import type {MyHeritageSession} from '../src/myheritage/auth.js';
import type {ApiResponse} from '../src/familysearch/transport-types.js';
const html='<script>var recordData = {"collectionId":"123","itemId":"456"}; var documentViewerOptions = {"sources":{"links":["https://images.example.test/page.jpg"]}};</script><title>Synthetic document</title>';
test('OldNews generic binary MIME downloads still require genuine document bytes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'fam-document-')),original=globalThis.fetch;
  const session:MyHeritageSession={accessToken:'synthetic',deviceId:'fixture',savedAt:''};
  const http={jar:new CookieJar(),exchange:async<T>():Promise<ApiResponse<T>>=>({status:200,headers:{},data:html as T})};
  const client=new MyHeritageDocuments(session,http,async()=>{});
  const jpeg=await sharp({create:{width:16,height:24,channels:3,background:'white'}}).jpeg().toBuffer();
  let bytes:Uint8Array=jpeg;
  globalThis.fetch=async(_url,init)=>{assert.equal(new Headers(init?.headers).has('cookie'),false);return new Response(bytes,{headers:{'content-type':'binary/octet-stream'}});};
  try{
    const out=join(directory,'scan.jpg'),result=await client.download('https://www.myheritage.com/research/record-123-456/synthetic',out);
    assert.equal(result.width,16);assert.deepEqual(await readFile(out),jpeg);
    bytes=Buffer.from('<html>not a document</html>');
    await assert.rejects(client.download('https://www.myheritage.com/research/record-123-456/synthetic',join(directory,'bad.jpg')),/not a readable document/);
  }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});
