import { validateTokens, type SavedSession, type Tokens } from './auth.js';
import { FS_ORIGIN, MOBILE_USER_AGENT, type HttpSession } from './http.js';

/** Renew existing authorization only. Password login is a separate, explicit operation. */
export async function refreshFamilySearchTokens(http: Pick<HttpSession, 'json'>, session: SavedSession): Promise<Tokens> {
  if (!session.tokens.refresh_token) throw new Error('No FamilySearch refresh token; run fam familysearch auth.');
  const result = await http.json<Tokens>(`${FS_ORIGIN}/service/mobile/api/v1/login`, {
    grant_type: 'refresh_token', refresh_token: session.tokens.refresh_token, devkey: session.clientId, currentTreeId: '',
  }, {Accept: 'application/json', Authorization: `Bearer ${session.tokens.access_token}`,
    'User-Agent': MOBILE_USER_AGENT, 'FS-User-Agent-Chain': MOBILE_USER_AGENT});
  const tokens = {access_token: result.access_token, refresh_token: result.refresh_token ?? session.tokens.refresh_token,
    token_type: result.token_type ?? session.tokens.token_type,
    ...(result.expires_in === undefined ? {} : {expires_in: result.expires_in})};
  validateTokens(tokens);
  return tokens;
}
