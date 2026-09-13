import {browserConfig} from '../shared/browser-config.js';
import {doctorCheckCache} from '../shared/doctor-cache.js';
import {failure} from '../shared/doctor-checks.js';
import type {DoctorOptions, ProviderReport} from '../shared/doctor.js';
import {NaraClient} from './client.js';

export async function diagnose(live: boolean, options: DoctorOptions = {}): Promise<ProviderReport> {
  const report: ProviderReport = {provider: 'nara', status: 'ok', checks: [
    {id: 'access', status: 'ok', code: 'public-access', message: 'Public Catalog website; no login.gov account or API key required.'}],
    limitations: ['Browser-rendered website reads only. Official API and contribution writes are not implemented.', 'The live check reads one public record; it does not test search, transcriptions, or downloads.']};
  try {
    const config = await browserConfig();
    report.checks.push({id: 'browser', status: config ? 'ok' : 'warning', code: config ? 'browser-configured' : 'browser-missing',
      message: config ? 'Browser configured for Catalog reads.' : 'Configure the browser with fam browser setup --local.'});
  } catch {report.checks.push({id: 'browser', status: 'error', code: 'browser-config-invalid', message: 'Browser configuration could not be read.'});}
  if (live) report.checks.push(await doctorCheckCache.run('nara', 'catalog', async () => {
    try {await new NaraClient().record('152951241'); return {id: 'catalog', status: 'ok', code: 'probe-passed', message: 'Read a public Catalog record without credentials.'};}
    catch (error) {return {id: 'catalog', ...failure(error, 'Retry fam cli.health check --provider nara --force.')};}
  }, options));
  else report.checks.push({id: 'catalog', status: 'skipped', code: 'live-not-requested', message: 'Catalog access not checked online.'});
  report.status = report.checks.some(c => c.status === 'error') ? 'error' : report.checks.some(c => c.status === 'warning') ? 'warning' : 'ok';
  return report;
}
