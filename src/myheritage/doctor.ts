import { renewMyHeritage, type MyHeritageSession } from './auth.js';
import { MyHeritageHttp, FAMILYGRAPH } from './http.js';
import { checkTreePageUrl, pageValue, parseTreePage } from './browser.js';
import { cookies, DoctorIssue, nonempty, object, requireResponse, requireSession, type DoctorProvider } from '../shared/doctor-checks.js';

export const doctorProvider: DoctorProvider = {
  service: 'myheritage', sessionFile: 'myheritage/session.json',
  inspect(value) {
    const s = object(value);
    requireSession(nonempty(s.accessToken) && nonempty(s.deviceId) && [undefined, 'native', 'browser'].includes(s.mode));
    cookies(s.cookies, true);
    if (s.mode === 'browser') {requireSession(nonempty(object(s.browser).pageUrl)); checkTreePageUrl(s.browser.pageUrl);}
    return {mode: s.mode ?? 'native', refreshAvailable: s.mode !== 'browser'};
  },
  recovery: () => 'Sign in on MyHeritage and import a fresh browser session with fam myheritage auth --har FILE.',
  refresh(value) {const s = value as MyHeritageSession; return renewMyHeritage(new MyHeritageHttp(s.cookies), s);},
  pending: [
    {file: 'myheritage/pending-auth.json', check: () => ({id: 'verification', status: 'warning', code: 'verification-pending', scope: 'password-login', message: 'Password sign-in requires verification.',
      action: 'Complete website verification and import a fresh HAR with fam myheritage auth --har FILE; for native MFA, use fam myheritage auth --code CODE.'})},
    {file: 'myheritage/login-block.json', check(value, now) {
      const date = Date.parse(object(value).blockedUntil);
      requireSession(Number.isFinite(date));
      if (date > now) return {id: 'login-block', status: 'warning', code: 'login-blocked', scope: 'password-login', message: `Password sign-in is blocked until ${new Date(date).toISOString()}.`,
        action: 'Wait until the block expires before signing in again; complete any website verification.'};
    }},
  ],
  probe: {id: 'account', label: 'Saved-session access', async run(value) {
      const s = value as MyHeritageSession, http = new MyHeritageHttp(s.cookies);
      if (s.mode === 'browser') {
        // The authenticated page supplies current API credentials without native login.
        const url = checkTreePageUrl(s.browser!.pageUrl);
        const {data} = await http.exchange<string>(url, {response: 'text', headers: s.browser?.userAgent ? {'User-Agent': s.browser.userAgent} : {}});
        const loggedIn = pageValue(data, 'isLoggedIn');
        if (loggedIn === false) throw new DoctorIssue('session-rejected');
        requireResponse(loggedIn === true && nonempty(pageValue(data, 'currentUserAccountID')));
        const page = parseTreePage(data);
        return {session: {...s, accessToken: page.token, userId: `user-${page.accountId}`,
          cookies: http.jar.serializeSync(), savedAt: new Date().toISOString()}};
      }
      const data = object((await http.exchange(`${FAMILYGRAPH}/me`, {headers: {Authorization: `Bearer ${s.accessToken}`}, query: {fields: 'id'}})).data);
      if (!data.id) throw new DoctorIssue('session-rejected');
      requireResponse(typeof data.id === 'string' && /^user-[A-Za-z0-9]+$/.test(data.id));
      return {session: {...s, cookies: http.jar.serializeSync(), savedAt: new Date().toISOString()}};
  }},
  limitations: ['Browser mode reads only the saved tree page; native mode reads only account ID. Catalogs, searches, tree API calls, downloads, and writes are not probed.'],
};
