import {setTimeout as delay} from 'node:timers/promises';
import {inspectLoginCredentials, loadLoginCredentials, type Service} from './credentials.js';
import {BrowserError} from './browser-config.js';
import {configuredBrowser, type BrowserTab} from './browser-runtime.js';
import {readPrivateJson, writePrivateJson} from './storage.js';

export interface BrowserLoginOptions {timeoutMs?: number; interactive?: boolean}
export function loginCooldown(text: string): number | undefined {
  return /access has been temporarily disabled|access has been temporarily blocked/i.test(text) && /(?:try again|retry) in 24 hours/i.test(text) ? 86400000 : undefined;
}
export async function waitForLogin<T>(tab: BrowserTab, origins: string[], verify: () => Promise<T | undefined>, options: BrowserLoginOptions = {}): Promise<T> {
  const timeout = options.timeoutMs ?? tab.browser.config.timeout * 1000;
  const deadline = Date.now() + timeout;
  let notified = false, credentials: {username: string; password: string} | undefined, loaded = false, nextCheck = 0;
  const submitted = new Set<string>();
  while (true) {
    let page: {origin: string; password: boolean; email: boolean; text: string} | undefined;
    try {page = await tab.evaluate(`({origin: location.origin, password: !!document.querySelector('input[type=password]'), email: !!document.querySelector('input[type=email], input[autocomplete=username], input[name*="email" i], input[name=username], input[id=email-login]'), text: document.body.innerText.slice(-6000)})`);} catch {}
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
      const result = await verify();
      if (result !== undefined) {await tab.browser.state(tab.provider); return result;}
      nextCheck = Date.now() + 10000;
      // Verification may navigate to an authenticated page. Inspect its current
      // state before deciding whether password entry is needed or permitted.
      continue;
    }
    const loginForm = page && origins.includes(page.origin) && (page.email || page.password);
    if (passwordPaused && loginForm && !options.interactive) throw new BrowserError(`Automatic password entry for ${tab.provider} is paused until ${block!.blockedUntil} after an earlier restriction. Complete sign-in in Camofox or run fam ${tab.provider}.session login --interactive, then retry. Viewer: ${tab.browser.endpoint.vncUrl}`, 'BROWSER_LOGIN_BLOCKED', tab.browser.endpoint.vncUrl);
    if (!passwordPaused && !options.interactive && loginForm && page) {
      if (!loaded) {
        loaded = true;
        if (await inspectLoginCredentials(tab.provider as Service) !== 'none') credentials = await loadLoginCredentials(tab.provider as Service);
      }
      const step = `${page.origin}:${page.password ? 'password' : 'username'}`;
      if (credentials && !submitted.has(step)) {
        submitted.add(step);
        await tab.browser.api('/fam/input', {userId: tab.userId, tabId: tab.id, origin: page.origin, ...credentials});
        nextCheck = 0; await delay(1500); continue;
      }
    }
    if (!notified) {await tab.browser.notify(timeout / 1000); notified = true;}
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
