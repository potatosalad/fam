import {Impit} from 'impit';
import {CookieJar} from 'tough-cookie';
import {fetchWithBrowser, isChallenge} from '../shared/browser-transport.js';
import {BrowserError} from '../shared/browser-config.js';
import {parseJson, stringifyJson} from '../shared/json.js';
export const WEB = 'https://www.fold3.com';
export const IMG = 'https://img.fold3.com';
export class Fold3Error extends Error {
  constructor(readonly code: 'http' | 'session-rejected' | 'api-changed' | 'access-denied' | 'verification-required' | 'not-found' | 'ocr-unavailable', readonly status?: number) {
    super(code === 'session-rejected' ? 'Fold3 sign-in is required. Run fam fold3.session login.'
      : code === 'access-denied' ? 'Fold3 did not grant this account access to the requested content. Check its Fold3 subscription and record permissions.'
      : code === 'verification-required' ? 'Fold3 requires browser verification. Run fam fold3.session login, or retry the read with --transport browser.'
      : code === 'not-found' ? 'The Fold3 record was not found.'
      : code === 'ocr-unavailable' ? 'Fold3 did not supply OCR for this scan.'
      : code === 'api-changed' ? 'Fold3 returned an unexpected response format.' : `Fold3 HTTP ${status}; the request was not retried.`);
    this.name = 'Fold3Error';
  }
}
export function checkUrl(value: string | URL): URL {
  let url: URL; try {url = new URL(value);} catch {throw new Error('Expected an absolute Fold3 HTTPS URL.');}
  if (![WEB, IMG].includes(url.origin) || url.username || url.password || url.hash) throw new Error('Refusing a request outside the approved Fold3 origins.');
  return url;
}
export type Transport = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'headers' | 'arrayBuffer'> & {body?: ReadableStream<Uint8Array> | null}>;
export class Fold3Http {
  readonly jar: CookieJar;
  private readonly transport: Transport;
  constructor(cookies?: ReturnType<CookieJar['serializeSync']>, transport?: Transport, private userAgent?: string) {
    this.jar = cookies ? CookieJar.deserializeSync(cookies) : new CookieJar();
    const native = new Impit({browser:'chrome',timeout:30_000});
    this.transport = transport ?? ((url, init) => native.fetch(url, init as Parameters<Impit['fetch']>[1]));
  }
  async request(value: string | URL, options: {body?: unknown; csrf?: string; native?: boolean} = {}) {
    let url = checkUrl(value);
    const method = options.body === undefined ? 'GET' : 'POST';
    if (method === 'POST' && (url.origin !== WEB || !['/fold31-search/doc-search','/fold31-search/filmstrip/by-offset','/fold31/api/connection/list-objs','/node/auth/user'].includes(url.pathname))) throw new Error('Unsupported Fold3 POST route.');
    for (let hop = 0; hop < 6; hop++) {
      const cookie = await this.jar.getCookieString(url.href);
      const init: RequestInit = {method,redirect:'manual',headers:{Accept:'application/json, text/html;q=0.9, */*;q=0.8',
        ...(this.userAgent ? {'User-Agent':this.userAgent} : {}), ...(cookie ? {Cookie:cookie} : {}),
        ...(method === 'POST' ? {'Content-Type':'application/json',Origin:WEB,Referer:`${WEB}/login`} : {}),
        ...(options.csrf ? {'x-csrf-token':options.csrf} : {})},
        ...(method === 'POST' ? {body:stringifyJson(options.body)} : {})};
      let response: Response;
      try {
        if (options.native) {const raw = await this.transport(url.href, init);response = new Response([204,205,304].includes(raw.status) ? null : raw.body ?? await raw.arrayBuffer(),{status:raw.status,headers:raw.headers});}
        else response = await fetchWithBrowser('fold3',url,init,()=>this.transport(url.href,init),this.jar);
      } catch(error) {if(error instanceof BrowserError) throw error;throw new Error('Fold3 network request failed.');}
      for (const c of response.headers.getSetCookie()) await this.jar.setCookie(c,url.href,{ignoreError:true});
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        if (method !== 'GET') throw new Fold3Error('api-changed'); // Never replay credentials after a redirect.
        const location=response.headers.get('location');if(!location)throw new Fold3Error('api-changed');
        url=checkUrl(new URL(location,url));continue;
      }
      const max=64*1024*1024;
      if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw new Error('Fold3 response exceeded 64 MiB.');}
      const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
      if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('Fold3 response exceeded 64 MiB.');}chunks.push(value);}}finally{reader.releaseLock();}
      const bytes=Buffer.concat(chunks),text=()=>bytes.toString('utf8');
      if(isChallenge(response.headers,text().slice(0,131072)))throw new Fold3Error('verification-required',response.status);
      if(response.status===401)throw new Fold3Error('session-rejected',401);
      if(response.status===403||response.status===406)throw new Fold3Error('access-denied',response.status);
      if(response.status===404)throw new Fold3Error('not-found',404);
      if(!response.ok)throw new Fold3Error('http',response.status);
      return {url:url.href,bytes,text,contentType:response.headers.get('content-type')??''};
    }
    throw new Error('Fold3 redirect limit exceeded.');
  }
  async json(value: string | URL, options?: Parameters<Fold3Http['request']>[1]): Promise<any> {
    const response=await this.request(value,options);
    if(!response.text().trim()&&new URL(value).pathname==='/node/refreshUser')throw new Fold3Error('session-rejected');
    try{return parseJson(response.text());}catch{throw new Fold3Error('api-changed');}
  }
}
