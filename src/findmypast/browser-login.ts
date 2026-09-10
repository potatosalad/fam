import {CookieJar} from 'tough-cookie';
import {waitForLogin, type BrowserLoginOptions} from '../shared/browser-login.js';
import {BrowserError, endpointId, rememberBrowser} from '../shared/browser-config.js';
import {BrowserTab, configuredBrowser, updateCookieJar} from '../shared/browser-runtime.js';
import {isChallengeResponse} from '../shared/browser-challenge.js';
import {graphqlOperation} from './catalog.js';
import {isFindmypastAuthenticationFailure, saveFindmypastSession, type FindmypastBrowserSession} from './auth.js';

export async function loginFindmypast(options: BrowserLoginOptions & {region?: string} = {}): Promise<FindmypastBrowserSession> {
  const region = options.region ?? 'com';
  if (!['com','co.uk'].includes(region)) throw new Error('--region must be com or co.uk.');
  const website = `https://www.findmypast.${region}`;
  const browser = await configuredBrowser();
  const reusable = (value: string) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password && [website, 'https://auth.findmypast.com'].includes(url.origin)
        && !url.pathname.startsWith('/.fam-browser-');
    } catch {return false;}
  };
  const existing = await browser.api<{tabs: {tabId: string; url: string; listItemId: string}[]}>(`/tabs?userId=${encodeURIComponent(browser.userId('findmypast'))}`);
  const tabs = (existing.tabs ?? []).filter(tab => tab.listItemId === 'fam' && reusable(tab.url));
  const priority = (value: string) => {const url = new URL(value); return url.origin !== website ? 0 : url.pathname === '/sign-in' ? 1 : 2;};
  tabs.sort((a, b) => priority(b.url) - priority(a.url));
  let reused: BrowserTab | undefined;
  for (const existing of tabs) {
    const candidate = new BrowserTab(browser, 'findmypast', existing.tabId);
    try {
      if (reusable(await candidate.evaluate<string>('location.href'))) {reused = candidate; break;}
    } catch { /* Closed or crashed pages can remain in Camofox's tab list. */ }
  }
  // Preserve an in-progress sign-in and its rendered page, as with MyHeritage.
  // Transport-only documents have no login UI and must not be adopted here.
  const tab = reused ?? await browser.tab('findmypast', `${website}/sign-in`);
  let signInStarted = false;
  const failed = (detail: string) => new BrowserError(`Findmypast account verification failed (${detail}). The saved session was not replaced.`, 'BROWSER_LOGIN_VERIFICATION_FAILED', browser.endpoint.vncUrl);
  return waitForLogin(tab, ['https://www.findmypast.com','https://www.findmypast.co.uk','https://auth.findmypast.com'], async page => {
    let current: URL;
    try {current = new URL(await tab.evaluate<string>('location.href'));} catch {return;}
    const origin = current.origin;
    if (!['https://www.findmypast.com','https://www.findmypast.co.uk'].includes(origin)) return;
    let response: Response;
    try {
      response = await tab.request(`${origin}/titan/marshal/graphql`, {method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({operationName: 'GetCurrentUserProfile', query: graphqlOperation('GetCurrentUserProfile').document, variables: {}})});
    } catch (error) {
      // A login redirect can race the same-origin request. Other transport
      // failures need their actual diagnostic, not a sign-in timeout.
      try {if (new URL(await tab.evaluate<string>('location.href')).origin !== origin) return;} catch {return;}
      throw error;
    }
    if (await isChallengeResponse(response)) return;
    if (!response.ok && response.status !== 401) throw failed(`HTTP ${response.status}`);
    let data;
    if (response.ok) {try {data = await response.json();} catch {throw failed('expected account JSON');}}
    const signedOut = response.status === 401 || isFindmypastAuthenticationFailure(data)
      || data?.data?.currentUserProfile === null && !data.errors?.length;
    if (signedOut) {
      // A retained /home or research tab can outlive its cookies. It has no
      // sign-in form, so waiting there will never let the user authenticate.
      if (!signInStarted && page && !page.email && !page.password && page.url === current.href && current.pathname !== '/sign-in') {
        signInStarted = true;
        await tab.navigate(`${origin}/sign-in`);
      }
      return;
    }
    if (typeof data?.data?.currentUserProfile?.id !== 'string' || !data.data.currentUserProfile.id || data.errors?.length) throw failed('no verified account');
    const jar = new CookieJar(); await updateCookieJar(jar, await tab.browser.state('findmypast'), origin);
    const session: FindmypastBrowserSession = {mode:'browser', browserInstance: endpointId(tab.browser.config), apiBase:`${origin}/titan/marshal`, cookies:jar.serializeSync(), savedAt:new Date().toISOString()};
    await rememberBrowser('findmypast', origin); await saveFindmypastSession(session); return session;
  }, options);
}
