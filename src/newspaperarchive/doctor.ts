import { doctorProvider as storied } from '../storied/doctor.js';
import { StoriedClient } from '../storied/client.js';
import type { StoriedSession } from '../storied/auth.js';
import { NewspaperArchiveClient } from './client.js';
import type { DoctorProvider } from '../shared/doctor-checks.js';
export const doctorProvider: DoctorProvider = {
  ...storied, service: 'newspaperarchive',
  recovery: () => 'Run fam newspaperarchive.session login; it shares the Storied account and native session.',
  probe: {id: 'account', label: 'Identity and newspaper catalog', async run(value) {
    await new NewspaperArchiveClient(new StoriedClient(value as StoriedSession)).verify();
    return {session: {...value as StoriedSession, validatedAt: new Date().toISOString()}};
  }},
  limitations: ['Checks identity and newspaper catalog only. Masked search results and OCR/image access depend on subscription and provider availability.'],
};
