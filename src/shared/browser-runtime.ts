import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {mkdir, writeFile, readFile, rm, rename, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Cookie, CookieJar} from 'tough-cookie';
import {providerNames} from './command-registry.js';
import {CREDENTIAL_DIR} from './storage.js';
import {browserConfig, browserUrl, browserEngine, browserName, saveBrowserConfig, browserUserId, endpointId, BrowserError, type BrowserConfig, type BrowserEndpoint, type BrowserEngine} from './browser-config.js';

const exec = promisify(execFile);
export const CAMOFOX_IMAGE = 'ghcr.io/jo-inc/camofox-browser:1.14.0@sha256:86c79eed8a6b3a78859f73bc70d6003c5566b85e969354ec454524b28197ffce';
export const pluginDirectory = fileURLToPath(new URL('../../browser/camofox-plugin/', import.meta.url));
export const browserDirectory = fileURLToPath(new URL('../../browser/', import.meta.url));
export const CLOAKBROWSER_IMAGE = 'fam-cloakbrowser:0.5.10';
export function localBrowserDirectory(engine: BrowserEngine) {return join(CREDENTIAL_DIR, 'browser', engine === 'cloakbrowser' ? 'local-cloakbrowser' : 'local');}
export function localBrowserEndpoint(engine: BrowserEngine, options: {apiPort?: number; vncPort?: number} = {}): BrowserEndpoint {
  const apiPort = options.apiPort ?? (engine === 'cloakbrowser' ? 9378 : 9377), vncPort = options.vncPort ?? (engine === 'cloakbrowser' ? 6082 : 6080);
  for (const port of [apiPort, vncPort]) if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new BrowserError('Browser ports must be between 1 and 65535.');
  if (apiPort === vncPort) throw new BrowserError('API and viewer need different ports.');
  const suffix = createHash('sha256').update(CREDENTIAL_DIR).digest('hex').slice(0, 10);
  return {engine, url: `http://127.0.0.1:${apiPort}`, vncUrl: `http://127.0.0.1:${vncPort}/vnc.html?autoconnect=1&resize=scale`,
    apiKey: randomBytes(32).toString('hex'), container: `fam-${engine === 'cloakbrowser' ? 'cloakbrowser' : 'browser'}-${suffix}`,
    image: engine === 'cloakbrowser' ? CLOAKBROWSER_IMAGE : CAMOFOX_IMAGE, apiPort, vncPort};
}
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
export async function setupBrowser(options: {engine?: BrowserEngine; local?: boolean; remote?: string; vncUrl?: string; apiKeyFile?: string; timeout?: number; install?: boolean; open?: boolean; session?: string; apiPort?: number; vncPort?: number} = {}) {
  if (options.local && options.remote) throw new BrowserError('Choose --local or --remote URL.');
  const prior = await browserConfig();
  const mode = options.remote ? 'remote' : 'local';
  const engine = options.engine ?? prior?.[mode]?.engine ?? 'cloakbrowser';
  if (!['cloakbrowser', 'camofox'].includes(engine)) throw new BrowserError('Choose cloakbrowser or camofox.');
  const config: BrowserConfig = {...prior, version: 1, mode: options.remote ? 'remote' : 'local', timeout: options.timeout ?? prior?.timeout ?? 600,
    transport: prior?.transport ?? 'auto', session: options.session ?? prior?.session ?? 'default', open: options.open ?? prior?.open ?? true};
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.session) || !Number.isSafeInteger(config.timeout) || config.timeout < 0 || config.timeout > 3600) throw new BrowserError('Invalid browser session name or timeout (0–3600 seconds).');
  if (options.remote) {
    const url = browserUrl(options.remote).replace(/\/$/, '');
    const viewer = new URL(url); viewer.port = '6080'; viewer.pathname = '/vnc.html'; viewer.search = '';
    config.remote = {engine, url, vncUrl: options.vncUrl ? browserUrl(options.vncUrl) : prior?.remote?.url === url ? prior.remote.vncUrl : viewer.href,
      ...(prior?.remote?.url === url ? {apiKey: prior.remote.apiKey} : {})};
    if (options.apiKeyFile) config.remote.apiKey = (await readFile(options.apiKeyFile, 'utf8')).trim();
  } else {
    await dockerReady(!!options.install);
    const saved = prior?.engines?.local?.[engine] ?? (prior?.local && (prior.local.engine ?? 'camofox') === engine ? prior.local : undefined);
    config.local = saved ? {...saved, engine} : localBrowserEndpoint(engine, options);
    if (saved && (options.apiPort !== undefined && options.apiPort !== (saved.apiPort ?? Number(new URL(saved.url).port)) || options.vncPort !== undefined && options.vncPort !== saved.vncPort)) throw new BrowserError('Local ports are fixed when the container is created. Use another FAM_CONFIG_DIR to create a browser on different ports.');
    if (options.vncUrl) config.local.vncUrl = browserUrl(options.vncUrl);
  }
  rememberEngines(config, prior);
  // Keep a generated key available for a retry even if Docker startup fails.
  await saveBrowserConfig(prior ? {...prior, engines: config.engines} : config);
  await startBrowser(config);
  const capabilities = await new Camofox(config).capabilities();
  if (capabilities.engine && capabilities.engine !== engine) throw new BrowserError(`This endpoint runs ${capabilities.engine}; select it with --engine ${capabilities.engine} or provide a ${engine} endpoint.`);
  if (prior?.[mode] && (prior[mode]!.engine ?? 'camofox') !== engine) await clearEngineSwitch({...prior, mode}, config);
  rememberEngines(config, prior);
  await saveBrowserConfig(config);
  return browserStatus(config);
}
function rememberEngines(config: BrowserConfig, prior?: BrowserConfig) {
  config.engines = {local: {...prior?.engines?.local, ...config.engines?.local}, remote: {...prior?.engines?.remote, ...config.engines?.remote}};
  for (const mode of ['local', 'remote'] as const) {
    if (prior?.[mode]) config.engines[mode]![prior[mode]!.engine ?? 'camofox'] = {...prior[mode]!, engine: prior[mode]!.engine ?? 'camofox'};
    if (config[mode]) config.engines[mode]![config[mode]!.engine ?? 'camofox'] = {...config[mode]!, engine: config[mode]!.engine ?? 'camofox'};
  }
}
export function discoveredEngine(config: BrowserConfig, engine: BrowserEngine, alternatives: Record<string, {url?: string; vncUrl?: string}>): BrowserEndpoint | undefined {
  const value = alternatives[engine], source = config[config.mode]!;
  if (!value?.url || !value.vncUrl) return;
  const url = new URL(value.url, `${source.url.replace(/\/$/, '')}/`), viewer = new URL(value.vncUrl, source.vncUrl);
  // Discovery can reuse the existing key only within its existing origin.
  if (url.origin !== new URL(source.url).origin || viewer.origin !== new URL(source.vncUrl).origin) throw new BrowserError('An advertised browser endpoint changes origin. Configure its URL and API key explicitly.');
  return {engine, url: browserUrl(url.href).replace(/\/$/, ''), vncUrl: browserUrl(viewer.href), apiKey: source.apiKey};
}
async function discardEngine(config: BrowserConfig): Promise<string[]> {
  const browser = new Camofox(config), ids = new Set<string>();
  if (config.mode === 'remote') {
    const result = await browser.api<{sessions: {userId: string}[]}>('/fam/reset', {all: true, discard: true}, 120000);
    for (const session of result.sessions) ids.add(session.userId);
  } else {
    const endpoint = config.local!, directory = join(localBrowserDirectory(browserEngine(config)), 'profiles');
    let inspected;
    try {inspected = JSON.parse(await docker(['inspect', endpoint.container!]))[0];} catch {}
    if (inspected && (inspected.Config.Labels?.app !== 'fam' || !inspected.Mounts.some((mount: any) => mount.Destination === '/data/profiles' && mount.Source === directory)))
      throw new BrowserError('The configured container does not own this fam profile directory.');
    if (inspected?.State.Running) await stopBrowser(config);
    for (const entry of await readdir(directory, {withFileTypes: true}).catch((error: NodeJS.ErrnoException) => {if (error.code === 'ENOENT') return []; throw error;})) {
      if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
      for (const name of ['fam-session.json', 'meta.json']) try {
        const meta = JSON.parse(await readFile(join(directory, entry.name, name), 'utf8'));
        if (typeof meta.userId === 'string') ids.add(meta.userId);
      } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
    }
    await rm(directory, {recursive: true, force: true});
    await mkdir(directory, {recursive: true, mode: 0o700});
    // Prevent a stale native cookie snapshot from reseeding a clean engine.
    await writeFile(join(directory, 'fam-reset-all.json'), JSON.stringify({at: new Date().toISOString()}), {mode: 0o600});
  }
  const scopes = new Set([endpointId(config)]);
  for (const userId of ids) {
    const provider = [...providers].sort((a, b) => b.length - a.length).find(name => userId.endsWith(`-${name}`));
    if (!provider || !userId.startsWith('fam-')) continue;
    const session = userId.slice(4, -provider.length - 1);
    if (/^[A-Za-z0-9._-]{1,64}$/.test(session)) scopes.add(endpointId({...config, session}));
  }
  for (const id of scopes) await rm(join(CREDENTIAL_DIR, 'browser', id), {recursive: true, force: true});
  return [...ids];
}
async function clearEngineSwitch(before: BrowserConfig, after: BrowserConfig) {
  // Preflight both remote services before deleting either side's state.
  if (before.mode === 'remote') for (const config of [before, after]) {
    if (!(await new Camofox(config).capabilities()).purge) throw new BrowserError('Update both remote fam browser services before switching engines; clean switching requires profile deletion support.');
  }
  await discardEngine(after);
  await discardEngine(before);
  await startBrowser(after);
}
export async function switchBrowserEngine(engine: BrowserEngine, supplied?: BrowserConfig): Promise<unknown> {
  if (!['cloakbrowser', 'camofox'].includes(engine)) throw new BrowserError('Choose cloakbrowser or camofox.');
  const prior = supplied ?? await browserConfig();
  if (!prior) return setupBrowser({local: true, engine});
  if (prior[prior.mode]!.engine === engine) {await startBrowser(prior); await saveBrowserConfig(prior); return browserStatus(prior);}
  let endpoint = prior.engines?.[prior.mode]?.[engine];
  if (!endpoint && browserEngine(prior) === engine) endpoint = {...prior[prior.mode]!, engine};
  if (!endpoint && prior.mode === 'local') endpoint = localBrowserEndpoint(engine);
  if (!endpoint) endpoint = discoveredEngine(prior, engine, (await new Camofox(prior).capabilities()).alternatives ?? {});
  if (!endpoint) throw new BrowserError(`Configure the remote ${engine} endpoint once with fam browser setup --engine ${engine} --remote URL --vnc-url URL --api-key-file FILE.`);
  const config: BrowserConfig = {...prior, [prior.mode]: {...endpoint, engine}};
  rememberEngines(config, prior);
  await saveBrowserConfig({...prior, engines: config.engines});
  await startBrowser(config);
  const capabilities = await new Camofox(config).capabilities();
  if (capabilities.engine && capabilities.engine !== engine) throw new BrowserError(`The selected endpoint runs ${capabilities.engine}, not ${engine}.`);
  if (browserEngine(prior) !== engine) await clearEngineSwitch(prior, config);
  await saveBrowserConfig(config);
  return {...await browserStatus(config), sessionsCleared: browserEngine(prior) !== engine};
}
export async function upgradeBrowser(config: BrowserConfig): Promise<BrowserConfig> {
  if (config[config.mode]!.engine !== undefined) return config;
  if (config.mode === 'local') await switchBrowserEngine('cloakbrowser', config);
  else {
    const capabilities = await new Camofox(config).capabilities();
    if (capabilities.engine === 'cloakbrowser') {
      config.remote = {...config.remote!, engine: 'cloakbrowser'}; rememberEngines(config); await saveBrowserConfig(config);
    } else if (config.engines?.remote?.cloakbrowser || capabilities.alternatives?.cloakbrowser) await switchBrowserEngine('cloakbrowser', config);
    else return config; // Remote upgrade follows deployment of the advertised service.
  }
  return (await browserConfig())!;
}
export async function startBrowser(config?: BrowserConfig): Promise<unknown> {
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
    let runtime = '4';
    if (browserEngine(config) === 'cloakbrowser') {
      const hash = createHash('sha256');
      for (const name of ['Dockerfile', 'package.json', 'package-lock.json', 'launch.py', 'server.mjs', 'humanize.mjs', 'main.mjs']) hash.update(await readFile(join(browserDirectory, 'cloakbrowser', name)));
      hash.update(await readFile(join(pluginDirectory, 'index.js'))); runtime = `cloakbrowser-${hash.digest('hex').slice(0, 16)}`;
    }
    if (exists && inspected.Config.Labels?.['fam.runtime'] !== runtime) {
      if (inspected.State.Running) await stopBrowser(config);
      const backup = `${container}-before-upgrade-${Date.now()}`;
      await docker(['rename', container, backup]); exists = false;
      process.stderr.write(`Preserved the previous local container as ${backup}; reusing its saved profiles.\n`);
    }
    if (exists) await docker(['start', container]);
    else {
      const directory = localBrowserDirectory(browserEngine(config));
      await mkdir(join(directory, 'profiles'), {recursive: true, mode: 0o700});
      const envFile = join(directory, 'container.env');
      if (browserEngine(config) === 'cloakbrowser') {
        await writeFile(envFile, `FAM_BROWSER_API_KEY=${endpoint.apiKey}\nFAM_BROWSER_PROFILE_DIR=/data/profiles\n`, {mode: 0o600});
        process.stderr.write('Preparing CloakBrowser. The first Docker build may take a few minutes.\n');
        await docker(['build', '-t', CLOAKBROWSER_IMAGE, '-f', join(browserDirectory, 'cloakbrowser/Dockerfile'), browserDirectory], 600000);
        await docker(['run', '-d', '--name', container, '--label', 'app=fam', '--label', `fam.runtime=${runtime}`, '--init', '--restart', 'unless-stopped', '--shm-size', '1g', '--env-file', envFile,
          '-p', `127.0.0.1:${endpoint.apiPort ?? 9378}:9377`, '-p', `127.0.0.1:${endpoint.vncPort ?? 6082}:6080`,
          '-v', `${join(directory, 'profiles')}:/data/profiles`, CLOAKBROWSER_IMAGE], 60000);
      } else {
      await writeFile(envFile, `CAMOFOX_API_KEY=${endpoint.apiKey}\nENABLE_VNC=1\nENABLE_FAM=1\nVNC_BIND=0.0.0.0\nCAMOFOX_PROFILE_DIR=/data/profiles\nCAMOFOX_CRASH_REPORT_ENABLED=false\nBROWSER_IDLE_TIMEOUT_MS=86400000\nTAB_INACTIVITY_MS=86400000\nSESSION_TIMEOUT_MS=86400000\n`, {mode: 0o600});
      const pluginConfig = join(directory, 'camofox.config.json');
      await writeFile(pluginConfig, JSON.stringify({plugins: {persistence: {enabled: true, indexedDB: true}, vnc: {enabled: true}, fam: {enabled: true}}}), {mode: 0o600});
      process.stderr.write('Preparing the persistent Camofox container. The first image download may take a few minutes.\n');
      await docker(['pull', endpoint.image!], 600000);
      await docker(['run', '-d', '--name', container, '--label', 'app=fam', '--label', `fam.runtime=${runtime}`, '--init', '--entrypoint', 'node', '--restart', 'unless-stopped', '--shm-size', '1g', '--env-file', envFile,
        '-p', `127.0.0.1:${endpoint.apiPort ?? new URL(endpoint.url).port}:9377`, '-p', `127.0.0.1:${endpoint.vncPort ?? 6080}:6080`,
        '-v', `${join(directory, 'profiles')}:/data/profiles`, '-v', `${pluginDirectory}:/app/plugins/fam:ro`, '-v', `${pluginConfig}:/app/camofox.config.json:ro`, endpoint.image!, '--max-old-space-size=512', '/app/plugins/fam/start.mjs'], 60000);
      }
    }
  }
  const browser = new Camofox(config);
  for (let attempt = 0; attempt < 45; attempt++) {
    try {await browser.api('/health', undefined, 3000); await browser.api('/start', {userId: browser.userId('web')}); return;} catch (error) {
      if (config.mode === 'remote' || attempt === 44) throw error;
      if (attempt % 10 === 0) process.stderr.write(`Waiting for ${browserName(config)} to start…\n`);
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
  return {configured: true, mode: config.mode, engine: browserEngine(config), availableEngines: config.mode === 'local' ? ['cloakbrowser','camofox'] : Object.keys(config.engines?.remote ?? {[browserEngine(config)]: endpoint}),
    upgradePending: endpoint.engine === undefined, url: endpoint.url, vncUrl: endpoint.vncUrl, reachable, running, plugin, timeout: config.timeout,
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
    catch {throw new BrowserError(`Cannot reach ${browserName(this.config)} at ${this.endpoint.url}. Run fam browser status or check the remote URL.`, 'BROWSER_UNAVAILABLE', this.endpoint.vncUrl);}
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
      throw new BrowserError(`${browserName(this.config)} request failed (HTTP ${response.status}).${reason}${detail[code] ? ` ${detail[code]}` : ''}`, 'BROWSER_API_FAILED', this.endpoint.vncUrl);
    }
    return response.json() as Promise<T>;
  }
  async capabilities() {
    try {const result = await this.api('/fam/capabilities'); if (result.version !== 1) throw new Error(); return result;}
    catch (error) {if (error instanceof BrowserError && error.code === 'BROWSER_UNAVAILABLE') throw error;
      throw new BrowserError('The browser needs an updated fam service and its configured API key. See fam browser setup --help and docs/browser.md.', 'BROWSER_PLUGIN_REQUIRED', this.endpoint.vncUrl);}
  }
  userId(provider: string) {return browserUserId(this.config, provider);}
  async tab(provider: string, url?: string): Promise<BrowserTab> {
    // Learn the ID before navigating so a failed navigation can be cleaned up.
    const result = await this.api('/tabs', {userId: this.userId(provider), sessionKey: 'fam'});
    if (typeof result.tabId !== 'string') throw new BrowserError('The browser did not create a tab.');
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
  config = await upgradeBrowser(config);
  const browser = new Camofox(config);
  try {await browser.api('/health', undefined, 3000);} catch {if (config.mode !== 'local') throw new BrowserError(`${browserName(config)} is unavailable at ${browser.endpoint.url}.`, 'BROWSER_UNAVAILABLE', browser.endpoint.vncUrl); await startBrowser(config);}
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
