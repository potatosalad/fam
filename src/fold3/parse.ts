import {load} from 'cheerio';
import {parseJson} from '../shared/json.js';
import {Fold3Error,WEB,checkUrl} from './http.js';
export function object(value: any): Record<string, any> {if(!value||typeof value!=='object'||Array.isArray(value))throw new Fold3Error('api-changed');return value;}
export function id(value: unknown): string {
  if(!['string','number','bigint'].includes(typeof value)||typeof value==='number'&&!Number.isSafeInteger(value)||! /^[1-9]\d*$/.test(String(value)))throw new Error('Fold3 IDs must be positive decimal integers. Pass large IDs as strings.');
  return String(value);
}
export function integer(value: number, min=0, max=10_000): number {if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Expected an integer between ${min} and ${max}.`);return value;}
export function account(value: unknown) {
  const v=object(value);if(v.userId==null||typeof v.username!=='string'||typeof v.accountStatus!=='string'||v.disabled===true)throw new Fold3Error('session-rejected');
  return {userId:id(v.userId),username:v.username,email:v.email,accountStatus:v.accountStatus,premiumAccess:v.premiumAccess,ancestrySubscriber:v.ancestrySubscriber,joinedAt:v.joinDate};
}
/** Do not export session context, signed URLs, or per-image authorization tokens. */
export function publicData(value: any): any {
  if(Array.isArray(value))return value.map(publicData);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:token|password|secret|session|csrf|authorization|cookie|signature)/i.test(key)).map(([key,v])=>[key,publicData(v)]));
  if(typeof value==='string'&&/^https?:\/\//i.test(value)) {
    try{const u=new URL(value);for(const key of [...u.searchParams.keys()])if(/token|signature|auth|key|jwt|iat/i.test(key))u.searchParams.delete(key);return u.href;}catch{return null;}
  }
  return value;
}
export const routes: Record<string,string>={IMAGE:'image',INDEX_RECORD:'record',STORY_PAGE:'memorial',MILITARY_UNIT:'unit',PUBLICATION:'publication',TITLE_COLLECTION:'collection',BATTLE:'battle',SUBJECT:'subject',REGIMENT:'regiment',COMPANY:'company'};
export function sourceUrl(type:string,identity:unknown):string|null {const path=routes[type];return path&&['string','number','bigint'].includes(typeof identity)?`${WEB}/${path}/${encodeURIComponent(String(identity))}`:null;}
export function metadata(values: any) {return Array.isArray(values)?values.map(v=>({name:v.name??v.n,label:v.label??v.l,value:v.value??v.v})):[];}
export function publication(value: unknown) {
  const v=object(value),publicationId=id(v.publicationId??v.id);
  if(typeof (v.title??v.t)!=='string')throw new Fold3Error('api-changed');
  return publicData({publicationId,title:v.title??v.t,description:v.shortDescription??v.sd,contentType:v.contentType??v.ct,
    accessLevel:v.configuredAccessLevel??v.cal,allowDownload:v.allowDownload??v.ad,allowPrint:v.allowPrint??v.ap,showOcr:v.showOcr??v.vo,
    percentComplete:v.percentComplete??v.pc,updatedAt:v.lastUpdated??v.lu,metadata:metadata(v.metadata??v.md),provider:v.provider??v.cp,
    sourceUrl:sourceUrl('PUBLICATION',publicationId)});
}
export function hit(value:any):any {
  const v=object(value),d=object(v.doc),ref=object(d.id),identity=ref.id??ref.objectId,type=ref.ct??ref.contentType;
  if(typeof type!=='string'||identity==null||typeof d.t!=='string')throw new Fold3Error('api-changed');
  return publicData({id:String(identity),type,title:d.t,shortTitle:d.s,publicationId:d.pid==null?undefined:String(d.pid),imageId:d.im==null?undefined:String(d.im),
    metadata:metadata(d.md),sourceUrl:sourceUrl(type,identity),highlights:v.hp??[],ocrHighlights:v.ohp??[],score:v.s,
    ...(Array.isArray(v.ch)?{children:v.ch.map(hit),totalChildren:v.chc}:{}),createdAt:d.cr,modifiedAt:d.lm});
}
export function hydration(text: string) {
  const $=load(text),data=$('script#hydrate-data[type="application/json"]').text();
  try{const v=object(parseJson(data));object(v.F3_COMPONENT_DATA);object(v.F3_PAGE_DATA);return v;}catch{throw new Fold3Error('api-changed');}
}
export function page(text: string,url: string) {
  const parsed=checkUrl(url);if(parsed.pathname==='/login')throw new Fold3Error('session-rejected');
  if(parsed.origin!==WEB||!/^\/(record|memorial|unit|document|image)\/[1-9]\d*(?:\/|$)/.test(parsed.pathname))throw new Fold3Error('api-changed');
  const data=hydration(text),content=data.F3_COMPONENT_DATA,$=load(text);
  if(!['content','unitContent','image','imageData'].some(key=>content[key]&&typeof content[key]==='object'))throw new Fold3Error('api-changed');
  return {sourceUrl:url,title:$('h1').first().text().trim()||$('title').text().trim(),
    citation:{provider:'Fold3',sourceUrl:url,accessedAt:new Date().toISOString()},data:publicData(content)};
}
export function imageDetails(value:unknown,expectedId:string) {
  const v=object(value),w=object(v.w),d=object(v.d),runtime=object(v.r),ref=object(w.id);
  if(ref.ct!=='IMAGE'||id(ref.id)!==expectedId)throw new Fold3Error('api-changed');
  const permissions=object(runtime.p);if(!Array.isArray(permissions.allowed)||!permissions.denied)throw new Fold3Error('api-changed');
  return {imageId:expectedId,title:d.t,parentTitle:d.f,width:d.w,height:d.h,hasOcr:d.o,transcriptType:d.x,clusterId:d.l,
    metadata:metadata(d.m),permissions:publicData(permissions),publicationId:runtime.x?.collectionType==='PUBLICATION'?String(runtime.x.collectionObjectId):undefined,
    sourceUrl:sourceUrl('IMAGE',expectedId),createdAt:w.c,modifiedAt:w.lm};
}
