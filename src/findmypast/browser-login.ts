import {CookieJar} from 'tough-cookie';
import {waitForLogin, type BrowserLoginOptions} from '../shared/browser-login.js';
import {endpointId, rememberBrowser} from '../shared/browser-config.js';
import {BrowserTab, configuredBrowser, updateCookieJar} from '../shared/browser-runtime.js';
import {graphqlOperation} from './catalog.js';
import {saveFindmypastSession, type FindmypastBrowserSession} from './auth.js';

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
  return waitForLogin(tab, ['https://www.findmypast.com','https://www.findmypast.co.uk','https://auth.findmypast.com'], async () => {
    let origin: string;
    try {origin = await tab.evaluate<string>('location.origin');} catch {return;}
    if (!['https://www.findmypast.com','https://www.findmypast.co.uk'].includes(origin)) return;
    let data;
    try {
      const response = await tab.request(`${origin}/titan/marshal/graphql`, {method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({operationName: 'GetCurrentUserProfile', query: graphqlOperation('GetCurrentUserProfile').document, variables: {}})});
      if (!response.ok) return; data = await response.json();
    } catch {return;}
    if (!data?.data?.currentUserProfile?.id || data.errors?.length) return;
    const jar = new CookieJar(); await updateCookieJar(jar, await tab.browser.state('findmypast'), origin);
    const session: FindmypastBrowserSession = {mode:'browser', browserInstance: endpointId(tab.browser.config), apiBase:`${origin}/titan/marshal`, cookies:jar.serializeSync(), savedAt:new Date().toISOString()};
    await rememberBrowser('findmypast', origin); await saveFindmypastSession(session); return session;
  }, options);
}
