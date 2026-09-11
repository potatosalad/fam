import {CookieJar} from 'tough-cookie';
import {BrowserError,directOnly,endpointId,loadProviderSession,saveProviderSession} from '../shared/browser-config.js';
import {configuredBrowser,updateCookieJar} from '../shared/browser-runtime.js';
import {waitForLogin,type BrowserLoginOptions} from '../shared/browser-login.js';
import {isChallengeResponse} from '../shared/browser-challenge.js';
import {loadLoginCredentials} from '../shared/credentials.js';
import {parseJson} from '../shared/json.js';
import {Fold3Http,Fold3Error,WEB} from './http.js';
import {account,hydration} from './parse.js';
export interface Fold3Session {mode:'native'|'browser';browserInstance?:string;cookies:ReturnType<CookieJar['serializeSync']>;savedAt:string;userAgent?:string}
export const loadSession=()=>loadProviderSession<Fold3Session>('fold3');
export const saveSession=(value:Fold3Session)=>saveProviderSession('fold3',value);
export const sessionStatus=(s?:Fold3Session)=>({sessionSaved:!!s,mode:s?.mode??null,savedAt:s?.savedAt??null,expiresAt:null,refreshAvailable:!!s});
export async function loginNative(http=new Fold3Http()):Promise<Fold3Session> {
  const bootstrap=await http.request(`${WEB}/login`,{native:true}),csrf=hydration(bootstrap.text()).F3_PAGE_DATA.csrf;
  if(typeof csrf!=='string'||!csrf)throw new Fold3Error('api-changed');
  const credentials=await loadLoginCredentials('fold3');
  await http.request(`${WEB}/node/auth/user`,{body:credentials,csrf,native:true});
  account(await http.json(`${WEB}/node/refreshUser`,{native:true}));
  const session:Fold3Session={mode:'native',cookies:http.jar.serializeSync(),savedAt:new Date().toISOString()};await saveSession(session);return session;
}
export async function loginBrowser(options:BrowserLoginOptions={}):Promise<Fold3Session> {
  if(await directOnly())throw new Error('Browser login needs --transport browser or auto. Use --native to attempt one native login.');
  const browser=await configuredBrowser(),tab=await browser.tab('fold3',`${WEB}/login`);
  return waitForLogin(tab,[WEB],async page=>{
    if(page?.origin!==WEB)return;
    const response=await tab.request(`${WEB}/node/refreshUser`);
    if(await isChallengeResponse(response)||response.status===401)return;
    if(!response.ok)throw new BrowserError(`Fold3 account verification failed (HTTP ${response.status}).`,'BROWSER_LOGIN_VERIFICATION_FAILED');
    const text=await response.text();if(!text.trim())return;
    let current;try{current=parseJson(text);}catch{throw new Fold3Error('api-changed');}
    account(current);
    const jar=new CookieJar();await updateCookieJar(jar,await browser.state('fold3'),WEB);
    const session:Fold3Session={mode:'browser',browserInstance:endpointId(browser.config),cookies:jar.serializeSync(),savedAt:new Date().toISOString(),userAgent:await tab.evaluate<string>('navigator.userAgent')};
    await saveSession(session);return session;
  },options);
}
