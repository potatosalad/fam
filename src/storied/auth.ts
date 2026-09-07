import { randomUUID } from 'node:crypto';
import { readPrivateJson, writePrivateJson } from '../shared/storage.js';
import { CLIENT_ID, StoriedHttp } from './http.js';

export const REDIRECT_URI = 'com.storied.auth0://auth.storied.com/android/com.storied/callback';

export interface StoriedSession {
  accessToken: string; refreshToken?: string; expiresAt: number; sessionId: string;
  subject: string; savedAt: string; validatedAt?: string;
}
export const saveSession = (s: StoriedSession) => writePrivateJson('storied/session.json', s);
export const loadSession = () => readPrivateJson<StoriedSession>('storied/session.json');
export function validSession(value: unknown): value is StoriedSession {
  const s = value as StoriedSession | undefined;
  return !!s && typeof s.accessToken === 'string' && !!s.accessToken && !/[\r\n\0]/.test(s.accessToken)
    && typeof s.subject === 'string' && !!s.subject && typeof s.sessionId === 'string' && /^[\da-f-]{36}$/i.test(s.sessionId)
    && Number.isFinite(s.expiresAt) && s.expiresAt > 0 && (s.refreshToken === undefined || typeof s.refreshToken === 'string' && !!s.refreshToken);
}
export function sessionStatus(s?: StoriedSession) {
  return {sessionSaved: validSession(s), mode: 'native', savedAt: s?.savedAt ?? null, validatedAt: s?.validatedAt ?? null,
    expiresAt: validSession(s) ? new Date(s.expiresAt).toISOString() : null, refreshAvailable: !!s?.refreshToken};
}
function tokenSession(value: unknown, previous?: StoriedSession): StoriedSession {
  const t = value as {access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; token_type?: unknown};
  if (!t || typeof t.access_token !== 'string' || !t.access_token || /[\r\n\0]/.test(t.access_token)
    || typeof t.expires_in !== 'number' || !Number.isFinite(t.expires_in) || t.expires_in <= 0
    || String(t.token_type).toLowerCase() !== 'bearer'
    || t.refresh_token !== undefined && (typeof t.refresh_token !== 'string' || !t.refresh_token)) throw new Error('Storied returned an invalid token response.');
  return {accessToken: t.access_token, refreshToken: t.refresh_token as string | undefined ?? previous?.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000, sessionId: previous?.sessionId ?? randomUUID(), subject: previous?.subject ?? '', savedAt: new Date().toISOString()};
}
export async function acceptAuthorizationCode(code: string, verifier: string, http = new StoriedHttp(), save = saveSession): Promise<StoriedSession> {
  const response = await http.request('/oauth/token', {auth: true, method: 'POST', body: {
    grant_type: 'authorization_code', client_id: CLIENT_ID, code, code_verifier: verifier, redirect_uri: REDIRECT_URI,
  }});
  const session = tokenSession(response);
  const info = await http.request('/userinfo', {auth: true, token: session.accessToken}) as {sub?: unknown};
  if (!info || typeof info.sub !== 'string' || !info.sub) throw new Error('Storied login returned no account identity; session was not saved.');
  session.subject = info.sub;
  await validateAccess(http, session);
  session.validatedAt = new Date().toISOString();
  await save(session); return session;
}
export async function validateAccess(http: StoriedHttp, s: StoriedSession): Promise<unknown[]> {
  const trees = await http.request('/api/Users/trees?numberOfTrees=1&includePersonCount=false', {token: s.accessToken, sessionId: s.sessionId});
  if (!Array.isArray(trees)) throw new Error('Storied tree response format changed; account access is unverified.');
  return trees;
}
/** One refresh request, no password fallback; callers save successful rotation before further reads. */
export async function refreshStoried(s: StoriedSession, http = new StoriedHttp()): Promise<StoriedSession> {
  if (!validSession(s) || !s.refreshToken) throw new Error('No Storied refresh token is available. Run fam storied auth.');
  return tokenSession(await http.request('/oauth/token', {auth: true, method: 'POST', body: {
    grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: s.refreshToken,
  }}), s);
}
