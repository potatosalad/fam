import {Impit} from 'impit';
import {fetchWithBrowser} from '../shared/browser-transport.js';
import {isChallenge} from '../shared/browser-challenge.js';
import {BrowserError} from '../shared/browser-config.js';
import {linkUrl, siteUrl} from './url.js';

type ResponseLike = Pick<Response, 'status' | 'headers' | 'arrayBuffer'>;
export type Transport = (url: string, init: {method: 'GET'; redirect: 'manual'; headers: Record<string, string>}) => Promise<ResponseLike>;
export interface Document {url: string; text: string; contentType: string; destinationUrl?: string}
export class CyndisListHttp {
  private transport: Transport;
  constructor(transport?: Transport) {
    const http = new Impit({browser: 'chrome', timeout: 30000});
    this.transport = transport ?? ((url, init) => fetchWithBrowser('cyndislist', url, init, () => http.fetch(url, init)));
  }
  async get(value: string): Promise<Document> {
    let url = siteUrl(value);
    const seen = new Set<string>();
    for (let hop = 0; hop < 8; hop++) {
      if (seen.has(url)) throw new Error('Cyndi’s List redirected in a loop.');
      seen.add(url);
      const response = await this.transport(url, {method: 'GET', redirect: 'manual', headers: {Accept: 'text/html, text/plain;q=0.9, */*;q=0.1'}});
      if ([301,302,303,307,308].includes(response.status)) {
        const target = linkUrl(response.headers.get('location') ?? undefined, url);
        if (!target) throw new Error('Cyndi’s List returned a redirect without a usable HTTP destination.');
        let internal: string;
        try {internal = siteUrl(target);} catch {return {url, text: '', contentType: '', destinationUrl: target};}
        url = internal; continue;
      }
      if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024) throw new Error('Cyndi’s List response exceeded 16 MiB.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 16 * 1024 * 1024) throw new Error('Cyndi’s List response exceeded 16 MiB.');
      const text = new TextDecoder().decode(bytes);
      if (isChallenge(response.headers, text)) throw new BrowserError('Cyndi’s List requires browser verification.', 'BROWSER_INTERACTION_REQUIRED');
      if (response.status < 200 || response.status >= 300) throw new Error(`Cyndi’s List returned HTTP ${response.status} for ${url}.`);
      return {url, text, contentType: response.headers.get('content-type') ?? ''};
    }
    throw new Error('Cyndi’s List redirect limit exceeded.');
  }
}
