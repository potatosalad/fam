import {CookieJar} from 'tough-cookie';
import {BrowserError, directOnly, endpointId, loadProviderSession, saveProviderSession} from '../shared/browser-config.js';
import {configuredBrowser, BrowserTab, updateCookieJar} from '../shared/browser-runtime.js';
import {waitForLogin, type BrowserLoginOptions} from '../shared/browser-login.js';
import {isChallengeResponse} from '../shared/browser-challenge.js';
import {account} from './parse.js';
import {NewspapersError, WEB} from './http.js';
export interface NewspapersSession {mode:'browser'; browserInstance:string; cookies:ReturnType<CookieJar['serializeSync']>; savedAt:string; userAgent?:string}
export const loadSession = () => loadProviderSession<NewspapersSession>('newspapers');
export const saveSession = (session: NewspapersSession) => saveProviderSession('newspapers', session);
export const sessionStatus = (session?: NewspapersSession) => ({sessionSaved:!!session, mode:session?.mode ?? null, savedAt:session?.savedAt ?? null, expiresAt:null, refreshAvailable:!!session});
export async function loginNewspapers(options: BrowserLoginOptions = {}): Promise<NewspapersSession> {
  if (await directOnly()) throw new NewspapersError('session-rejected');
  const browser = await configuredBrowser();
  const reusable = (value: string) => {try {const u=new URL(value);return u.origin === WEB && !u.username && !u.password && !u.pathname.startsWith('/.fam-browser-');} catch {return false;}};
  const existing = await browser.api<{tabs:{tabId:string;url:string;listItemId:string}[]}>(`/tabs?userId=${encodeURIComponent(browser.userId('newspapers'))}`);
  let tab: BrowserTab | undefined;
  for (const saved of existing.tabs ?? []) if (saved.listItemId === 'fam' && reusable(saved.url)) {
    const candidate = new BrowserTab(browser,'newspapers',saved.tabId);
    try {if (reusable(await candidate.evaluate<string>('location.href'))) {tab=candidate;break;}} catch {}
  }
  tab ??= await browser.tab('newspapers', `${WEB}/signin/`);
  let redirected = false;
  return waitForLogin(tab, [WEB], async page => {
    if (page?.origin !== WEB) return;
    const response = await tab!.request(`${WEB}/account/`);
    if (await isChallengeResponse(response)) return;
    if (!response.ok && response.status !== 401) throw new BrowserError(`Newspapers account verification failed (HTTP ${response.status}). The saved session was not replaced.`, 'BROWSER_LOGIN_VERIFICATION_FAILED');
    try {
      if (response.status === 401) throw new NewspapersError('session-rejected');
      account(await response.text());
    } catch (error) {
      if (!(error instanceof NewspapersError) || error.code !== 'session-rejected') throw error;
      if (!redirected && !page.email && !page.password && !page.url?.includes('/signin')) {redirected=true;await tab!.navigate(`${WEB}/signin/`);}
      return;
    }
    const jar = new CookieJar(); await updateCookieJar(jar, await browser.state('newspapers'), WEB);
    const session: NewspapersSession = {mode:'browser',browserInstance:endpointId(browser.config),cookies:jar.serializeSync(),savedAt:new Date().toISOString(),userAgent:await tab!.evaluate<string>('navigator.userAgent')};
    await saveSession(session); return session;
  }, {...options, readyToSubmit:async () => tab!.evaluate<boolean>(`!!document.querySelector('input[name="cf-turnstile-response"]')?.value`)});
}
