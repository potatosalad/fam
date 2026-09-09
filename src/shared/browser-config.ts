import {createHash} from 'node:crypto';
import {readPrivateJson, writePrivateJson} from './storage.js';

export type BrowserMode = 'local' | 'remote';
export type BrowserTransportMode = 'auto' | 'http' | 'browser';
export interface BrowserEndpoint {url: string; vncUrl: string; apiKey?: string; container?: string; image?: string; apiPort?: number; vncPort?: number}
export interface BrowserConfig {
  version: 1; mode: BrowserMode; local?: BrowserEndpoint; remote?: BrowserEndpoint;
  timeout: number; transport: BrowserTransportMode; session: string; open: boolean;
}
export class BrowserError extends Error {
  constructor(message: string, readonly code = 'BROWSER_FAILED', readonly vncUrl?: string) {super(message); this.name = 'BrowserError';}
}
let overrides: {transport?: BrowserTransportMode; timeout?: number} = {};
export function setBrowserOverrides(value: typeof overrides) {
  overrides = {...(value.transport === undefined ? {} : {transport: value.transport}), ...(value.timeout === undefined ? {} : {timeout: value.timeout})};
}
export function browserUrl(value: string): string {
  let url: URL;
  try {url = new URL(value);} catch {throw new BrowserError('Expected an absolute browser URL.');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new BrowserError('Browser URLs must use HTTP or HTTPS without embedded credentials.');
  return url.href;
}
export async function browserConfig(): Promise<BrowserConfig | undefined> {
  const saved = await readPrivateJson<BrowserConfig>('browser/config.json');
  if (!saved) return undefined;
  if (saved.version !== 1 || !['local', 'remote'].includes(saved.mode) || !saved[saved.mode] || !['auto','http','browser'].includes(saved.transport)
    || !Number.isSafeInteger(saved.timeout) || saved.timeout < 0 || saved.timeout > 3600 || !/^[A-Za-z0-9._-]{1,64}$/.test(saved.session)) throw new BrowserError('Invalid browser configuration. Run fam browser setup.');
  for (const endpoint of [saved.local, saved.remote]) if (endpoint) {browserUrl(endpoint.url); browserUrl(endpoint.vncUrl);}
  return {...saved, ...overrides};
}
export const saveBrowserConfig = (config: BrowserConfig) => writePrivateJson('browser/config.json', config);
export function endpointId(config: BrowserConfig): string {
  return createHash('sha256').update(`${config.mode}:${config[config.mode]!.url}:${config.session}`).digest('hex').slice(0, 24);
}
export function browserUserId(config: BrowserConfig, provider: string): string {
  if (provider !== 'web-private' && !/^[a-z]+$/.test(provider)) throw new BrowserError('Invalid browser provider.');
  return `fam-${config.session}-${provider}`;
}
export async function rememberBrowser(provider: string, origin: string, enabled = true): Promise<void> {
  const config = await browserConfig(); if (!config) return;
  // One file per origin avoids lost updates between concurrent commands.
  const key = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  await writePrivateJson(`browser/${endpointId(config)}/routing/${provider}-${key}.json`, {origin, enabled});
}
export function transportPreference(config?: BrowserConfig): {policy: BrowserTransportMode; source: 'command' | 'configuration' | 'environment' | 'default'} {
  if (overrides.transport !== undefined) return {policy: overrides.transport, source: 'command'};
  if (config) return {policy: config.transport, source: 'configuration'};
  if (process.env.FAM_TRANSPORT !== undefined) return {policy: process.env.FAM_TRANSPORT as BrowserTransportMode, source: 'environment'};
  return {policy: 'auto', source: 'default'};
}
export function transportDecision(policy: BrowserTransportMode, remembered?: boolean): {transport: 'http' | 'browser'; reason: string} {
  if (policy !== 'auto') return {transport: policy === 'browser' ? 'browser' : 'http', reason: `Selected ${policy} policy`};
  return remembered === true ? {transport: 'browser', reason: 'Remembered browser route'}
    : {transport: 'http', reason: remembered === false ? 'Browser route disabled' : 'No remembered browser route'};
}
export async function useBrowser(provider: string, origin: string): Promise<boolean> {
  const config = await browserConfig();
  const {policy} = transportPreference(config);
  if (policy !== 'auto') return transportDecision(policy).transport === 'browser';
  if (!config) return false;
  const key = createHash('sha256').update(origin).digest('hex').slice(0, 24);
  const remembered = await readPrivateJson<{enabled: boolean}>(`browser/${endpointId(config)}/routing/${provider}-${key}.json`);
  return transportDecision(policy, remembered?.enabled).transport === 'browser';
}
export async function directOnly(): Promise<boolean> {return transportPreference(await browserConfig()).policy === 'http';}
export interface BrowserSessionMarker {browserInstance?: string}
export async function loadProviderSession<T>(provider: string): Promise<T | undefined> {
  const config = await browserConfig();
  if (config) {
    const selected = await readPrivateJson<{mode: string}>(`browser/${endpointId(config)}/${provider}/active.json`);
    const scoped = await readPrivateJson<T>(`browser/${endpointId(config)}/${provider}/session.json`);
    if (scoped && selected?.mode !== 'native') return scoped;
  }
  const legacy = await readPrivateJson<T & {browserInstance?: string; mode?: string}>(`${provider}/session.json`);
  // Old HAR sessions have no instance identity. Explicitly import them into the
  // selected browser; never silently copy local logins to a remote service.
  if (config && legacy && (legacy.browserInstance || legacy.mode === 'browser') && !await directOnly()) return undefined;
  return legacy;
}
export async function saveProviderSession(provider: string, session: BrowserSessionMarker): Promise<void> {
  if (session.browserInstance) {
    if (!/^[a-f0-9]{24}$/.test(session.browserInstance)) throw new BrowserError('Invalid browser session identity.');
    await writePrivateJson(`browser/${session.browserInstance}/${provider}/session.json`, session);
    await writePrivateJson(`browser/${session.browserInstance}/${provider}/active.json`, {mode: 'browser'});
  } else {
    await writePrivateJson(`${provider}/session.json`, session);
    const config = await browserConfig();
    if (config) await writePrivateJson(`browser/${endpointId(config)}/${provider}/active.json`, {mode: 'native'});
  }
}
