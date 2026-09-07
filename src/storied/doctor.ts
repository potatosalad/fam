import { validSession, refreshStoried, validateAccess, type StoriedSession } from './auth.js';
import { StoriedHttp } from './http.js';
import { requireSession, type DoctorProvider } from '../shared/doctor-checks.js';

export const doctorProvider: DoctorProvider = {
  service: 'storied', sessionFile: 'storied/session.json',
  inspect(value) {
    requireSession(validSession(value));
    return {mode: 'native', expiresAt: value.expiresAt, refreshAvailable: !!value.refreshToken};
  },
  recovery: () => 'Run fam storied auth. Use --interactive if browser verification is required.',
  refresh: value => refreshStoried(value as StoriedSession),
  probe: {id: 'account', label: 'Account tree list', async run(value) {
    await validateAccess(new StoriedHttp(), value as StoriedSession);
    return {session: {...value as StoriedSession, validatedAt: new Date().toISOString()}};
  }},
  limitations: ['Checks one account tree-list response; record searches, individual content, subscriptions and writes require separate verification.'],
};
