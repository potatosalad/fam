import {load} from 'cheerio';
import {loadLoginCredentials, type Credentials} from '../shared/credentials.js';
import {readPrivateJson, writePrivateJson} from '../shared/storage.js';
import {AmericanAncestorsHttp, AmericanAncestorsError, WEB, APP, ACCOUNT} from './http.js';
export interface AmericanAncestorsSession {
  version: 1; savedAt: string; validatedAt: string; cookies: ReturnType<AmericanAncestorsHttp['jar']['serializeSync']>;
}
export const loadSession = () => readPrivateJson<AmericanAncestorsSession>('americanancestors/session.json');
export const saveSession = (session: AmericanAncestorsSession) => writePrivateJson('americanancestors/session.json', session);
export function validSession(session?: AmericanAncestorsSession): session is AmericanAncestorsSession {
  return session?.version === 1 && !!session.cookies?.cookies?.length && typeof session.savedAt === 'string' && typeof session.validatedAt === 'string';
}
export function sessionStatus(session?: AmericanAncestorsSession) {
  return {sessionSaved: validSession(session), mode: 'native', savedAt: session?.savedAt ?? null, validatedAt: session?.validatedAt ?? null, passwordRetryAutomatic: false, refreshAvailable: false};
}
export async function readAccount(http: AmericanAncestorsHttp) {
  const {text} = await http.text(`${WEB}/search/advanced-search`, {redirects: false});
  if (!load(text)('a.nav-link--user-logout').length) throw new AmericanAncestorsError('session-rejected');
  return {authenticated: true, sourceUrl: `${WEB}/search/advanced-search`, note: 'Signed-in website session. Membership and image rights vary by collection.'};
}
export async function authenticate(http = new AmericanAncestorsHttp(), credentials?: Credentials, save = saveSession) {
  const login = credentials ?? await loadLoginCredentials('americanancestors');
  const returnUrl = `${APP}/account/refreshcredentials?returnurl=${WEB}/search/advanced-search`;
  const url = `${ACCOUNT}/account/login?${new URLSearchParams({ReturnUrl: returnUrl})}`;
  const page = await http.text(url), $ = load(page.text), form = $('#tn-login-form');
  const token = form.find('input[name=__RequestVerificationToken]').attr('value');
  if (form.length !== 1 || !token || new URL(form.attr('action') || page.url, page.url).href !== url) throw new AmericanAncestorsError('api-changed');
  const result = await http.text(url, {body: new URLSearchParams({__RequestVerificationToken: token, 'PatronAccountLogin.Username': login.username, 'PatronAccountLogin.Password': login.password})});
  if (load(result.text)('#tn-login-form').length) throw new AmericanAncestorsError('session-rejected');
  await readAccount(http);
  const now = new Date().toISOString();
  const session: AmericanAncestorsSession = {version: 1, savedAt: now, validatedAt: now, cookies: http.jar.serializeSync()};
  await save(session); return session;
}
