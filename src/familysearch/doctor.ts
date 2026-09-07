import { CHURCH_CLIENT_ID, type SavedSession } from './auth.js';
import { FS_ORIGIN, HttpSession, MOBILE_USER_AGENT } from './http.js';
import { refreshFamilySearchTokens } from './session.js';
import { cookies, DoctorIssue, expiry, nonempty, object, requireResponse, requireSession, type DoctorProvider } from '../shared/doctor-checks.js';

async function read(session: unknown, path: string, accept = 'application/x-fs-v1+json') {
  const s = session as SavedSession;
  const http = new HttpSession(s.cookies);
  const data = object((await http.exchange(`${FS_ORIGIN}${path}`, {headers: {
    Authorization: `Bearer ${s.tokens.access_token}`, Accept: accept,
    'User-Agent': MOBILE_USER_AGENT, 'FS-User-Agent-Chain': MOBILE_USER_AGENT,
  }})).data);
  return {data, session: {...s, cookies: http.jar.serializeSync()}};
}
async function currentUser(session: unknown) {
  const {data: result, session: next} = await read(session, '/platform/users/current');
  requireResponse(Array.isArray(result.users));
  if (!result.users[0]?.id) throw new DoctorIssue('session-rejected');
  return {session: next};
}
export const doctorProvider: DoctorProvider = {
  service: 'familysearch', sessionFile: 'session.json',
  inspect(value) {
    const s = object(value), tokens = object(s.tokens);
    requireSession(s.version === 1 && s.clientId === CHURCH_CLIENT_ID && Number.isFinite(Date.parse(s.obtainedAt)) && nonempty(tokens.access_token));
    cookies(s.cookies, true);
    if (tokens.expires_in !== undefined) requireSession(typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in) && tokens.expires_in >= 0);
    return {mode: 'native', refreshAvailable: nonempty(tokens.refresh_token),
      expiresAt: expiry(tokens.expires_in === undefined ? undefined : Date.parse(s.obtainedAt) + tokens.expires_in * 1000)};
  },
  recovery: () => 'Run fam familysearch auth and complete any Church Account verification.',
  async refresh(value) {
    const s = value as SavedSession, http = new HttpSession(s.cookies);
    const tokens = await refreshFamilySearchTokens(http, s);
    return {...s, tokens, obtainedAt: new Date().toISOString(), cookies: http.jar.serializeSync()};
  },
  probe: {id: 'account', label: 'Current account', run: currentUser},
  limitations: ['Only session access is checked. Tree contents, searches, downloads, and writes are not probed.'],
};
