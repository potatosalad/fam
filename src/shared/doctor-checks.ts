import { CookieJar } from 'tough-cookie';
import type { Service } from './credentials.js';
import type { ApiRequest, ApiResponse } from '../familysearch/transport-types.js';

export type CheckStatus = 'ok' | 'warning' | 'error' | 'skipped';
export interface DoctorCheck {
  id: string; status: CheckStatus; code: string; message: string; action?: string;
  /** A restriction on creating a new password session, not on reading with a saved session. */
  scope?: 'password-login';
}
export interface SessionInfo { mode: 'native' | 'browser'; expiresAt?: number; refreshAvailable: boolean }
export interface DoctorProbe {
  id: string;
  label: string;
  recovery?: string;
  /** A successful browser read may return renewed session state to persist. */
  run(session: unknown): Promise<void | {session: unknown}>;
}
export interface DoctorProvider {
  service: Service;
  sessionFile: string;
  inspect(session: unknown): SessionInfo;
  recovery(info?: SessionInfo): string;
  /** Token renewal only; return state without writing or starting a password login. */
  refresh?(session: unknown): Promise<unknown>;
  /** The normal session-login flow; it validates and persists the new session. */
  login?: {kind: 'credentials' | 'browser'; run(session?: unknown): Promise<unknown>};
  pending?: { file: string; check(value: unknown, now: number): DoctorCheck | undefined }[];
  probe: DoctorProbe;
  limitations: string[];
}
export type IssueCode = 'session-rejected' | 'refresh-rejected' | 'session-save-failed' | 'request-challenged' | 'access-denied' | 'verification-required' | 'rate-limited' | 'service-unavailable' | 'network' | 'api-changed' | 'check-failed' | 'no-data' | 'login-failed' | 'login-blocked' | 'browser-unavailable';
export class DoctorIssue extends Error {
  constructor(readonly code: IssueCode) { super(code); }
}
export function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
export function nonempty(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && !/[\r\n\0]/.test(value); }
export function requireSession(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid saved session.'); }
export function requireResponse(condition: unknown): asserts condition { if (!condition) throw new DoctorIssue('api-changed'); }
export function cookies(value: unknown, required = false) {
  if (value === undefined && !required) return;
  requireSession(Array.isArray(object(value).cookies));
  CookieJar.deserializeSync(value as Parameters<typeof CookieJar.deserializeSync>[0]);
}
export function expiry(value: unknown): number | undefined {
  if (value === undefined || value === 0) return undefined;
  requireSession(typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime()));
  return value;
}

/** Inspect only structured codes; never copy remote messages, URLs, headers, or account data. */
export function graphData(value: unknown): Record<string, any> {
  const result = object(value);
  if (Array.isArray(result.errors) && result.errors.length) {
    const codes = result.errors.map((e: unknown) => object(object(e).extensions).code);
    if (codes.includes('UNAUTHENTICATED')) throw new DoctorIssue('session-rejected');
    if (codes.includes('FORBIDDEN')) throw new DoctorIssue('access-denied');
    throw new DoctorIssue('api-changed');
  }
  requireResponse(result.data !== null && typeof result.data === 'object' && !Array.isArray(result.data));
  return result.data;
}
export type DoctorHttp = { exchange<T = unknown>(url: string | URL, options?: ApiRequest): Promise<ApiResponse<T>> };
export async function graphql(http: DoctorHttp, url: string, op: {name: string; document: string}, variables: Record<string, unknown>, headers: Record<string, string> = {}) {
  return graphData((await http.exchange(url, {method: 'POST', headers, body: {operationName: op.name, query: op.document, variables}})).data);
}

export function failure(error: unknown, recovery: string): Pick<DoctorCheck, 'status' | 'code' | 'message' | 'action'> {
  const e = object(error), message = error instanceof Error ? error.message : '';
  const code: IssueCode = error instanceof DoctorIssue ? error.code
    : e.name === 'MyHeritageChallengeError' ? 'request-challenged'
    : e.code === 'BROWSER_INTERACTION_REQUIRED' ? 'verification-required'
    : e.code === 'BROWSER_LOGIN_BLOCKED' ? 'login-blocked'
    : ['BROWSER_UNAVAILABLE', 'BROWSER_PLUGIN_REQUIRED', 'BROWSER_API_FAILED'].includes(e.code) ? 'browser-unavailable'
    : ['GeneanetError', 'NewspaperArchiveError', 'NewspapersError', 'AmericanAncestorsError'].includes(e.name) && ['session-rejected', 'verification-required', 'api-changed'].includes(e.code) ? e.code
    : e.status === 401 ? 'session-rejected'
    : e.status === 403 || e.status === 451 ? 'access-denied'
    : e.status === 406 || e.name === 'MyHeritageResearchVerificationError' ? 'verification-required'
    : e.status === 429 ? 'rate-limited'
    : typeof e.status === 'number' && e.status >= 500 ? 'service-unavailable'
    : /network request failed|fetch failed|timed? ?out/i.test(message) ? 'network'
    : /^(MyHeritage browser session expired|Record research needs a signed-in website session|Missing website session cookie)/.test(message) ? 'session-rejected'
    : /Expected JSON|format changed|no .*connection|GraphQL errors/.test(message) ? 'api-changed'
    : 'check-failed';
  const descriptions: Record<IssueCode, [string, string]> = {
    'session-rejected': ['The saved session was rejected or no signed-in account was returned.', recovery],
    'refresh-rejected': ['Session renewal was rejected; sign-in is required.', recovery],
    'session-save-failed': ['The updated session could not be saved.', 'Check write permissions and available space in the active fam profile, then retry.'],
    'request-challenged': ['The provider requires a website security check.', `Complete the security check in the browser. ${recovery}`],
    'access-denied': ['The provider denied the account access check.', recovery],
    'verification-required': ['The provider requires website verification.', `Complete verification on the provider website. ${recovery}`],
    'rate-limited': ['The provider is rate limiting requests.', 'Wait for the provider cooldown before rerunning doctor; avoid repeated sign-in attempts.'],
    'service-unavailable': ['The provider returned a server error.', 'Retry later and check the provider website if the problem continues.'],
    network: ['The request failed to connect or timed out.', 'Check your connection, DNS, and proxy settings, then retry.'],
    'api-changed': ['The response did not match the expected API format.', 'Update fam and retry. If this persists, report the provider and check ID; the integration may need updating.'],
    'check-failed': ['The account access check could not complete.', recovery],
    'login-failed': ['Automatic sign-in did not complete.', `Check the configured credentials and complete any required account verification. ${recovery}`],
    'login-blocked': ['The provider has temporarily paused automatic sign-in.', 'Wait for the login cooldown, or complete sign-in manually in the configured browser. Run fam browser open to view it.'],
    'browser-unavailable': ['Automatic sign-in could not reach the configured browser.', 'Run fam browser status and restore browser access, then retry fam doctor.'],
    'no-data': ['This account has no suitable data for this check.', 'Retry with an account that has a linked tree person.'],
  };
  return {status: code === 'no-data' ? 'skipped' : 'error', code, message: descriptions[code][0], action: descriptions[code][1]};
}
