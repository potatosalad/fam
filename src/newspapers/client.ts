import {NewspapersHttp, NewspapersError, WEB} from './http.js';
import {account, pageMetadata, publicValue} from './parse.js';
import {loadSession, loginNewspapers, saveSession, type NewspapersSession} from './auth.js';
import {directOnly} from '../shared/browser-config.js';
import {downloadPage} from './download.js';
import {articleId, articleTypes, recordType, selectArticle, clippingRecord, type ArticleType, type RecordType} from './records.js';
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) throw new Error('Newspapers IDs must be positive decimal strings.');
  return value;
}
export function integer(value: number, min = 1, max = 100) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Expected an integer between ${min} and ${max}.`);
  return value;
}
export function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Use a real calendar date in YYYY-MM-DD form.');
  return value;
}
function text(value: string, max = 2000) {if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`Expected nonempty text of at most ${max} characters.`); return value.trim();}
export interface SearchOptions {type?:RecordType; keyword?:string; publicationId?:string; country?:string; region?:string; city?:string; from?:string; to?:string; sort?:'score'|'date-asc'|'date-desc'; limit?:number; cursor?:string}
export function searchQuery(options: SearchOptions = {}) {
  const query: Record<string,string> = {product:'1','entity-types':recordType(options.type ?? 'page'),count:String(integer(options.limit ?? 20)),start:options.cursor === undefined ? '*' : text(options.cursor,4096)};
  if (!options.keyword?.trim() && !options.publicationId) throw new Error('Supply --keyword or --publication-id.');
  if (options.keyword !== undefined) query.keyword = text(options.keyword);
  if (options.publicationId !== undefined) query['publication-ids'] = id(options.publicationId);
  for (const key of ['country','region','city'] as const) if (options[key] !== undefined) query[key] = text(options[key],200).toLowerCase();
  if (query.country && !/^[a-z]{2}$/.test(query.country)) throw new Error('--country needs a two-letter country code, such as us.');
  if (query.region && !/^[a-z]{2}-[a-z0-9]{1,3}$/.test(query.region)) throw new Error('--region needs a country-region code, such as us-ut.');
  if (query.city && !query.country && !query.region) throw new Error('--city requires --country or --region.');
  if (!!options.from !== !!options.to) throw new Error('Use --from and --to together.');
  if (options.from && options.to) {query['date-start']=date(options.from);query['date-end']=date(options.to);if (options.from > options.to) throw new Error('--from must be on or before --to.');}
  if (options.sort !== undefined) {if (!['score','date-asc','date-desc'].includes(options.sort)) throw new Error('Sort must be score, date-asc, or date-desc.');query.sort=options.sort==='score'?'score-desc':`paper-${options.sort}`;}
  return query;
}
export interface ClippingSearchOptions {keyword?:string;user?:string;mine?:boolean;tag?:string;region?:string;publicationId?:string;from?:string;to?:string;sort?:'modified-desc'|'modified-asc'|'date-desc'|'date-asc'|'score';limit?:number;cursor?:string}
export function clippingQuery(options:ClippingSearchOptions={}) {
  if(options.mine!==undefined&&typeof options.mine!=='boolean')throw new Error('mine must be a boolean.');
  if(options.mine&&options.user!==undefined)throw new Error('Choose --mine or --user.');
  const query:Record<string,string>={product_id:'1',visibility:options.mine?'all':'public',count:String(integer(options.limit??24)),cursor_mark:options.cursor===undefined?'*':text(options.cursor,4096)};
  for(const key of ['keyword','user','tag','region'] as const)if(options[key]!==undefined)query[key]=text(options[key]!,key==='keyword'?2000:200);
  if(options.publicationId!==undefined)query.title=id(options.publicationId);
  if(!!options.from!==!!options.to)throw new Error('Use --from and --to together.');
  if(options.from&&options.to){query.date_start=date(options.from);query.date_end=date(options.to);if(options.from>options.to)throw new Error('--from must be on or before --to.');}
  if(options.sort!==undefined){if(!['modified-desc','modified-asc','date-desc','date-asc','score'].includes(options.sort))throw new Error('Unknown clipping sort.');query.sort=options.sort==='score'?'score-desc':options.sort.startsWith('date-')?`paper-${options.sort}`:options.sort;}
  return query;
}
export const operations = {
  account: {method:'GET',path:'/account/',input:{},description:'Authenticated account data from serialized website JSON; no billing details or tokens.'},
  search: {method:'GET',path:'/api/search/query',input:{type:'page | obituary | marriage | birth | enslavement | crime?',keyword:'string?',publicationId:'decimal ID?',country:'string?',region:'string?',city:'string?',from:'date?',to:'date?',sort:'score | date-asc | date-desc?',limit:'1–100?',cursor:'opaque nextStart?'},description:'Page or indexed article search with opaque cursor pagination.'},
  article: {method:'GET',path:'/api/article/page/{pageId}/articles',input:{pageId:'decimal ID',articleId:'UUID or decimal ID',type:'obituary | marriage | birth | enslavement | crime?'},description:'Select one indexed article, with extracted people/events, crop coordinates, and citation.'},
  clipping: {method:'GET',path:'/article/api/{clippingId}/',input:{clippingId:'decimal ID'},description:'Clipping details, tags, page identity, and any available OCR; tokens are withheld.'},
  clippingSearch: {method:'GET',path:'/api/clipping/list',input:{keyword:'string?',user:'username or ID?',mine:'boolean?',tag:'string?',region:'place name?',publicationId:'decimal ID?',from:'date?',to:'date?',sort:'modified-desc | modified-asc | date-desc | date-asc | score?',limit:'1–100?',cursor:'opaque next_cursor_mark?'},description:'Search public clippings, or the signed-in account’s own clippings with mine=true.'},
  locations: {method:'GET',path:'/api/title/location/search',input:{prefix:'string',limit:'1–100?'},description:'Place suggestions for search filters.'},
  browse: {method:'GET',path:'/api/browse/1/{path}',input:{path:'browse path?'},description:'Browse the newspaper hierarchy using returned paths.'},
  publication: {method:'GET',path:'/api/browse/get-publication/1/{publicationId}',input:{publicationId:'decimal ID'},description:'Resolve a publication to its browse path and title.'},
  issue: {method:'GET',path:'/api/browse/get-issue/{publicationId}/{date}',input:{publicationId:'decimal ID',date:'YYYY-MM-DD'},description:'List editions and pages in an issue.'},
  page: {method:'GET',path:'/api/client/image/authorize/',input:{pageId:'decimal ID'},description:'Page metadata and current access rights; authorization tokens are withheld.'},
  hits: {method:'GET',path:'/api/search/hits',input:{pageId:'decimal ID',keyword:'string'},description:'Coordinates of keyword matches on the scan.'},
  clippings: {method:'GET',path:'/api/clipping/page',input:{pageId:'decimal ID',offset:'0–1000000?',limit:'1–100?'},description:'Public clippings on a page.'},
  articles: {method:'GET',path:'/api/article/page/{pageId}/articles',input:{pageId:'decimal ID'},description:'Structured article categories using a fresh page authorization.'},
  ocr: {method:'GET',path:'/api/client/image/ocr/',input:{pageId:'decimal ID',articleId:'UUID or decimal ID?',type:'obituary | marriage | birth | enslavement | crime?',clippingId:'decimal ID?',x:'integer?',y:'integer?',width:'integer?',height:'integer?'},description:'Page or selection OCR. An article ID resolves its rectangle automatically; empty/unavailable text is explicit.'},
} as const;
export type Operation = keyof typeof operations;
export class NewspapersClient {
  constructor(private http = new NewspapersHttp(), private session?: NewspapersSession, private renew?: () => Promise<NewspapersSession>) {}
  static async open() {
    const session = await loadSession();
    // Public catalog reads work without an account. Sign-in is explicit, or is
    // renewed once after an existing session is positively rejected.
    return new NewspapersClient(new NewspapersHttp(session?.cookies, undefined, session?.userAgent), session, loginNewspapers);
  }
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {const result = await operation();await this.save();return result;}
    catch (error) {
      if (!(error instanceof NewspapersError) || error.code !== 'session-rejected' || !this.session || !this.renew || await directOnly()) throw error;
      this.session = await this.renew();this.http = this.http.withCookies(this.session.cookies, this.session.userAgent);
      const result = await operation(); await this.save(); return result;
    }
  }
  private async save() {if (this.session) {this.session={...this.session,cookies:this.http.jar.serializeSync(),savedAt:new Date().toISOString()};await saveSession(this.session);}}
  private json(path: string, query: Record<string,string> = {}, headers?: Record<string,string>) {
    const url = new URL(path, WEB); url.search = new URLSearchParams(query).toString();return this.http.json(url, headers);
  }
  me() {return this.run(async () => account((await this.http.get(`${WEB}/account/`)).text()));}
  async verify() {const user=await this.me();return {authenticated:true,isSubscriber:user.isSubscriber,checkedAt:new Date().toISOString()};}
  async refresh() {if (!this.renew) throw new NewspapersError('session-rejected');this.session=await this.renew();this.http=new NewspapersHttp(this.session.cookies,undefined,this.session.userAgent);return this.verify();}
  search(options: SearchOptions = {}) {
    const query = searchQuery(options);
    return this.run(async () => {
      const result = await this.json('/api/search/query',query);
      if (!Array.isArray(result?.records) || !['number','bigint'].includes(typeof result.recordCount) || result.recordCount < 0 || result.nextStart != null && typeof result.nextStart !== 'string') throw new NewspapersError('api-changed');
      return {records:publicValue(result.records),recordCount:result.recordCount,nextCursor:result.records.length ? result.nextStart || null : null,partialResults:result.partialResults === true,
        limit:Number(query.count),type:query['entity-types'], accessNote:'Search results do not establish subscription access to every scan. Indexed people and events are provider extractions; verify them against the image.'};
    });
  }
  locations(prefix: string, limit = 10) {text(prefix,200);integer(limit);return this.run(async () => {const result=await this.json('/api/title/location/search',{prefix,'product-id':'1',count:String(limit)});if (!Array.isArray(result)) throw new NewspapersError('api-changed');return publicValue(result);});}
  browse(path = '') {
    if (!/^\/?[a-zA-Z0-9_/-]*$/.test(path) || path.includes('//') || path.length > 1000) throw new Error('Use a Newspapers browse path containing letters, numbers, slashes, underscores, or hyphens.');
    return this.run(async () => publicValue(await this.json(`/api/browse/1/${path.replace(/^\//,'')}`)));
  }
  publication(publicationId: string) {id(publicationId);return this.run(async () => publicValue(await this.json(`/api/browse/get-publication/1/${publicationId}`)));}
  issue(publicationId: string, issueDate: string) {id(publicationId);date(issueDate);return this.run(async () => publicValue(await this.json(`/api/browse/get-issue/${publicationId}/${issueDate}`)));}
  private async authorize(pageId: string) {
    const result = await this.json('/api/client/image/authorize/',{id:id(pageId),fcfToken:'',pqsid:''});
    pageMetadata(result, pageId);return result;
  }
  page(pageId: string) {id(pageId);return this.run(async () => pageMetadata(await this.authorize(pageId), pageId));}
  download(pageId: string) {id(pageId);return this.run(async () => downloadPage(this.http,pageId,await this.authorize(pageId)));}
  private async articleData(pageId:string, requestedId:string, authorization:any, type?:ArticleType) {
    if(!authorization.image.canView || typeof authorization.iat!=='string')throw new NewspapersError('access-denied');
    const articles=await this.json(`/api/article/page/${pageId}/articles`,{},{Authorization:`Bearer: ${authorization.iat}`});
    return selectArticle(articles,authorization,pageId,requestedId,type);
  }
  article(pageId:string, requestedId:string, type?:ArticleType) {
    id(pageId);requestedId=articleId(requestedId);if(type!==undefined&&!articleTypes.includes(type))throw new Error('Unknown article type.');
    return this.run(async()=>this.articleData(pageId,requestedId,await this.authorize(pageId),type));
  }
  downloadArticle(pageId:string, requestedId:string, type?:ArticleType) {
    id(pageId);requestedId=articleId(requestedId);if(type!==undefined&&!articleTypes.includes(type))throw new Error('Unknown article type.');
    return this.run(async()=>{const authorization=await this.authorize(pageId);const article=await this.articleData(pageId,requestedId,authorization,type);
      return downloadPage(this.http,pageId,authorization,{kind:'article',article});});
  }
  private async clippingData(clippingId:string){return clippingRecord(await this.json(`/article/api/${clippingId}/`),clippingId);}
  clipping(clippingId:string){id(clippingId);return this.run(()=>this.clippingData(clippingId));}
  downloadClipping(clippingId:string){id(clippingId);return this.run(async()=>{const clipping=await this.clippingData(clippingId);return downloadPage(this.http,clipping.pageId,await this.authorize(clipping.pageId),{kind:'clipping',clipping});});}
  searchClippings(options:ClippingSearchOptions={}){
    const query=clippingQuery(options);
    return this.run(async()=>{
      if(options.mine)query.user=account((await this.http.get(`${WEB}/account/`)).text()).id;
      const result=await this.json('/api/clipping/list',query);
      if(!Array.isArray(result?.clippings)||typeof result.more_results!=='boolean')throw new NewspapersError('api-changed');
      const next=result.more_results&&result.clippings.length?result.next_cursor_mark:null;
      if(result.more_results&&(!result.clippings.length||typeof next!=='string'||!next||next===query.cursor_mark))throw new NewspapersError('api-changed');
      return {clippings:publicValue(result.clippings),nextCursor:next||null,moreResults:!!next,limit:Number(query.count),scope:options.mine?'mine':'public'};
    });
  }
  hits(pageId: string, keyword: string) {id(pageId);text(keyword);return this.run(async () => {const result=await this.json('/api/search/hits',{images:pageId,terms:keyword.trim().replace(/\s+/g,'|')});if (!Array.isArray(result)) throw new NewspapersError('api-changed');return {pageId,keyword,hits:publicValue(result[0] ?? [])};});}
  clippings(pageId: string, offset = 0, limit = 25) {id(pageId);integer(offset,0,1_000_000);integer(limit);return this.run(async () => {
    const result=await this.json('/api/clipping/page',{page_id:pageId,start:String(offset),count:String(limit)});
    if (!Array.isArray(result?.clippings) || typeof result.more_clippings !== 'boolean') throw new NewspapersError('api-changed');
    return {...publicValue(result),nextOffset:result.more_clippings && result.clippings.length ? offset+result.clippings.length : null};
  });}
  articles(pageId: string) {id(pageId);return this.run(async () => {
    const value=await this.authorize(pageId); if (!value.image.canView || typeof value.iat !== 'string') throw new NewspapersError('access-denied');
    return publicValue(await this.json(`/api/article/page/${pageId}/articles`,{}, {Authorization:`Bearer: ${value.iat}`}));
  });}
  ocr(pageId: string, options: {articleId?:string;type?:ArticleType;clippingId?:string;x?:number;y?:number;width?:number;height?:number} = {}) {
    id(pageId);if (options.articleId && options.clippingId) throw new Error('Choose an article or clipping, not both.');
    if (options.articleId!==undefined) options={...options,articleId:articleId(options.articleId)};if (options.clippingId) id(options.clippingId);
    if (options.type!==undefined&&(!options.articleId||!articleTypes.includes(options.type))) throw new Error('OCR record type requires an article ID and a supported article type.');
    const rect = ['x','y','width','height'] as const;
    if (rect.some(k=>options[k]!==undefined) && !rect.every(k=>options[k]!==undefined)) throw new Error('Supply x, y, width, and height together.');
    if (options.clippingId && options.x !== undefined) throw new Error('Clipping OCR uses the clipping rectangle; omit coordinates.');
    for (const key of rect) if (options[key] !== undefined) integer(options[key]!, key==='x'||key==='y'?0:1,100000);
    return this.run(async () => {
      const value=await this.authorize(pageId);if (!value.image.canView || typeof value.iat !== 'string') throw new NewspapersError('access-denied');
      const selection = options.articleId&&options.x===undefined ? (await this.articleData(pageId,options.articleId,value,options.type)).rectangle
        : !options.clippingId && options.x === undefined ? {x:0,y:0,width:integer(value.image.width,1,100000),height:integer(value.image.height,1,100000)} : options;
      if (selection.x !== undefined && (selection.x+selection.width! > value.image.width || selection.y!+selection.height! > value.image.height)) throw new Error('OCR rectangle exceeds the page dimensions.');
      const query:Record<string,string>={page:pageId,type:options.clippingId?'clipping':'article',objectId:options.clippingId ?? options.articleId ?? '',iat:value.iat};
      for (const key of rect) if (selection[key]!==undefined) query[key]=String(selection[key]);
      const result=await this.json('/api/client/image/ocr/',query);if (typeof result?.ocr !== 'string') throw new NewspapersError('api-changed');
      return {pageId,text:result.ocr,available:!!result.ocr.trim(),sourceUrl:`${WEB}/image/${pageId}/`,note:'Machine OCR may be unavailable for this selection or account; verify names and dates against the scan.'};
    });
  }
  call(name: string, input: Record<string,any> = {}): Promise<unknown> {
    if (!Object.hasOwn(operations,name)) throw new Error('Unknown Newspapers read operation. Run fam newspapers.api list.');
    const operation=operations[name as Operation];
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!Object.hasOwn(operation.input,k))) throw new Error('Input contains unsupported fields. Run fam newspapers.api describe --operation NAME.');
    for (const [key,type] of Object.entries(operation.input)) if (!type.endsWith('?') && input[key]===undefined) throw new Error(`Missing input: ${key}.`);
    switch (name as Operation) {
      case 'account':return this.me();case 'search':return this.search(input);case 'locations':return this.locations(input.prefix,input.limit);case 'browse':return this.browse(input.path);
      case 'article':return this.article(input.pageId,input.articleId,input.type);case 'clipping':return this.clipping(input.clippingId);case 'clippingSearch':return this.searchClippings(input);
      case 'publication':return this.publication(input.publicationId);case 'issue':return this.issue(input.publicationId,input.date);case 'page':return this.page(input.pageId);
      case 'hits':return this.hits(input.pageId,input.keyword);case 'clippings':return this.clippings(input.pageId,input.offset,input.limit);case 'articles':return this.articles(input.pageId);
      case 'ocr':{const {pageId,...options}=input;return this.ocr(pageId,options);}
    }
  }
}
