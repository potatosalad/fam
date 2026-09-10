import type {Provider} from './command-registry.js';
import {browserConfig, loadProviderSession, saveProviderSession} from './browser-config.js';
import { inspectLoginCredentials, type Service } from './credentials.js';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from './storage.js';
import { DoctorIssue, object, failure, type CheckStatus, type DoctorCheck, type DoctorProvider, type SessionInfo } from './doctor-checks.js';

export const doctorProviders = {
  familysearch: () => import('../familysearch/doctor.js'),
  ancestry: () => import('../ancestry/doctor.js'),
  myheritage: () => import('../myheritage/doctor.js'),
  findmypast: () => import('../findmypast/doctor.js'),
  findagrave: () => import('../findagrave/doctor.js'),
  geneanet: () => import('../geneanet/doctor.js'),
  storied: () => import('../storied/doctor.js'),
  americanancestors: () => import('../americanancestors/doctor.js'),
  newspaperarchive: () => import('../newspaperarchive/doctor.js'),
};
export interface ProviderReport {
  provider: Provider;
  status: CheckStatus;
  session?: SessionInfo;
  checks: DoctorCheck[];
  limitations: string[];
  recovery?: {method: 'refresh' | 'login'; outcome: 'succeeded' | 'failed'; code?: string}[];
}
export interface DoctorReport {
  schemaVersion: 1;
  checkedAt: string;
  mode: 'local' | 'live';
  status: CheckStatus;
  providers: ProviderReport[];
}
export type DoctorEvent =
  | {type: 'progress'; provider: Provider; label: string}
  | {type: 'complete'; provider: Provider; report: ProviderReport};
export interface DoctorOptions {repair?: boolean}
type RepairAttempts = {refresh?: boolean; login?: boolean};
type Dependencies = {
  read: typeof readPrivateJson;
  write: typeof writePrivateJson;
  credentials: typeof inspectLoginCredentials;
  now: () => number;
  browser?: () => Promise<boolean>;
};
const dependencies: Dependencies = {
  read: name => /^(myheritage|findmypast|storied)\/session\.json$/.test(name) ? loadProviderSession(name.split('/')[0]) : readPrivateJson(name),
  write: (name, value) => /^(myheritage|findmypast|storied)\/session\.json$/.test(name) ? saveProviderSession(name.split('/')[0], value as {browserInstance?: string}) : writePrivateJson(name, value),
  credentials: inspectLoginCredentials, now: Date.now,
  browser: async () => !!await browserConfig(),
};
function status(checks: {status: CheckStatus}[]): CheckStatus {
  return checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
}

function sessionChecks(checks: DoctorCheck[], session?: SessionInfo): DoctorCheck[] {
  return checks.filter(check => !session || check.scope !== 'password-login');
}

/** Check access first, then try one renewal and one normal sign-in, verifying after each repair. */
export async function diagnoseProvider(provider: DoctorProvider, live = true, deps: Dependencies = dependencies,
  progress: (label: string) => void = () => {}, options: DoctorOptions = {}, attempts: RepairAttempts = {}): Promise<ProviderReport> {
  const checks: DoctorCheck[] = [];
  const recovery: NonNullable<ProviderReport['recovery']> = [];
  const repair = options.repair !== false;
  let session: unknown, info: SessionInfo | undefined;
  let credentialSource: Awaited<ReturnType<typeof inspectLoginCredentials>> | undefined;
  try {
    session = await deps.read(provider.sessionFile);
    if (session === undefined) checks.push({id: 'session', status: 'warning', code: 'session-missing', message: 'No saved session.', action: provider.recovery()});
    else {
      info = provider.inspect(session);
      const expired = info.expiresAt !== undefined && info.expiresAt <= deps.now();
      checks.push({id: 'session', status: expired ? 'warning' : 'ok', code: expired ? 'session-expired' : 'session-saved',
        message: expired ? `Saved access token expired at ${new Date(info.expiresAt!).toISOString()}.`
          : info.expiresAt ? `Saved access token expires at ${new Date(info.expiresAt).toISOString()}; local metadata only.`
          : 'Saved session has no known expiry; local metadata only.',
        ...(expired ? {action: provider.recovery(info)} : {})});
    }
  } catch {
    session = undefined; info = undefined;
    checks.push({id: 'session', status: 'error', code: 'session-invalid', message: 'The saved session is unreadable or malformed.',
      action: `Check ${provider.sessionFile} in the active profile and restore it or authenticate again. ${provider.recovery()}`});
  }
  try {
    const source = credentialSource = await deps.credentials(provider.service);
    checks.push({id: 'credentials', status: 'ok', code: `credentials-${source}`,
      message: source === 'none' ? 'No password configured; browser imports and existing sessions can still work.'
        : source === 'helper' ? 'Credential helper configured; execution and password validity are unverified.'
        : `Login details are available from ${source === 'file' ? 'the saved login file' : 'environment variables'}; password validity is unverified.`});
  } catch {
    checks.push({id: 'credentials', status: 'error', code: 'credentials-invalid', scope: 'password-login', message: 'The effective credential source is unreadable, incomplete, or malformed.',
      action: `Check ${provider.service.toUpperCase()}_USERNAME and ${provider.service.toUpperCase()}_PASSWORD, FAM_CREDENTIALS_COMMAND or config.json credentialsCommand, and the saved login file. Use fam ${provider.service}.credential set to replace saved login details.`});
  }
  for (const pending of provider.pending ?? []) {
    try {
      const value = await deps.read(pending.file);
      if (value !== undefined) {const check = pending.check(value, deps.now()); if (check) checks.push(check);}
    } catch {
      checks.push({id: 'auth-state', status: 'error', code: 'auth-state-invalid', scope: 'password-login', message: `Cannot inspect ${pending.file}.`, action: 'Check this authentication state file in the active profile, then complete a fresh sign-in.'});
    }
  }
  const probe = provider.probe;
  const finish = (): ProviderReport => ({provider: provider.service, status: status(sessionChecks(checks, info)), session: info,
    checks, limitations: provider.limitations, ...(recovery.length ? {recovery} : {})});
  if (!live) {
    checks.push({id: probe.id, status: 'skipped', code: 'live-not-requested', message: `${probe.label}: not checked online.`});
    return finish();
  }
  const save = async (next: unknown) => {
    const nextInfo = provider.inspect(next);
    try {await deps.write(provider.sessionFile, next);} catch {throw new DoctorIssue('session-save-failed');}
    session = next; info = nextInfo;
  };
  const verify = async () => {
    progress(`${provider.service}: ${probe.label}`);
    const result = await probe.run(session);
    if (result && repair) await save(result.session);
  };
  const repairable = (error: unknown, browserLogin = false) => {
    const code = failure(error, '').code;
    return ['session-rejected', 'refresh-rejected', 'access-denied', 'api-changed', 'check-failed'].includes(code)
      || browserLogin && ['request-challenged', 'verification-required'].includes(code);
  };
  const attempt = async (method: 'refresh' | 'login', run: () => Promise<void>) => {
    attempts[method] = true;
    const entry: NonNullable<ProviderReport['recovery']>[number] = {method, outcome: 'failed'};
    recovery.push(entry);
    try {await run(); await verify(); entry.outcome = 'succeeded';}
    catch (error) {entry.code = failure(error, '').code; throw error;}
  };
  let verified = false, problem: unknown;
  if (info && session !== undefined) {
    try {await verify(); verified = true;} catch (error) {problem = error;}
    if (!verified && repair && !attempts.refresh && info.refreshAvailable && provider.refresh && repairable(problem)) {
      try {
        await attempt('refresh', async () => {
          progress(`${provider.service}: refreshing session`);
          let next: unknown;
          try {next = await provider.refresh!(session);}
          catch (error) {
            if ([400, 401, 403].includes(object(error).status)) throw new DoctorIssue('refresh-rejected');
            throw error;
          }
          // Save rotated tokens before verification, even if that request fails.
          await save(next);
          checks.push({id: 'refresh', status: 'ok', code: 'session-refreshed', message: 'Renewed session saved.'});
        });
        verified = true;
      } catch (error) {problem = error;}
    }
  }
  if (!verified && repair && provider.login && (session === undefined || repairable(problem, provider.login.kind === 'browser'))) {
    const login = provider.login;
    const blocked = login.kind === 'credentials' && checks.find(check => check.scope === 'password-login'
      && ['login-blocked', 'verification-pending', 'verification-required', 'authorization-pending', 'auth-state-invalid'].includes(check.code));
    let unavailable: DoctorCheck | undefined;
    if (attempts.login) unavailable = {id: 'login', status: 'skipped', code: 'login-already-attempted',
      message: 'Sign-in was already attempted for this shared session.', action: provider.recovery(info)};
    else if (blocked) unavailable = {...blocked, id: 'login', scope: undefined};
    else if (login.kind === 'credentials' && (!credentialSource || credentialSource === 'none')) unavailable = {
      id: 'login', status: 'skipped', code: 'login-not-configured', message: 'Automatic sign-in needs configured login credentials.',
      action: `Configure login credentials with fam ${provider.service}.credential set, then retry fam doctor.`};
    else if (login.kind === 'browser') {
      let configured = false;
      try {configured = !!await deps.browser?.();} catch { /* Show setup instructions without exposing configuration. */ }
      if (!configured) unavailable = {id: 'login', status: 'skipped', code: 'browser-not-configured',
        message: 'Automatic browser sign-in needs a configured browser.', action: 'Run fam browser setup, then retry fam doctor.'};
      else if (session === undefined && (!credentialSource || credentialSource === 'none')) unavailable = {
        id: 'login', status: 'skipped', code: 'login-not-configured', message: 'No saved session or configured credentials for automatic sign-in.', action: provider.recovery()};
    }
    if (unavailable) checks.push(unavailable);
    else try {
      await attempt('login', async () => {
        progress(`${provider.service}: signing in again${login.kind === 'browser' ? ' through the browser' : ''}`);
        let next: unknown;
        try {next = await login.run(session);}
        catch (error) {
          const code = failure(error, '').code;
          if (['check-failed', 'api-changed', 'session-rejected', 'access-denied'].includes(code)) throw new DoctorIssue('login-failed');
          throw error;
        }
        // The regular login flow has already saved and validated this state.
        info = provider.inspect(next); session = next;
        checks.push({id: 'login', status: 'ok', code: 'session-login', message: 'Signed in and saved a new session.'});
      });
      verified = true;
    } catch (error) {problem = error;}
  }
  if (verified) {
    checks[0] = {id: 'session', status: 'ok', code: 'session-verified', message: 'Saved session accepted by the provider.'};
    checks.push({id: probe.id, status: 'ok', code: 'probe-passed', message: `${probe.label}: read succeeded.`});
  } else if (problem !== undefined) {
    const result = failure(problem, probe.recovery ?? provider.recovery(info));
    const skippedLogin = checks.find(check => check.id === 'login' && check.status !== 'ok');
    checks.push({id: probe.id, ...result, ...(skippedLogin?.action ? {action: skippedLogin.action} : {}),
      message: `${probe.label}: ${result.message}`});
  } else {
    checks.push({id: probe.id, status: 'skipped', code: 'live-blocked', message: `${probe.label}: skipped because local state needs attention.`});
  }
  return finish();
}

export async function runDoctor(services: Provider[], live = true, progress?: (label: string) => void,
  onEvent?: (event: DoctorEvent) => void, options: DoctorOptions = {}): Promise<DoctorReport> {
  // Integrations sharing a session must finish renewal and persistence before
  // another check reads it. Independent providers can complete in any order.
  const sessions = new Map<string, Promise<ProviderReport>>();
  const repairs = new Map<string, RepairAttempts>();
  const providers = await Promise.all(services.map(async service => {
    const update = (label: string) => {
      progress?.(`${service}: ${label}`);
      onEvent?.({type: 'progress', provider: service, label});
    };
    let report: ProviderReport;
    try {
      if (service === 'cyndislist' || service === 'wayback') {
        update(live ? 'Checking public access' : 'Inspecting local configuration');
        report = await (service === 'cyndislist' ? await import('../cyndislist/doctor.js') : await import('../wayback/doctor.js')).diagnose(live);
      } else {
        const {doctorProvider} = await doctorProviders[service]();
        const attempts = repairs.get(doctorProvider.sessionFile) ?? {};
        repairs.set(doctorProvider.sessionFile, attempts);
        const previous = sessions.get(doctorProvider.sessionFile);
        const pending = (async () => {
          if (previous) {update('Waiting for shared session'); await previous.catch(() => {});}
          update('Inspecting saved session');
          return diagnoseProvider(doctorProvider, live, dependencies,
            label => update(label.replace(`${service}: `, '')), options, attempts);
        })();
        sessions.set(doctorProvider.sessionFile, pending);
        report = await pending;
      }
    } catch {
      report = {provider: service, status: 'error', checks: [{id: 'provider', status: 'error', code: 'provider-unavailable',
        message: 'The provider integration could not be loaded.', action: 'Reinstall fam and its dependencies, then retry.'}], limitations: ['No capabilities were verified.']};
    }
    onEvent?.({type: 'complete', provider: service, report});
    return report;
  }));
  return {schemaVersion: 1, checkedAt: new Date().toISOString(), mode: live ? 'live' : 'local', status: status(providers), providers};
}

function primaryIssue(provider: ProviderReport): DoctorCheck | undefined {
  const issues = sessionChecks(provider.checks, provider.session).filter(c => c.status === 'warning' || c.status === 'error');
  return issues.find(c => c.code === 'login-blocked') ?? issues.find(c => c.status === 'error') ?? issues[0];
}

export function doctorSummary(provider: ProviderReport): {label: string; detail: string; action?: string} {
  const details: Record<string, [string, string]> = {
    'session-missing': ['SETUP', 'No saved session'],
    'session-invalid': ['ERROR', 'Session file is unreadable or invalid'],
    'session-expired': ['EXPIRED', 'Saved access token has expired'],
    'credentials-invalid': ['ERROR', 'Credential configuration needs attention'],
    'verification-pending': ['WAIT', 'Sign-in verification pending'],
    'verification-required': ['WAIT', 'Website verification required'],
    'authorization-pending': ['WAIT', 'Browser sign-in pending'],
    'auth-state-invalid': ['ERROR', 'Authentication state is unreadable'],
    'session-rejected': ['INVALID', 'Session rejected'],
    'refresh-rejected': ['SIGN IN', 'Session could not be renewed'],
    'session-save-failed': ['ERROR', 'Updated session could not be saved'],
    'request-challenged': ['WAIT', 'Request challenged; session unverified'],
    'access-denied': ['DENIED', provider.recovery?.length ? 'Access denied after session recovery' : 'Provider denied the account check'],
    'rate-limited': ['WAIT', 'Provider rate limit'],
    'service-unavailable': ['ERROR', 'Provider unavailable'],
    network: ['ERROR', 'Connection failed'],
    'api-changed': ['ERROR', provider.recovery?.length ? 'Unexpected account response after recovery' : 'Unexpected account response'],
    'check-failed': ['ERROR', 'Session check failed'],
    'provider-unavailable': ['ERROR', 'Integration could not load'],
    'login-failed': ['SIGN IN', 'Automatic sign-in did not complete'],
    'browser-unavailable': ['BROWSER', 'Sign-in browser is unavailable'],
  };
  const issue = primaryIssue(provider);
  const passed = provider.checks.some(c => c.code === 'probe-passed');
  const browser = provider.session?.mode === 'browser';
  const [label, detail] = issue?.code === 'login-blocked' ? ['BLOCKED', issue.message.replace(/^Password sign-in is blocked /, '').replace(/\.$/, '')]
    : issue ? details[issue.code] ?? [issue.status === 'warning' ? 'WARN' : 'ERROR', issue.message]
    : provider.provider === 'cyndislist' ? [passed ? 'OK' : 'PUBLIC', passed ? 'Directory access verified' : 'No account required; not checked online']
    : provider.provider === 'wayback' ? [passed ? 'OK' : 'PUBLIC', passed ? 'Archive index verified' : 'No account required; not checked online']
    : passed ? ['OK', provider.checks.some(c => c.code === 'session-login') ? 'Signed in again and verified'
      : provider.checks.some(c => c.code === 'session-refreshed') ? 'Session refreshed and verified' : browser ? 'Browser session verified' : 'Session verified']
    : ['SAVED', browser ? 'Browser session; not checked online' : 'Not checked online'];
  return {label, detail, action: issue?.action?.split(/(?<=\.)\s+/)[0]};
}

export function formatDoctor(report: DoctorReport, verbose = false): string {
  if (!verbose) {
    const lines: string[] = [], actions: string[] = [];
    const width = Math.max(13, ...report.providers.map(provider => provider.provider.length));
    for (const provider of report.providers) {
      const {label, detail, action} = doctorSummary(provider);
      lines.push(`${provider.provider.padEnd(width)} ${label.padEnd(7)} ${detail}`);
      if (action) actions.push(`${provider.provider}: ${action}`);
    }
    if (actions.length) lines.push('', ...actions);
    lines.push('', report.mode === 'local' ? 'Offline: sessions are unverified. Run fam cli.health check to check online.'
      : 'Provider access checks only; other capabilities untested. Use --verbose for details.');
    return lines.join('\n');
  }
  const lines = [`fam cli.health check — ${report.mode} checks`, `Profile: ${CREDENTIAL_DIR}`];
  if (report.mode === 'local') lines.push('Online functionality is unverified. Run fam cli.health check to check online.');
  else lines.push('Provider access checks; failed sessions can be refreshed or signed in again. Use --no-fix to check without changing sessions.');
  for (const provider of report.providers) {
    lines.push('', `${provider.provider}: ${provider.status.toUpperCase()}${provider.session ? ` (${provider.session.mode})` : ''}`);
    for (const attempt of provider.recovery ?? []) lines.push(`  Recovery: ${attempt.method} ${attempt.outcome}${attempt.code ? ` (${attempt.code})` : ''}.`);
    for (const check of provider.checks) {
      const scope = check.scope === 'password-login' ? ' [password login only]' : '';
      lines.push(`  ${check.status.toUpperCase().padEnd(7)} ${check.id}${scope}: ${check.message}`);
      if (check.action) lines.push(`          Next: ${check.action}`);
    }
    for (const limitation of provider.limitations) lines.push(`  Coverage: ${limitation}`);
  }
  const counts = report.providers.flatMap(p => sessionChecks(p.checks, p.session));
  lines.push('', `${counts.filter(c => c.status === 'error').length} errors, ${counts.filter(c => c.status === 'warning').length} warnings, ${counts.filter(c => c.status === 'skipped').length} skipped checks.`);
  if (report.providers.some(p => p.session && p.checks.some(c => c.scope === 'password-login'))) lines.push('Password-login restrictions are shown separately and do not change saved-session status.');
  return lines.join('\n');
}
