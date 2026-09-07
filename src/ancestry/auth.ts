import { loadLoginCredentials } from '../shared/credentials.js';
import { createHash, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../shared/storage.js';
import { AncestryHttp, AUTH, GATEWAY, USER_AGENT } from './http.js';

// Public Android application identifiers extracted from signed build 18.16.3, auth/a.a().
export const CLIENT_ID = '6faee385e875e51bf783bc678c5157f4c9b329bb';
export const CLIENT_SECRET = '67ee41eea8c604b8187047cf8bc1bdf34a1364838716c7fb8af9cab912941c36';
export interface AncestryTokens {
  access_token: string; refresh_token: string; token_type: string; scope: string;
  user_id?: string; expires_in?: string | number; must_change_password_before_next_login?: boolean;
}
export interface AncestrySession { tokens: AncestryTokens; expiresAt: number; savedAt: string; deviceId: string; cookies: ReturnType<AncestryHttp['jar']['serializeSync']>; }
export interface Login { username: string; password: string; }
interface PendingAuth { verification_token: string; user_id: string; method?: {type?: string; device?: string}; savedAt?: string; }
export async function loadAncestryCredentials(): Promise<Login> {
  return loadLoginCredentials('ancestry');
}
export interface PreAuthChallenge { algorithm: string; sessionId: string; algorithmParameters: {n: number; r: number}; authFlow?: string; authFlows?: string[]; }
/** Reproduce the APK's sha256-mod-v1 login proof, with a bounded CPU deadline. */
export function solvePreAuth(challenge: PreAuthChallenge, identity: string, deviceId: string, timeoutMs = 5000): string {
  const {n, r} = challenge.algorithmParameters ?? {};
  if (challenge.algorithm !== 'sha256-mod-v1' || !challenge.sessionId || !Number.isSafeInteger(n) || n <= 0 || !Number.isSafeInteger(r) || r < 0 || r >= n) throw new Error('Unsupported Ancestry pre-auth challenge.');
  const started = Date.now();
  for (let key = 0; Date.now() - started <= timeoutMs; key++) {
    const hash = createHash('sha256').update(`${challenge.sessionId}${key}${identity}${deviceId}`).digest('hex').toUpperCase();
    if (BigInt(`0x${hash}`) % BigInt(n) === BigInt(r)) return Buffer.from(JSON.stringify({solution_hash: hash, solution_time_ms: Date.now() - started, key, session_id: challenge.sessionId})).toString('base64');
  }
  throw new Error('Ancestry pre-auth proof timed out.');
}
export async function tokenRequest(http: AncestryHttp, fields: Record<string, string>, refresh = false): Promise<AncestryTokens> {
  const data = (await http.exchange<AncestryTokens>(`${AUTH}/${refresh ? 'oauth20' : 'ancauth'}/tokens`, {
    method: 'POST', encoding: 'raw', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...fields}).toString(),
  })).data;
  if (refresh && data.access_token) data.refresh_token ||= fields.refresh_token!;
  if (data.must_change_password_before_next_login) throw new Error('Ancestry requires a password change. Complete it on Ancestry, then run fam ancestry auth again.');
  if (!data.access_token || !data.refresh_token) {
    if (fields.service_provider === 'user_credentials' && typeof (data as unknown as PendingAuth).verification_token === 'string') {
      await writePrivateJson('ancestry/pending-auth.json', {...data, savedAt: new Date().toISOString()});
      throw new Error('Ancestry requires email verification. Run fam ancestry auth --send-code, then fam ancestry auth --code CODE.');
    }
    throw new Error('Ancestry returned an incomplete token response; run fam ancestry auth to sign in again.');
  }
  return data;
}
export async function saveAncestrySession(http: AncestryHttp, tokens: AncestryTokens, deviceId: string, expiresAt?: number): Promise<AncestrySession> {
  const seconds = Number(tokens.expires_in);
  const session = {tokens, deviceId, savedAt: new Date().toISOString(), expiresAt: expiresAt ?? (Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0), cookies: http.jar.serializeSync()};
  await writePrivateJson('ancestry/session.json', session);
  if (expiresAt === undefined) await rm(join(CREDENTIAL_DIR, 'ancestry/pending-auth.json'), {force: true});
  return session;
}
async function pendingAuth(): Promise<PendingAuth> {
  const pending = await readPrivateJson<PendingAuth>('ancestry/pending-auth.json');
  if (!pending?.verification_token) throw new Error('No pending Ancestry verification; run fam ancestry auth first.');
  return pending;
}
export async function sendAncestryCode(): Promise<{sent: boolean; method?: string; destination?: string}> {
  const pending = await pendingAuth();
  const type = pending.method?.type?.toLowerCase();
  if (type !== 'email') throw new Error('This account needs a verification method other than email. Complete sign-in on Ancestry.');
  const http = new AncestryHttp();
  const client = await tokenRequest(http, {service_provider: 'client_credentials', scope: '*'});
  await http.exchange(`${GATEWAY}/ims/mfa/email/resendcode`, {method: 'POST', headers: {Authorization: `Bearer ${client.access_token}`, 'verify-uauth-v1': pending.verification_token}, response: 'void'});
  return {sent: true, method: 'email', destination: pending.method?.device};
}
export async function verifyAncestryCode(code: string): Promise<AncestrySession> {
  if (!/^\d{4,10}$/.test(code)) throw new Error('Enter the numeric Ancestry verification code.');
  const pending = await pendingAuth();
  const device = await readPrivateJson<{id: string}>('ancestry/device.json');
  if (!device?.id) throw new Error('Missing Ancestry device state; run fam ancestry auth again.');
  const http = new AncestryHttp();
  const tokens = await tokenRequest(http, {service_provider: 'mfa_credentials', scope: '*', mfa_code: code, verification_token: pending.verification_token,
    device_name: 'Android', os_version: '16', app_name: 'Ancestry Mobile App', os: 'Android'});
  if (!tokens.user_id) throw new Error('Ancestry returned no signed-in user after verification.');
  return saveAncestrySession(http, tokens, device.id);
}
export async function authenticateAncestry(): Promise<AncestrySession> {
  const login = await loadAncestryCredentials();
  const prior = await readPrivateJson<AncestrySession>('ancestry/session.json');
  const device = await readPrivateJson<{id: string}>('ancestry/device.json');
  const deviceId = prior?.deviceId ?? device?.id ?? randomUUID();
  await writePrivateJson('ancestry/device.json', {id: deviceId});
  const http = new AncestryHttp();
  const client = await tokenRequest(http, {service_provider: 'client_credentials', scope: '*'});
  const challenge = (await http.exchange<PreAuthChallenge>(`${GATEWAY}/auth/pre-auth`, {
    method: 'POST', headers: {Authorization: `Bearer ${client.access_token}`},
    body: {device: {deviceId, deviceName: 'Android', appName: 'Ancestry Mobile App', os: 'Android', osVersion: '16', userAgent: USER_AGENT}, identity: login.username, supportedAlgorithms: ['sha256-mod-v1']},
  })).data;
  const proof = solvePreAuth(challenge, login.username, deviceId);
  const tokens = await tokenRequest(http, {service_provider: 'user_credentials', scope: '*', username: login.username, password: login.password,
    token: proof, device_id: deviceId, device_name: 'Android', os_version: '16', app_name: 'Ancestry Mobile App', os: 'Android', autosend: 'false'});
  if (!tokens.user_id) throw new Error('Ancestry returned a client token without a signed-in user.');
  return saveAncestrySession(http, tokens, deviceId);
}
