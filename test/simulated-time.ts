import type {TestContext} from 'node:test';
import timers from 'node:timers/promises';
import {syncBuiltinESMExports} from 'node:module';

// Advance the application clock at each awaited delay; keep real socket/I/O timers intact.
export function simulateDelays(t: TestContext) {
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  const delay = t.mock.method(timers, 'setTimeout', async (ms = 1, value?: unknown) => {
    t.mock.timers.tick(ms);
    return value;
  });
  syncBuiltinESMExports(); // Update the runtime's named imports of setTimeout.
  t.after(() => {delay.mock.restore(); t.mock.timers.reset(); syncBuiltinESMExports();});
}
