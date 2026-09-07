import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test process gets disposable storage, even when real credentials are exported.
const directory = mkdtempSync(join(tmpdir(), 'fam-test-'));
process.env.FAM_CONFIG_DIR = directory;
delete process.env.FAMILYSEARCH_CONFIG_DIR;
delete process.env.FAM_CREDENTIALS_COMMAND;
for (const service of ['FAMILYSEARCH', 'ANCESTRY', 'MYHERITAGE', 'FINDMYPAST', 'FINDAGRAVE']) {
  delete process.env[`${service}_USERNAME`];
  delete process.env[`${service}_PASSWORD`];
}
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
