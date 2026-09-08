import { createHash, randomBytes } from 'node:crypto';
import { AUTH_ORIGIN, AUDIENCE, CLIENT_ID } from './http.js';
import { acceptAuthorizationCode, REDIRECT_URI, saveSession } from './auth.js';
import {endpointId} from '../shared/browser-config.js';

export function authorizationRequest() {
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  const url = new URL('/authorize', AUTH_ORIGIN);
  url.search = new URLSearchParams({client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI,
    audience: AUDIENCE, scope: 'openid profile email offline_access', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'}).toString();
  return {url, verifier, state};
}
export function callbackCode(location: string, state: string): string | undefined {
  let url: URL;
  try {url = new URL(location);} catch {return;}
  const expected = new URL(REDIRECT_URI);
  if (url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname || url.username || url.password || url.hash) return;
  if (url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) throw new Error('Storied authentication state did not match.');
  if (url.searchParams.has('error')) throw new Error('Storied browser authorization was rejected.');
  if (url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code')) throw new Error('Storied callback did not contain an authorization code.');
  return url.searchParams.get('code')!;
}

/** Native PKCE through the configured persistent Camofox browser. */
export async function authenticateBrowser(options: {interactive?: boolean; autofill?: boolean; channel?: string; timeoutMs?: number} = {}) {
  if (options.channel && options.channel !== 'camofox') throw new Error('Storied browser sign-in now uses Camofox. Run fam browser setup.');
  const {configuredBrowser} = await import('../shared/browser-runtime.js');
  const {waitForLogin} = await import('../shared/browser-login.js');
  const browser = await configuredBrowser(), tab = await browser.tab('storied');
  const request = authorizationRequest();
  // Arm before navigation: an existing Auth0 session may redirect immediately.
  const watch = await browser.api('/fam/callback', {userId: tab.userId, origin: AUTH_ORIGIN, redirectUri: REDIRECT_URI,
    state: request.state, timeoutMs: options.timeoutMs ?? browser.config.timeout * 1000});
  try {
    try {await tab.navigate(request.url.href);} catch { /* An app callback cannot commit as a document. Poll the armed watcher. */ }
    const code = await waitForLogin(tab, [AUTH_ORIGIN], async () => {
      const result = await browser.api('/fam/callback-result', {userId: tab.userId, id: watch.id});
      if (result.callback) return callbackCode(result.callback, request.state);
      if (result.expired) throw new Error('Storied browser authorization expired. Run fam storied.session login.');
    }, options);
    return acceptAuthorizationCode(code, request.verifier, undefined, async session => {session.browserInstance = endpointId(browser.config); await saveSession(session);});
  } finally {await browser.api('/fam/callback-result', {userId: tab.userId, id: watch.id, cancel: true}).catch(() => {});}
}
