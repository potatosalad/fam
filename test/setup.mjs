import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Each test process gets disposable storage, even when real credentials are exported.
const directory = mkdtempSync(join(tmpdir(), 'familysearch-test-'));
process.env.FAMILYSEARCH_CONFIG_DIR = directory;
for (const service of ['FAMILYSEARCH', 'ANCESTRY', 'MYHERITAGE', 'FINDMYPAST']) {
  delete process.env[`${service}_USERNAME`];
  delete process.env[`${service}_PASSWORD`];
}
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
