import {CookieJar} from 'tough-cookie';
import {loginTab, waitForLogin, type BrowserLoginOptions} from '../shared/browser-login.js';
import {endpointId, rememberBrowser} from '../shared/browser-config.js';
import {updateCookieJar} from '../shared/browser-runtime.js';
import {graphqlOperation} from './catalog.js';
import {saveFindmypastSession, type FindmypastBrowserSession} from './auth.js';

export async function loginFindmypast(options: BrowserLoginOptions & {region?: string} = {}): Promise<FindmypastBrowserSession> {
  const region = options.region ?? 'com';
  if (!['com','co.uk'].includes(region)) throw new Error('--region must be com or co.uk.');
  const tab = await loginTab('findmypast', `https://www.findmypast.${region}/sign-in`);
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
