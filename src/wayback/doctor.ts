import type {ProviderReport} from '../shared/doctor.js';
import {WaybackClient} from './client.js';

export async function diagnose(live: boolean): Promise<ProviderReport> {
  const report: ProviderReport = {provider:'wayback', status:'ok', checks:[{id:'access', status:'ok', code:'public-access', message:'Public archive; no credentials or account required.'}],
    limitations:['Capture index lookup only; individual archived pages are not downloaded.']};
  if (!live) report.checks.push({id:'availability', status:'skipped', code:'live-not-requested', message:'Archive not contacted.'});
  else try {
    await new WaybackClient({timeout:15, open:'never'}).find('https://example.com/');
    report.checks.push({id:'availability', status:'ok', code:'probe-passed', message:'Wayback capture index responded.'});
  } catch (error) {
    report.status = 'error';
    report.checks.push({id:'availability', status:'error', code:'check-failed', message:(error as Error).message});
  }
  return report;
}
