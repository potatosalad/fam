import * as cheerio from 'cheerio';
import { loadLoginCredentials, type Credentials } from '../shared/credentials.js';
import { readPrivateJson, writePrivateJson } from '../shared/storage.js';
import { GeneanetHttp, GeneanetError, WEB, API } from './http.js';
import { pageKeys } from './parse.js';

export interface GeneanetSession {
  version: 1; username: string; savedAt: string; validatedAt: string;
  cookies: ReturnType<GeneanetHttp['jar']['serializeSync']>;
}
export interface GeneanetAccount { username: string; fullname?: string; premium?: boolean; country?: string; dateCreate?: string }
export const saveSession = (session: GeneanetSession) => writePrivateJson('geneanet/session.json', session);
export const loadSession = () => readPrivateJson<GeneanetSession>('geneanet/session.json');
export function sessionStatus(session?: GeneanetSession) {
  return {sessionSaved: Boolean(session?.username && session.cookies?.cookies?.length), mode: 'web',
    savedAt: session?.savedAt ?? null, validatedAt: session?.validatedAt ?? null,
    passwordRetryAutomatic: false, refreshAvailable: false};
}
export async function readAccount(http: GeneanetHttp, expected?: string): Promise<GeneanetAccount> {
  const {text} = await http.text(`${WEB}/`);
  const user = pageKeys(text).user;
  if (!user || typeof user.username !== 'string' || !user.username || typeof user.jwt_token !== 'string' || !user.jwt_token) throw new GeneanetError('session-rejected');
  if (expected && user.username !== expected) throw new GeneanetError('session-rejected');
  const account = await http.json<Record<string, unknown>>(`${API}/user/current`, {token: user.jwt_token});
  if (account.username !== user.username) throw new GeneanetError('session-rejected');
  // /user/current includes jwt_token; expose only the documented profile fields.
  return {username: user.username, ...(typeof account.fullname === 'string' ? {fullname: account.fullname} : {}),
    ...(typeof account.premium === 'boolean' ? {premium: account.premium} : {}),
    ...(typeof account.country === 'string' ? {country: account.country} : {}),
    ...(typeof account.date_create === 'string' ? {dateCreate: account.date_create} : {})};
}
export async function authenticateGeneanet(http = new GeneanetHttp(), credentials?: Credentials,
  save: (session: GeneanetSession) => Promise<void> = saveSession): Promise<GeneanetSession> {
  const login = credentials ?? await loadLoginCredentials('geneanet');
  const page = await http.text(`${WEB}/connexion/`), $ = cheerio.load(page.text);
  const form = $('form').filter((_i, e) => $(e).find('input[name="_password"]').length > 0);
  const csrf = form.find('input[name="_csrf_token"]').attr('value');
  if (form.length !== 1 || !csrf || new URL(form.attr('action') ?? '', page.url).href !== `${WEB}/connexion/login_check`) throw new GeneanetError('api-changed');
  const response = await http.text(`${WEB}/connexion/login_check`, {body: new URLSearchParams({_username: login.username, _password: login.password, _remember_me: 'on', _csrf_token: csrf})});
  if (cheerio.load(response.text)('input[name="_password"]').length) throw new Error('Geneanet sign-in failed. Check credentials or complete account verification on the website. Login was not retried.');
  const account = await readAccount(http), now = new Date().toISOString();
  const session: GeneanetSession = {version: 1, username: account.username, savedAt: now, validatedAt: now, cookies: http.jar.serializeSync()};
  await save(session); return session;
}
