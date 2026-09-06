import {WEB, type MyHeritageHttp} from './http.js';
import type {Query} from '../transport-types.js';
import type {MyHeritageSession} from './auth.js';
import {individualWithHints} from './web-queries.js';

export interface TreePage {
  accountId: string; siteId: string; treeId: string; rootId: string; homeId: string;
  title: string; size: number; csrf: string; token: string; lang: string; dataLang: string;
  clientVersion: number; revision: number; proximity: number; maxPeople: number;
  trees: {id: string | number; name: string; count: number; url: string}[];
}
/** Parse JSON literals in known page assignments. Never execute website JavaScript. */
export function pageValue(html: string, name: string): unknown {
  if (!/^\w+$/.test(name)) throw new Error('Invalid page variable.');
  const match = new RegExp(`\\bvar\\s+${name}\\s*=\\s*`).exec(html);
  if (!match) return undefined;
  const text = html.slice(match.index + match[0].length);
  let quoted = false, escaped = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false;}
    else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) {try {return JSON.parse(text.slice(0, i));} catch {return undefined;}}
  }
  return undefined;
}
export function parseTreePage(html: string): TreePage {
  const get = (key: string) => pageValue(html, key);
  if (get('isLoggedIn') !== true || typeof get('currentUserAccountID') !== 'string') {
    throw new Error('MyHeritage browser session expired or this is not a signed-in tree page. Import a fresh HAR with myheritage auth --har FILE.');
  }
  const media = get('mediaUploaderData') as {fgToken?: string} | undefined;
  const trees = get('treeSelectionMenuEntries');
  if (typeof get('siteID') !== 'string' || !media?.fgToken || typeof get('mhXsrfToken') !== 'string' || !Array.isArray(trees)) {
    throw new Error('MyHeritage tree page format changed; session was not replaced.');
  }
  return {accountId: String(get('currentUserAccountID')), siteId: String(get('siteID')), treeId: String(get('familyTreeID')),
    rootId: String(get('rootIndividualID')), homeId: String(get('homeIndividualID')), title: String(get('familyTreeTitle')),
    size: Number(get('familyTreeSize')), csrf: String(get('mhXsrfToken')), token: media.fgToken,
    lang: String(get('displayLang') ?? 'EN'), dataLang: String(get('dataLang') ?? 'EN'),
    clientVersion: Number(get('clientVersion')), revision: Number(get('familyTreeRevision')),
    proximity: Number(get('maxProximityLevel')), maxPeople: Number(get('maxIndividualsAfterPrune')), trees};
}
export function checkTreePageUrl(value: string): URL {
  const url = new URL(value, WEB);
  if (url.origin !== WEB || url.username || url.password || !(/^\/family-trees\//.test(url.pathname) || url.pathname === '/FP/family-tree.php')) {
    throw new Error('Expected a MyHeritage family-tree page URL.');
  }
  return url;
}
type JsonObject = Record<string, any>;
export class MyHeritageBrowser {
  private page?: Promise<TreePage>;
  constructor(private readonly session: MyHeritageSession, private readonly http: Pick<MyHeritageHttp, 'exchange' | 'jar'>,
    private readonly persist: () => Promise<void>) {}
  private headers(): Record<string, string> {return this.session.browser?.userAgent ? {'User-Agent': this.session.browser.userAgent} : {};}
  async context(): Promise<TreePage> {
    this.page ??= this.loadPage().catch(error => {this.page = undefined; throw error;});
    return this.page;
  }
  private async loadPage() {
    if (!this.session.browser?.pageUrl) throw new Error('Browser session has no tree page. Import a fresh HAR.');
    const url = checkTreePageUrl(this.session.browser.pageUrl);
    const response = await this.http.exchange<string>(url, {headers: this.headers(), response: 'text'});
    const page = parseTreePage(response.data);
    this.session.accessToken = page.token; this.session.userId = `user-${page.accountId}`;
    await this.persist();
    return page;
  }
  async refresh() {this.page = undefined; return this.context();}
  private async api(path: string, query: Query = {}): Promise<JsonObject> {
    const page = await this.context();
    const response = await this.http.exchange<JsonObject>(`${WEB}/FP/API/${path}`, {
      headers: this.headers(), query: {s: page.siteId, lang: page.lang, csrf_token: page.csrf, ...query},
    });
    const data = response.data;
    if (!data || typeof data !== 'object' || data.success === false || data.status === 'error' || data.error || data.errorCode) {
      throw new Error(`MyHeritage website API ${path} did not return a successful result.`);
    }
    await this.persist();
    return data;
  }
  private async localId(id: string, kind: 'tree' | 'individual') {
    const page = await this.context();
    const prefix = `${kind}-${page.siteId}-`;
    const local = id.startsWith(prefix) ? id.slice(prefix.length) : id;
    if (!/^\d+$/.test(local)) throw new Error(`Browser ${kind} ID must be a numeric ID or an ID from the current site.`);
    return local;
  }
  async me() {
    const p = await this.context();
    const permissions = await this.api('FamilyTree/get-current-user-permissions.php', {familyTreeId: p.treeId});
    return {id: `user-${p.accountId}`, default_site: {id: `site-${p.siteId}`, name: p.title, default_tree: {id: `tree-${p.siteId}-${p.treeId}`}},
      default_individual: {id: `individual-${p.siteId}-${Number(permissions.associatedIndividualId) > 0 ? permissions.associatedIndividualId : Number(p.homeId) > 0 ? p.homeId : p.rootId}`}, permissions};
  }
  async sites() {
    const p = await this.context();
    return {scope: 'current-site', data: [{id: `site-${p.siteId}`, tree_name: p.title, trees: await this.trees(`site-${p.siteId}`)}]};
  }
  async trees(siteId: string) {
    const p = await this.context();
    if (siteId !== p.siteId && siteId !== `site-${p.siteId}`) throw new Error('Browser session is scoped to its captured site; import a HAR from the other site to switch.');
    return {data: p.trees.map(t => ({id: `tree-${p.siteId}-${t.id}`, name: t.name, individual_count: t.count}))};
  }
  async tree(treeId: string) {
    const p = await this.context(), local = await this.localId(treeId, 'tree');
    const tree = p.trees.find(t => String(t.id) === local);
    if (!tree) throw new Error('Tree was not listed on the authenticated site.');
    return {id: `tree-${p.siteId}-${local}`, name: tree.name, individual_count: tree.count, site: {id: `site-${p.siteId}`},
      ...(local === p.treeId ? {root_individual: {id: `individual-${p.siteId}-${p.rootId}`}} : {})};
  }
  async people(treeId: string, offset: number, limit: number) {
    const p = await this.context(), local = await this.localId(treeId, 'tree');
    if (local !== p.treeId) throw new Error('Open this tree in the browser and import its HAR before listing its neighborhood. Use find to search other trees in the site.');
    const result = await this.api('FamilyTree/get-tree-layout.php', {clientVersion: p.clientVersion, familyTreeID: local,
      familyTreeRev: p.revision, smartMatchesRev: 0, recordMatchesRev: 0, clientDate: new Date().toISOString().slice(0, 10),
      rootID: p.rootId, dataLang: p.dataLang, treeStyle: 0, memberID: p.accountId, addMeCards: 0, classic: 0,
      maxProximityLevel: p.proximity, maxIndividualsAfterPrune: p.maxPeople, shouldFetchCousins: 1, shouldFetchDnaInfo: 0,
      shouldFetchSMInfo: 0, shouldFetchRMInfo: 0, isFlatLook: 1, isFaceLift: 1, pap: 0});
    const data = result.data ?? result;
    if (!Array.isArray(data.personCards)) throw new Error('Tree layout contained no person cards.');
    const unique = [...new Map<string, JsonObject>(data.personCards.filter((c: JsonObject) => /^\d+$/.test(String(c.id))).map((c: JsonObject) => [String(c.id), c])).values()];
    return {scope: 'tree-neighborhood', total_tree_people: data.familyTreeSize, available_people: unique.length, offset, limit,
      data: unique.slice(offset, offset + limit).map(c => ({id: `individual-${p.siteId}-${c.id}`, name: c.n, first_name: c.fn, last_name: c.ln,
        gender: c.g, birth: c.b, birth_year: c.by, death: c.d, death_year: c.dy})),
      note: 'Website layout can prune distant people. Use find to search the tree by name.'};
  }
  async find(treeId: string, query: string, limit = 20) {
    const p = await this.context(), local = await this.localId(treeId, 'tree');
    await this.tree(treeId);
    return this.api('individual-lookup.php', {siteID: p.siteId, familyTreeID: local, query, thumbnailType: 2,
      displayLang: p.lang, dataLang: p.dataLang, formatAsJSON: 1, maxResults: limit, rpl: 1});
  }
  async person(id: string) {
    const p = await this.context(), local = await this.localId(id, 'individual');
    return this.api('FamilyTree/get-extended-card-content.php', {individualID: local, dataLang: p.dataLang,
      clientDate: new Date().toISOString().slice(0, 10), facts: 1, photos: 1, relatives: 1, allEventsForIndividual: 1,
      dna: 0, matches: 1, sites: 1, discoveries: 0});
  }
  async insights(id: string) {
    const p = await this.context(), local = await this.localId(id, 'individual');
    const cookie = this.http.jar.getCookiesSync(WEB).find(c => c.key === 'PHPSESSID')?.value;
    if (!cookie) throw new Error('Browser session has no PHP session cookie. Import a fresh HAR.');
    const form = new URLSearchParams({bearer_token: p.token, query: JSON.stringify(individualWithHints), operation: '',
      variables: JSON.stringify({individualId: `individual-${p.siteId}-${local}`, lang: p.lang, showHintsSetting: 0, relationshipPrefix: ''}),
      description: 'individual data with hints query', 'mhc#PHPSESSID': cookie});
    const result = (await this.http.exchange<JsonObject>(`${WEB}/web-family-graphql/individual_data_with_hints_query/`, {
      method: 'POST', headers: {...this.headers(), Origin: WEB, 'Content-Type': 'application/x-www-form-urlencoded'}, encoding: 'raw', body: form.toString(),
    })).data;
    if (result.errors?.length || !result.data?.individual) throw new Error('MyHeritage website person query returned no individual.');
    await this.persist(); return result.data;
  }
  async matches(id: string) {
    const p = await this.context(), local = await this.localId(id, 'individual');
    const counts = await this.api('FamilyTree/get-adhoc-matches.php', {familyTreeID: p.treeId, individualIDs: local, SM: 1, RM: 1, dataLang: p.dataLang});
    return {scope: 'match-counts', ...counts};
  }
}
