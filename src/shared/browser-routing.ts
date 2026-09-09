import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {CREDENTIAL_DIR, readPrivateJson} from './storage.js';
import {BrowserError, browserConfig, endpointId, transportPreference, transportDecision} from './browser-config.js';

function origin(value: string): string {
  let url: URL;
  try {url = new URL(value);} catch {throw new BrowserError('Expected an HTTP or HTTPS origin.');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== '/' || /[\u0000-\u0020]/.test(value)) throw new BrowserError('Supply only an HTTP or HTTPS origin, without credentials, a path, query, or fragment.');
  return url.origin;
}
const originKey = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);

/** Read only the selected instance's routing metadata, never browser sessions,
 * cookies or endpoint secrets. No provider/browser connections or writes. */
export async function browserRouting(providers: readonly string[], requestedOrigin?: string) {
  if (providers.some(provider => !/^[a-z]+$/.test(provider))) throw new BrowserError('Invalid browser provider.');
  const selectedOrigin = requestedOrigin === undefined ? undefined : origin(requestedOrigin);
  const config = await browserConfig(), preference = transportPreference(config);
  const directory = config ? `browser/${endpointId(config)}/routing` : undefined;
  const routes: Array<{provider: string; origin: string | null; rememberedBrowser: boolean | null; transport: 'http' | 'browser'; reason: string}> = [];
  const add = (provider: string, value: string | null, remembered?: boolean) => routes.push({provider, origin: value,
    rememberedBrowser: remembered ?? null, ...transportDecision(preference.policy, remembered)});
  if (selectedOrigin) {
    for (const provider of providers) {
      const saved = directory ? await readPrivateJson<{enabled: boolean}>(`${directory}/${provider}-${originKey(selectedOrigin)}.json`) : undefined;
      add(provider, selectedOrigin, saved?.enabled);
    }
  } else {
    const files = directory ? await readdir(join(CREDENTIAL_DIR, directory)).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new BrowserError('Cannot read browser transport routing.');
    }) : [];
    for (const provider of providers) {
      const savedRoutes: Array<{origin:string;enabled:boolean}> = [];
      for (const file of files.filter(file => file.startsWith(`${provider}-`) && /^[a-z]+-[a-f0-9]{24}\.json$/.test(file))) {
        const saved = await readPrivateJson<{origin:string;enabled:boolean}>(`${directory}/${file}`);
        if (!saved || typeof saved.origin !== 'string' || typeof saved.enabled !== 'boolean') throw new BrowserError('Invalid browser transport routing metadata.');
        const value = origin(saved.origin);
        if (file !== `${provider}-${originKey(value)}.json`) throw new BrowserError('Browser transport routing does not match its origin.');
        savedRoutes.push({origin:value,enabled:saved.enabled});
      }
      for (const saved of savedRoutes.sort((a,b)=>a.origin.localeCompare(b.origin))) add(provider, saved.origin, saved.enabled);
      add(provider, null);
    }
  }
  return {configured: !!config, ...(config ? {mode:config.mode,session:config.session,instance:endpointId(config)} : {}),
    ...preference, routes,
    note: `Each row is the starting transport for that provider and origin.${selectedOrigin ? '' : ' Other origins use the default row.'} Auto can switch HTTP to browser after a challenge. State belongs to this local fam profile and selected browser instance.`};
}
