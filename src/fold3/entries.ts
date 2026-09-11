import type {Fold3Client} from './client.js';
import {Fold3Error,WEB} from './http.js';
import {id,integer,object,metadata,publicData} from './parse.js';

export function rectangle(value:unknown){
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||value.length>128||! /^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length%4===1||Buffer.from(value,'base64').toString('base64').replace(/=+$/,'')!==value.replace(/=+$/,''))throw new Fold3Error('api-changed');
  const bytes=Buffer.from(value,'base64');let at=1;
  const number=()=>{let n=0;for(let i=0;i<5;i++){if(at>=bytes.length)break;const b=bytes[at++];n=n*128+(b&127);if(n>0x7fffffff)break;if(!(b&128))return n;}throw new Fold3Error('api-changed');};
  if(!bytes.length)throw new Fold3Error('api-changed');
  const rotation=(bytes[0]&3)*90,x=number(),y=number(),width=number(),height=number();
  if(at!==bytes.length)throw new Fold3Error('api-changed');return {x,y,width,height,rotation};
}
function wrapped(value:unknown,type:string,identity:string){const v=object(value),w=object(v.w),ref=object(w.id);if(ref.ct!==type||id(ref.id)!==identity)throw new Fold3Error('api-changed');object(v.d);return v;}
export function contributions(value:unknown){
  if(value===undefined)return [];if(!Array.isArray(value))throw new Fold3Error('api-changed');
  return value.map(element=>{
    const e=object(element),w=object(e.w),ref=object(w.id),d=object(e.d);
    if(typeof ref.ct!=='string'||typeof ref.id!=='string'&&typeof ref.id!=='number'&&typeof ref.id!=='bigint')throw new Fold3Error('api-changed');
    return publicData({id:String(ref.id),type:ref.ct,ordinal:w.n,contributorId:w.o==null?undefined:id(w.o),modifiedAt:w.lm,
      ...(ref.ct==='IMAGE_ANNOTATION'?{value:d.v,label:d.l,annotationType:d.t,alternates:d.a,normalized:d.n,rect:rectangle(d.r)}:ref.ct==='CORRECTION'?{field:d.f,value:d.v}:{data:d})});
  });
}
export async function imageContributions(client:Fold3Client,value:string){
  const imageId=id(value),v=wrapped(await client.http.json(`${WEB}/fold31-image-data/image/document/IMAGE/${imageId}?flag=ALL_CONTRIBUTIONS&flag=PERMISSIONS`),'IMAGE',imageId);
  return {imageId,sourceUrl:`${WEB}/image/${imageId}`,items:contributions(v.de),note:'Contributions are user annotations, corrections, and comments. Retain the original scan as evidence.'};
}
export async function entry(client:Fold3Client,value:string){
  const entryId=id(value),v=wrapped(await client.http.json(`${WEB}/fold31-image-data/sub-image/document/SUB_IMAGE/${entryId}?flag=ALL_CONTRIBUTIONS&flag=PERMISSIONS`),'SUB_IMAGE',entryId),d=v.d,parentImageId=id(d.i);
  return {entryId,parentImageId,title:d.t,ordinal:d.o,rect:rectangle(d.r),metadata:metadata(d.m),contributions:contributions(v.de),permissions:publicData(v.r?.p),sourceUrl:`${WEB}/sub-image/${entryId}`,imageUrl:`${WEB}/image/${parentImageId}`};
}
export interface EntryOptions {x?:number;y?:number;width?:number;height?:number;limit?:number;offset?:number}
export async function entries(client:Fold3Client,value:string,options:EntryOptions={}){
  object(options);if(Object.keys(options).some(k=>!['x','y','width','height','limit','offset'].includes(k)))throw new Error('Unknown Fold3 entry-list option.');
  const imageId=id(value),limit=integer(options.limit??20,1,100),offset=integer(options.offset??0,0,10000),v=wrapped(await client.imageAuthorization(imageId,false),'IMAGE',imageId),d=v.d;
  const width=integer(d.w,1,100000),height=integer(d.h,1,100000),info=d.si;
  const specified=['x','y','width','height'].filter(k=>options[k as keyof EntryOptions]!==undefined).length;
  if(specified!==0&&specified!==4)throw new Error('Supply all of --x, --y, --width, and --height for an entry viewport.');
  const region=specified?{x:integer(options.x!,0,width-1),y:integer(options.y!,0,height-1),width:integer(options.width!,1,width),height:integer(options.height!,1,height)}:{x:0,y:0,width,height};
  if(region.x+region.width>width||region.y+region.height>height)throw new Error('The entry viewport exceeds the image dimensions.');
  if(info!==undefined&&(!Number.isSafeInteger(info.c)||info.c<0))throw new Fold3Error('api-changed');
  const advertised=info?.c??0;
  const items:Array<{entryId:string;title:string;ordinal:number;rect:ReturnType<typeof rectangle>;sourceUrl:string}>=[];
  if(advertised){
    const maxArea=info.t==='COLLAPSED'?region.width*region.height:integer(info.v,1,10_000_000_000);
    const tileWidth=Math.min(region.width,Math.max(1,Math.floor(Math.sqrt(maxArea)))),tileHeight=Math.min(region.height,Math.max(1,Math.floor(maxArea/tileWidth)));
    if(Math.ceil(region.width/tileWidth)*Math.ceil(region.height/tileHeight)>64)throw new Error('This index requires more than 64 viewports; supply a smaller --x/--y/--width/--height region.');
    const seen=new Set<string>();let first=true;
    for(let y=region.y;y<region.y+region.height;y+=tileHeight)for(let x=region.x;x<region.x+region.width;x+=tileWidth){
      const w=Math.min(tileWidth,region.x+region.width-x),h=Math.min(tileHeight,region.y+region.height-y);
      const r=object(await client.http.json(`${WEB}/fold31-image-data/sub-image/index/IMAGE/${imageId}/${x}/${y}/${w}/${h}/${first}`));first=false;
      if(r.spatial!==undefined&&!Array.isArray(r.spatial)||r.nonSpatial!==undefined&&!Array.isArray(r.nonSpatial)||r.spatial===undefined&&r.nonSpatial===undefined)throw new Fold3Error('api-changed');
      for(const n of [...r.spatial??[],...r.nonSpatial??[]]){object(n);const entryId=id(n.i);if(seen.has(entryId))continue;seen.add(entryId);
        if(typeof n.t!=='string'||!Number.isSafeInteger(n.o)||n.o<0)throw new Fold3Error('api-changed');
        items.push({entryId,title:n.t,ordinal:n.o,rect:rectangle(n.r),sourceUrl:`${WEB}/sub-image/${entryId}`});if(items.length>10000)throw new Error('Entry index exceeded 10,000 entries; select a smaller viewport.');
      }
    }
  }
  items.sort((a,b)=>a.ordinal-b.ordinal||a.entryId.localeCompare(b.entryId));
  const complete=region.x===0&&region.y===0&&region.width===width&&region.height===height&&items.length===advertised;
  return {imageId,items:items.slice(offset,offset+limit),total:items.length,providerTotal:advertised,region,complete,offset,limit,nextOffset:offset+limit<items.length?offset+limit:null,
    note:'Pagination is local over the requested index region. Ordinals and rectangles are provider values; absent sub-image entries do not imply an empty scan.'};
}
