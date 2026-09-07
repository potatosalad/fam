import { loadLoginCredentials } from '../shared/credentials.js';
import { createHash, randomBytes } from 'node:crypto';
import { CHURCH_ORIGIN, HttpSession, HttpError, IDENT_ORIGIN } from './http.js';
import { writePrivateJson } from '../shared/storage.js';

// Public OAuth client identifier embedded in FamilySearch Tree 5.4.4 (wmf).
// This identifies the Church provider; it is not a client secret.
export const CHURCH_CLIENT_ID = 'fs-internal-dev-key-000080';
export const REDIRECT_URI = 'org.familysearch.tree://oauth/redirect';
export interface LoginCredentials { username: string; password: string }
export interface Tokens {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
}
export interface SavedSession {
  version: 1;
  clientId: string;
  tokens: Tokens;
  obtainedAt: string;
  cookies: ReturnType<HttpSession['jar']['serializeSync']>;
}

export function createAuthorization() {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const url = new URL('/cis-web/oauth2/v3/authorization', IDENT_ORIGIN);
  url.search = new URLSearchParams({
    client_id: CHURCH_CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: 'code', scope: 'profile offline_access', prompt: 'login', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.href, verifier, state };
}

export function parseCallback(callback: string, state: string): string {
  const url = new URL(callback);
  if (url.username || url.password || `${url.protocol}//${url.host}${url.pathname}` !== REDIRECT_URI || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) {
    throw new Error('OAuth callback or state did not match the initiating request.');
  }
  if (url.searchParams.has('error')) throw new Error('FamilySearch declined authorization.');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.getAll('code').length !== 1) throw new Error('FamilySearch callback has no unambiguous authorization code.');
  return code;
}

export function extractStateToken(html: string): string {
  const match = html.match(/"stateToken"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match) throw new Error('Church login page no longer exposes the expected sign-in state.');
  // Decode string data only; never execute downloaded JavaScript.
  return JSON.parse(`"${match[1].replace(/\\x([0-9a-f]{2})/gi, '\\u00$1')}"`) as string;
}

export async function loadCredentials(): Promise<LoginCredentials> {
  return loadLoginCredentials('familysearch');
}

interface IdxField {
  name: string;
  value?: string;
  form?: { value: IdxField[] };
  options?: Array<{ label: string; value: { form: { value: IdxField[] } } }>;
}
interface IdxAction { name: string; href: string; value?: IdxField[] }
interface IdxState {
  stateHandle: string;
  expiresAt?: string;
  remediation?: { value: IdxAction[] };
  success?: { href: string };
}
const ION = 'application/ion+json; okta-version=1.0.0';

function requireChurchAction(action: { href: string }) {
  if (new URL(action.href).origin !== CHURCH_ORIGIN) throw new Error('Unexpected Church sign-in action origin.');
}

/** Follow only username/password sign-in actions. Extra factors require user interaction. */
export async function authenticateChurch(http: HttpSession, credentials: LoginCredentials): Promise<SavedSession> {
  const auth = createAuthorization();
  const page = await http.follow(auth.url, REDIRECT_URI);
  if (new URL(page.url).origin !== CHURCH_ORIGIN || !page.html) {
    throw new Error('Expected the Church Account sign-in page.');
  }
  const ion = (url: string, body: unknown) => http.json<IdxState>(url, body, { Accept: ION, 'Content-Type': ION, Origin: CHURCH_ORIGIN });
  let state = await ion(`${CHURCH_ORIGIN}/idp/idx/introspect`, { stateToken: extractStateToken(page.html) });
  const postAction = async (action: IdxAction, fields: object) => {
    requireChurchAction(action);
    return ion(action.href, { stateHandle: state.stateHandle, ...fields });
  };
  const identify = state.remediation?.value.find(x => x.name === 'identify');
  if (!identify) throw new Error('Church sign-in did not offer username identification.');
  state = await postAction(identify, { identifier: credentials.username });
  const select = state.remediation?.value.find(x => x.name === 'select-authenticator-authenticate');
  const password = select?.value?.find(x => x.name === 'authenticator')?.options?.find(x => x.label === 'Password');
  if (!select || !password) throw new Error('Church sign-in requires an authentication method other than password.');
  state = await postAction(select, { authenticator: Object.fromEntries(password.value.form.value.map(x => [x.name, x.value])) });
  const challenge = state.remediation?.value.find(x => x.name === 'challenge-authenticator');
  const passcode = challenge?.value?.find(x => x.name === 'credentials')?.form?.value.find(x => x.name === 'passcode');
  if (!challenge || !passcode) throw new Error('Church sign-in did not offer the expected password challenge.');
  state = await postAction(challenge, { credentials: { passcode: credentials.password } });
  if (!state.success) {
    // No credential retries, automatic MFA messages, enrollment, or account changes.
    throw new Error('Church sign-in did not complete. The password may be invalid or additional verification may be required; sign in through the normal Church website to resolve it, then retry.');
  }
  requireChurchAction(state.success);
  const callback = await http.follow(state.success.href, REDIRECT_URI);
  const code = parseCallback(callback.url, auth.state);
  const response = await http.request(`${IDENT_ORIGIN}/cis-web/oauth2/v3/token`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CHURCH_CLIENT_ID, redirect_uri: REDIRECT_URI, code_verifier: auth.verifier, code }).toString(),
  });
  if (!response.ok) throw new HttpError(response.status, '/cis-web/oauth2/v3/token');
  let tokens: Tokens;
  try { tokens = await response.json() as Tokens; }
  catch { throw new Error('FamilySearch returned an invalid token response.'); }
  validateTokens(tokens);
  const session: SavedSession = { version: 1, clientId: CHURCH_CLIENT_ID, tokens, obtainedAt: new Date().toISOString(), cookies: http.jar.serializeSync() };
  await writePrivateJson('session.json', session);
  return session;
}

export function validateTokens(tokens: Tokens): void {
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token || /[\r\n]/.test(tokens.access_token)) {
    throw new Error('Authentication response did not include a valid access token.');
  }
  if (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token)) {
    throw new Error('Authentication response included an invalid refresh token.');
  }
}
