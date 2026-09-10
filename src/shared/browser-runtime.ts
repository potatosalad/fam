import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {mkdir, writeFile, readFile, rm, rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Cookie, CookieJar} from 'tough-cookie';
import {providerNames} from './command-registry.js';
import {CREDENTIAL_DIR} from './storage.js';
import {browserConfig, browserUrl, saveBrowserConfig, browserUserId, endpointId, BrowserError, type BrowserConfig, type BrowserEndpoint} from './browser-config.js';

const exec = promisify(execFile);
export const CAMOFOX_IMAGE = 'ghcr.io/jo-inc/camofox-browser:1.14.0@sha256:86c79eed8a6b3a78859f73bc70d6003c5566b85e969354ec454524b28197ffce';
export const pluginDirectory = fileURLToPath(new URL('../../browser/camofox-plugin/', import.meta.url));
const providers: readonly string[] = ['web-private', 'web', ...providerNames];
export async function openUrl(url: string): Promise<boolean> {
  browserUrl(url);
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  try {await exec(command, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url], {timeout: 5000}); return true;} catch {return false;}
}
async function docker(args: string[], timeout = 30000): Promise<string> {
  try {return (await exec('docker', args, {timeout, maxBuffer: 1024 * 1024})).stdout;}
  catch {throw new BrowserError('Docker is unavailable or the browser container could not be managed. Run fam browser setup --local.');}
}
async function dockerReady(install: boolean) {
  try {await docker(['info', '--format', '{{.ServerVersion}}'], 10000); return;} catch {}
  if (process.platform !== 'darwin') throw new BrowserError('Install and start a Docker runtime, then rerun fam browser setup --local.');
  try {await exec('open', ['-a', 'OrbStack'], {timeout: 5000});} catch {
    let accepted = install;
    if (!accepted && process.stdin.isTTY) {
      const input = createInterface({input: process.stdin, output: process.stderr});
      try {accepted = /^y(es)?$/i.test((await input.question('Install OrbStack with Homebrew now? [y/N] ')).trim());} finally {input.close();}
    }
    if (!accepted) throw new BrowserError('Install OrbStack from https://orbstack.dev or run fam browser setup --local --install.');
    process.stderr.write('Installing OrbStack. Complete any macOS setup prompts, then fam will continue.\n');
    await new Promise<void>((resolve, reject) => {
      const child = spawn('brew', ['install', '--cask', 'orbstack'], {stdio: ['inherit','inherit','inherit']});
      child.once('error', () => reject(new BrowserError('Install Homebrew from https://brew.sh, then rerun fam browser setup --local --install.')));
      child.once('exit', code => code === 0 ? resolve() : reject(new BrowserError('OrbStack installation did not complete.')));
    });
    await exec('open', ['-a', 'OrbStack']);
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    try {await docker(['info', '--format', '{{.ServerVersion}}'], 3000); return;} catch {}
    if (attempt % 10 === 0) process.stderr.write('Waiting for the Docker runtime to finish starting…\n');
    await delay(2000);
  }
  throw new BrowserError('Docker has not started. Finish OrbStack setup and rerun fam browser start.');
}
export async function setupBrowser(options: {local?: boolean; remote?: string; vncUrl?: string; apiKeyFile?: string; timeout?: number; install?: boolean; open?: boolean; session?: string; apiPort?: number; vncPort?: number} = {}) {
  if (options.local && options.remote) throw new BrowserError('Choose --local or --remote URL.');
  const prior = await browserConfig();
  const config: BrowserConfig = {...prior, version: 1, mode: options.remote ? 'remote' : 'local', timeout: options.timeout ?? prior?.timeout ?? 600,
    transport: prior?.transport ?? 'auto', session: options.session ?? prior?.session ?? 'default', open: options.open ?? prior?.open ?? true};
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.session) || !Number.isSafeInteger(config.timeout) || config.timeout < 0 || config.timeout > 3600) throw new BrowserError('Invalid browser session name or timeout (0–3600 seconds).');
  if (options.remote) {
    const url = browserUrl(options.remote).replace(/\/$/, '');
    const viewer = new URL(url); viewer.port = '6080'; viewer.pathname = '/vnc.html'; viewer.search = '';
    config.remote = {url, vncUrl: options.vncUrl ? browserUrl(options.vncUrl) : prior?.remote?.url === url ? prior.remote.vncUrl : viewer.href,
      ...(prior?.remote?.url === url ? {apiKey: prior.remote.apiKey} : {})};
    if (options.apiKeyFile) config.remote.apiKey = (await readFile(options.apiKeyFile, 'utf8')).trim();
  } else {
    await dockerReady(!!options.install);
    const apiPort = options.apiPort ?? prior?.local?.apiPort ?? 9377, vncPort = options.vncPort ?? prior?.local?.vncPort ?? 6080;
    for (const port of [apiPort,vncPort]) if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new BrowserError('Browser ports must be between 1 and 65535.');
    const suffix = createHash('sha256').update(CREDENTIAL_DIR).digest('hex').slice(0, 10);
    config.local = prior?.local ?? {url: `http://127.0.0.1:${apiPort}`, vncUrl: `http://127.0.0.1:${vncPort}/vnc.html?autoconnect=1&resize=remote`,
      apiKey: randomBytes(32).toString('hex'), container: `fam-browser-${suffix}`, image: CAMOFOX_IMAGE, apiPort, vncPort};
    if (prior?.local && (options.apiPort !== undefined && apiPort !== (prior.local.apiPort ?? Number(new URL(prior.local.url).port)) || options.vncPort !== undefined && vncPort !== (prior.local.vncPort ?? 6080))) throw new BrowserError('Local ports are fixed when the container is created. Use another FAM_CONFIG_DIR to create a browser on different ports.');
    if (options.vncUrl) config.local.vncUrl = browserUrl(options.vncUrl);
  }
  await saveBrowserConfig(config);
  await startBrowser(config);
  await new Camofox(config).capabilities();
  return browserStatus(config);
}
export async function startBrowser(config?: BrowserConfig) {
  config ??= await browserConfig();
  if (!config) return setupBrowser({local: true});
  const endpoint = config[config.mode]!;
  if (config.mode === 'local') {
    await dockerReady(false);
    const container = endpoint.container!;
    let exists = false;
    let inspected: any;
    try {inspected = JSON.parse(await docker(['inspect', container]))[0]; exists = true;} catch {}
    if (exists && inspected.Config.Labels?.['app'] !== 'fam') throw new BrowserError('The configured local container is not owned by fam.');
    if (exists && inspected.Config.Labels?.['fam.runtime'] !== '3') {
      if (inspected.State.Running) await stopBrowser(config);
      const backup = `${container}-before-upgrade-${Date.now()}`;
      await docker(['rename', container, backup]); exists = false;
      process.stderr.write(`Preserved the previous local container as ${backup}; reusing its saved profiles.\n`);
    }
    if (exists) await docker(['start', container]);
    else {
      const directory = join(CREDENTIAL_DIR, 'browser', 'local');
      await mkdir(join(directory, 'profiles'), {recursive: true, mode: 0o700});
      const envFile = join(directory, 'container.env');
      await writeFile(envFile, `CAMOFOX_API_KEY=${endpoint.apiKey}\nENABLE_VNC=1\nENABLE_FAM=1\nVNC_BIND=0.0.0.0\nCAMOFOX_PROFILE_DIR=/data/profiles\nCAMOFOX_CRASH_REPORT_ENABLED=false\nBROWSER_IDLE_TIMEOUT_MS=86400000\nTAB_INACTIVITY_MS=86400000\nSESSION_TIMEOUT_MS=86400000\n`, {mode: 0o600});
      const pluginConfig = join(directory, 'camofox.config.json');
      await writeFile(pluginConfig, JSON.stringify({plugins: {persistence: {enabled: true, indexedDB: true}, vnc: {enabled: true}, fam: {enabled: true}}}), {mode: 0o600});
      process.stderr.write('Preparing the persistent Camofox container. The first image download may take a few minutes.\n');
      await docker(['pull', endpoint.image!], 600000);
      await docker(['run', '-d', '--name', container, '--label', 'app=fam', '--label', 'fam.runtime=3', '--init', '--entrypoint', 'node', '--restart', 'unless-stopped', '--shm-size', '1g', '--env-file', envFile,
        '-p', `127.0.0.1:${endpoint.apiPort ?? new URL(endpoint.url).port}:9377`, '-p', `127.0.0.1:${endpoint.vncPort ?? 6080}:6080`,
        '-v', `${join(directory, 'profiles')}:/data/profiles`, '-v', `${pluginDirectory}:/app/plugins/fam:ro`, '-v', `${pluginConfig}:/app/camofox.config.json:ro`, endpoint.image!, '--max-old-space-size=512', '/app/plugins/fam/start.mjs'], 60000);
    }
  }
  const browser = new Camofox(config);
  for (let attempt = 0; attempt < 45; attempt++) {
    try {await browser.api('/health', undefined, 3000); await browser.api('/start', {}); return;} catch (error) {
      if (config.mode === 'remote' || attempt === 44) throw error;
      if (attempt % 10 === 0) process.stderr.write('Waiting for Camofox to start…\n');
      await delay(1000);
    }
  }
}
export async function browserStatus(config?: BrowserConfig) {
  config ??= await browserConfig();
  if (!config) return {configured: false, next: 'fam browser setup --local'};
  const endpoint = config[config.mode]!;
  let reachable = false, plugin = false, running = false;
  try {const health = await new Camofox(config).api('/health', undefined, 3000); reachable = true; running = !!health.browserRunning; await new Camofox(config).capabilities(); plugin = true;} catch {}
  return {configured: true, mode: config.mode, url: endpoint.url, vncUrl: endpoint.vncUrl, reachable, running, plugin, timeout: config.timeout,
    transport: config.transport, session: config.session, ...(config.mode === 'local' ? {container: endpoint.container} : {})};
}
export async function stopBrowser(config: BrowserConfig) {
  const browser = new Camofox(config);
  const closeTabs = () => browser.api('/fam/close', {userIds: providers.map(provider => browserUserId(config, provider))});
  let result: {closed: number; checkpointed?: boolean};
  if (config.mode === 'local') {
    const container = config.local!.container!;
    const inspected = JSON.parse(await docker(['inspect', container]))[0];
    if (inspected.Config.Labels?.app !== 'fam') throw new BrowserError('The configured local container is not owned by fam.');
    result = inspected.State.Running ? await closeTabs().catch(() => ({closed: 0, checkpointed: false})) : {closed: 0};
    // Older upstream images put a shell at PID 1, which does not forward TERM.
    if (inspected.State.Running && !inspected.HostConfig.Init) await docker(['exec', container, 'node', '-e',
      "const fs=require('fs');for(const pid of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))){try{const args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0');if(args.includes('server.js')&&args[0].endsWith('node'))process.kill(Number(pid),'SIGTERM');}catch{}}"
    ]).catch(() => {});
    await docker(['stop', '--time', '30', container], 40000);
  } else result = await closeTabs();
  return {mode: config.mode, ...result, browserStopped: config.mode === 'local', sessionsPreserved: true};
}
export async function resetBrowserRouting(config: BrowserConfig) {
  await rm(join(CREDENTIAL_DIR, 'browser', endpointId(config), 'routing'), {recursive: true, force: true});
  return {reset: 'transport', sessionsPreserved: true};
}
export async function resetBrowserSession(config: BrowserConfig, {provider, all = false, open = config.open}: {provider?: string; all?: boolean; open?: boolean}) {
  if (!!provider === all || provider && !providers.includes(provider)) throw new BrowserError('Choose --provider NAME or --all for the browser session reset.');
  const browser = await configuredBrowser(config);
  if (!(await browser.capabilities()).reset) throw new BrowserError('Session reset needs an updated fam Camofox plugin. Update the plugin and restart Camofox once; subsequent session resets do not restart the browser.', 'BROWSER_PLUGIN_REQUIRED', browser.endpoint.vncUrl);
  // NewspaperArchive and Storied share browser authentication. Reset both
  // contexts and both scoped CLI snapshots when either is selected.
  const affected = all ? providers : ['storied','newspaperarchive'].includes(provider!) ? ['storied','newspaperarchive'] : [provider!];
  const backupDirectory = join(CREDENTIAL_DIR, 'browser', endpointId(config), 'reset-backups', randomUUID());
  const result = await browser.api<{sessions: {userId: string; backupDirectory: string; closedTabs: number}[]}>('/fam/reset', {all, userIds: affected.map(name => browser.userId(name))}, 120000);
  const scopes = new Map<string, Set<string>>([[endpointId(config), new Set(affected)]]);
  for (const reset of result.sessions) {
    const name = providers.find(name => reset.userId.endsWith(`-${name}`));
    if (!all || !name || !reset.userId.startsWith('fam-')) continue;
    const session = reset.userId.slice(4, -name.length - 1);
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(session)) continue;
    const id = endpointId({...config, session});
    if (!scopes.has(id)) scopes.set(id, new Set(providers));
  }
  for (const [id, names] of scopes) {
    await mkdir(join(backupDirectory, id), {recursive: true, mode: 0o700});
    for (const name of [...names, ...(all ? ['routing'] : [])]) {
      try {await rename(join(CREDENTIAL_DIR, 'browser', id, name), join(backupDirectory, id, name));}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    }
  }
  const tab = all ? undefined : await browser.tab(affected[0]);
  if (tab) await tab.evaluate(`(()=>{document.title='fam: clean ${provider} session';document.body.textContent='This browser session has been reset. Open the provider website here when you are ready to sign in manually.';return true})()`);
  return {reset: 'session', all, ...(provider ? {provider} : {}), affectedProviders: affected, mode: config.mode, browserStopped: false, credentialsPreserved: true,
    loginCooldownPreserved: true, transportDecisionsPreserved: !all, backupDirectory, browserBackups: result.sessions, ...(tab ? {tabId: tab.id} : {}),
    vncUrl: browser.endpoint.vncUrl, opened: open ? await openUrl(browser.endpoint.vncUrl) : false,
    next: `${all ? 'Run fam PROVIDER.session login to sign in again; browser sign-ins support --interactive for manual submission.' : `Sign in manually in the blank browser tab, or run fam ${provider}.session login --interactive.`} No provider website was opened and no login was attempted.`};
}
export interface BrowserCookie {name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite?: 'Strict' | 'Lax' | 'None'}
export interface StorageState {cookies: BrowserCookie[]; origins: unknown[]}
export class Camofox {
  readonly endpoint: BrowserEndpoint;
  private viewerOpened = false;
  constructor(readonly config: BrowserConfig) {this.endpoint = config[config.mode]!;}
  async api<T = any>(path: string, body?: unknown, timeout = 60000): Promise<T> {
    let response: Response;
    try {response = await fetch(`${this.endpoint.url.replace(/\/$/,'')}${path}`, {method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: {...(this.endpoint.apiKey ? {Authorization: `Bearer ${this.endpoint.apiKey}`} : {}), ...(body === undefined ? {} : {'Content-Type': path.startsWith('/fam/') ? 'application/vnd.fam+json' : 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})});}
    catch {throw new BrowserError(`Cannot reach Camofox at ${this.endpoint.url}. Run fam browser status or check the remote URL.`, 'BROWSER_UNAVAILABLE', this.endpoint.vncUrl);}
    if (!response.ok) {
      let code = ''; try {code = (await response.json()).error ?? '';} catch {}
      const reason = response.status === 401 || response.status === 403 ? ' The server API key is missing or incorrect; configure --api-key-file.' : '';
      const detail: Record<string, string> = {
        'tab-not-found': 'The browser tab was closed; retry the command.',
        'session-has-unrelated-tabs': 'This context also contains tabs outside fam; the reset was refused to preserve them.',
        'session-reset-in-progress': 'A browser session reset is in progress. Wait for it to finish.',
        'session-reset-unsupported': 'Update the fam Camofox plugin and enable persistent storage to use session reset.',
        'unsupported-fetch-header': 'The browser controls one of these headers and cannot override it. Use cookie import for cookies.',
        'response-too-large': 'Browser responses are limited to 64 MiB.',
        'page-navigation-failed': 'The page could not be loaded. For binary downloads or non-document URLs use --mode request --format raw.',
        'page-timeout': 'The page navigation timed out.',
        'page-not-started': 'The page capture expired; retry the fetch.',
      };
      throw new BrowserError(`Camofox request failed (HTTP ${response.status}).${reason}${detail[code] ? ` ${detail[code]}` : ''}`, 'BROWSER_API_FAILED', this.endpoint.vncUrl);
    }
    return response.json() as Promise<T>;
  }
  async capabilities() {
    try {const result = await this.api('/fam/capabilities'); if (result.version !== 1) throw new Error(); return result;}
    catch (error) {if (error instanceof BrowserError && error.code === 'BROWSER_UNAVAILABLE') throw error;
      throw new BrowserError('Camofox needs the fam plugin and its configured API key. See fam browser setup --help and docs/browser.md.', 'BROWSER_PLUGIN_REQUIRED', this.endpoint.vncUrl);}
  }
  userId(provider: string) {return browserUserId(this.config, provider);}
  async tab(provider: string, url?: string): Promise<BrowserTab> {
    // Learn the ID before navigating so a failed navigation can be cleaned up.
    const result = await this.api('/tabs', {userId: this.userId(provider), sessionKey: 'fam'});
    if (typeof result.tabId !== 'string') throw new BrowserError('Camofox did not create a browser tab.');
    const tab = new BrowserTab(this, provider, result.tabId);
    try {if (url) await tab.navigate(url); return tab;}
    catch (error) {await tab.close().catch(() => {}); throw error;}
  }
  async state(provider: string): Promise<StorageState> {return (await this.api('/fam/storage', {userId: this.userId(provider)})).state;}
  async openViewer(): Promise<boolean> {
    if (!this.viewerOpened) this.viewerOpened = await openUrl(this.endpoint.vncUrl);
    return this.viewerOpened;
  }
  async notify(timeout = this.config.timeout) {process.stderr.write(`Complete sign-in or verification at ${this.endpoint.vncUrl}\n${timeout > 0 ? `Waiting up to ${timeout} seconds; the command will resume automatically.` : 'Complete verification, then rerun the command.'}\n`); if (this.config.open) await this.openViewer();}
}
export class BrowserTab {
  constructor(readonly browser: Camofox, readonly provider: string, readonly id: string) {}
  get userId() {return this.browser.userId(this.provider);}
  async close() {await this.browser.api('/fam/close-tab', {userId: this.userId, tabId: this.id});}
  async evaluate<T>(expression: string): Promise<T> {return (await this.browser.api(`/tabs/${this.id}/evaluate`, {userId: this.userId, expression})).result;}
  async navigate(url: string) {return this.browser.api(`/tabs/${this.id}/navigate`, {userId: this.userId, url});}
  async prepare(origin: string) {return this.browser.api('/fam/prepare', {userId: this.userId, tabId: this.id, origin});}
  async request(url: string, init: {method?: string; headers?: HeadersInit; body?: unknown} = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    let bodyBase64: string | undefined;
    if (init.body !== undefined && init.body !== null) {
      const request = new Request(url, {method: init.method ?? 'POST', body: init.body as BodyInit, headers});
      if (request.headers.has('content-type')) headers.set('content-type', request.headers.get('content-type')!);
      bodyBase64 = Buffer.from(await request.arrayBuffer()).toString('base64');
    }
    const data = await this.browser.api('/fam/request', {userId: this.userId, tabId: this.id, url, method: init.method ?? 'GET', headers: Object.fromEntries(headers), bodyBase64});
    const responseHeaders = new Headers(data.headers);
    for (const name of ['content-encoding','content-length','transfer-encoding']) responseHeaders.delete(name);
    return new Response([204,205,304].includes(data.status) || init.method === 'HEAD' ? null : Buffer.from(data.bodyBase64, 'base64'), {status: data.status, headers: responseHeaders});
  }
}
export async function configuredBrowser(config?: BrowserConfig): Promise<Camofox> {
  config ??= await browserConfig();
  if (!config) {await setupBrowser({local: true}); config = (await browserConfig())!;}
  const browser = new Camofox(config);
  try {await browser.api('/health', undefined, 3000);} catch {if (config.mode !== 'local') throw new BrowserError(`Camofox is unavailable at ${browser.endpoint.url}.`, 'BROWSER_UNAVAILABLE', browser.endpoint.vncUrl); await startBrowser(config);}
  await browser.capabilities();
  return browser;
}
export async function updateCookieJar(jar: CookieJar, state: StorageState, origin: string) {
  const url = new URL(origin);
  for (const raw of jar.serializeSync()?.cookies ?? []) {
    const cookie = Cookie.fromJSON(raw); if (!cookie) continue;
    const domain = cookie.domain?.replace(/^\./, '');
    if (domain && (url.hostname === domain || !cookie.hostOnly && url.hostname.endsWith(`.${domain}`))) {
      await new Promise<void>((resolve, reject) => jar.store.removeCookie(cookie.domain!, cookie.path!, cookie.key!, error => error ? reject(error) : resolve()));
    }
  }
  for (const cookie of state.cookies) {
    const domain = cookie.domain.replace(/^\./, '');
    const hostOnly = !cookie.domain.startsWith('.');
    if (url.hostname !== domain && (hostOnly || !url.hostname.endsWith(`.${domain}`))) continue;
    // Browser storage is already structured. Re-parsing it as Set-Cookie rejects
    // valid nameless cookies and can interpret cookie values as attributes.
    await jar.setCookie(new Cookie({key: cookie.name, value: cookie.value, domain, hostOnly,
      path: cookie.path || '/', secure: cookie.secure, httpOnly: cookie.httpOnly,
      ...(cookie.sameSite ? {sameSite: cookie.sameSite.toLowerCase()} : {}),
      ...(cookie.expires > 0 ? {expires: new Date(cookie.expires * 1000)} : {})}), origin);
  }
}
export function jarCookies(jar: CookieJar, origin: string): BrowserCookie[] {
  const hostname = new URL(origin).hostname;
  return (jar.serializeSync()?.cookies ?? []).flatMap(raw => {
    const cookie = Cookie.fromJSON(raw); if (!cookie) return [];
    const domain = cookie.domain?.replace(/^\./, '');
    if (!domain || hostname !== domain && (cookie.hostOnly || !hostname.endsWith(`.${domain}`))) return [];
    const expiry = cookie.expiryTime(cookie.creation instanceof Date ? cookie.creation : undefined);
    const expires = typeof expiry === 'number' && Number.isFinite(expiry) ? expiry / 1000 : -1;
    if (expires !== -1 && expires <= Date.now() / 1000) return [];
    return [{name: cookie.key!, value: cookie.value!, domain: cookie.hostOnly ? domain : `.${domain}`, path: cookie.path || '/', expires,
      httpOnly: !!cookie.httpOnly, secure: !!cookie.secure, ...(cookie.sameSite ? {sameSite: ({lax:'Lax', strict:'Strict', none:'None'} as const)[cookie.sameSite as 'lax' | 'strict' | 'none']} : {})}];
  });
}
export async function importBrowserCookies(provider: string, jar: CookieJar, origin: string) {
  const browser = await configuredBrowser();
  await browser.api('/fam/cookies', {userId: browser.userId(provider), cookies: jarCookies(jar, origin), explicit: true});
  return endpointId(browser.config);
}
