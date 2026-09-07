import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Browser } from 'playwright';
import { loadLoginCredentials } from '../shared/credentials.js';
import { AUTH_ORIGIN, AUDIENCE, CLIENT_ID } from './http.js';
import { acceptAuthorizationCode, REDIRECT_URI } from './auth.js';

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

/** The same native authorization-code flow as the APK, in an ephemeral browser context.
 * No HAR, browser profile, password, authorization code, or PKCE verifier is saved.
 */
export async function authenticateBrowser(options: {interactive?: boolean; channel?: string; timeoutMs?: number} = {}) {
  if (options.channel && !['chrome','msedge','chromium'].includes(options.channel)) throw new Error('Browser channel must be chrome, msedge, or chromium.');
  const timeoutMs = options.timeoutMs ?? (options.interactive ? 600_000 : 120_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) throw new Error('Invalid sign-in timeout.');
  const credentials = options.interactive ? undefined : await loadLoginCredentials('storied');
  const {chromium} = await import('playwright');
  let browser: Browser;
  try {
    browser = await chromium.launch({headless: !options.interactive,
      ...(options.channel && options.channel !== 'chromium' ? {channel: options.channel} : {}), timeout: 30_000});
  } catch {
    if (options.channel) throw new Error('Could not launch the selected browser. Install it and retry.');
    try {browser = await chromium.launch({channel: 'chrome', headless: !options.interactive, timeout: 30_000});}
    catch {throw new Error('Storied auth needs Chromium or Chrome. See docs/storied/README.md for browser setup.');}
  }
  const request = authorizationRequest();
  let code: string | undefined, failure: Error | undefined, stopped = false;
  const onSignal = () => {stopped = true; void browser.close().catch(() => {});};
  const signals = ['SIGINT','SIGTERM','SIGHUP'] as const;
  for (const signal of signals) process.on(signal, onSignal);
  try {
    const context = await browser.newContext();
    context.on('response', response => {
      if (new URL(response.url()).origin !== AUTH_ORIGIN || response.status() < 300 || response.status() >= 400) return;
      const location = response.headers().location;
      if (!location) return;
      try {code ??= callbackCode(location, request.state);} catch (e) {failure = e as Error;}
    });
    const page = await context.newPage();
    await page.goto(request.url.href, {waitUntil: 'domcontentloaded', timeout: 30_000});
    if (credentials) {
      if (new URL(page.url()).origin !== AUTH_ORIGIN || new URL(page.url()).pathname !== '/login') throw new Error('Storied login page changed; credentials were not submitted.');
      const email = page.locator('input[id="email-login"]:visible'), password = page.locator('input[id="password-login"]:visible');
      if (await email.count() !== 1 || await password.count() !== 1) throw new Error('Storied login form changed; use fam storied.session login --interactive.');
      await email.fill(credentials.username);
      await password.fill(credentials.password);
      await page.getByRole('button', {name: 'Sign In', exact: true}).filter({visible: true}).click({timeout: 15_000});
    } else process.stderr.write('Complete Storied sign-in in the browser. Waiting for its authorization callback…\n');
    const end = Date.now() + timeoutMs;
    let lastReport = Date.now();
    while (!code && !failure && !stopped && Date.now() < end) {
      if (!browser.isConnected()) throw new Error('Storied sign-in browser was closed.');
      if (Date.now() - lastReport > 30_000) {
        process.stderr.write('Waiting for Storied authorization; use --interactive if account verification is required.\n'); lastReport = Date.now();
      }
      await delay(250);
    }
    if (failure) throw failure;
    if (stopped || !code) throw new Error('Storied sign-in did not complete. Use fam storied.session login --interactive to finish any required verification.');
    await browser.close();
    return await acceptAuthorizationCode(code, request.verifier);
  } catch (error) {
    // Browser errors may contain filled values or callback URLs. Only our fixed errors are safe.
    if (error instanceof Error && error.message.startsWith('Storied ')) throw error;
    throw new Error('Storied browser sign-in failed; browser details were suppressed. Try fam storied.session login --interactive.');
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
    await browser.close().catch(() => {});
  }
}
