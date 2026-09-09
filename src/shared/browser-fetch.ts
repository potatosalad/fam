import {setTimeout as delay} from 'node:timers/promises';
import {load} from 'cheerio';
import TurndownService from 'turndown';
// @ts-expect-error The GFM plugin does not publish TypeScript declarations.
import {gfm} from 'turndown-plugin-gfm';
import {configuredBrowser, type BrowserTab} from './browser-runtime.js';
import {BrowserError} from './browser-config.js';
import {isChallenge} from './browser-challenge.js';
import {readCommandFile} from './command-input.js';
import {UsageError, type Values} from './command-runtime.js';
import {parseJson} from './json.js';

export type FetchFormat = 'raw' | 'html' | 'text' | 'markdown' | 'json';
export interface BrowserFetchOptions {
  url: string; mode: 'navigate' | 'request'; format: FetchFormat; context: string;
  headers: Record<string, string>; cookies: Record<string, unknown>[];
  method: string; bodyBase64?: string; timeout: number; waitMs: number;
  selector?: string; keepTab: boolean; open?: boolean; redirects: 'follow' | 'manual' | 'error';
}
interface WireResponse {url: string; status: number; statusText: string; headers: [string, string][]; bodyBase64: string}
interface PageResponse extends WireResponse {pending: boolean; html: string; contentHtml: string; text: string; title: string; ready: boolean; selected: boolean}
export interface BrowserFetchResult {
  requestUrl: string; url: string; status: number; statusText: string; headers: [string, string][];
  contentType: string; bytes: number; mode: string; title?: string; html?: string; text?: string;
  markdown?: string; links?: {text: string; url: string}[]; metadata?: Record<string, string>;
  jsonLd?: unknown[]; json?: unknown; bodyBase64?: string; tabId?: string; vncUrl?: string;
}
const formats = ['raw','html','text','markdown','json'];
const list = (value: Values[string]): string[] => value === undefined ? [] : Array.isArray(value) ? value : [String(value)];
function httpUrl(value: string): URL {
  let url: URL; try {url = new URL(value);} catch {throw new UsageError('--url must be an absolute HTTP or HTTPS URL.');}
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new UsageError('Fetch URLs must use HTTP or HTTPS without embedded credentials; use --header Authorization:… instead.');
  return url;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export async function browserFetchOptions(values: Values): Promise<BrowserFetchOptions> {
  if (values.open && values['no-open']) throw new UsageError('Choose --open or --no-open.');
  const url = httpUrl(String(values.url)), headers = new Headers();
  if (values['headers-file']) {
    let input: unknown; try {input = JSON.parse(await readCommandFile(String(values['headers-file']), 'utf8'));} catch {throw new UsageError('--headers-file must contain a JSON object of header strings.');}
    if (!object(input) || Object.values(input).some(value => typeof value !== 'string')) throw new UsageError('--headers-file must contain a JSON object of header strings.');
    try {for (const [name,value] of Object.entries(input)) headers.set(name, String(value));} catch {throw new UsageError('Invalid header name or value in --headers-file.');}
  }
  for (const header of list(values.header)) {
    const colon = header.indexOf(':');
    if (colon < 1) throw new UsageError('--header expects Name: value; repeat for additional headers.');
    try {headers.set(header.slice(0, colon).trim(), header.slice(colon + 1).trim());} catch {throw new UsageError('Invalid --header name or value.');}
  }
  if (values['user-agent']) headers.set('user-agent', String(values['user-agent']));
  if (values.referer) headers.set('referer', httpUrl(String(values.referer)).href);
  const cookies: Record<string, unknown>[] = [];
  if (values['cookies-file']) {
    let input: any; try {input = JSON.parse(await readCommandFile(String(values['cookies-file']), 'utf8'));} catch {throw new UsageError('--cookies-file must contain a JSON cookie array or Playwright storage state.');}
    input = Array.isArray(input) ? input : input?.cookies;
    if (!Array.isArray(input) || input.some(cookie => !object(cookie) || typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || !(typeof cookie.url === 'string' || typeof cookie.domain === 'string' && typeof cookie.path === 'string')))
      throw new UsageError('Each cookie needs string name/value and either url or domain/path.');
    cookies.push(...input);
  }
  for (const line of [...list(values.cookie), ...(headers.has('cookie') ? [headers.get('cookie')!] : [])]) for (const part of line.split(';')) {
    if (!part.trim()) continue;
    const equal = part.indexOf('=');
    if (equal < 1) throw new UsageError('--cookie expects name=value pairs separated by semicolons.');
    cookies.push({name: part.slice(0,equal).trim(), value: part.slice(equal + 1).trim(), url: `${url.origin}/`});
  }
  headers.delete('cookie');
  for (const name of headers.keys()) if (/^(host|origin|content-length|connection|accept-encoding|transfer-encoding|upgrade|trailer|te|keep-alive|sec-.*|proxy-.*)$/i.test(name))
    throw new UsageError(`The browser controls ${name}; this header cannot be overridden. Cookies can be supplied with --cookie or --cookies-file.`);
  if (values.body !== undefined && values['body-file'] !== undefined) throw new UsageError('Choose --body or --body-file.');
  const body = values['body-file'] !== undefined ? await readCommandFile(String(values['body-file'])) : values.body !== undefined ? Buffer.from(String(values.body)) : undefined;
  const method = String(values.method ?? (body ? 'POST' : 'GET')).toUpperCase();
  if (!/^[A-Z!#$%&'*+.^_`|~-]+$/.test(method) || ['CONNECT','TRACE','TRACK'].includes(method)) throw new UsageError('Unsupported browser HTTP method. CONNECT, TRACE and TRACK are forbidden by browsers.');
  if (body !== undefined && ['GET','HEAD'].includes(method)) throw new UsageError('GET and HEAD cannot have a browser request body.');
  if (body && body.length > 48 * 1024 * 1024) throw new UsageError('Browser request bodies are limited to 48 MiB.');
  const format = String(values.json ? 'json' : values.format ?? 'text') as FetchFormat;
  if (!formats.includes(format)) throw new UsageError('Unsupported fetch format.');
  const mode = String(values.mode ?? (method !== 'GET' || format === 'raw' ? 'request' : 'navigate')) as BrowserFetchOptions['mode'];
  if (!['navigate','request'].includes(mode)) throw new UsageError('Choose --mode navigate or request.');
  if (mode === 'navigate' && method !== 'GET') throw new UsageError('Document navigation uses GET; use --mode request for other methods.');
  if (mode === 'navigate' && values.redirects && values.redirects !== 'follow') throw new UsageError('Document navigation follows browser redirects; use --mode request for manual redirects.');
  if (mode === 'request' && (values['wait-for'] || values['wait-ms'])) throw new UsageError('--wait-for and --wait-ms require --mode navigate.');
  if (values.private && values.context && !['web','web-private'].includes(String(values.context)))
    throw new UsageError('--private uses a separate general browsing context; omit --context or select web.');
  return {url: url.href, headers: Object.fromEntries(headers), cookies, mode, format, method, ...(body === undefined ? {} : {bodyBase64: body.toString('base64')}),
    context: values.private ? 'web-private' : String(values.context ?? 'web'), timeout: Number(values.timeout ?? 60), waitMs: Number(values['wait-ms'] ?? 0),
    selector: values['wait-for'] as string | undefined, keepTab: !!values['keep-tab'] || !!values.open,
    open: values.open ? true : values['no-open'] ? false : undefined, redirects: (values.redirects ?? 'follow') as BrowserFetchOptions['redirects']};
}
const markdown = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-'}).use(gfm);
export function extractBrowserContent(html: string, url: string, visibleText?: string, contentHtml?: string) {
  const $ = load(html), metadata: Record<string, string> = {}, jsonLd: unknown[] = [];
  $('meta[name],meta[property]').each((_,node) => {const el=$(node), key=el.attr('name') ?? el.attr('property'); if (key) metadata[key]=el.attr('content') ?? '';});
  $('script[type="application/ld+json"]').each((_,node) => {try {jsonLd.push(parseJson($(node).text()));} catch { /* Invalid website metadata is omitted. */ }});
  let base = url; try {base = new URL($('base[href]').first().attr('href') ?? url, url).href;} catch {}
  const content = load(contentHtml ?? $('body').html() ?? html);
  content('script,style,noscript,template,[hidden],[aria-hidden="true"]').remove();
  const links: {text:string; url:string}[] = [];
  for (const [tag, attribute] of [['a','href'],['img','src']]) content(`${tag}[${attribute}]`).each((_,node) => {
    const el=content(node); try {
      const target = new URL(el.attr(attribute)!, base);
      if (!['http:','https:','mailto:','tel:'].includes(target.protocol)) {el.removeAttr(attribute); return;}
      el.attr(attribute,target.href); if (tag === 'a') links.push({text:el.text().trim(),url:target.href});
    } catch {el.removeAttr(attribute);}
  });
  const md = markdown.turndown(content('body').html() ?? '');
  content('br').replaceWith('\n');
  content('p,div,section,article,header,footer,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote').append('\n');
  const text = visibleText ?? content('body').text().replace(/[\t ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  return {title: $('title').text(), text, markdown: md, links, metadata, jsonLd};
}
function decodedBody(response: WireResponse): string {
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(new Headers(response.headers).get('content-type') ?? '')?.[1] ?? 'utf-8';
  try {return new TextDecoder(charset).decode(Buffer.from(response.bodyBase64,'base64'));} catch {return Buffer.from(response.bodyBase64,'base64').toString('utf8');}
}
export function browserFetchResult(options: BrowserFetchOptions, response: WireResponse | PageResponse): BrowserFetchResult {
  const contentType = new Headers(response.headers).get('content-type') ?? '', bytes = Buffer.from(response.bodyBase64,'base64');
  const result: BrowserFetchResult = {requestUrl: options.url, url: response.url, status: response.status, statusText: response.statusText, headers: response.headers, contentType, bytes: bytes.length, mode: options.mode};
  if (options.format === 'raw') return {...result, bodyBase64: response.bodyBase64};
  const body = decodedBody(response), page = 'html' in response ? response : undefined;
  if (page && /html|xhtml/i.test(contentType) || /^\s*(?:<!doctype html|<html\b)/i.test(body) || /html|xhtml/i.test(contentType)) {
    const html = page?.html ?? body;
    return {...result, html, ...extractBrowserContent(html, response.url, page?.text, page?.contentHtml)};
  }
  if (/^(?:text\/)|json|xml|javascript|svg/i.test(contentType) || !contentType && !bytes.includes(0)) {
    const text = page?.text || body;
    let json: unknown; try {json = parseJson(body);} catch {}
    return {...result, text, markdown: text, ...(json === undefined ? {} : {json})};
  }
  if (options.format !== 'json') throw new BrowserError('This response is binary; use --format raw --out FILE or --format json.', 'BROWSER_BINARY_RESPONSE');
  return {...result, bodyBase64: response.bodyBase64};
}
export function renderBrowserFetch(result: BrowserFetchResult, format: FetchFormat): string | Buffer {
  if (format === 'raw') return Buffer.from(result.bodyBase64 ?? '', 'base64');
  if (format === 'html') {
    if (result.html === undefined) throw new BrowserError('This response is not HTML; use --format raw or text.', 'BROWSER_NOT_HTML');
    return result.html;
  }
  return result[format === 'markdown' ? 'markdown' : 'text'] ?? '';
}
async function navigate(tab: BrowserTab, options: BrowserFetchOptions, url = options.url): Promise<PageResponse> {
  await tab.browser.api('/fam/page-start', {userId: tab.userId, tabId: tab.id, url, headers: options.headers, timeoutMs: options.timeout * 1000});
  let end = Date.now() + options.timeout * 1000, notified = false, readyAt: number | undefined, challengeAt: number | undefined;
  while (true) {
    const response = await tab.browser.api<PageResponse>('/fam/page-result', {userId:tab.userId, tabId:tab.id, selector:options.selector});
    const challenge = !response.pending && (isChallenge(new Headers(response.headers), response.html) || /Enable JavaScript and cookies to continue/i.test(response.text));
    // Empty script-only documents may navigate after obtaining clearance.
    const blank = !response.pending && !response.text?.trim() && /<script\b/i.test(response.html) && !/<(?:img|video|form|input)\b/i.test(response.contentHtml);
    if (challenge && challengeAt === undefined) {
      challengeAt = Date.now(); end = challengeAt + tab.browser.config.timeout * 1000;
    }
    // Give automatic verification a chance to finish without opening a viewer.
    // A blank app-loading document alone never requests human interaction.
    if (challenge && !notified && (Date.now() - challengeAt! >= 2000 || Date.now() >= end)) {
      notified = true;
      await tab.browser.notify();
    }
    if (!response.pending && response.ready && !challenge && !blank && (!options.selector || response.selected)) {
      readyAt ??= Date.now();
      if (Date.now() - readyAt >= options.waitMs) return response;
    } else readyAt = undefined;
    if (Date.now() >= end) {
      if (challenge) throw new BrowserError(`Browser verification did not finish. Complete it at ${tab.browser.endpoint.vncUrl}, then retry.`, 'BROWSER_INTERACTION_REQUIRED', tab.browser.endpoint.vncUrl);
      throw new BrowserError(options.selector ? 'Timed out waiting for the selected element.' : 'Timed out waiting for the browser page.', 'BROWSER_PAGE_TIMEOUT');
    }
    await delay(300);
  }
}
async function request(tab: BrowserTab, options: BrowserFetchOptions): Promise<WireResponse> {
  let url = new URL(options.url); url.hash = '';
  let method = options.method, bodyBase64 = options.bodyBase64, headers = {...options.headers};
  let verified = false;
  for (let redirects = 0; redirects <= 20; redirects++) {
    await tab.prepare(url.origin);
    let response = await tab.browser.api<WireResponse>('/fam/fetch-request', {userId:tab.userId, tabId:tab.id, url:url.href, method, headers, bodyBase64, timeoutMs:options.timeout * 1000}, options.timeout * 1000 + 5000);
    if (isChallenge(new Headers(response.headers), decodedBody(response))) {
      // Never automatically replay a potentially mutating request.
      if (!['GET','HEAD'].includes(method) || verified) {
        await tab.navigate(url.origin).catch(() => {});
        await tab.browser.notify(0);
        throw new BrowserError(`This request requires verification. Open ${tab.browser.endpoint.vncUrl} and retry; the operation was not replayed.`, 'BROWSER_INTERACTION_REQUIRED', tab.browser.endpoint.vncUrl);
      }
      verified = true;
      // Verification uses browser cookies. Navigation may redirect outside the
      // origin, so request-only header overrides must stay on the original call.
      await navigate(tab, {...options, headers:{}, selector:undefined, waitMs:0}, url.href);
      await tab.prepare(url.origin);
      response = await tab.browser.api<WireResponse>('/fam/fetch-request', {userId:tab.userId,tabId:tab.id,url:url.href,method,headers,bodyBase64,timeoutMs:options.timeout * 1000}, options.timeout * 1000 + 5000);
      if (isChallenge(new Headers(response.headers), decodedBody(response))) {
        await tab.navigate(url.href).catch(() => {});
        await tab.browser.notify(0);
        throw new BrowserError(`The website still requires verification at ${tab.browser.endpoint.vncUrl}.`, 'BROWSER_INTERACTION_REQUIRED', tab.browser.endpoint.vncUrl);
      }
    }
    const location = new Headers(response.headers).get('location');
    if (![301,302,303,307,308].includes(response.status) || !location || options.redirects === 'manual') return response;
    if (options.redirects === 'error') throw new BrowserError('The response redirected and --redirects error was selected.', 'BROWSER_REDIRECT');
    const next = httpUrl(new URL(location,url).href); next.hash = '';
    if (next.origin !== url.origin) headers = {};
    if (response.status === 303 && method !== 'HEAD' || [301,302].includes(response.status) && method === 'POST') {
      method = 'GET'; bodyBase64 = undefined; delete headers['content-type'];
    }
    url = next;
  }
  throw new BrowserError('Browser fetch exceeded 20 redirects.', 'BROWSER_REDIRECT_LIMIT');
}
export async function fetchBrowserUrl(options: BrowserFetchOptions): Promise<BrowserFetchResult> {
  const browser = await configuredBrowser();
  const capabilities = await browser.capabilities();
  if (!capabilities.fetch) throw new BrowserError('URL fetching needs an updated fam Camofox plugin. Update it and restart the browser once.', 'BROWSER_PLUGIN_REQUIRED', browser.endpoint.vncUrl);
  if (options.context === 'web-private' && !capabilities.privateFetch)
    throw new BrowserError('Private URL fetching needs an updated fam Camofox plugin and its private-window engine support. Update it and restart the browser once.', 'BROWSER_PLUGIN_REQUIRED', browser.endpoint.vncUrl);
  if (options.open !== undefined) browser.config.open = options.open;
  const tab = await browser.tab(options.context);
  let preserve = options.keepTab;
  try {
    if (options.open) await browser.openViewer();
    if (options.cookies.length) await browser.api('/fam/cookies', {userId:tab.userId,cookies:options.cookies,explicit:true});
    const response = options.mode === 'navigate' ? await navigate(tab, options) : await request(tab, options);
    const result = browserFetchResult(options,response);
    return {...result, ...(options.keepTab ? {tabId:tab.id,vncUrl:browser.endpoint.vncUrl} : {})};
  } catch (error) {
    if (error instanceof BrowserError && error.code === 'BROWSER_INTERACTION_REQUIRED') preserve = true;
    throw error;
  } finally {
    await browser.api('/fam/page-end', {userId:tab.userId,tabId:tab.id}).catch(() => {});
    if (!preserve) await browser.api('/fam/close-tab', {userId:tab.userId,tabId:tab.id});
  }
}
