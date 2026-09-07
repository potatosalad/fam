import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CREDENTIAL_DIR } from '../storage.js';
import { CookieJar } from 'tough-cookie';
import { FindmypastClient } from './client.js';
import { saveFindmypastSession, type FindmypastBrowserSession } from './auth.js';
import { FindmypastHttp } from './http.js';

export function browserSessionFromHar(text: string): FindmypastBrowserSession {
  let har: any; try { har = JSON.parse(text); } catch { throw new Error('Invalid HAR JSON.'); }
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('HAR has no entries.');
  const relevant = entries.filter((entry: any) => {
    try { const u = new URL(entry.request.url); return ['https://www.findmypast.com','https://www.findmypast.co.uk'].includes(u.origin) &&
      u.pathname === '/titan/marshal/graphql' && entry.response?.status === 200; } catch { return false; }
  });
  for (const entry of relevant.reverse()) {
    const url = new URL(entry.request.url), jar = new CookieJar();
    const cookieHeader = (entry.request.headers ?? []).find((h: any) => typeof h.name === 'string' && h.name.toLowerCase() === 'cookie')?.value;
    const cookies = typeof cookieHeader === 'string' ? cookieHeader.split(';').map(s => {
      const i = s.indexOf('='); return {name:s.slice(0,i).trim(),value:s.slice(i+1).trim()};
    }) : entry.request.cookies ?? [];
    for (const cookie of cookies) {
      if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || !cookie.name || !cookie.value || /[;\r\n]/.test(cookie.name+cookie.value)) continue;
      jar.setCookieSync(`${cookie.name}=${cookie.value}; Secure; Path=/`, url.href);
    }
    if (!jar.getCookieStringSync(url.href)) continue;
    const headers: Record<string,string> = {};
    for (const header of entry.request.headers ?? []) if (['x-csrf-token','x-xsrf-token','x-requested-with','user-agent'].includes(header.name?.toLowerCase()) && typeof header.value === 'string') headers[header.name] = header.value;
    return {mode:'browser',apiBase:`${url.origin}/titan/marshal`,cookies:jar.serializeSync(),savedAt:new Date().toISOString(),headers};
  }
  throw new Error('HAR needs a successful Findmypast /titan/marshal/graphql request including cookies. Export including sensitive data after loading a signed-in tree page.');
}
export async function importFindmypastHar(path: string) {
  const session = browserSessionFromHar(await readFile(path,'utf8'));
  // Validate account identity before saving; public operations alone cannot prove login.
  const http = new FindmypastHttp(session.cookies);
  const client = new FindmypastClient(session, http, {refresh:async () => {throw new Error('Unexpected native refresh.');},save:async () => {}});
  const profile = await client.graphql<{currentUserProfile?: {id?: string}}>('GetCurrentUserProfile');
  if (!profile.currentUserProfile?.id) throw new Error('HAR cookies do not authenticate a Findmypast account.');
  session.cookies = http.jar.serializeSync();
  await saveFindmypastSession(session);
  await rm(join(CREDENTIAL_DIR,'findmypast/pending-auth.json'),{force:true});
  return session;
}
