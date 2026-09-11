import {mkdir} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
// @ts-expect-error Shared launcher helper is plain JavaScript.
import {withProcessLock} from '../../bin/build-state.mjs';
import type {Provider} from './command-registry.js';
import {object, type DoctorCheck} from './doctor-checks.js';
import {CREDENTIAL_DIR, readPrivateJson, writePrivateJson} from './storage.js';

const minimumAge = 45 * 60_000, jitterRange = 30 * 60_000;
type Dependencies = {
  read: typeof readPrivateJson;
  write: typeof writePrivateJson;
  now: () => number;
  random: () => number;
  lock?: (file: string, run: () => Promise<DoctorCheck>) => Promise<DoctorCheck>;
};
export type DoctorCheckCache = ReturnType<typeof createDoctorCheckCache>;

async function lockCheck(file: string, run: () => Promise<DoctorCheck>): Promise<DoctorCheck> {
  const directory = dirname(join(CREDENTIAL_DIR, file));
  await mkdir(directory, {recursive: true, mode: 0o700});
  return withProcessLock(directory, `.${basename(file)}.lock`, run);
}

/** Cache only individual live results, never provider reports, sessions, or recovery actions. */
export function createDoctorCheckCache(deps: Dependencies = {
  read: readPrivateJson, write: writePrivateJson, now: Date.now, random: Math.random, lock: lockCheck,
}) {
  return {
    async run(provider: Provider, id: string, run: () => Promise<DoctorCheck>, options: {force?: boolean} = {}): Promise<DoctorCheck> {
      const file = `cache/health/${encodeURIComponent(provider)}/${encodeURIComponent(id)}.json`;
      const execute = async (): Promise<DoctorCheck> => {
        if (!options.force) {
          try {
            const entry = object(await deps.read(file)), check = object(entry.check), now = deps.now();
            const age = entry.expiresAt - entry.checkedAt;
            if (entry.version === 1 && entry.provider === provider && check.id === id
              && Number.isSafeInteger(entry.checkedAt) && Number.isSafeInteger(entry.expiresAt)
              && entry.checkedAt <= now && now < entry.expiresAt && age >= minimumAge && age <= minimumAge + jitterRange
              && ['ok', 'warning', 'error', 'skipped'].includes(check.status)
              && typeof check.code === 'string' && typeof check.message === 'string'
              && (check.action === undefined || typeof check.action === 'string')) {
              return {id, status: check.status, code: check.code, message: check.message,
                ...(check.action ? {action: check.action} : {}), cached: true,
                checkedAt: new Date(entry.checkedAt).toISOString(), expiresAt: new Date(entry.expiresAt).toISOString()};
            }
          } catch { /* Missing, unreadable, and malformed cache entries are misses. */ }
        }
        const check = await run();
        // Local blockers must not postpone a first online check after setup is repaired.
        if (check.code === 'live-blocked' || check.code === 'live-not-requested') return check;
        const checkedAt = deps.now();
        const expiresAt = checkedAt + minimumAge + Math.floor(deps.random() * (jitterRange + 1));
        const result = {id, status: check.status, code: check.code, message: check.message,
          ...(check.action ? {action: check.action} : {})};
        try {
          await deps.write(file, {version: 1, provider, checkedAt, expiresAt, check: result});
          return {...result, cached: false, checkedAt: new Date(checkedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString()};
        } catch {
          // A cache write failure must not discard the actual health result.
          return {...result, cached: false, checkedAt: new Date(checkedAt).toISOString()};
        }
      };
      // Hold one lock per live check across lookup, execution, and save. Separate
      // CLI processes must recheck the entry after an overlapping run finishes.
      if (!deps.lock) return execute();
      let started = false;
      try {return await deps.lock(file, () => {started = true; return execute();});}
      catch (error) {
        if (started) throw error;
        return {id, status: 'warning', code: 'live-check-unavailable',
          message: 'The live check could not acquire its cache lock; another invocation may still be checking.',
          action: 'Wait for other health checks to finish and check active profile permissions, then retry.'};
      }
    },
  };
}

export const doctorCheckCache = createDoctorCheckCache();
