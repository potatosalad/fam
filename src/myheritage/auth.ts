import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from '../shared/storage.js';
import { loadMyHeritageCredentials } from './credentials.js';
import { MyHeritageHttp, FAMILYGRAPH, WEB } from './http.js';
import { parseTreePage } from './browser.js';

export interface MyHeritageAuthResponse {
  resultCode: number; description: string; accessToken?: string; accountId?: string; userId?: string;
  data12p?: string; tfaMethod?: string; tfaPhoneLast4Digits?: string;
}
export interface MyHeritageSession {
  accessToken: string; accountId?: string; mode?: 'native' | 'browser'; userId?: string; data12p?: string;
  browser?: {pageUrl: string; userAgent?: string};
  deviceId: string; savedAt: string; cookies: ReturnType<MyHeritageHttp['jar']['serializeSync']>;
}
function decodeXml(text: string): string {
  if (text.startsWith('<![CDATA[') && text.endsWith(']]>')) return text.slice(9, -3);
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name: string) => {
    const entities: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
    if (name.startsWith('#')) {
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (code > 0x10ffff || code === 0 || (code >= 0xd800 && code <= 0xdfff)) throw new Error('Invalid XML character in MyHeritage response.');
      return String.fromCodePoint(code);
    }
    return entities[name.toLowerCase()]!;
  });
}
/** Parse only the native login envelope. No DTDs, external entities or executable XML. */
export function parseAuthResponse(xml: string): MyHeritageAuthResponse {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<MyHeritage\b/.test(xml)) throw new Error('Unexpected MyHeritage authentication response.');
  const result = xml.match(/<Result\b([^>]*)>\s*(-?\d+)\s*<\/Result>/);
  if (!result) throw new Error('MyHeritage authentication response has no result code.');
  const field = (name: string) => {const value = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`))?.[1]; return value === undefined ? undefined : decodeXml(value.trim());};
  return {resultCode: Number(result[2]), description: decodeXml(result[1]!.match(/\bdesc=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find(v => v !== undefined) ?? ''),
    accessToken: field('FamilyGraphAccessToken'), accountId: field('AccountID'), userId: field('PlaintextAccountID'),
    data12p: field('data12p'), tfaMethod: field('TfaMethod'), tfaPhoneLast4Digits: field('TfaPhoneLast4Digits')};
}
export function deviceFields(deviceId: string): Record<string, string> {
  return {DisplayLang: 'EN', Version: '7.5.44', DeviceInfo: 'Android', DevicePlatform: 'Android', DeviceOS: '16',
    DeviceScreen: '1080x2400', DeviceID: deviceId, AppName: 'MyHeritage'};
}
export async function saveMyHeritageSession(http: MyHeritageHttp, session: Omit<MyHeritageSession, 'cookies' | 'savedAt'>): Promise<MyHeritageSession> {
  const saved = {...session, savedAt: new Date().toISOString(), cookies: http.jar.serializeSync()};
  await writePrivateJson('myheritage/session.json', saved);
  await rm(resolve(CREDENTIAL_DIR, 'myheritage/pending-auth.json'), {force: true});
  return saved;
}
export async function authenticateMyHeritage(options: {code?: string; verificationCode?: string; recaptchaToken?: string} = {}): Promise<MyHeritageSession> {
  const pending = await readPrivateJson<{blockedUntil?: string}>('myheritage/login-block.json') ?? await readPrivateJson<{blockedUntil?: string}>('myheritage/pending-auth.json');
  if (pending?.blockedUntil && Date.parse(pending.blockedUntil) > Date.now()) throw new Error(`MyHeritage login is temporarily blocked until ${pending.blockedUntil}. No login request was sent.`);
  const login = await loadMyHeritageCredentials();
  const prior = await readPrivateJson<MyHeritageSession>('myheritage/session.json');
  const device = await readPrivateJson<{id: string}>('myheritage/device.json');
  const deviceId = prior?.deviceId ?? device?.id ?? randomUUID();
  await writePrivateJson('myheritage/device.json', {id: deviceId});
  if (options.code && !/^\d{4,10}$/.test(options.code)) throw new Error('Enter the numeric MyHeritage MFA code.');
  const http = new MyHeritageHttp(prior?.cookies);
  const fields = {...deviceFields(deviceId), Action: 'login', Email: login.username.trim(), Pwd: login.password,
    ...(options.recaptchaToken ? {recaptchaV3Token: options.recaptchaToken} : {}),
    ...(options.code ? {MfaCode: options.code} : {}), ...(options.verificationCode ? {verification_code: options.verificationCode} : {})};
  const response = parseAuthResponse((await http.exchange<string>(`${WEB}/FP/API/Mobile/login.php`, {
    method: 'POST', headers: {Accept: 'application/xml', 'Content-Type': 'application/x-www-form-urlencoded'},
    encoding: 'raw', body: new URLSearchParams(fields).toString(), response: 'text',
  })).data);
  if (response.resultCode !== 0) {
    await writePrivateJson('myheritage/pending-auth.json', {resultCode: response.resultCode, description: response.description,
      method: response.tfaMethod, phoneLast4Digits: response.tfaPhoneLast4Digits, savedAt: new Date().toISOString()});
    throw new Error(`MyHeritage sign-in needs attention (code ${response.resultCode}${response.tfaMethod ? `, method ${response.tfaMethod}` : ''}).${response.tfaMethod ? ' Run fam myheritage.session login --code CODE to complete MFA.' : response.resultCode === -1003 ? ' reCAPTCHA is required. Complete normal browser sign-in when permitted, then use fam myheritage.session login --har FILE. Do not retry during a temporary access block.' : ''}`);
  }
  if (!response.accessToken || !response.accountId) throw new Error('MyHeritage sign-in returned incomplete credentials.');
  return saveMyHeritageSession(http, {accessToken: response.accessToken, accountId: response.accountId, userId: response.userId, data12p: response.data12p, deviceId});
}
export async function refreshMyHeritage(http: MyHeritageHttp, session: MyHeritageSession): Promise<MyHeritageSession> {
  const next = await renewMyHeritage(http, session);
  await writePrivateJson('myheritage/session.json', next);
  return next;
}
export async function renewMyHeritage(http: MyHeritageHttp, session: MyHeritageSession): Promise<MyHeritageSession> {
  if (session.mode === 'browser') throw new Error('Browser sessions refresh from their authenticated tree page, not the native token endpoint.');
  const response = parseAuthResponse((await http.exchange<string>(`${WEB}/FP/API/Mobile/refresh-token.php`, {
    method: 'POST', headers: {Authorization: `Bearer ${session.accessToken}`, Accept: 'application/xml', 'Content-Type': 'application/x-www-form-urlencoded'},
    encoding: 'raw', body: new URLSearchParams(deviceFields(session.deviceId)).toString(), response: 'text',
  })).data);
  if (response.resultCode !== 0 || !response.accessToken) throw new Error(`MyHeritage session refresh failed (code ${response.resultCode}); run fam myheritage.session login.`);
  return {...session, accessToken: response.accessToken, accountId: response.accountId ?? session.accountId,
    userId: response.userId ?? session.userId, data12p: response.data12p ?? session.data12p,
    savedAt: new Date().toISOString(), cookies: http.jar.serializeSync()};
}

/** Import only API authorization from a HAR that the account owner explicitly supplies.
 * Never persist the HAR, response bodies, or unrelated origins. */
export function sessionFromHar(text: string): {accessToken: string; http: MyHeritageHttp; browser?: MyHeritageSession['browser']} {
  if (text.length > 100_000_000) throw new Error('HAR exceeds 100 MB; export only MyHeritage API requests.');
  let har: {log?: {entries?: {request?: {url?: string; headers?: {name: string; value: string}[]; cookies?: {name: string; value: string}[]; queryString?: {name: string; value: string}[]; postData?: {mimeType?: string; text?: string; params?: {name: string; value: string}[]}}; response?: {status?: number; content?: {text?: string; encoding?: string}}}[]}};
  try {har = JSON.parse(text);} catch {throw new Error('Invalid HAR JSON.');}
  const http = new MyHeritageHttp(); let accessToken: string | undefined, pageUrl: string | undefined, userAgent: string | undefined;
  if (!har || !Array.isArray(har.log?.entries)) throw new Error('HAR must contain log.entries.');
  for (const entry of har.log.entries) {
    const r = entry?.request; if (typeof r?.url !== 'string' || !entry.response?.status || entry.response.status < 200 || entry.response.status >= 300) continue;
    let url: URL; try {url = new URL(r.url);} catch {continue;}
    const treePage = url.origin === WEB && !url.username && !url.password && (/^\/family-trees\//.test(url.pathname) || url.pathname === '/FP/family-tree.php');
    let pageToken: string | undefined;
    if (treePage) {
      pageUrl = url.href;
      const content = entry.response.content;
      if (typeof content?.text === 'string') {
        try {pageToken = parseTreePage(content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text).token;}
        catch { /* A public/signed-out tree page is not authentication evidence. */ }
      }
    }
    if (url.username || url.password || !([FAMILYGRAPH, 'https://familygraphql.myheritage.com'].includes(url.origin) ||
      url.origin === WEB && /^\/web-family-graph(?:ql)?(?:\/|$)/.test(url.pathname) || treePage && pageToken)) continue;
    const auth = r.headers?.find(h => h.name.toLowerCase() === 'authorization')?.value;
    let formToken = r.postData?.params?.find(p => ['bearer_token', 'access_token'].includes(p.name))?.value;
    if (!formToken && r.postData?.text) {
      if (r.postData.mimeType?.includes('application/x-www-form-urlencoded')) {const form = new URLSearchParams(r.postData.text); formToken = form.get('bearer_token') ?? form.get('access_token') ?? undefined;}
      else if (r.postData.mimeType?.includes('application/json')) {try {const body = JSON.parse(r.postData.text); formToken = body?.bearer_token ?? body?.access_token;} catch {}}
    }
    const token = pageToken ?? auth?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? r.queryString?.find(q => q.name === 'access_token')?.value ?? url.searchParams.get('access_token') ?? formToken;
    if (typeof token === 'string' && token && !/[\r\n]/.test(token)) accessToken = token;
    if (url.origin === WEB) userAgent = r.headers?.find(h => h.name.toLowerCase() === 'user-agent')?.value;
    const headerCookies = r.headers?.find(h => h.name.toLowerCase() === 'cookie')?.value?.split(/;\s*/).map(c => {
      const index = c.indexOf('='); return {name: c.slice(0, index), value: c.slice(index + 1)};
    }) ?? [];
    for (const cookie of [...headerCookies, ...r.cookies ?? []]) {
      if (/^[!#$%&'*+\-.^_`|~\w]+$/.test(cookie.name) && !/[;\r\n]/.test(cookie.value)) {
        http.jar.setCookieSync(`${cookie.name}=${cookie.value}; Path=/; Secure`, url.href);
      }
    }
  }
  if (!accessToken) throw new Error('No successful MyHeritage API bearer session found. Export a HAR including sensitive headers after a successful login and opening your family tree.');
  return {accessToken, http, ...(pageUrl ? {browser: {pageUrl, userAgent}} : {})};
}
export async function importMyHeritageHar(text: string): Promise<MyHeritageSession> {
  const {accessToken, http, browser} = sessionFromHar(text);
  const device = await readPrivateJson<{id: string}>('myheritage/device.json');
  if (browser) {
    const {MyHeritageBrowser} = await import('./browser.js');
    const session: MyHeritageSession = {accessToken, browser, deviceId: device?.id ?? randomUUID(), mode: 'browser', savedAt: '', cookies: http.jar.serializeSync()};
    const client = new MyHeritageBrowser(session, http, async () => {});
    await client.me(); // Require both a signed-in page and a successful account permissions request.
    return saveMyHeritageSession(http, session);
  }
  // A login page may contain a guest token: validate against /me before storing it.
  const me = (await http.exchange<{id?: string}>(`${FAMILYGRAPH}/me`, {headers: {Authorization: `Bearer ${accessToken}`}, query: {fields: 'id'}})).data;
  if (!me.id || !/^user-[A-Za-z0-9]+$/.test(me.id)) throw new Error('The imported token did not identify a signed-in MyHeritage account.');
  return saveMyHeritageSession(http, {accessToken, userId: me.id, deviceId: device?.id ?? randomUUID(), mode: 'native'});
}
