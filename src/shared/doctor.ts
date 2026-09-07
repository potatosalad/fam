import { parseArgs } from 'node:util';
import { inspectLoginCredentials, type Service } from './credentials.js';
import { CREDENTIAL_DIR, readPrivateJson, writePrivateJson } from './storage.js';
import { DoctorIssue, object, failure, type CheckStatus, type DoctorCheck, type DoctorProvider, type SessionInfo } from './doctor-checks.js';
import { withSessionRefresh } from './session-refresh.js';

export const doctorProviders = {
  familysearch: () => import('../familysearch/doctor.js'),
  ancestry: () => import('../ancestry/doctor.js'),
  myheritage: () => import('../myheritage/doctor.js'),
  findmypast: () => import('../findmypast/doctor.js'),
  findagrave: () => import('../findagrave/doctor.js'),
  geneanet: () => import('../geneanet/doctor.js'),
  storied: () => import('../storied/doctor.js'),
};
export interface ProviderReport {
  provider: Service;
  status: CheckStatus;
  session?: SessionInfo;
  checks: DoctorCheck[];
  limitations: string[];
}
export interface DoctorReport {
  schemaVersion: 1;
  checkedAt: string;
  mode: 'local' | 'live';
  status: CheckStatus;
  providers: ProviderReport[];
}
type Dependencies = {
  read: typeof readPrivateJson;
  write: typeof writePrivateJson;
  credentials: typeof inspectLoginCredentials;
  now: () => number;
};
const dependencies: Dependencies = {read: readPrivateJson, write: writePrivateJson, credentials: inspectLoginCredentials, now: Date.now};
function status(checks: {status: CheckStatus}[]): CheckStatus {
  return checks.some(c => c.status === 'error') ? 'error' : checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
}

function sessionChecks(checks: DoctorCheck[], session?: SessionInfo): DoctorCheck[] {
  return checks.filter(check => !session || check.scope !== 'password-login');
}

/** Validate online, renew once when needed, and verify the renewed session before reporting success. */
export async function diagnoseProvider(provider: DoctorProvider, live = true, deps: Dependencies = dependencies,
  progress: (label: string) => void = () => {}): Promise<ProviderReport> {
  const checks: DoctorCheck[] = [];
  let session: unknown, info: SessionInfo | undefined;
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
    session = undefined;
    checks.push({id: 'session', status: 'error', code: 'session-invalid', message: 'The saved session is unreadable or malformed.',
      action: `Check ${provider.sessionFile} in the active profile and restore it or authenticate again. ${provider.recovery()}`});
  }
  try {
    const source = await deps.credentials(provider.service);
    checks.push({id: 'credentials', status: 'ok', code: `credentials-${source}`,
      message: source === 'none' ? 'No password configured; browser imports and existing sessions can still work.'
        : source === 'helper' ? 'Credential helper configured; execution and password validity are unverified.'
        : `Login details are available from ${source === 'file' ? 'the saved login file' : 'environment variables'}; password validity is unverified.`});
  } catch {
    checks.push({id: 'credentials', status: 'error', code: 'credentials-invalid', scope: 'password-login', message: 'The effective credential source is unreadable, incomplete, or malformed.',
      action: `Check ${provider.service.toUpperCase()}_USERNAME and ${provider.service.toUpperCase()}_PASSWORD, FAM_CREDENTIALS_COMMAND or config.json credentialsCommand, and the saved login file. Use fam ${provider.service} credentials to replace saved login details.`});
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
  if (!live || !info || session === undefined) {
    checks.push({id: probe.id, status: 'skipped', code: !live ? 'live-not-requested' : 'live-blocked',
      message: !live ? `${probe.label}: not checked online.` : `${probe.label}: skipped because local state needs attention.`});
  } else {
    progress(`${provider.service}: ${probe.label}`);
    const save = async (next: unknown) => {
      const nextInfo = provider.inspect(next);
      try {await deps.write(provider.sessionFile, next);} catch {throw new DoctorIssue('session-save-failed');}
      session = next; info = nextInfo;
    };
    const refresh = info.refreshAvailable && provider.refresh ? async () => {
      progress(`${provider.service}: renewing session`);
      let next: unknown;
      try {next = await provider.refresh!(session);}
      catch (error) {
        if ([400, 401].includes(object(error).status)) throw new DoctorIssue('refresh-rejected');
        throw error;
      }
      // Save rotated credentials before any verification request, even if verification fails.
      await save(next);
      checks.push({id: 'refresh', status: 'ok', code: 'session-refreshed', message: 'Renewed session saved.'});
    } : undefined;
    try {
      await withSessionRefresh(async () => {
        const result = await probe.run(session);
        if (result) await save(result.session);
      }, refresh, info.expiresAt !== undefined && info.expiresAt <= deps.now() + 30_000);
      checks[0] = {id: 'session', status: 'ok', code: 'session-verified', message: 'Saved session accepted by the provider.'};
      checks.push({id: probe.id, status: 'ok', code: 'probe-passed', message: `${probe.label}: read succeeded.`});
    } catch (error) {
      const result = failure(error, probe.recovery ?? provider.recovery(info));
      checks.push({id: probe.id, ...result, message: `${probe.label}: ${result.message}`});
    }
  }
  return {provider: provider.service, status: status(sessionChecks(checks, info)), session: info, checks, limitations: provider.limitations};
}

export async function runDoctor(services: Service[], live = true, progress?: (label: string) => void): Promise<DoctorReport> {
  const providers: ProviderReport[] = [];
  for (const service of services) {
    try {
      const {doctorProvider} = await doctorProviders[service]();
      providers.push(await diagnoseProvider(doctorProvider, live, dependencies, progress));
    } catch {
      providers.push({provider: service, status: 'error', checks: [{id: 'provider', status: 'error', code: 'provider-unavailable',
        message: 'The provider integration could not be loaded.', action: 'Reinstall fam and its dependencies, then retry.'}], limitations: ['No capabilities were verified.']});
    }
  }
  return {schemaVersion: 1, checkedAt: new Date().toISOString(), mode: live ? 'live' : 'local', status: status(providers), providers};
}

function primaryIssue(provider: ProviderReport): DoctorCheck | undefined {
  const issues = sessionChecks(provider.checks, provider.session).filter(c => c.status === 'warning' || c.status === 'error');
  return issues.find(c => c.code === 'login-blocked') ?? issues.find(c => c.status === 'error') ?? issues[0];
}

export function formatDoctor(report: DoctorReport, verbose = false): string {
  if (!verbose) {
    const lines: string[] = [], actions: string[] = [];
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
      'access-denied': ['DENIED', 'Access denied; expiry is unconfirmed'],
      'rate-limited': ['WAIT', 'Provider rate limit'],
      'service-unavailable': ['ERROR', 'Provider unavailable'],
      network: ['ERROR', 'Connection failed'],
      'api-changed': ['ERROR', 'Unexpected provider response'],
      'check-failed': ['ERROR', 'Session check failed'],
      'provider-unavailable': ['ERROR', 'Integration could not load'],
    };
    for (const provider of report.providers) {
      const issue = primaryIssue(provider);
      const passed = provider.checks.some(c => c.code === 'probe-passed');
      const browser = provider.session?.mode === 'browser';
      const [label, detail] = issue?.code === 'login-blocked' ? ['BLOCKED', issue.message.replace(/^Password sign-in is blocked /, '').replace(/\.$/, '')]
        : issue ? details[issue.code] ?? ['ERROR', issue.message]
        : passed ? ['OK', provider.checks.some(c => c.code === 'session-refreshed') ? 'Session refreshed and verified' : browser ? 'Browser session verified' : 'Session verified']
        : ['SAVED', browser ? 'Browser session; not checked online' : 'Not checked online'];
      lines.push(`${provider.provider.padEnd(13)} ${label.padEnd(7)} ${detail}`);
      if (issue?.action) actions.push(`${provider.provider}: ${issue.action.split(/(?<=\.)\s+/)[0]}`);
    }
    if (actions.length) lines.push('', ...actions);
    lines.push('', report.mode === 'local' ? 'Offline: sessions are unverified. Run fam doctor to check online.'
      : 'Session checks only; other capabilities untested. Use --verbose for details.');
    return lines.join('\n');
  }
  const lines = [`fam doctor — ${report.mode} checks`, `Profile: ${CREDENTIAL_DIR}`];
  if (report.mode === 'local') lines.push('Online functionality is unverified. Run fam doctor to check online.');
  else lines.push('Authenticated reads with automatic renewal when needed. No password login.');
  for (const provider of report.providers) {
    lines.push('', `${provider.provider}: ${provider.status.toUpperCase()}${provider.session ? ` (${provider.session.mode})` : ''}`);
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

const help = `Usage: fam doctor [PROVIDER ...] [--offline] [--verbose | --json]

Check saved sessions online and renew them automatically when needed.
  --offline Inspect local state only; no network requests or session changes
  --live    Check online (the default; retained for compatibility)
  --verbose Show individual checks, recovery steps, and coverage limits
  --json    Print a structured report with stable check IDs and issue codes
  --help    Show this help

Examples:
  fam doctor
  fam doctor ancestry findmypast
  fam doctor --offline --json

One authenticated read per provider, plus at most one token renewal and retry if needed.
Renewed tokens and browser session updates are saved. No password login or credential lookup.
Password-login cooldowns do not block existing sessions. No searches or tree traversal.
MyHeritage browser checks read one saved tree page and retain its current API token.
Exit codes: 0 = no issues found in performed checks, 1 = warnings/errors,
2 = invalid arguments. Skipped checks are never evidence of working functionality.
Set FAM_CONFIG_DIR to choose the profile to inspect.
`;

export async function doctorMain(args: string[]) {
  let parsed: {values: {help?: boolean; live?: boolean; offline?: boolean; json?: boolean; verbose?: boolean}; positionals: string[]};
  try {
    parsed = parseArgs({args, allowPositionals: true, options: {help: {type: 'boolean', short: 'h'}, live: {type: 'boolean'}, offline: {type: 'boolean'}, json: {type: 'boolean'}, verbose: {type: 'boolean'}}});
    if (parsed.positionals.some(p => !Object.hasOwn(doctorProviders, p))) throw new Error('Unknown provider.');
    if (parsed.values.json && parsed.values.verbose) throw new Error('Choose text details or JSON.');
    if (parsed.values.live && parsed.values.offline) throw new Error('Choose online or offline checks.');
  } catch {
    console.error('Invalid doctor arguments. Run fam doctor --help.'); process.exitCode = 2; return;
  }
  if (parsed.values.help) {console.log(help); return;}
  const services = [...new Set(parsed.positionals.length ? parsed.positionals : Object.keys(doctorProviders))] as Service[];
  const progress = parsed.values.verbose ? (label: string) => console.error(`Checking ${label}…`) : undefined;
  const report = await runDoctor(services, !parsed.values.offline, progress);
  console.log(parsed.values.json ? JSON.stringify(report, null, 2) : formatDoctor(report, !!parsed.values.verbose));
  process.exitCode = report.status === 'ok' ? 0 : 1;
}
