import type {DoctorOptions, ProviderReport} from '../shared/doctor.js';
import {doctorCheckCache} from '../shared/doctor-cache.js';
import {failure} from '../shared/doctor-checks.js';
import {InternetArchiveClient} from './client.js';

export async function diagnose(live: boolean, options: DoctorOptions = {}): Promise<ProviderReport> {
  const report: ProviderReport = {provider: 'internetarchive', status: 'ok', checks: [{id: 'access', status: 'ok', code: 'public-access',
    message: 'Anonymous public API access; no credentials are loaded.'}], limitations: ['Catalog probe only; full-text search, downloads, and restricted-item access are not verified.']};
  if (!live) report.checks.push({id: 'availability', status: 'skipped', code: 'live-not-requested', message: 'Archive not contacted.'});
  else {
    const check = await doctorCheckCache.run('internetarchive', 'availability', async () => {
      try {
        await new InternetArchiveClient({timeout: 15}).search('identifier:genealogy', {limit: 1});
        return {id: 'availability', status: 'ok', code: 'probe-passed', message: 'Internet Archive catalog API responded.'};
      } catch (error) {return {id: 'availability', ...failure(error, 'Retry fam cli.health check --provider internetarchive --force.')};}
    }, options);
    report.checks.push(check);
    if (check.status !== 'skipped') report.status = check.status;
  }
  return report;
}
