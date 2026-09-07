import { Impit } from 'impit';

export const WEB = 'https://newspaperarchive.com';
export function checkUrl(value: string | URL): URL {
  let url: URL;
  try {url = new URL(value);} catch {throw new Error('Expected an absolute NewspaperArchive HTTPS URL.');}
  if (url.origin !== WEB || url.username || url.password || url.hash) throw new Error('Refusing a request outside NewspaperArchive.');
  return url;
}
export class NewspaperArchiveError extends Error {
  constructor(readonly code: 'http' | 'verification-required' | 'api-changed', readonly status?: number) {
    super(code === 'verification-required' ? 'NewspaperArchive requires browser verification for this public page. Open its source URL on the website; the request was not retried.'
      : code === 'api-changed' ? 'NewspaperArchive response format changed or this capability is unavailable.'
      : `NewspaperArchive HTTP ${status}; check website access. The request was not retried.`);
    this.name = 'NewspaperArchiveError';
  }
}
type ResponseLike = Pick<Response, 'status' | 'headers' | 'arrayBuffer'>;
export type Transport = (url: string, init: {method: 'GET'; headers: Record<string, string>; redirect: 'manual'}) => Promise<ResponseLike>;
/** Public OCR pages only. Storied credentials/tokens are never sent to the NewspaperArchive website. */
export class NewspaperArchiveHttp {
  private readonly transport: Transport;
  constructor(transport?: Transport) {
    const http = new Impit({browser: 'chrome', timeout: 30_000});
    this.transport = transport ?? ((url, init) => http.fetch(url, init));
  }
  async text(value: string | URL) {
    let url = checkUrl(value);
    for (let hop = 0; hop < 6; hop++) {
      let response: ResponseLike;
      try {response = await this.transport(url.href, {method: 'GET', headers: {}, redirect: 'manual'});}
      catch {throw new Error('NewspaperArchive network request failed.');}
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new NewspaperArchiveError('api-changed');
        url = checkUrl(new URL(location, url)); continue;
      }
      if (Number(response.headers.get('content-length')) > 20 * 1024 * 1024) throw new Error('NewspaperArchive response exceeded 20 MiB.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new Error('NewspaperArchive response exceeded 20 MiB.');
      const text = new TextDecoder().decode(bytes);
      if (/Just a moment\.\.\.|Attention Required!.*Cloudflare|challenge-platform|cf-chl-/i.test(text.slice(0,12000))) throw new NewspaperArchiveError('verification-required', response.status);
      if (response.status < 200 || response.status >= 300) throw new NewspaperArchiveError('http', response.status);
      return {url: url.href, text};
    }
    throw new Error('NewspaperArchive redirect limit exceeded.');
  }
}
