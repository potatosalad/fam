import { tokenRequest, type AncestrySession } from './auth.js';
import type { AncestryHttp } from './http.js';

export async function refreshAncestrySession(http: AncestryHttp, session: AncestrySession): Promise<AncestrySession> {
  if (!session.tokens.refresh_token) throw new Error('No Ancestry refresh token; run fam ancestry.session login.');
  const tokens = await tokenRequest(http, {grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token}, true);
  tokens.user_id ??= session.tokens.user_id;
  const seconds = Number(tokens.expires_in);
  return {...session, tokens, savedAt: new Date().toISOString(),
    expiresAt: Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0, cookies: http.jar.serializeSync()};
}
