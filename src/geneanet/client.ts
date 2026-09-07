import { GeneanetHttp, GeneanetError, WEB, TREE } from './http.js';
import { loadSession, readAccount, saveSession, type GeneanetSession } from './auth.js';
import { integer, searchUrl, type SearchKind, type SearchInput } from './catalog.js';
import { parseSearch, parsePage, parseCollections, researchUrl } from './parse.js';

export const id = (value: string) => { if (!/^\d+$/.test(value)) throw new Error('Geneanet IDs must be decimal strings.'); return value; };
export const treeName = (value: string) => { if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error('Invalid Geneanet tree name.'); return value; };
export interface MediaView { id: string | number; page: number; files?: Record<string,string> }
export interface MediaDeposit { id: string | number; username?: string; title?: string; slug?: string; type?: string; private?: boolean; views: MediaView[]; [key: string]: unknown }
export class GeneanetClient {
  constructor(readonly http: GeneanetHttp, readonly session?: GeneanetSession,
    private readonly persist: (session: GeneanetSession) => Promise<void> = saveSession) {}
  static async open(anonymous = false) {
    if (anonymous) return new GeneanetClient(new GeneanetHttp());
    const session = await loadSession();
    if (session?.version !== 1 || !session.username || !session.cookies?.cookies?.length) throw new Error('No usable Geneanet session. Run fam geneanet.session login, or use --anonymous for public reads.');
    return new GeneanetClient(new GeneanetHttp(session.cookies), session);
  }
  private async saved() {
    if (this.session) await this.persist({...this.session, cookies: this.http.jar.serializeSync()});
  }
  async me() {
    if (!this.session) throw new Error('A saved Geneanet session is required for account verification.');
    const account = await readAccount(this.http, this.session.username);
    this.session.validatedAt = new Date().toISOString(); await this.saved(); return account;
  }
  async search(input: SearchInput, kind: SearchKind = 'search') {
    const page = await this.http.text(searchUrl(kind, input));
    const result = parseSearch(page.text, page.url); await this.saved(); return result;
  }
  async record(value: string) {
    const page = await this.http.text(researchUrl(value));
    researchUrl(page.url);
    const result = parsePage(page.text, page.url); await this.saved(); return result;
  }
  async person(tree: string, input: {firstName?: string; lastName?: string; occurrence?: string; index?: string}) {
    const url = new URL(`/${treeName(tree)}`, TREE); url.searchParams.set('lang', 'en');
    if (input.index) url.searchParams.set('i', id(input.index));
    else {
      if (!input.firstName || !input.lastName) throw new Error('A person lookup requires an index or both first and last name.');
      url.searchParams.set('p', input.firstName); url.searchParams.set('n', input.lastName);
      if (input.occurrence !== undefined) url.searchParams.set('oc', String(integer(input.occurrence, 0, 0)));
    }
    return this.record(url.href);
  }
  async collections(zone = 'all') {
    if (!['all','north_america','australia','benelux','central_eastern_europe','france','german','britain_island','scandinavia','south_europe'].includes(zone)) throw new Error('Unknown Geneanet catalog zone.');
    const page = await this.http.text(`${WEB}/collections/catalog/?zone=${zone}`);
    const result = parseCollections(page.text, page.url); await this.saved(); return result;
  }
  async treeMedia(tree: string, index: string) {
    const data = await this.http.json<unknown[]>(`${TREE}/api/${treeName(tree)}/media/${id(index)}`);
    if (!Array.isArray(data)) throw new GeneanetError('api-changed'); await this.saved(); return data;
  }
  async media(deposit: string) {
    const data = await this.http.json<MediaDeposit>(`${WEB}/media/api/deposits/${id(deposit)}`);
    if (String(data.id) !== deposit || !Array.isArray(data.views)) throw new GeneanetError('api-changed'); await this.saved(); return data;
  }
  async mediaReferences(deposit: string, view: string) {
    const media = await this.media(deposit);
    if (!media.views.some(v => String(v.id) === id(view))) throw new Error('This view does not belong to the Geneanet media deposit.');
    const data = await this.http.json<unknown[]>(`${WEB}/media/api/deposits/${deposit}/views/${view}/references`);
    if (!Array.isArray(data)) throw new GeneanetError('api-changed'); await this.saved(); return data;
  }
  async images(register: string, from = 1, to = from) {
    integer(from, 1, 1, 100000); integer(to, from, 1, 100000);
    if (to < from || to - from >= 100) throw new Error('Request an inclusive range of at most 100 register pages.');
    const data = await this.http.json<unknown[]>(`${WEB}/registres/api/images/${id(register)}?min_page=${from}&max_page=${to}`);
    if (!Array.isArray(data)) throw new GeneanetError('api-changed'); await this.saved(); return data;
  }
}
