import { GeneanetHttp, GeneanetError, WEB } from './http.js';
import type { GeneanetSession } from './auth.js';
import { pageKeys } from './parse.js';

const probe = {id: 'account', label: 'Signed-in account', async run(value: unknown) {
  const session = value as GeneanetSession;
  const {text} = await new GeneanetHttp(session.cookies).text(`${WEB}/`, {redirects: false});
  if (pageKeys(text).user?.username !== session.username) throw new GeneanetError('session-rejected', 401);
}};
// Structural provider interface keeps this module usable with or without the optional root doctor dispatcher.
export const doctorProvider = {
  service: 'geneanet' as const, sessionFile: 'geneanet/session.json',
  inspect(value: unknown) {
    const session = value as GeneanetSession;
    if (session?.version !== 1 || typeof session.username !== 'string' || !session.username || !session.cookies?.cookies?.length) throw new Error('Invalid Geneanet session.');
    new GeneanetHttp(session.cookies);
    return {mode: 'browser' as const, refreshAvailable: false};
  },
  recovery: () => 'Run fam geneanet auth. Complete any browser verification on Geneanet; failed reads do not retry passwords.',
  probe,
  probes: [probe],
  limitations: ['Account only. Search, library/tree browser challenges, media, downloads, subscription-specific collections, and writes are not probed.'],
};
