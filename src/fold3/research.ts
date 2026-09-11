import type {Fold3Client} from './client.js';
import {Fold3Error,WEB} from './http.js';
import {hit,id,integer,metadata,object,publicData,sourceUrl} from './parse.js';

export interface BrowseOptions {path?:string[];prefix?:string;limit?:number;offset?:number}
export const connectionTypes={image:'IMAGE',record:'INDEX_RECORD',memorial:'STORY_PAGE',unit:'MILITARY_UNIT',file:'FILE',subject:'SUBJECT',battle:'BATTLE','sub-image':'SUB_IMAGE'} as const;
export interface ConnectionOptions {type:keyof typeof connectionTypes;direction?:'incoming'|'outgoing';limit?:number;offset?:number}
export interface FileInfo {anchorImageId:string;publicationId:string;clusterId:string;title:string;total:number;sortKey:string;indexedFile:boolean;sourceUrl:string}
export interface FileImage {imageId:string;title:string;ordinal:number;sourceUrl:string}

function optionsOnly(value:unknown,keys:string[]){const o=object(value);if(Object.keys(o).some(k=>!keys.includes(k)))throw new Error('Unknown Fold3 research option. Inspect fam fold3.api describe.');}
function reference(value:unknown){const v=object(value);if(typeof v.ct!=='string'||typeof v.id!=='string'&&typeof v.id!=='number'&&typeof v.id!=='bigint')throw new Fold3Error('api-changed');return {type:v.ct,id:String(v.id),sourceUrl:sourceUrl(v.ct,v.id)};}

/** The anchor's cluster is the boundary. A filmstrip can include the next file. */
export async function fileInfo(client:Fold3Client,value:string):Promise<FileInfo>{
  const anchorImageId=id(value),r=object(await client.http.json(`${WEB}/fold31-search/filmstrip/${anchorImageId}?count=1&prev-count=0`));
  if(!Array.isArray(r.n)||!Array.isArray(r.c))throw new Fold3Error('api-changed');
  const anchor=r.n.find((n:any)=>id(n.i)===anchorImageId),cluster=r.c.find((c:any)=>c.i===anchor?.c);
  if(!cluster||typeof cluster.i!=='string'||typeof cluster.t!=='string'||typeof cluster.s!=='string'||cluster.s.length>16384||!Number.isSafeInteger(cluster.z)||cluster.z<1)throw new Fold3Error('api-changed');
  const publicationId=id(cluster.i.split('.')[0]);
  return {anchorImageId,publicationId,clusterId:cluster.i,title:cluster.t,total:cluster.z,sortKey:cluster.s,indexedFile:cluster.f===true,sourceUrl:`${WEB}/image/${anchorImageId}`};
}

export async function fileImages(client:Fold3Client,file:FileInfo,limit=100,offset=0){
  integer(limit,1,100);integer(offset,0,1_000_000);if(offset>file.total)throw new Error('The offset exceeds the file page count.');
  const take=Math.min(limit,file.total-offset);let items:FileImage[]=[];
  if(take){
    const r=object(await client.http.json(`${WEB}/fold31-search/filmstrip/by-offset?offset=${offset}&count=${take-1}&prev-count=0`,{body:{p:file.publicationId,s:file.sortKey}}));
    if(!Array.isArray(r.n)||!Array.isArray(r.c))throw new Fold3Error('api-changed');
    const cluster=r.c.find((c:any)=>c.i===file.clusterId);
    if(!cluster||cluster.z!==file.total||cluster.s!==file.sortKey)throw new Error('Fold3 file boundaries changed; restart enumeration.');
    items=r.n.filter((n:any)=>n.c===file.clusterId).map((n:any)=>({imageId:id(n.i),title:n.t,ordinal:n.o,sourceUrl:`${WEB}/image/${id(n.i)}`}));
    if(items.length!==take||new Set(items.map(n=>n.imageId)).size!==take||items.some((n,i)=>n.ordinal!==offset+i||typeof n.title!=='string'))throw new Error('Fold3 returned missing, repeated, or out-of-order file pages; enumeration stopped.');
  }
  return {file,items,offset,limit,nextOffset:offset+items.length<file.total?offset+items.length:null,complete:offset===0&&items.length===file.total};
}

export async function connections(client:Fold3Client,value:string,options:ConnectionOptions){
  optionsOnly(options,['type','direction','limit','offset']);
  if(!Object.hasOwn(connectionTypes,options.type))throw new Error('Unsupported Fold3 connection type.');
  const identity=options.type==='file'?value:id(value);
  if(typeof identity!=='string'||!identity.length||identity.length>512||/[\x00-\x1f]/.test(identity))throw new Error('Expected a returned Fold3 object ID.');
  const direction=options.direction??'outgoing',limit=integer(options.limit??20,1,100),offset=integer(options.offset??0,0,10000);
  if(!['incoming','outgoing'].includes(direction))throw new Error('Connection direction must be incoming or outgoing.');
  if(offset+limit>10000)throw new Error('Fold3 connection reads are bounded to 10,000 entries.');
  const result=await client.http.json(`${WEB}/fold31/api/connection/list-objs?thumb-height=100&thumb-width=100`,{body:{id:{ct:connectionTypes[options.type],id:identity},forward:direction==='outgoing',offset,count:limit+1}});
  if(!Array.isArray(result)||result.length>limit+1)throw new Fold3Error('api-changed');
  const items=result.map(v=>{
    object(v);const ref=reference(v.id),c=object(v.c);
    if(typeof v.t!=='string'||typeof c.id!=='string')throw new Fold3Error('api-changed');
    const principle=reference(c.p),target=reference(c.t),anchor=direction==='outgoing'?principle:target;
    if(anchor.id!==identity||anchor.type!==connectionTypes[options.type])throw new Fold3Error('api-changed');
    return publicData({...ref,title:v.t,subType:v.st,imageId:v.im==null?undefined:id(v.im),publicationId:v.pid==null?undefined:id(v.pid),metadata:metadata(v.md),
      connection:{id:c.id,principle,target,metadata:c.md,createdAt:c.c},createdAt:v.cr,modifiedAt:v.lm});
  });
  if(new Set(items.map(v=>v.connection.id)).size!==items.length)throw new Fold3Error('api-changed');
  const more=items.length>limit,next=offset+limit;
  return {anchor:{type:connectionTypes[options.type],id:identity},direction,items:items.slice(0,limit),offset,limit,nextOffset:more&&next<10000?next:null,windowLimitReached:more&&next>=10000,
    note:'Connections are website links and contributions; they do not by themselves establish a family relationship. Pagination uses one lookahead entry.'};
}

export async function browsePublication(client:Fold3Client,value:string,options:BrowseOptions={}){
  optionsOnly(options,['path','prefix','limit','offset']);
  const publicationId=id(value),path=options.path??[],limit=integer(options.limit??20,1,100),offset=integer(options.offset??0,0,9999);
  if(!Array.isArray(path)||path.length>6||path.some(v=>typeof v!=='string'||!v.length||v.length>16384))throw new Error('Use up to six exact browse path values returned by Fold3.');
  if(options.prefix!==undefined&&(typeof options.prefix!=='string'||!options.prefix.trim()||options.prefix.length>500))throw new Error('Supply a nonempty browse prefix.');
  const labels=await client.http.json(`${WEB}/fold31-search/search-util/browse-levels/${publicationId}`);
  if(!Array.isArray(labels)||labels.some(v=>typeof v!=='string')||labels.length>6)throw new Fold3Error('api-changed');
  const filter=(type:string,value:string,filterType='TERM')=>({type,values:[value],filterType,strict:true,exclude:false});
  const filters=[filter('general.title.id',publicationId),...path.map((v,i)=>filter(`general.title.browse.${i+1}`,v))];
  // Preserve empty levels as path values, so later levels retain their true index.
  const selected=[...path];
  for(let level=path.length+1;level<=labels.length;level++){
    const type=`general.title.browse.${level}`;
    const r=object(await client.http.json(`${WEB}/fold31-search/doc-search`,{body:{filters:[...filters,...(options.prefix?[filter(type,options.prefix,'PREFIX')]:[])],facetRequests:[{type,maxCount:limit+1,mode:'ALL',sort:'ALPHA'}],maxCount:0,offset:0}}));
    if(!Array.isArray(r.facets))throw new Fold3Error('api-changed');
    const facets=r.facets.find((f:any)=>f.type===type)?.facets;
    if(!Array.isArray(facets)||facets.some((f:any)=>typeof f.v!=='string'||!Number.isSafeInteger(f.c)||f.c<0))throw new Fold3Error('api-changed');
    const incomplete=r.timedOut===true||Number(r.shards?.failed??0)>0;
    if(!incomplete&&!options.prefix&&facets.length===1&&facets[0].l==='␀'){
      selected.push(facets[0].v);filters.push(filter(type,facets[0].v));continue;
    }
    if(facets.length||incomplete||options.prefix){
      if(offset)throw new Error('Browse branches use --prefix to narrow results; --offset applies to the image list at the end of a path.');
      return {publicationId,kind:'branches' as const,level,label:labels[level-1],path:selected,items:facets.slice(0,limit).map((f:any)=>({value:f.v,label:f.l??f.v,count:f.c,nodeType:f.t,path:[...selected,f.v]})),
        truncated:facets.length>limit,incomplete,nextOffset:null,note:'Pass an item’s entire path as repeated --path values. Use --prefix to narrow a truncated branch list.'};
    }
    break;
  }
  if(options.prefix)throw new Error('The selected path contains images. Remove --prefix and paginate with --offset.');
  if(offset+limit>10000)throw new Error('Fold3 image search is bounded to 10,000 results; select a narrower browse path.');
  const r=object(await client.http.json(`${WEB}/fold31-search/doc-search`,{body:{filters:[...filters,filter('general.title.content.doc-type','IMAGE')],sortOrder:'FILMSTRIP',maxCount:limit,offset}}));
  if(!Array.isArray(r.hits)||!Number.isSafeInteger(r.total)||r.total<0)throw new Fold3Error('api-changed');
  const incomplete=r.timedOut===true||Number(r.shards?.failed??0)>0||r.hits.length===0&&r.total>offset,next=offset+r.hits.length;
  return {publicationId,kind:'images' as const,path:selected,items:r.hits.map(hit),total:r.total,offset,limit,nextOffset:!incomplete&&next<r.total&&next<10000?next:null,
    incomplete,windowLimitReached:next>=10000&&next<r.total,note:'Images are ordered by the website filmstrip. Use an image ID with fam fold3.file get or fam fold3.file download.'};
}
