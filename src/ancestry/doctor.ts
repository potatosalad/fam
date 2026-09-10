import type { AncestrySession } from './auth.js';
import { refreshAncestrySession } from './session.js';
import { AncestryHttp, GATEWAY } from './http.js';
import { graphqlOperation } from './catalog.js';
import { cookies, expiry, graphql, nonempty, object, requireResponse, requireSession, type DoctorProvider } from '../shared/doctor-checks.js';

function headers(s: AncestrySession) {
  return {Authorization: `Bearer ${s.tokens.access_token}`, 'Ancestry-UserId': s.tokens.user_id!,
    'Ancestry-ClientPath': 'Mobile.AndroidApp', 'Ancestry-CultureId': 'en-US', 'X-PreferredCountry': 'US'};
}
export const doctorProvider: DoctorProvider = {
  service: 'ancestry', sessionFile: 'ancestry/session.json',
  inspect(value) {
    const s = object(value), tokens = object(s.tokens);
    requireSession(nonempty(tokens.access_token) && nonempty(tokens.refresh_token) && nonempty(tokens.user_id) && nonempty(s.deviceId));
    cookies(s.cookies, true);
    return {mode: 'native', expiresAt: expiry(s.expiresAt), refreshAvailable: nonempty(tokens.refresh_token)};
  },
  recovery: () => 'Run fam ancestry.session login and complete any account verification.',
  login: {kind: 'credentials', async run() {return (await import('./auth.js')).authenticateAncestry();}},
  refresh(value) {const s = value as AncestrySession; return refreshAncestrySession(new AncestryHttp(s.cookies), s);},
  pending: [{file: 'ancestry/pending-auth.json', check: () => ({id: 'verification', status: 'warning', code: 'verification-pending', scope: 'password-login',
    message: 'A sign-in is awaiting account verification.', action: 'Run fam ancestry.session login --send-code, then fam ancestry.session login --code CODE. Complete other verification methods on Ancestry.'})}],
  probe: {id: 'trees', label: 'Authenticated tree listing', async run(value) {
      const s = value as AncestrySession, http = new AncestryHttp(s.cookies);
      const data = await graphql(http, `${GATEWAY}/graphql/federation`, graphqlOperation('GetTreeList'), {limit: 1}, headers(s));
      requireResponse(Array.isArray(data.trees?.treeConnection?.nodes));
      return {session: {...s, cookies: http.jar.serializeSync(), savedAt: new Date().toISOString()}};
  }},
  limitations: ['Only the authenticated tree list is checked, with a one-tree limit. Tree contents, searches, downloads, and writes are not probed.'],
};
