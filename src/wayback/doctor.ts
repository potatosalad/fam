import type {DoctorOptions, ProviderReport} from '../shared/doctor.js';
import {doctorCheckCache} from '../shared/doctor-cache.js';
import {failure} from '../shared/doctor-checks.js';
import {WaybackClient} from './client.js';

export async function diagnose(live: boolean, options: DoctorOptions = {}): Promise<ProviderReport> {
  const report: ProviderReport = {provider:'wayback', status:'ok', checks:[{id:'access', status:'ok', code:'public-access', message:'Public archive; no credentials or account required.'}],
    limitations:['Capture index lookup only; individual archived pages are not downloaded.']};
  if (!live) report.checks.push({id:'availability', status:'skipped', code:'live-not-requested', message:'Archive not contacted.'});
  else {
    const check = await doctorCheckCache.run('wayback', 'availability', async () => {
      try {
        await new WaybackClient({timeout:15, open:'never'}).find('https://example.com/');
        return {id:'availability', status:'ok', code:'probe-passed', message:'Wayback capture index responded.'};
      } catch (error) {return {id: 'availability', ...failure(error, 'Retry fam cli.health check --provider wayback --force.')};}
    }, options);
    report.checks.push(check);
    if (check.status !== 'skipped') report.status = check.status;
  }
  return report;
}
