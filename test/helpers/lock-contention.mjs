import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';

/** Observe a real failed lock acquisition, without adding production test hooks. */
export function observeLockContention(lock, ownerPid) {
  const mkdir = fs.mkdir;
  const {promise: ready, resolve, reject} = Promise.withResolvers();
  const restore = () => {
    clearTimeout(timer);
    fs.mkdir = mkdir;
    syncBuiltinESMExports();
  };
  const timer = setTimeout(() => {
    restore();
    reject(new Error(`No contender attempted ${lock}`));
  }, 10_000);
  fs.mkdir = async function (path, ...options) {
    try {return await mkdir.call(this, path, ...options);}
    catch (error) {
      if (String(path) === lock && error.code === 'EEXIST') {
        const owner = ownerPid === undefined ? undefined
          : await fs.readFile(join(lock, 'owner.json'), 'utf8').then(JSON.parse).catch(() => undefined);
        if (ownerPid === undefined || owner?.pid === ownerPid) {
          restore();
          resolve();
        }
      }
      throw error;
    }
  };
  syncBuiltinESMExports();
  return {ready, restore};
}
