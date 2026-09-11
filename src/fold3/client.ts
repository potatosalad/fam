import {Fold3Http,Fold3Error,WEB} from './http.js';
import {loadSession,saveSession,type Fold3Session} from './auth.js';
import {account,hit,id,imageDetails,integer,object,page,publication,publicData} from './parse.js';
export const types = {research:['IMAGE','INDEX_RECORD','STORY_PAGE'],image:['IMAGE'],record:['INDEX_RECORD'],memorial:['STORY_PAGE'],unit:['MILITARY_UNIT'],publication:['PUBLICATION'],all:[]} as const;
export interface SearchOptions {keyword?:string;name?:string;type?:keyof typeof types;publicationId?:string;place?:string;conflict?:string;serviceNumber?:string;year?:number;birthYear?:number;deathYear?:number;limit?:number;offset?:number;sort?:'RELEVANCE'|'CHRONOLOGICAL_ASC'|'CHRONOLOGICAL_DESC'|'ALPHABETICAL'|'LAST_MODIFIED';filter?:string[];field?:string[];facet?:string[]}
const facetName=(value:string)=>{if(typeof value!=='string'||! /^[a-z][a-z0-9.-]{0,150}$/.test(value))throw new Error('Expected a Fold3 facet/field name.');return value;};
function pair(text:string){const at=text.indexOf('=');if(at<1||!text.slice(at+1).trim())throw new Error('Use NAME=VALUE for --filter and --field.');return [facetName(text.slice(0,at)),text.slice(at+1)] as const;}
export function searchQuery(options:SearchOptions={},facetsOnly=false) {
  object(options);
  const allowed=['keyword','name','type','publicationId','place','conflict','serviceNumber','year','birthYear','deathYear','limit','offset','sort','filter','field','facet'];
  if(Object.keys(options).some(key=>!allowed.includes(key)))throw new Error('Unknown Fold3 search option. Inspect fam fold3.api describe --operation search.');
  for(const key of ['keyword','name','place','conflict','serviceNumber'] as const)if(options[key]!==undefined&&typeof options[key]!=='string')throw new Error(`Fold3 ${key} must be a string.`);
  for(const key of ['filter','field','facet'] as const)if(options[key]!==undefined&&(!Array.isArray(options[key])||options[key]!.some(v=>typeof v!=='string')))throw new Error(`Fold3 ${key} must be an array of strings.`);
  const type=options.type??'research';if(!Object.hasOwn(types,type))throw new Error('Unknown Fold3 record type.');
  const maxCount=integer(options.limit??20,1,100),offset=integer(options.offset??0);
  if(offset+maxCount>10000)throw new Error('Fold3 search is bounded to 10,000 results; narrow the search before continuing.');
  const filters:Array<{type:string;values:string[];filterType:string;strict:boolean;exclude:boolean}>=[];
  const add=(name:string,value?:string)=>{if(value!==undefined&&value.trim()){const existing=filters.find(f=>f.type===name);if(existing)existing.values.push(value);else filters.push({type:name,values:[value],filterType:'TERM',strict:true,exclude:false});}};
  for(const t of types[type])add('general.title.content.doc-type',t);
  if(options.publicationId!==undefined)add('general.title.id',id(options.publicationId));
  add('place',options.place);add('military.conflict',options.conflict);add('military.service-number',options.serviceNumber);
  for(const [key,year] of Object.entries({date:options.year,'date.vital.birth':options.birthYear,'date.vital.death':options.deathYear}))if(year!==undefined)add(key,String(integer(year,1,9999)));
  for(const value of options.filter??[]){const [name,text]=pair(value);add(name,text);}
  const fieldedKeywords:Array<{type:string;texts:string[];strict:boolean;exclude:boolean}>=[];
  if(options.name?.trim())fieldedKeywords.push({type:'full-name',texts:[options.name.trim()],strict:true,exclude:false});
  for(const value of options.field??[]){const [name,text]=pair(value);fieldedKeywords.push({type:name,texts:[text],strict:true,exclude:false});}
  if(!facetsOnly&&!options.keyword?.trim()&&!fieldedKeywords.length&&!filters.some(f=>f.type!=='general.title.content.doc-type'))throw new Error('Supply a name, keyword, publication, or research filter.');
  const sortOrder=options.sort??'RELEVANCE';if(!['RELEVANCE','CHRONOLOGICAL_ASC','CHRONOLOGICAL_DESC','ALPHABETICAL','LAST_MODIFIED'].includes(sortOrder))throw new Error('Unknown Fold3 sort order.');
  const facets=options.facet??(facetsOnly?['general.title.id']:[]);
  if(facets.length>10)throw new Error('Request at most 10 facets.');
  return {keywords:options.keyword?.trim()??'',fieldedKeywords,filters,maxCount:facetsOnly?0:maxCount,offset:facetsOnly?0:offset,sortOrder,ocr:true,
    facetRequests:facets.map(type=>({type:facetName(type),maxCount,mode:'ALL'})),highlight:{highlight:true}};
}
export const operations = {
  search:{method:'POST',path:'/fold31-search/doc-search',input:'SearchOptions (name, keyword, type, publicationId, filter[], field[], facet[], limit, offset)',description:'Search records with facets and OCR highlights.'},
  facets:{method:'POST',path:'/fold31-search/doc-search',input:'SearchOptions; facet[] selects facet names',description:'Browse publication, place, conflict, date, and other facets.'},
  publications:{method:'GET',path:'/fold31/api/publication',input:'{keyword?, limit?, offset?}',description:'Fetch the public publication catalog and filter/page it locally.'},
  publication:{method:'GET',path:'/fold31/api/publication/pub/{id}',input:'{id}',description:'Publication description, source metadata, and configured access level.'},
  record:{method:'GET',path:'/record/{id}',input:'{id}',description:'Indexed record, source citation, and related records from page hydration.'},
  memorial:{method:'GET',path:'/memorial/{id}',input:'{id}',description:'Memorial facts, stories, and source links from page hydration.'},
  unit:{method:'GET',path:'/unit/{id}',input:'{id}',description:'Military unit history and research links from page hydration.'},
  image:{method:'GET',path:'/fold31-image-data/image/document/IMAGE/{id}?flag=PERMISSIONS',input:'{id}',description:'Scan metadata and current account permissions; no authorization tokens in output.'},
  filmstrip:{method:'GET',path:'/fold31-search/filmstrip/{id}',input:'{id, limit?}',description:'Neighboring scan IDs and document clusters; continue from a returned image ID.'},
  ocr:{method:'GET',path:'/fold31-image-data/ocr/text/IMAGE/{id}',input:'{id}',description:'Machine transcription when supplied by the provider.'},
  'ocr-hits':{method:'GET',path:'/fold31-image-data/ocr/hits/IMAGE/{id}',input:'{id, keyword}',description:'Keyword bounding boxes in provider scan coordinates.'},
} as const;
export type Operation=keyof typeof operations;
export class Fold3Client {
  constructor(readonly http=new Fold3Http(),private session?:Fold3Session){}
  static async open(){const session=await loadSession();return new Fold3Client(new Fold3Http(session?.cookies,undefined,session?.userAgent),session);}
  async me(){return account(await this.http.json(`${WEB}/node/refreshUser`));}
  async verify(){await this.me();return {authenticated:true,checkedAt:new Date().toISOString(),note:'Sign-in does not imply access to subscription records.'};}
  async refresh(){if(!this.session)throw new Fold3Error('session-rejected');await this.me();this.session={...this.session,cookies:this.http.jar.serializeSync(),savedAt:new Date().toISOString()};await saveSession(this.session);return {authenticated:true,savedAt:this.session.savedAt,note:'Revalidated existing cookies. If expired, run fam fold3.session login.'};}
  async search(options:SearchOptions={},facetsOnly=false){
    const query=searchQuery(options,facetsOnly),result=object(await this.http.json(`${WEB}/fold31-search/doc-search`,{body:query}));
    if(!Array.isArray(result.hits)||!Number.isSafeInteger(result.total)||result.total<0)throw new Fold3Error('api-changed');
    const incomplete=result.timedOut===true||Number(result.shards?.failed??0)>0||(!facetsOnly&&result.hits.length===0&&result.total>query.offset);
    const next=query.offset+result.hits.length;
    return {items:result.hits.map(hit),total:result.total,offset:query.offset,limit:query.maxCount,
      nextOffset:!facetsOnly&&!incomplete&&result.hits.length>0&&next<result.total&&next<10000?next:null,
      incomplete,windowLimitReached:!facetsOnly&&next>=10000&&next<result.total,
      facets:publicData(result.facets??[]),query,took:result.took,sourceUrl:`${WEB}/search`,
      note:'Search metadata does not establish image or download access. Facet values are provider identifiers; reuse them verbatim.'};
  }
  facets(options:SearchOptions={}){return this.search(options,true);}
  async publications(keyword='',limit=20,offset=0){
    integer(limit,1,1000);integer(offset,0,100000);
    const result=await this.http.json(`${WEB}/fold31/api/publication`);if(!Array.isArray(result))throw new Fold3Error('api-changed');
    const all=result.map(publication).filter(v=>!keyword||`${v.title} ${v.description}`.toLowerCase().includes(keyword.toLowerCase()));
    return {items:all.slice(offset,offset+limit),total:all.length,offset,limit,nextOffset:offset+limit<all.length?offset+limit:null,pagination:'The website catalog is fetched once per call; keyword filtering and pagination are local.'};
  }
  async publication(value:string){return publication(await this.http.json(`${WEB}/fold31/api/publication/pub/${id(value)}`));}
  async record(value:string,kind:'record'|'memorial'|'unit'|'document'='record'){
    if(!['record','memorial','unit','document'].includes(kind))throw new Error('Unsupported Fold3 page type.');
    const result=await this.http.request(`${WEB}/${kind}/${id(value)}`);return page(result.text(),result.url);
  }
  async image(value:string){const identity=id(value);return imageDetails(await this.imageAuthorization(identity,false),identity);}
  async imageAuthorization(value:string,token=true){return this.http.json(`${WEB}/fold31-image-data/image/document/IMAGE/${id(value)}?flag=PERMISSIONS${token?'&flag=TOKEN':''}`);}
  async filmstrip(value:string,limit=20){
    const identity=id(value);integer(limit,1,100);const result=object(await this.http.json(`${WEB}/fold31-search/filmstrip/${identity}?count=${limit}&prev-count=0`));
    if(!Array.isArray(result.n))throw new Fold3Error('api-changed');
    const nodes=result.n.map((v:any)=>({imageId:id(v.i),imageTitle:v.t,clusterId:v.c,ordinal:v.o,sourceUrl:`${WEB}/image/${id(v.i)}`}));
    const clusters=(result.c??[]).map((v:any)=>({clusterId:v.i,title:v.t,slug:v.g,size:v.z,sortKey:v.s,file:v.f}));
    return {anchorImageId:result.a==null?identity:id(result.a),nodes,clusters:publicData(clusters),sourceUrl:`${WEB}/image/${identity}`,note:'A filmstrip fragment, not a complete roll. Continue from a returned imageId; cluster boundaries may change.'};
  }
  async ocr(value:string){
    const identity=id(value),result=await this.http.request(`${WEB}/fold31-image-data/ocr/text/IMAGE/${identity}`);
    let text=result.text();
    if(/json/i.test(result.contentType)){const {parseJson}=await import('../shared/json.js');let j:any;try{j=parseJson(text);}catch{throw new Fold3Error('api-changed');}text=typeof j==='string'?j:j?.value;}
    if(typeof text!=='string'||!text.trim())throw new Error('Fold3 did not supply OCR for this scan.');
    if(/<(!doctype|html|body)\b/i.test(text))throw new Fold3Error('api-changed');
    return {imageId:identity,text,sourceUrl:`${WEB}/image/${identity}`,note:'Machine OCR can misread names and dates; verify against the scan.'};
  }
  async ocrHits(value:string,keyword:string){if(typeof keyword!=='string'||!keyword.trim())throw new Error('Supply --keyword for OCR hits.');const identity=id(value);
    const result=await this.http.json(`${WEB}/fold31-image-data/ocr/hits/IMAGE/${identity}?keyword=${encodeURIComponent(keyword)}`);if(!Array.isArray(result))throw new Fold3Error('api-changed');
    return {imageId:identity,keyword,rectangles:publicData(result),coordinateFormat:'Provider compact rectangles, in scan coordinates.'};
  }
  async call(name:string,input:Record<string,any>={}){
    if(!Object.hasOwn(operations,name))throw new Error('Unknown Fold3 read operation. Run fam fold3.api list.');object(input);
    const keys=name==='search'||name==='facets'?undefined:name==='publications'?['keyword','limit','offset']:name==='filmstrip'?['id','limit']:name==='ocr-hits'?['id','keyword']:['id'];
    if(keys&&Object.keys(input).some(key=>!keys.includes(key)))throw new Error('Unknown Fold3 operation input. Inspect fam fold3.api describe.');
    switch(name as Operation){case 'search':return this.search(input);case 'facets':return this.facets(input);case 'publications':return this.publications(input.keyword,input.limit,input.offset);case 'publication':return this.publication(input.id);case 'record':return this.record(input.id);case 'memorial':return this.record(input.id,'memorial');case 'unit':return this.record(input.id,'unit');case 'image':return this.image(input.id);case 'filmstrip':return this.filmstrip(input.id,input.limit);case 'ocr':return this.ocr(input.id);case 'ocr-hits':return this.ocrHits(input.id,input.keyword);}
  }
}
