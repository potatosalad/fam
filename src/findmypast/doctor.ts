import { type SavedFindmypastSession, isBrowserSession, refreshFindmypast, type FindmypastSession } from './auth.js';
import { FindmypastHttp, GRAPHQL } from './http.js';
import { graphqlOperation } from './catalog.js';
import { cookies, DoctorIssue, expiry, graphql, nonempty, object, requireResponse, requireSession, type DoctorProvider } from '../shared/doctor-checks.js';

async function query(value: unknown, name: string, variables = {}) {
  const s = value as SavedFindmypastSession, browser = isBrowserSession(s);
  const http = new FindmypastHttp(browser ? s.cookies : undefined);
  const data = await graphql(http, browser ? `${s.apiBase}/graphql` : GRAPHQL, graphqlOperation(name), variables, {
    'apollographql-client-name': 'fmp-mobile-app-android', 'apollographql-client-version': '2.59.0',
    ...(browser ? s.headers : {Authorization: `Bearer ${s.tokens.access_token}`}),
  });
  return {data, session: browser ? {...s, cookies: http.jar.serializeSync(), savedAt: new Date().toISOString()} : undefined};
}
export const doctorProvider: DoctorProvider = {
  service: 'findmypast', sessionFile: 'findmypast/session.json',
  inspect(value) {
    const s = object(value);
    if (s.mode === 'browser') {
      cookies(s.cookies, true);
      requireSession(['https://www.findmypast.co.uk/titan/marshal', 'https://www.findmypast.com/titan/marshal'].includes(s.apiBase));
      requireSession(s.headers === undefined || s.headers !== null && typeof s.headers === 'object' && !Array.isArray(s.headers)
        && Object.entries(s.headers).every(([k, v]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) && nonempty(v)));
      return {mode: 'browser', refreshAvailable: false};
    }
    requireSession(s.mode === undefined && nonempty(object(s.tokens).access_token) && typeof s.expiresAt === 'number' && s.expiresAt > 0);
    return {mode: 'native', expiresAt: expiry(s.expiresAt), refreshAvailable: nonempty(s.tokens.refresh_token)};
  },
  recovery: info => info?.mode === 'native' ? 'Run fam findmypast.session login --browser and complete account verification.'
    : 'Sign in on Findmypast and import a fresh browser session with fam findmypast.session login --har FILE.',
  refresh(value) {return refreshFindmypast(value as FindmypastSession);},
  pending: [
    {file: 'findmypast/verification-required.json', check: () => ({id: 'verification', status: 'warning', code: 'verification-required', scope: 'password-login',
      message: 'Password login requires browser verification; imported browser sessions may still work.',
      action: 'To restore native sign-in, run fam findmypast.session login --browser and complete website verification.'})},
    {file: 'findmypast/pending-auth.json', check: () => ({id: 'browser-auth', status: 'warning', code: 'authorization-pending', scope: 'password-login', message: 'Browser authorization has not been completed.', action: 'Finish with fam findmypast.session login --callback-file FILE, or restart expired authorization with fam findmypast.session login --browser.'})},
  ],
  probe: {id: 'account', label: 'Current account', async run(s) {
      const {data, session} = await query(s, 'GetCurrentUserProfile');
      requireResponse(Object.hasOwn(data, 'currentUserProfile'));
      if (!data.currentUserProfile?.id) throw new DoctorIssue('session-rejected');
      if (session) return {session};
  }},
  limitations: ['Only session access is checked. Trees, catalogs, searches, downloads, and writes are not probed.'],
};
