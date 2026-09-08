import {randomUUID} from 'node:crypto';
import {CookieJar} from 'tough-cookie';
import {loginTab, waitForLogin, browserRead, type BrowserLoginOptions} from '../shared/browser-login.js';
import {endpointId, rememberBrowser} from '../shared/browser-config.js';
import {updateCookieJar} from '../shared/browser-runtime.js';
import {checkTreePageUrl, parseTreePage} from './browser.js';
import {MyHeritageHttp, WEB} from './http.js';
import {saveMyHeritageSession, type MyHeritageSession} from './auth.js';

export async function loginMyHeritage(options: BrowserLoginOptions & {treeUrl?: string} = {}): Promise<MyHeritageSession> {
  const treeUrl = options.treeUrl ? checkTreePageUrl(options.treeUrl).href : undefined;
  const tab = await loginTab('myheritage', treeUrl ?? `${WEB}/login`);
  return waitForLogin(tab, [WEB], async () => {
    let current: {url: string; links: string[]};
    try {current = await tab.evaluate('({url: location.href, links: Array.from(document.querySelectorAll("a[href]"), a => a.href)})');} catch {return;}
    if (new URL(current.url).origin !== WEB) return;
    const candidates = [...new Set(treeUrl ? [treeUrl] : [current.url, ...current.links, `${WEB}/FP/family-tree.php`])]
      .filter(url => {try {checkTreePageUrl(url); return true;} catch {return false;}});
    for (const target of candidates.slice(0, 3)) {
      const response = await browserRead(tab, target); if (!response) continue;
      let tree; try {checkTreePageUrl(response.url); tree = parseTreePage(response.text);} catch {continue;}
      const params = new URLSearchParams({s: tree.siteId, lang: tree.lang, csrf_token: tree.csrf, familyTreeId: tree.treeId});
      let permissions;
      try {const result = await tab.request(`${WEB}/FP/API/FamilyTree/get-current-user-permissions.php?${params}`); if (!result.ok) continue; permissions = await result.json();} catch {continue;}
      if (!permissions || permissions.success === false || permissions.status === 'error' || permissions.error || permissions.errorCode) continue;
      const jar = new CookieJar(); await updateCookieJar(jar, await tab.browser.state('myheritage'), WEB);
      await rememberBrowser('myheritage', WEB);
      return saveMyHeritageSession(new MyHeritageHttp(jar.serializeSync()), {accessToken: tree.token, accountId: tree.accountId, userId: `user-${tree.accountId}`,
        deviceId: randomUUID(), mode: 'browser', browserInstance: endpointId(tab.browser.config), browser: {pageUrl: response.url, userAgent: await tab.evaluate<string>('navigator.userAgent')}});
    }
  }, options);
}
