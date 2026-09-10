import {randomUUID} from 'node:crypto';
import {CookieJar} from 'tough-cookie';
import {waitForLogin, type BrowserLoginOptions} from '../shared/browser-login.js';
import {endpointId, rememberBrowser} from '../shared/browser-config.js';
import {BrowserTab, configuredBrowser, updateCookieJar} from '../shared/browser-runtime.js';
import {checkTreePageUrl, parseTreePage, pageValue} from './browser.js';
import {MyHeritageHttp, WEB} from './http.js';
import {saveMyHeritageSession, type MyHeritageSession} from './auth.js';

export async function loginMyHeritage(options: BrowserLoginOptions & {treeUrl?: string} = {}): Promise<MyHeritageSession> {
  const treeUrl = options.treeUrl ? checkTreePageUrl(options.treeUrl).href : undefined;
  const browser = await configuredBrowser();
  const existing = await browser.api<{tabs: {tabId: string; url: string; listItemId: string}[]}>(`/tabs?userId=${encodeURIComponent(browser.userId('myheritage'))}`);
  const treePage = (url: string) => {try {return checkTreePageUrl(url).href;} catch {return undefined;}};
  const reusable = (value: string) => {
    try {const url = new URL(value); return url.origin === WEB && !url.username && !url.password && !url.pathname.startsWith('/.fam-browser-');} catch {return false;}
  };
  const tabs = (existing.tabs ?? []).filter(tab => tab.listItemId === 'fam' && reusable(tab.url));
  const priority = (url: string) => (treeUrl ? url === treeUrl : treePage(url)) ? 2 : new URL(url).pathname !== '/login' ? 1 : 0;
  tabs.sort((a,b) => priority(b.url) - priority(a.url));
  let reused: BrowserTab | undefined;
  for (const existing of tabs) {
    const candidate = new BrowserTab(browser, 'myheritage', existing.tabId);
    try {
      if (reusable(await candidate.evaluate<string>('location.href'))) {reused = candidate; break;}
    } catch { /* Camofox can retain a tab entry after the user closes its page. */ }
  }
  const tab = reused ?? await browser.tab('myheritage', treeUrl ?? `${WEB}/login`);
  const navigated = new Set<string>();
  return waitForLogin(tab, [WEB], async () => {
    const readPage = () => tab.evaluate<{url: string; links: string[]; html: string}>('({url: location.href, links: Array.from(document.querySelectorAll("a[href]"), a => a.href), html: document.documentElement.outerHTML})');
    let current;
    try {current = await readPage();} catch {return;}
    if (new URL(current.url).origin !== WEB) return;
    // Do not spend the one tree navigation while sign-in is still in progress:
    // it can redirect back to login and leave no attempt after authentication.
    const registration = pageValue(current.html, 'registrationClientData') as {isLoggedIn?: boolean} | undefined;
    if (new URL(current.url).pathname === '/login' || registration?.isLoggedIn === false || pageValue(current.html, 'isLoggedIn') === false) return;
    // The family-site landing page is signed in but has no tree API context.
    // Follow its actual tree link once, allowing the browser to render the page
    // and keeping the manually completed login in the same tab and context.
    if (!treePage(current.url) || treeUrl && treePage(current.url) !== treeUrl) {
      const target = (treeUrl ? [treeUrl] : current.links.map(treePage).filter((url): url is string => !!url)).find(url => !navigated.has(url));
      if (!target || navigated.size) return;
      navigated.add(target);
      try {await tab.navigate(target); current = await readPage();} catch {return;}
    }
    let tree; try {checkTreePageUrl(current.url); tree = parseTreePage(current.html);} catch {return;}
    const params = new URLSearchParams({s: tree.siteId, lang: tree.lang, csrf_token: tree.csrf, familyTreeId: tree.treeId});
    let permissions;
    try {const result = await tab.request(`${WEB}/FP/API/FamilyTree/get-current-user-permissions.php?${params}`); if (!result.ok) return; permissions = await result.json();} catch {return;}
    if (!permissions || permissions.success === false || permissions.status === 'error' || permissions.error || permissions.errorCode) return;
    const jar = new CookieJar(); await updateCookieJar(jar, await tab.browser.state('myheritage'), WEB);
    await rememberBrowser('myheritage', WEB);
    return saveMyHeritageSession(new MyHeritageHttp(jar.serializeSync()), {accessToken: tree.token, accountId: tree.accountId, userId: `user-${tree.accountId}`,
      deviceId: randomUUID(), mode: 'browser', browserInstance: endpointId(tab.browser.config), browser: {pageUrl: current.url, userAgent: await tab.evaluate<string>('navigator.userAgent')}});
  }, options);
}
