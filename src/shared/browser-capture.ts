import { access, chmod, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Page } from 'playwright';
import { CREDENTIAL_DIR, writePrivateJson } from './storage.js';

export interface CaptureOptions {
  channel?: 'chrome' | 'msedge' | 'chromium';
  timeoutMs?: number;
}
export interface CaptureRecipe<T> {
  provider: 'myheritage' | 'findmypast';
  startUrl: string;
  urlFilter: RegExp;
  instructions: string;
  /** Read-only browser operations; true requires a successful account response. */
  advance(page: Page, report: (message: string) => void): Promise<boolean>;
  /** Validate the actual saved HAR through the normal importer before saving a session. */
  importHar(path: string): Promise<T>;
}
export type CaptureLaunch = (profile: string, harPath: string, options: CaptureOptions) => Promise<BrowserContext>;

export function captureOptions(channel?: string, timeout?: string): CaptureOptions {
  if (channel !== undefined && !['chrome', 'msedge', 'chromium'].includes(channel)) {
    throw new Error('--browser-channel must be chrome, msedge, or chromium.');
  }
  const seconds = timeout === undefined ? 600 : Number(timeout);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) throw new Error('--capture-timeout must be 1–3600 seconds.');
  return {channel: channel as CaptureOptions['channel'], timeoutMs: seconds * 1000};
}

async function installChromium(signal: AbortSignal): Promise<void> {
  const require = createRequire(import.meta.url);
  await new Promise<void>((resolve, reject) => {
    // Resolve within fam's installed dependency, so global installs work from any cwd.
    const child = spawn(process.execPath, [require.resolve('playwright/cli'), 'install', 'chromium'], {
      stdio: ['ignore', 'ignore', 'ignore'], timeout: 300_000, signal,
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('Browser download failed.')));
  });
}

async function launchBrowser(profile: string, harPath: string, options: CaptureOptions, urlFilter: RegExp, signal: AbortSignal): Promise<BrowserContext> {
  const { chromium } = await import('playwright');
  const launch = (channel?: 'chrome' | 'msedge') => chromium.launchPersistentContext(profile, {
    channel, headless: false, viewport: null, timeout: 30_000,
    handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    recordHar: {path: harPath, mode: 'full', content: 'embed', urlFilter},
  });
  if (options.channel !== 'chromium') {
    try { return await launch(options.channel ?? 'chrome'); }
    catch (error) {
      // Only a missing installation warrants fallback. Profile locks, display errors,
      // and browser crashes need attention, not a second browser/profile attempt.
      if (options.channel || !/distribution .* is not found|executable doesn't exist/i.test(String(error))) throw error;
    }
  }
  try { await access(chromium.executablePath()); }
  catch {
    process.stderr.write('Installing the capture browser (first run only)…\n');
    await installChromium(signal);
  }
  signal.throwIfAborted();
  return launch();
}

/** A browser fetch stays on its exact origin, never follows redirects, and is bounded. */
export async function browserJson(page: Page, origin: string, path: string, body: string, contentType: string, method: 'GET' | 'POST' = 'POST'): Promise<any> {
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password || new URL(page.url()).origin !== origin) return undefined;
  return page.evaluate(async ({origin, url, body, contentType, method}) => {
    if (location.origin !== origin) return null;
    try {
      const response = await fetch(url, {method, mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
        ...(method === 'POST' ? {headers: {'Content-Type': contentType}, body} : {}), signal: AbortSignal.timeout(10_000)});
      if (!response.ok) return null;
      return await response.json();
    } catch { return null; }
  }, {origin, url: url.href, body, contentType, method});
}

/** Fetch a supporting page without navigating or taking focus from the login window.
 * Fetch's same-origin mode also rejects cross-origin redirects before transmission. */
export async function browserPage(page: Page, origin: string, target: string): Promise<{url: string; html: string} | undefined> {
  const url = new URL(target, origin);
  if (url.origin !== origin || url.username || url.password || new URL(page.url()).origin !== origin) return undefined;
  return await page.evaluate(async ({origin, url}) => {
    if (location.origin !== origin) return null;
    try {
      const response = await fetch(url, {mode: 'same-origin', credentials: 'same-origin', redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(10_000)});
      if (!response.ok || new URL(response.url).origin !== origin) return null;
      return {url: response.url, html: await response.text()};
    } catch {return null;}
  }, {origin, url: url.href}) ?? undefined;
}

/** Never print browser exceptions: they can embed URLs, cookies, or script arguments. */
export async function captureAuthentication<T>(recipe: CaptureRecipe<T>, options: CaptureOptions = {}, dependencies: {
  launch?: CaptureLaunch; progress?: (message: string) => void; pollMs?: number; signal?: AbortSignal;
} = {}): Promise<{session: T; harPath: string}> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Capture timeout must be between 1 ms and one hour.');
  const progress = dependencies.progress ?? (message => process.stderr.write(`${message}\n`));
  // The shared storage helper tightens permissions on every ancestor down to the profile.
  await writePrivateJson(`${recipe.provider}/browser/capture.json`, {format: 1});
  const directory = join(CREDENTIAL_DIR, recipe.provider, 'browser');
  const profile = join(directory, 'user-data');
  await mkdir(profile, {recursive: true, mode: 0o700});
  await chmod(profile, 0o700);
  const captureDir = await mkdtemp(join(directory, 'capture-'));
  await chmod(captureDir, 0o700);
  const harPath = join(captureDir, 'session.har');
  let context: BrowserContext | undefined, closed = false, ready = false;
  let stop: string | undefined, closePromise: Promise<void> | undefined;
  const cancelled = new AbortController();
  const close = () => closePromise ??= context ? context.close() : Promise.resolve();
  const cancel = () => { stop = 'Capture cancelled'; cancelled.abort(); void close().catch(() => {}); };
  const timeout = () => { stop = 'Capture timed out'; void close().catch(() => {}); };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  for (const signal of signals) process.on(signal, cancel);
  dependencies.signal?.addEventListener('abort', cancel, {once: true});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (dependencies.signal?.aborted) throw new Error('Capture cancelled.');
    progress(`Opening ${recipe.provider}. Sign in and complete any verification in the browser. ${recipe.instructions}`);
    try {
      context = await (dependencies.launch ?? ((p, h, o) => launchBrowser(p, h, o, recipe.urlFilter, cancelled.signal)))(profile, harPath, options);
    } catch {
      if (stop) throw new Error(`${stop}.`);
      throw new Error('Cannot launch the capture browser. Close any other fam capture window for this provider and retry. Check that a desktop display and the selected browser are available; --browser-channel chromium downloads its browser automatically.');
    }
    // A signal can arrive during launch; now close the newly created context as well.
    closePromise = undefined;
    if (stop) { await close(); throw new Error(stop); }
    context.on('close', () => { closed = true; });
    timer = setTimeout(timeout, timeoutMs);
    const page = context.pages()[0] ?? await context.newPage();
    try { await page.goto(recipe.startUrl, {waitUntil: 'domcontentloaded', timeout: 30_000}); }
    catch { if (!closed && !stop) progress('Finish loading or signing in in the capture window; recording is still active.'); }
    let lastProgress = Date.now();
    let waiting = `Waiting for a signed-in account. ${recipe.instructions}`;
    const report = (message: string) => {
      if (message !== waiting) {waiting = message; progress(message); lastProgress = Date.now();}
    };
    while (!closed && !stop && !ready) {
      // Context-wide HAR recording also covers login popups and replacement tabs.
      for (const current of context.pages()) {
        try { if (await recipe.advance(current, report)) {ready = true; break;} }
        catch { /* Navigation, sign-in, and verification can temporarily replace the page. */ }
        if (closed || stop) break;
      }
      if (Date.now() - lastProgress >= 30_000) {
        progress(`${waiting} Close the capture window or press Ctrl-C to stop.`);
        lastProgress = Date.now();
      }
      if (!ready && !closed && !stop) await delay(dependencies.pollMs ?? 3000);
    }
    // The interactive timeout must not fire while flushing or validating a complete capture.
    clearTimeout(timer);
    try {
      await close(); // Playwright flushes a full, unsanitized HAR here, including request bodies.
      await chmod(harPath, 0o600);
    } catch {
      throw new Error('The browser stopped before its HAR could be finalized. Run the capture command again and keep the window open until fam finishes.');
    }
    if (stop || !ready) throw new Error(`${stop ?? 'Browser closed before authentication was captured'}. HAR saved privately at ${harPath}. Run the capture command again to finish.`);
    progress('Captured account traffic. Validating the saved HAR…');
    try {
      const session = await recipe.importHar(harPath);
      progress(`Authentication saved. Sensitive HAR: ${harPath}`);
      return {session, harPath};
    } catch {
      throw new Error(`The captured HAR did not pass account validation; authentication was not completed. HAR saved privately at ${harPath}. Complete website verification and run the capture command again, or retry fam ${recipe.provider}.session login --har with this file.`);
    }
  } finally {
    if (timer) clearTimeout(timer);
    for (const signal of signals) process.removeListener(signal, cancel);
    dependencies.signal?.removeEventListener('abort', cancel);
    if (context) {
      try { await close(); } catch { /* Keep the original failure; no browser error output. */ }
      try { if ((await stat(harPath)).isFile()) await chmod(harPath, 0o600); } catch { /* Browser may have crashed before writing. */ }
    }
  }
}

export const readCapturedHar = (path: string) => readFile(path, 'utf8');
