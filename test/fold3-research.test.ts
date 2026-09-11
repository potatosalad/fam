import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Fold3Client} from '../src/fold3/client.js';
import {Fold3Http,IMG} from '../src/fold3/http.js';
import {exportFile} from '../src/fold3/file-export.js';
import {stringifyJson} from '../src/shared/json.js';
import {commandById} from '../src/shared/command-registry.js';
const response=(value:unknown)=>new Response(stringifyJson(value),{headers:{'content-type':'application/json'}});
const cluster={i:'7.fixture',t:'Synthetic pension file',s:'pension\tfixture',z:3,f:true};
const nodes=Array.from({length:3},(_,i)=>({i:123+i,t:`Page ${i+1}`,c:cluster.i,o:i}));
function strip(url:URL,init:RequestInit){
  if(url.pathname.endsWith('/by-offset')){
    const body=JSON.parse(String(init.body));assert.equal(body.p,'7');assert.equal(body.s,cluster.s);
    const offset=Number(url.searchParams.get('offset')),count=Number(url.searchParams.get('count'));
    return structuredClone({a:nodes[offset].i,n:nodes.slice(offset,offset+count+1),c:[cluster]});
  }
  return structuredClone({a:124,n:[nodes[1],nodes[2],{i:456,t:'Unrelated page',c:'7.other',o:0}],c:[{...cluster,i:'7.other',z:1},cluster]});
}

test('file enumeration starts at the first page and respects boundaries despite a middle anchor',async()=>{
  const client=new Fold3Client(new Fold3Http(undefined,async(value,init)=>response(strip(new URL(value),init))));
  const first=await client.fileImages('124',2),last=await client.fileImages('124',2,2);
  assert.equal(first.file.total,3);assert.equal(first.file.clusterId,cluster.i);assert.deepEqual(first.items.map(p=>p.imageId),['123','124']);assert.equal(first.nextOffset,2);
  assert.deepEqual(last.items.map(p=>p.imageId),['125']);assert.equal(last.nextOffset,null);assert.equal(last.complete,false);
  assert.equal((await client.fileImages('124',3)).complete,true);assert.equal((await client.fileImages('124',3,3)).items.length,0);
  await assert.rejects(client.fileImages('124',3,4),/exceeds/);
});

test('file traversal rejects changed boundaries, gaps, duplicates, and out-of-order pages',async()=>{
  for(const change of [(r:any)=>r.c[0].z++,(r:any)=>r.n.pop(),(r:any)=>r.n[1].i=r.n[0].i,(r:any)=>r.n.reverse(),(r:any)=>r.n[1].c='7.other']){
    const client=new Fold3Client(new Fold3Http(undefined,async(value,init)=>{const url=new URL(value),r=strip(url,init);if(url.pathname.endsWith('/by-offset'))change(r);return response(r);}));
    await assert.rejects(client.fileImages('124',3),/boundaries changed|missing, repeated, or out-of-order/);
  }
});

test('connection reads use directional anchors and server pagination with a lookahead',async()=>{
  const ids=['9007199254740997','9007199254740998','9007199254740999'];
  const client=new Fold3Client(new Fold3Http(undefined,async(_url,init)=>{
    const q=JSON.parse(String(init.body));assert.deepEqual(q.id,{ct:'IMAGE',id:'124'});assert.equal(q.forward,false);assert.equal(q.count,3);
    return response(ids.slice(q.offset,q.offset+q.count).map((id,i)=>({id:{ct:'STORY_PAGE',id},t:'Synthetic memorial',md:[{n:'Birth',v:'1880'}],c:{id:'link-'+id,p:{ct:'STORY_PAGE',id},t:q.id,md:{text:'Evidence link',token:'synthetic-secret'}},im:123})));
  }));
  const first=await client.connections('124',{type:'image',direction:'incoming',limit:2}),next=await client.connections('124',{type:'image',direction:'incoming',limit:2,offset:first.nextOffset!});
  assert.equal(first.items[0].id,ids[0]);assert.equal(first.items[0].sourceUrl,'https://www.fold3.com/memorial/'+ids[0]);assert.equal(first.nextOffset,2);assert.equal(next.items.length,1);assert.equal(next.nextOffset,null);
  assert.doesNotMatch(stringifyJson(first),/synthetic-secret/);
  await assert.rejects(client.connections('124',{type:'image',direction:'both' as any}));
  await assert.rejects(client.call('connections',{id:'124',type:'image',delete:true}));
});

test('connection API changes and ignored limits are never reported as valid pages',async()=>{
  const item={id:{ct:'STORY_PAGE',id:'2'},t:'Test',c:{id:'link',p:{ct:'STORY_PAGE',id:'2'},t:{ct:'IMAGE',id:'124'}}};
  for(const data of [{items:[]},[item,item],[{...item,c:{...item.c,t:{ct:'IMAGE',id:'999'}}}],Array(4).fill(item)]){
    const client=new Fold3Client(new Fold3Http(undefined,async()=>response(data)));
    await assert.rejects(client.connections('124',{type:'image',direction:'incoming',limit:2}),{code:'api-changed'});
  }
});

test('collection browsing preserves opaque path values, labels, prefix filters and truncation',async()=>{
  const value='0000001880\t1880f';let body:any;
  const client=new Fold3Client(new Fold3Http(undefined,async(url,init)=>{
    if(url.includes('browse-levels'))return response(['Year','File']);body=JSON.parse(String(init.body));
    return response({facets:[{type:'general.title.browse.2',facets:[{v:'alpha\tAlphaf',l:'Alpha',c:3,t:'FILE'},{v:'albert\tAlbertf',l:'Albert',c:1,t:'FILE'}]}],timedOut:false,shards:{failed:0}});
  }));
  const result=await client.browse('7',{path:[value],prefix:'Al',limit:1});assert.equal(result.kind,'branches');
  if(result.kind==='branches'){assert.equal(result.label,'File');assert.equal(result.truncated,true);assert.deepEqual(result.items[0].path,[value,'alpha\tAlphaf']);}
  assert.equal(body.filters[1].values[0],value);assert.equal(body.filters[2].filterType,'PREFIX');assert.equal(body.filters[2].values[0],'Al');
  await assert.rejects(client.browse('7',{path:[''],limit:1}));
});

test('empty hierarchy levels retain their positions and leaf scans use filmstrip order',async()=>{
  const queries:any[]=[];
  const client=new Fold3Client(new Fold3Http(undefined,async(url,init)=>{
    if(url.includes('browse-levels'))return response(['Unused','File']);
    const q=JSON.parse(String(init.body));queries.push(q);
    if(q.facetRequests)return response({facets:[{type:q.facetRequests[0].type,facets:q.facetRequests[0].type.endsWith('.1')?[{v:'␀\t␀f',l:'␀',c:3}]:[{v:'fixture',l:'Fixture',c:3,t:'FILE'}]}]});
    return response({hits:[{doc:{id:{ct:'IMAGE',id:123},t:'Page 1'}}],total:3});
  }));
  const branch=await client.browse('7');assert.equal(branch.kind,'branches');assert.deepEqual(branch.items[0].path,['␀\t␀f','fixture']);
  const leaf=await client.browse('7',{path:branch.items[0].path,limit:1});assert.equal(leaf.kind,'images');assert.equal(leaf.nextOffset,1);assert.equal(queries.at(-1).sortOrder,'FILMSTRIP');assert.equal(queries.at(-1).filters[2].type,'general.title.browse.2');
});

test('incomplete browse results never imply an exhausted collection',async()=>{
  const client=new Fold3Client(new Fold3Http(undefined,async(url)=>response(url.includes('browse-levels')?['File']:{facets:[{type:'general.title.browse.1',facets:[]}],timedOut:true})));
  const r=await client.browse('7');assert.equal(r.kind,'branches');assert.equal(r.incomplete,true);
});

async function exportFixture(){
  const jpeg=await sharp({create:{width:4,height:3,channels:3,background:'#abcdef'}}).jpeg().toBuffer();
  let denied='124';const fetched:string[]=[];
  const client=new Fold3Client(new Fold3Http(undefined,async(value,init)=>{
    const url=new URL(value);
    if(url.pathname.includes('/filmstrip/'))return response(strip(url,init));
    if(url.origin===IMG)return new Response(jpeg,{headers:{'content-type':'image/jpeg'}});
    if(url.pathname.includes('/publication/'))return response({id:7,t:'Synthetic collection'});
    const imageId=url.pathname.split('/').at(-1)!;fetched.push(imageId);
    return response({w:{id:{ct:'IMAGE',id:imageId}},d:{t:'Synthetic page',w:4,h:3,m:[]},r:{p:{allowed:imageId===denied?[]:['VIEW','DOWNLOAD'],denied:{}},o:{token:'synthetic-secret'},x:{collectionType:'PUBLICATION',collectionObjectId:7}}});
  }));
  return {client,fetched,permit:()=>{denied='';}};
}

test('an interrupted file export resumes after verifying saved images and citation sidecars',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fam-fold3-export-')),directory=join(root,'file');
  try{
    const f=await exportFixture();await assert.rejects(exportFile(f.client,'124',directory,{maxPages:2}),/exceeding/);await assert.rejects(lstat(directory));
    await assert.rejects(exportFile(f.client,'124',directory),e=>(e as any).code==='access-denied'&&/--resume/.test((e as Error).message));
    const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));assert.equal(manifest.complete,false);assert.equal(manifest.pages.length,3);assert.ok(manifest.pages[0].sha256);assert.equal(manifest.pages[1].sha256,undefined);
    assert.equal((await lstat(join(directory,manifest.pages[0].filename))).mode&0o777,0o600);await assert.rejects(lstat(join(directory,'.fam-fold3.lock')));
    f.permit();f.fetched.length=0;const result=await exportFile(f.client,'124',directory,{resume:true});assert.equal(result.complete,true);assert.equal(result.reused,1);assert.deepEqual(f.fetched,['124','125']);
    f.fetched.length=0;const again=await exportFile(f.client,'124',directory,{resume:true});assert.equal(again.downloaded,0);assert.equal(again.reused,3);assert.deepEqual(f.fetched,[]);
    assert.doesNotMatch(await readFile(join(directory,'manifest.json'),'utf8'),/synthetic-secret/);
    await assert.rejects(exportFile(f.client,'124',directory),{code:'EEXIST'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('resume rejects corrupted files, mismatched manifests, symlinks and active locks without downloading',async()=>{
  for(const mode of ['bytes','manifest','symlink','lock']){
    const root=await mkdtemp(join(tmpdir(),'fam-fold3-corruption-')),directory=join(root,'file');
    try{
      const f=await exportFixture();f.permit();await exportFile(f.client,'124',directory);f.fetched.length=0;
      const manifestPath=join(directory,'manifest.json'),m=JSON.parse(await readFile(manifestPath,'utf8')),image=join(directory,m.pages[0].filename);
      if(mode==='bytes')await writeFile(image,'corruption');
      if(mode==='manifest'){m.pages[0].filename='../../outside.jpg';await writeFile(manifestPath,JSON.stringify(m));}
      if(mode==='symlink'){await rm(image);await symlink(join(directory,m.pages[1].filename),image);}
      if(mode==='lock')await writeFile(join(directory,'.fam-fold3.lock'),'locked');
      await assert.rejects(exportFile(f.client,'124',directory,{resume:true}));assert.deepEqual(f.fetched,[]);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});

test('resume recovers a completed image/sidecar pair when interruption precedes the manifest update',async()=>{
  const root=await mkdtemp(join(tmpdir(),'fam-fold3-recover-')),directory=join(root,'file');
  try{const f=await exportFixture();f.permit();await exportFile(f.client,'124',directory);f.fetched.length=0;
    const path=join(directory,'manifest.json'),m=JSON.parse(await readFile(path,'utf8'));delete m.pages[0].sha256;delete m.pages[0].bytes;m.complete=false;await writeFile(path,JSON.stringify(m));
    assert.equal((await exportFile(f.client,'124',directory,{resume:true})).reused,3);assert.deepEqual(f.fetched,[]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('new research commands expose typed flags and keep raw mutation routes unavailable',async()=>{
  for(const command of ['fold3.file get','fold3.file.image list','fold3.file download','fold3.publication browse','fold3.connection list'])assert.ok(commandById.has(command));
  assert.equal(commandById.get('fold3.file download')!.flags.find(f=>f.name==='resume')!.type,'boolean');
  assert.equal(commandById.get('fold3.publication browse')!.flags.find(f=>f.name==='path')!.multiple,true);
  let calls=0;const http=new Fold3Http(undefined,async()=>{calls++;return response({});});
  await assert.rejects(http.request('https://www.fold3.com/fold31/api/connection/delete',{body:{}}),/Unsupported/);assert.equal(calls,0);
});
