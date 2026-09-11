import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test process gets disposable storage, even when real credentials are exported.
const directory = mkdtempSync(join(tmpdir(), 'fam-test-'));
process.env.FAM_CONFIG_DIR = directory;
process.env.FAM_TRANSPORT = 'http'; // Offline tests never launch a real browser.
process.env.FAM_AUTO_UPDATE = '0'; // Tests must never update the real checkout.
delete process.env.FAM_HISTORY;
delete process.env.FAMILYSEARCH_CONFIG_DIR;
delete process.env.FAM_CREDENTIALS_COMMAND;
delete process.env.FAM_CREDENTIALS_SYNC_COMMAND;
delete process.env.FAM_CREDENTIALS_SYNC_DISABLED;
for (const service of ['FAMILYSEARCH', 'ANCESTRY', 'MYHERITAGE', 'FINDMYPAST', 'FINDAGRAVE', 'GENEANET', 'STORIED', 'NEWSPAPERS', 'FOLD3']) {
  delete process.env[`${service}_USERNAME`];
  delete process.env[`${service}_PASSWORD`];
}
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
