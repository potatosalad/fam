import { loadLoginCredentials, type Credentials } from '../credentials.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../storage.js';
import { AUTH, FindmypastHttp, FindmypastHttpError } from './http.js';
import type { CookieJar } from 'tough-cookie';

export const CLIENT_ID = 'HdCksGN9pb2NxepbUqO6Q0iwksi43pwe'; // Public Android OAuth client ID.
export const AUDIENCE = 'https://www.findmypast.com/api';
export type FindmypastCredentials = Credentials;
export interface FindmypastTokens { access_token: string; refresh_token?: string; id_token?: string; token_type: string; expires_in: number; scope?: string; }
export interface FindmypastSession { tokens: FindmypastTokens; expiresAt: number; savedAt: string; }
export interface FindmypastBrowserSession { mode: 'browser'; cookies: ReturnType<CookieJar['serializeSync']>; apiBase: string; savedAt: string; headers?: Record<string,string>; }
export type SavedFindmypastSession = FindmypastSession | FindmypastBrowserSession;
export function isBrowserSession(session?: SavedFindmypastSession): session is FindmypastBrowserSession { return Boolean(session && 'mode' in session && session.mode === 'browser'); }
export const loadFindmypastCredentials = (): Promise<FindmypastCredentials> => loadLoginCredentials('findmypast');
export function loginBody(credentials: FindmypastCredentials) {
  return {client_id: CLIENT_ID, username: credentials.username, password: credentials.password,
    grant_type: 'http://auth0.com/oauth/grant-type/password-realm', realm: 'account', audience: AUDIENCE, scope: 'openid offline_access'};
}
export function sessionFromTokens(tokens: FindmypastTokens, previous?: FindmypastSession): FindmypastSession {
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token ||
    typeof tokens.token_type !== 'string' || tokens.token_type.toLowerCase() !== 'bearer' ||
    !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('Findmypast returned an invalid token response.');
  return {tokens: {...tokens, refresh_token: tokens.refresh_token || previous?.tokens.refresh_token},
    expiresAt: Date.now() + tokens.expires_in * 1000, savedAt: new Date().toISOString()};
}
export async function authenticateFindmypast(http = new FindmypastHttp()): Promise<FindmypastSession> {
  if (await readPrivateJson('findmypast/verification-required.json')) throw new Error('Findmypast requires browser verification. Run findmypast auth --browser.');
  const credentials = await loadFindmypastCredentials();
  let data: FindmypastTokens;
  try { ({data} = await http.exchange<FindmypastTokens>(`${AUTH}/oauth/token`, {method: 'POST', body: loginBody(credentials)})); }
  catch (error) {
    if (error instanceof FindmypastHttpError && ['requires_verification', 'mfa_required', 'mfa_registration_required', 'too_many_attempts'].includes(error.code ?? '')) {
      await writePrivateJson('findmypast/verification-required.json', {code: error.code, at: new Date().toISOString()});
      throw new Error(`Findmypast ${error.code}; complete findmypast auth --browser before another password login.`);
    }
    throw error;
  }
  const session = sessionFromTokens(data);
  await saveFindmypastSession(session);
  return session;
}
export async function refreshFindmypast(session: FindmypastSession, http = new FindmypastHttp()): Promise<FindmypastSession> {
  if (!session.tokens.refresh_token) throw new Error('No Findmypast refresh token; run findmypast auth.');
  const {data} = await http.exchange<FindmypastTokens>(`${AUTH}/oauth/token`, {method: 'POST',
    body: {client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token}});
  return sessionFromTokens(data, session);
}
export const saveFindmypastSession = (session: SavedFindmypastSession) => writePrivateJson('findmypast/session.json', session);
export function sessionStatus(session?: SavedFindmypastSession) {
  if (isBrowserSession(session)) return {sessionSaved: true, mode: 'browser', savedAt:session.savedAt, expiresAt:null, expired:null, refreshAvailable:false};
  return {sessionSaved: Boolean(session?.tokens.access_token), savedAt: session?.savedAt ?? null,
    expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    expired: session ? Date.now() >= session.expiresAt : null, refreshAvailable: Boolean(session?.tokens.refresh_token)};
}
export const REDIRECT_URI = 'com.findmypast.prod://auth.findmypast.com/android/com.findmypast.prod/callback';
interface PendingAuthorization {state: string; verifier: string; createdAt: number;}
export async function beginBrowserAuthorization(): Promise<{url: string; instructions: string}> {
  const pending: PendingAuthorization = {state: randomBytes(32).toString('base64url'), verifier: randomBytes(32).toString('base64url'), createdAt: Date.now()};
  await writePrivateJson('findmypast/pending-auth.json', pending);
  const params = new URLSearchParams({client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
    audience: AUDIENCE, scope: 'offline_access openid profile email', connection: 'account', mode: 'mobile', prompt: 'login',
    state: pending.state, code_challenge: createHash('sha256').update(pending.verifier).digest('base64url'), code_challenge_method: 'S256'});
  return {url: `${AUTH}/authorize?${params}`, instructions: 'Complete sign-in in your browser, then save the com.findmypast.prod:// callback URL to a private file and run findmypast auth --callback-file FILE. The browser console may show the callback when no Android app is installed.'};
}
export function validateCallback(value: string, pending: PendingAuthorization): string {
  const url = new URL(value.trim());
  if (`${url.protocol}//${url.host}${url.pathname}` !== REDIRECT_URI || url.username || url.password || url.hash) throw new Error('Invalid Findmypast callback URL.');
  if (Date.now() - pending.createdAt > 30 * 60_000) throw new Error('Browser authorization expired; start findmypast auth --browser again.');
  const state = Buffer.from(url.searchParams.get('state') ?? ''), expected = Buffer.from(pending.state);
  if (state.length !== expected.length || !timingSafeEqual(state, expected)) throw new Error('Findmypast callback state mismatch.');
  if (url.searchParams.has('error')) throw new Error('Browser authorization was declined or failed.');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('state').length !== 1) throw new Error('Findmypast callback is missing an authorization code.');
  return code;
}
export async function finishBrowserAuthorization(callback: string, http = new FindmypastHttp()) {
  const pending = await readPrivateJson<PendingAuthorization>('findmypast/pending-auth.json');
  if (!pending) throw new Error('Start findmypast auth --browser first.');
  const code = validateCallback(callback, pending);
  const {data} = await http.exchange<FindmypastTokens>(`${AUTH}/oauth/token`, {method: 'POST', body: {
    client_id: CLIENT_ID, grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: REDIRECT_URI,
  }});
  const session = sessionFromTokens(data); await saveFindmypastSession(session);
  await rm(join(CREDENTIAL_DIR, 'findmypast/pending-auth.json'), {force: true});
  await rm(join(CREDENTIAL_DIR, 'findmypast/verification-required.json'), {force: true});
  return session;
}
