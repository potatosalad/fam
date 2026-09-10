import { doctorProvider as storied } from '../storied/doctor.js';
import { prepareCall } from '../storied/client.js';
import { operation } from '../storied/catalog.js';
import { StoriedHttp } from '../storied/http.js';
import type { StoriedSession } from '../storied/auth.js';
import { operations } from './client.js';
import { object, nonempty, requireResponse, type DoctorProvider } from '../shared/doctor-checks.js';
export const doctorProvider: DoctorProvider = {
  ...storied, service: 'newspaperarchive',
  recovery: () => 'Run fam newspaperarchive.session login; it shares the Storied account and native session.',
  probe: {id: 'account', label: 'Identity and newspaper catalog', async run(value) {
    // The health runner owns repair. A normal StoriedClient can refresh and
    // save internally, bypassing --no-fix and the shared-session attempt limit.
    const session = value as StoriedSession, http = new StoriedHttp();
    const identity = object(await http.request('/userinfo', {auth: true, token: session.accessToken}));
    requireResponse(nonempty(identity.sub));
    const request = prepareCall(operation(operations.countries));
    const catalog = object(await http.request(request.path, {...request, token: session.accessToken, sessionId: session.sessionId}));
    requireResponse(catalog.error == null && Array.isArray(catalog.data));
    return {session: {...session, validatedAt: new Date().toISOString()}};
  }},
  limitations: ['Checks identity and newspaper catalog only. Masked search results and OCR/image access depend on subscription and provider availability.'],
};
