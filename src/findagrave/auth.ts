import { loadLoginCredentials, type Credentials } from '../shared/credentials.js';
import { writePrivateJson } from '../shared/storage.js';
import { FindagraveHttp, GRAPHQL } from './http.js';
import { contracts } from './generated/contracts.js';
import type { CookieJar } from 'tough-cookie';

export type FindagraveCredentials = Credentials;
export interface FindagraveSession { contributorId: string; token: string; savedAt: string; validatedAt: string; cookies?: ReturnType<CookieJar['serializeSync']>; }
export const loadFindagraveCredentials = (): Promise<FindagraveCredentials> => loadLoginCredentials('findagrave');
export const saveSession = (session: FindagraveSession) => writePrivateJson('findagrave/session.json', session);
export function sessionStatus(session?: FindagraveSession) {
  return {sessionSaved: Boolean(session?.token && session.contributorId), mode: 'native', savedAt: session?.savedAt ?? null,
    validatedAt: session?.validatedAt ?? null, expiresAt: null, refreshAvailable: false};
}
type Http = Pick<FindagraveHttp, 'exchange'> & Partial<Pick<FindagraveHttp, 'jar'>>;
export async function authenticateFindagrave(http: Http = new FindagraveHttp(), credentials?: FindagraveCredentials,
  save: (session: FindagraveSession) => Promise<void> = saveSession): Promise<FindagraveSession> {
  const login = credentials ?? await loadFindagraveCredentials();
  const op = contracts.graphql.find(o => o.id === 'graphql.Authenticate.41cc792c')!;
  const {data} = await http.exchange<{data?: {authenticate?: {result?: unknown; token?: string; contributor?: {id?: string}; reactivation?: unknown}}; errors?: unknown[]}>(GRAPHQL,
    {method: 'POST', headers: op.headers, body: {operationName: op.name, query: op.document,
      variables: {credentials: {email: login.username, password: login.password, remember: true, isMobile: true}}}});
  const auth = data.data?.authenticate;
  if (data.errors?.length || !auth?.token || !auth.contributor?.id) throw new Error('Find a Grave sign-in was not successful. Check credentials or complete any required account verification on the website. Login was not retried.');
  const token = auth.token, contributorId = String(auth.contributor.id);
  const check = contracts.graphql.find(o => o.name === 'SignedInContributor')!;
  const profile = await http.exchange<{data?: {signedInContributor?: {id?: string}}; errors?: unknown[]}>(GRAPHQL,
    {method: 'POST', headers: {...check.headers, fgm: contributorId, fgmSeed: token}, body: {operationName: check.name, query: check.document, variables: {}}});
  if (profile.data.errors?.length || String(profile.data.data?.signedInContributor?.id) !== contributorId) throw new Error('Find a Grave login returned a token but account validation failed; session was not saved.');
  const now = new Date().toISOString();
  const session: FindagraveSession = {token, contributorId, savedAt: now, validatedAt: now, cookies: http.jar?.serializeSync()};
  await save(session); return session;
}
