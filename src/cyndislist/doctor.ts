import {browserConfig} from '../shared/browser-config.js';
import type {ProviderReport} from '../shared/doctor.js';
import {CyndisListHttp} from './http.js';
import {parsePage} from './parse.js';
import {CATEGORY_INDEX} from './url.js';

export async function diagnose(live: boolean): Promise<ProviderReport> {
  const report: ProviderReport = {provider: 'cyndislist', status: 'ok', checks: [
    {id: 'access', status: 'ok', code: 'public-access', message: 'Public provider; no account, credentials, or login required.'}],
    limitations: ['Checks category index access. Google search and external resource destinations are not probed.']};
  try {
    const configured = !!await browserConfig();
    report.checks.push({id: 'browser', status: configured ? 'ok' : 'warning', code: configured ? 'browser-configured' : 'browser-missing',
      message: configured ? 'Camofox configured for Google search; not contacted by this check.' : 'Google search needs Camofox; direct Cyndi reads can still work.',
      ...(configured ? {} : {action: 'Run fam browser setup --local.'})});
    if (!configured) report.status = 'warning';
    if (live) {
      const page = parsePage(await new CyndisListHttp().get(CATEGORY_INDEX));
      if (!page.categories.length) throw new Error('No categories were recognized.');
      report.checks.push({id: 'directory', status: 'ok', code: 'probe-passed', message: `Read ${page.categories.length} category links.`});
    } else report.checks.push({id: 'directory', status: 'skipped', code: 'live-not-requested', message: 'Directory access not checked online.'});
  } catch (error) {report.status = 'error'; report.checks.push({id: 'directory', status: 'error', code: 'check-failed', message: (error as Error).message});}
  return report;
}
