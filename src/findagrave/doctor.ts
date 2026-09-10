import type { FindagraveSession } from './auth.js';
import { FindagraveHttp, GRAPHQL } from './http.js';
import { graphqlOperation } from './catalog.js';
import { cookies, DoctorIssue, graphql, nonempty, object, requireResponse, requireSession, type DoctorProvider } from '../shared/doctor-checks.js';

export const doctorProvider: DoctorProvider = {
  service: 'findagrave', sessionFile: 'findagrave/session.json',
  inspect(value) {
    const s = object(value);
    requireSession(nonempty(s.token) && nonempty(s.contributorId));
    cookies(s.cookies);
    return {mode: 'native', refreshAvailable: false};
  },
  recovery: () => 'Run fam findagrave.session login. If login fails, update credentials with fam findagrave.credential set and complete any website verification. There is no token refresh command.',
  login: {kind: 'credentials', async run() {return (await import('./auth.js')).authenticateFindagrave();}},
  probe: {id: 'account', label: 'Signed-in contributor', async run(value) {
      const s = value as FindagraveSession, op = graphqlOperation('SignedInContributor'), http = new FindagraveHttp(s.cookies);
      const data = await graphql(http, GRAPHQL, op, {}, {...op.headers, fgm: s.contributorId, fgmSeed: s.token});
      requireResponse(Object.hasOwn(data, 'signedInContributor'));
      if (!data.signedInContributor?.id || String(data.signedInContributor.id) !== s.contributorId) throw new DoctorIssue('session-rejected');
      return {session: {...s, cookies: http.jar.serializeSync(), validatedAt: new Date().toISOString()}};
  }},
  limitations: ['Only session access is checked. Public searches, memorials, photos, downloads, and writes are not probed.'],
};
