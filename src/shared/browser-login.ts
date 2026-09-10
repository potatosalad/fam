import {setTimeout as delay} from 'node:timers/promises';
import {inspectLoginCredentials, loadLoginCredentials, type Service} from './credentials.js';
import {BrowserError} from './browser-config.js';
import {configuredBrowser, type BrowserTab} from './browser-runtime.js';
import {readPrivateJson, writePrivateJson} from './storage.js';

export interface BrowserLoginOptions {timeoutMs?: number; interactive?: boolean; autofill?: boolean}
export interface BrowserLoginPage {origin: string; url?: string; password: boolean; email: boolean; text: string; document?: number}
export function loginCooldown(text: string): number | undefined {
  return /access has been temporarily disabled|access has been temporarily blocked/i.test(text) && /(?:try again|retry) in 24 hours/i.test(text) ? 86400000 : undefined;
}
export async function waitForLogin<T>(tab: BrowserTab, origins: string[], verify: (page?: BrowserLoginPage) => Promise<T | undefined>, options: BrowserLoginOptions = {}): Promise<T> {
  let preserve = false;
  try {return await pollLogin(tab, origins, verify, options);}
  catch (error) {
    preserve = error instanceof BrowserError && ['BROWSER_INTERACTION_REQUIRED', 'BROWSER_LOGIN_BLOCKED'].includes(error.code);
    throw error;
  } finally {
    // Saved cookies survive tab closure. Leave unfinished human interaction in
    // the viewer; the server's idle reaper bounds its lifetime after CLI exit.
    if (!preserve) await tab.close().catch(() => {});
  }
}
async function pollLogin<T>(tab: BrowserTab, origins: string[], verify: (page?: BrowserLoginPage) => Promise<T | undefined>, options: BrowserLoginOptions): Promise<T> {
  const timeout = options.timeoutMs ?? tab.browser.config.timeout * 1000;
  const deadline = Date.now() + timeout;
  let notified = false, credentials: {username: string; password: string} | undefined, loaded = false, nextCheck = 0;
  let interactionAfter = Date.now() + (options.interactive || options.autofill === false ? 0 : 5000);
  let lastPage: string | undefined;
  const submitted = new Set<string>(), filled = new Set<string>();
  let autofillSupported = false;
  while (true) {
    let page: BrowserLoginPage | undefined;
    try {page = await tab.evaluate(`(() => {
      const visible = selector => Array.from(document.querySelectorAll(selector)).some(input =>
        !input.disabled && input.getClientRects().length > 0 && getComputedStyle(input).visibility !== 'hidden');
      return {origin: location.origin, url: location.href, document: performance.timeOrigin,
        password: visible('input[type=password]'),
        email: visible('input[type=email], input[autocomplete=username], input[name*="email" i], input[name=username], input[id=email-login]'),
        text: document.body?.innerText.slice(-6000) ?? ''};
    })()`);} catch {}
    if (page) {
      const currentPage = JSON.stringify([page.origin, page.url, page.document, page.email, page.password]);
      // Verify immediately after navigation or the login form disappears. Keep
      // the slower account probe interval while the user remains on one step.
      if (currentPage !== lastPage) nextCheck = 0;
      lastPage = currentPage;
    }
    const blockFile = `${tab.provider}/browser-login-block.json`;
    const cooldown = page && origins.includes(page.origin) ? loginCooldown(page.text) : undefined;
    let block = await readPrivateJson<{blockedUntil: string}>(blockFile);
    if (cooldown && (!block || Date.parse(block.blockedUntil) <= Date.now())) {
      block = {blockedUntil: new Date(Date.now() + cooldown).toISOString()};
      await writePrivateJson(blockFile, {...block, reason: 'provider-temporary-access-restriction'});
    }
    const passwordPaused = !!block && Date.parse(block.blockedUntil) > Date.now();
    if (cooldown) throw new BrowserError(`${tab.provider} is displaying a temporary access restriction. Automatic password entry is paused until ${block!.blockedUntil}. Viewer: ${tab.browser.endpoint.vncUrl}`, 'BROWSER_LOGIN_BLOCKED', tab.browser.endpoint.vncUrl);
    if (Date.now() >= nextCheck) {
      const result = await verify(page);
      if (result !== undefined) {await tab.browser.state(tab.provider); return result;}
      nextCheck = Date.now() + 10000;
      // Verification may navigate to an authenticated page. Inspect its current
      // state before deciding whether password entry is needed or permitted.
      continue;
    }
    const loginForm = page && origins.includes(page.origin) && (page.email || page.password);
    if (passwordPaused && loginForm && !options.interactive && options.autofill !== false) throw new BrowserError(`Automatic password submission for ${tab.provider} is paused until ${block!.blockedUntil} after an earlier restriction. Complete sign-in in Camofox or run fam ${tab.provider}.session login --interactive, then retry. Viewer: ${tab.browser.endpoint.vncUrl}`, 'BROWSER_LOGIN_BLOCKED', tab.browser.endpoint.vncUrl);
    if (options.autofill !== false && (options.interactive || !passwordPaused) && loginForm && page) {
      if (!loaded) {
        loaded = true;
        if (await inspectLoginCredentials(tab.provider as Service) !== 'none') credentials = await loadLoginCredentials(tab.provider as Service);
      }
      const step = `${page.origin}:${page.password ? 'password' : 'username'}`;
      const documentStep = `${step}:${page.document ?? 0}`;
      if (credentials && options.interactive && !filled.has(documentStep)) {
        if (!autofillSupported) {
          const capabilities = await tab.browser.api('/fam/capabilities');
          if (capabilities.autofill !== true) throw new BrowserError('Interactive autofill needs an updated fam Camofox plugin. Update the plugin and restart Camofox, or use --no-autofill to continue manually.', 'BROWSER_PLUGIN_REQUIRED', tab.browser.endpoint.vncUrl);
          autofillSupported = true;
        }
        const result = await tab.browser.api('/fam/autofill', {userId: tab.userId, tabId: tab.id, origin: page.origin, ...credentials});
        if (result.ready) filled.add(documentStep);
      } else if (credentials && !options.interactive && !submitted.has(step)) {
        const result = await tab.browser.api('/fam/input', {userId: tab.userId, tabId: tab.id, origin: page.origin, ...credentials});
        if (result.submitted === true) {
          submitted.add(step);
          interactionAfter = Date.now() + 5000;
          nextCheck = 0; await delay(1500); continue;
        }
        // The form may disappear between inspection and input. An explicit
        // non-submission permits another try; an ambiguous outcome does not.
        if (result.submitted !== false) throw new BrowserError('Camofox did not confirm credential submission. Check the sign-in page before retrying.', 'BROWSER_API_FAILED', tab.browser.endpoint.vncUrl);
      }
    }
    if (!notified && (Date.now() >= interactionAfter || Date.now() >= deadline)) {await tab.browser.notify(timeout / 1000); notified = true;}
    if (Date.now() >= deadline) throw new BrowserError(`Sign-in did not finish. Open ${tab.browser.endpoint.vncUrl}, complete sign-in or verification, and retry.`, 'BROWSER_INTERACTION_REQUIRED', tab.browser.endpoint.vncUrl);
    await delay(Math.min(2000, Math.max(1, deadline - Date.now())));
  }
}
export async function loginTab(provider: string, startUrl: string) {
  const browser = await configuredBrowser();
  return browser.tab(provider, startUrl);
}
export async function browserRead(tab: BrowserTab, target: string): Promise<{url: string; text: string} | undefined> {
  const origin = new URL(target).origin;
  try {
    for (let hop = 0; hop < 6; hop++) {
      const response = await tab.request(target, {headers: {Accept: 'text/html'}});
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location'); if (!location) return;
        const next = new URL(location, target); if (next.origin !== origin) return;
        target = next.href; continue;
      }
      if (response.ok) return {url: target, text: await response.text()};
      return;
    }
  } catch (error) {if (!(error instanceof BrowserError)) throw error;}
}
