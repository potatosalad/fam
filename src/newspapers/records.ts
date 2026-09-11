import {NewspapersError, WEB} from './http.js';
import {pageMetadata, publicValue} from './parse.js';

export const articleTypes = ['obituary','marriage','birth','enslavement','crime'] as const;
export type ArticleType = typeof articleTypes[number];
export type RecordType = 'page' | ArticleType;
export const articleCollections: Record<ArticleType,string> = {obituary:'obituaries',marriage:'marriages',birth:'births',enslavement:'enslavements',crime:'crimeArticles'};
export function articleId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[1-9]\d{0,19}|[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i.test(value)) throw new Error('Article IDs must be UUIDs or positive decimal strings.');
  return value.toLowerCase();
}
export function recordType(value: unknown): RecordType {
  if (value !== 'page' && !articleTypes.includes(value as ArticleType)) throw new Error('Record type must be page, obituary, marriage, birth, enslavement, or crime.');
  return value as RecordType;
}
export interface Rectangle {x:number;y:number;width:number;height:number}
export function rectangle(value: any, pageWidth: number, pageHeight: number): Rectangle {
  if (!value || ![pageWidth,pageHeight].every(n=>Number.isSafeInteger(n)&&n>0&&n<=100_000)
      || !['x','y','width','height'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k]))
      || value.x<0 || value.y<0 || value.width<=0 || value.height<=0 || value.rotation != null && value.rotation!==0) throw new NewspapersError('api-changed');
  const result={x:Math.ceil(value.x),y:Math.ceil(value.y),width:Math.ceil(value.width),height:Math.ceil(value.height)};
  if (result.x+result.width>pageWidth || result.y+result.height>pageHeight) throw new NewspapersError('api-changed');
  return result;
}
/** The viewer rounds each normalized polygon edge to original scan pixels. */
function polygonRectangle(polygon: unknown, pageWidth: number, pageHeight: number): Rectangle {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 10_000
      || !polygon.every(point => point && ['x','y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 1))) throw new NewspapersError('api-changed');
  const x = Math.round(Math.min(...polygon.map(point => point.x)) * pageWidth);
  const y = Math.round(Math.min(...polygon.map(point => point.y)) * pageHeight);
  return rectangle({x,y,width:Math.round(Math.max(...polygon.map(point => point.x)) * pageWidth)-x,
    height:Math.round(Math.max(...polygon.map(point => point.y)) * pageHeight)-y},pageWidth,pageHeight);
}
export function selectArticle(value: any, authorization: any, pageId: string, requestedId: string, type?: ArticleType) {
  const citation=pageMetadata(authorization,pageId), matches:{type:ArticleType;record:any}[]=[];
  for (const kind of type ? [type] : articleTypes) {
    const records=value?.[articleCollections[kind]] ?? (kind==='crime'?[]:undefined);
    if (!Array.isArray(records)) throw new NewspapersError('api-changed');
    for (const record of records) {
      const entityId=kind==='crime'?record?.crime?.CrimeId:record?.id;
      if (String(entityId).toLowerCase()===requestedId) matches.push({type:kind,record});
    }
  }
  if (!matches.length) throw new NewspapersError('not-found',404);
  const match=matches[0], {width,height}=authorization.image;
  if (matches.some(item=>item.type!==match.type)) throw new Error('More than one article category matches this ID; supply --type.');
  const crops=matches.map(item=>item.type==='enslavement'||item.type==='birth'
    ? polygonRectangle(item.record.polygon,width,height)
    : rectangle(item.record.rectangle,width,height));
  const crop=crops[0];
  if (crops.some(other=>other.x!==crop.x||other.y!==crop.y||other.width!==crop.width||other.height!==crop.height)) throw new NewspapersError('api-changed');
  return {pageId,articleId:requestedId,type:match.type,rectangle:crop,sourceUrl:`${WEB}/image/${pageId}/?article=${requestedId}`,
    citation,details:publicValue(matches.map(item=>item.record)),note:'Provider-extracted names, relationships, and events may be incorrect; verify them against the scan.'};
}
export function clippingRecord(value: any, requestedId: string) {
  if (!value || String(value.clipping_id)!==requestedId || !/^[1-9]\d{0,19}$/.test(String(value.page_id)) || typeof value.title!=='string') throw new NewspapersError('api-changed');
  return {...publicValue(value),clippingId:requestedId,pageId:String(value.page_id),sourceUrl:`${WEB}/clipping/${requestedId}/`};
}
