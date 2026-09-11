import type {ProviderReport} from '../shared/doctor.js';
import {InternetArchiveClient} from './client.js';

export async function diagnose(live: boolean): Promise<ProviderReport> {
  const report: ProviderReport = {provider: 'internetarchive', status: 'ok', checks: [{id: 'access', status: 'ok', code: 'public-access',
    message: 'Anonymous public API access; no credentials are loaded.'}], limitations: ['Catalog probe only; full-text search, downloads, and restricted-item access are not verified.']};
  if (!live) report.checks.push({id: 'availability', status: 'skipped', code: 'live-not-requested', message: 'Archive not contacted.'});
  else try {
    await new InternetArchiveClient({timeout: 15}).search('identifier:genealogy', {limit: 1});
    report.checks.push({id: 'availability', status: 'ok', code: 'probe-passed', message: 'Internet Archive catalog API responded.'});
  } catch (error) {
    report.status = 'error';
    report.checks.push({id: 'availability', status: 'error', code: 'check-failed', message: (error as Error).message});
  }
  return report;
}
