import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, symlink, lstat, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// @ts-ignore The packaged Docker service is JavaScript.
import {clearStaleProcessLocks} from '../browser/cloakbrowser/server.mjs';

test('container replacement clears dead Chromium locks but preserves an active profile', async t => {
  const root=await mkdtemp(join(tmpdir(),'fam-chromium-locks-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=join(root,'profile'),proc=join(root,'proc');
  await mkdir(directory);await mkdir(join(proc,'123'),{recursive:true});
  const lock=join(directory,'SingletonLock');await symlink('previous-container-123',lock);
  await writeFile(join(proc,'123','cmdline'),`chrome\0--user-data-dir=${directory}\0`);
  await assert.rejects(clearStaleProcessLocks(directory,proc),/already in use/);
  assert.equal((await lstat(lock)).isSymbolicLink(),true);
  await writeFile(join(proc,'123','cmdline'),'unrelated-process\0');
  await clearStaleProcessLocks(directory,proc);
  await assert.rejects(lstat(lock),{code:'ENOENT'});
  await clearStaleProcessLocks(directory,proc);
});
