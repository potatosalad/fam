import {setTimeout as delay} from 'node:timers/promises';
import type {CookieJar} from 'tough-cookie';
import {BrowserError, directOnly, endpointId, rememberBrowser, useBrowser} from './browser-config.js';
import {configuredBrowser, updateCookieJar, jarCookies, type BrowserTab} from './browser-runtime.js';
import {isChallenge, isChallengeResponse as challenged} from './browser-challenge.js';
export {isChallenge} from './browser-challenge.js';

export type HttpResponse = Pick<Response, 'status' | 'headers' | 'arrayBuffer'> & {body?: ReadableStream<Uint8Array> | null};
export type HttpInit = {method?: string; headers?: HeadersInit; body?: unknown; redirect?: string; signal?: AbortSignal | null};
async function normalize(response: HttpResponse): Promise<Response> {
  if (response instanceof Response) return response;
  if (response.body) return new Response([204,205,304].includes(response.status) ? null : response.body as BodyInit, {status: response.status, headers: response.headers});
  return new Response([204,205,304].includes(response.status) ? null : await response.arrayBuffer(), {status: response.status, headers: response.headers});
}
async function waitForChallenge(tab: BrowserTab, signal?: AbortSignal | null): Promise<void> {
  const end = Date.now() + tab.browser.config.timeout * 1000;
  let notified = false;
  while (true) {
    signal?.throwIfAborted();
    let state: {html: string; ready: boolean} | undefined;
    try {state = await tab.evaluate(`({html:document.documentElement.outerHTML.slice(0,131072),
      ready:document.readyState === 'complete' && !!document.body &&
        (!!document.body.innerText.trim() || !!document.body.querySelector('img,video,audio,embed,object,form,input'))})`);} catch {}
    // A script-only interstitial can have an empty title/body while it obtains
    // clearance and navigates. Do not replace it with our transport document.
    if (state?.ready && !isChallenge(new Headers(), state.html) && !/Enable JavaScript and cookies to continue/i.test(state.html)) return;
    if (!notified) {await tab.browser.notify(); notified = true;}
    if (Date.now() >= end) throw new BrowserError(`Browser verification did not finish. Complete it at ${tab.browser.endpoint.vncUrl}, then retry.`, 'BROWSER_INTERACTION_REQUIRED', tab.browser.endpoint.vncUrl);
    await delay(1500);
  }
}
const tabs = new Map<string, Promise<BrowserTab>>();
export async function closeBrowserTransportTabs(): Promise<void> {
  const pending = [...tabs.values()]; tabs.clear();
  await Promise.allSettled(pending.map(async value => {const tab = await value; await tab.browser.api('/fam/close-tab', {userId: tab.userId, tabId: tab.id});}));
}
export async function browserRequest(provider: string, target: URL, init: HttpInit, jar?: CookieJar, sessionCookies: string[] = []): Promise<Response> {
  init.signal?.throwIfAborted();
  const browser = await configuredBrowser();
  // Each operation owns its tab, so concurrent CLIs never navigate one another's
  // interactive pages. Contexts (cookies/storage) are shared by provider.
  const key = `${endpointId(browser.config)}:${provider}:${target.origin}`;
  let pending = tabs.get(key);
  if (!pending) {
    pending = (async () => {
      const tab = await browser.tab(provider);
      if (jar) {
        const state = await browser.state(provider);
        // A native HTTP session can seed a new browser context on challenge.
        // Existing browser cookies always win over stale HTTP snapshots.
        const hasBrowserCookies = state.cookies.some(cookie => {const domain = cookie.domain.replace(/^\./,''); return target.hostname === domain || cookie.domain.startsWith('.') && target.hostname.endsWith(`.${domain}`);});
        const cookies = hasBrowserCookies ? [] : jarCookies(jar, target.origin);
        if (cookies.length) await browser.api('/fam/cookies', {userId: tab.userId, cookies});
      }
      await tab.prepare(target.origin); return tab;
    })();
    tabs.set(key, pending);
  }
  const tab = await pending;
  try {
  const request = async () => {
    // Explicitly managed session cookies come from current authorization, not
    // an old HTTP snapshot. Refresh only these cookies, including on reused tabs.
    if (jar && sessionCookies.length) {
      const cookies = jarCookies(jar, target.origin).filter(cookie => sessionCookies.includes(cookie.name));
      if (cookies.length) await browser.api('/fam/cookies', {userId: tab.userId, cookies});
    }
    return tab.request(target.href, init);
  };
  let response = await request();
  if (await challenged(response)) {
    void response.body?.cancel().catch(() => {});
    await rememberBrowser(provider, target.origin);
    await tab.navigate((init.method ?? 'GET') === 'GET' ? target.href : target.origin);
    await waitForChallenge(tab, init.signal);
    init.signal?.throwIfAborted();
    await tab.prepare(target.origin);
    response = await request();
    if (await challenged(response)) {
      void response.body?.cancel().catch(() => {});
      // Keep the actual verification page available, not the blank document
      // used to issue API requests. Never replay the operation a third time.
      await tab.navigate((init.method ?? 'GET') === 'GET' ? target.href : target.origin);
      throw new BrowserError(`The website still requires verification at ${browser.endpoint.vncUrl}. Retry after completing it.`, 'BROWSER_INTERACTION_REQUIRED', browser.endpoint.vncUrl);
    }
  }
  if (jar) await updateCookieJar(jar, await browser.state(provider), target.origin);
  await rememberBrowser(provider, target.origin);
  return response;
  } catch (error) {
    // Keep a verification tab available after an interaction timeout or Ctrl-C.
    tabs.delete(key); throw error;
  }
}
/** Recover only evidenced challenge responses. Network failures, ordinary 403s,
 * rate limits and provider errors retain their original behavior. */
export async function fetchWithBrowser(provider: string, url: string | URL, init: HttpInit, direct: () => Promise<HttpResponse>, jar?: CookieJar, sessionCookies: string[] = []): Promise<Response> {
  const target = new URL(url);
  if (await useBrowser(provider, target.origin)) return browserRequest(provider, target, init, jar, sessionCookies);
  const response = await normalize(await direct());
  if (await directOnly() || !await challenged(response)) return response;
  void response.body?.cancel().catch(() => {});
  process.stderr.write(`${provider}: website verification required; continuing in Camofox…\n`);
  return browserRequest(provider, target, init, jar, sessionCookies);
}
