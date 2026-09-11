import {browserConfig} from '../shared/browser-config.js';
import type {DoctorOptions, ProviderReport} from '../shared/doctor.js';
import {doctorCheckCache} from '../shared/doctor-cache.js';
import {failure} from '../shared/doctor-checks.js';
import {CyndisListHttp} from './http.js';
import {parsePage} from './parse.js';
import {CATEGORY_INDEX} from './url.js';

export async function diagnose(live: boolean, options: DoctorOptions = {}): Promise<ProviderReport> {
  const report: ProviderReport = {provider: 'cyndislist', status: 'ok', checks: [
    {id: 'access', status: 'ok', code: 'public-access', message: 'Public provider; no account, credentials, or login required.'}],
    limitations: ['Checks category index access. Site search and external resource destinations are not probed.']};
  try {
    const configured = !!await browserConfig();
    report.checks.push({id: 'browser', status: configured ? 'ok' : 'warning', code: configured ? 'browser-configured' : 'browser-missing',
      message: configured ? 'Browser configured for site search; not contacted by this check.' : 'Site search needs browser setup; directory browsing is available.',
      ...(configured ? {} : {action: 'Run fam browser setup --local.'})});
    if (!configured) report.status = 'warning';
  } catch {
    report.status = 'error';
    report.checks.push({id: 'browser', status: 'error', code: 'browser-config-invalid', message: 'Browser configuration could not be read.'});
  }
  if (live) {
    const check = await doctorCheckCache.run('cyndislist', 'directory', async () => {
      try {
        const page = parsePage(await new CyndisListHttp().get(CATEGORY_INDEX));
        if (!page.categories.length) throw new Error('No categories were recognized.');
        return {id: 'directory', status: 'ok', code: 'probe-passed', message: `Read ${page.categories.length} category links.`};
      } catch (error) {return {id: 'directory', ...failure(error, 'Retry fam cli.health check --provider cyndislist --force.')};}
    }, options);
    report.checks.push(check);
    if (check.status === 'error' || check.status === 'warning' && report.status === 'ok') report.status = check.status;
  } else report.checks.push({id: 'directory', status: 'skipped', code: 'live-not-requested', message: 'Directory access not checked online.'});
  return report;
}
