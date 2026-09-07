/** Opt-in authenticated document reads using the public Walton acceptance examples. */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { FamilySearchClient } from '../src/index.js';

const { values } = parseArgs({ options: { report: { type: 'string' }, label: { type: 'string' }, cli: { type: 'boolean' } } });
const root = new URL('../artifacts/document-research/', import.meta.url);
await mkdir(root, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(join(fileURLToPath(root), 'verify-'));
const client = await FamilySearchClient.open();
const research = client.research;
const checks: Array<Record<string, unknown>> = [];
function passed(operation: string, details: Record<string, unknown> = {}) {
  checks.push({ operation, status: 'passed', ...details });
  console.error(`${operation}: passed`);
}
const image3 = 'https://www.familysearch.org/ark:/61903/3:1:3QSQ-G935-BNWL';
const image408 = 'https://www.familysearch.org/ark:/61903/3:1:3QS7-8935-BJZR';

const raw = await client.get<{ sourceDescriptions?: unknown[] }>('/service/cds/recapi/collections/1999178/waypoints', { count: 1 });
assert.ok(Array.isArray(raw.sourceDescriptions));
passed('generic GET recapi');

const counties = await research.browse('1999178', { count: 100, all: true, limit: 1000 });
assert.equal(counties.complete, true);
const walton = counties.items.find(item => item.title === 'Walton');
assert.ok(walton);
passed('collection counties', { returned: counties.items.length, complete: counties.complete });

const volumes = await research.browse(walton.url, { all: true, limit: 1000 });
assert.equal(volumes.complete, true);
const estate = volumes.items.find(item => item.title === 'Estate index 1820-1938 vol A-Q');
assert.ok(estate);
passed('county volumes', { returned: volumes.items.length, complete: volumes.complete });

const images = await research.browse(estate.url, { count: 100, all: true, limit: 1000 });
assert.equal(images.complete, true);
assert.equal(images.total, 736);
assert.equal(images.items.length, 736);
assert.equal(new Set(images.items.map(item => item.imageArk)).size, 736);
assert.equal(images.items[2].imageArk, image3);
assert.equal(images.items[407].imageArk, image408);
passed('paginated volume images', { returned: images.items.length, unique: 736, complete: true });

const film = await research.filmImages('005764700', { all: true, limit: 1000 });
assert.equal(film.complete, true);
assert.deepEqual(film.items.map(item => item.imageArk), images.items.map(item => item.imageArk));
assert.equal((await research.filmImage('005764700', 408)).imageArk, image408);
passed('DGS images and image selection', { dgs: '005764700', returned: film.items.length, matchesWaypointOrder: true });

for (const [ark, number] of [[image3, 3], [image408, 408]] as const) {
  const image = await research.downloadOriginal(ark, join(directory, `walton-${number}.jpg`));
  assert.equal(image.imageNumber, number);
  assert.equal(image.dgs, '005764700');
  assert.equal(image.imageCount, 736);
  assert.ok(image.citations.length);
  passed('original image download', { imageArk: ark, imageNumber: number, width: image.width, height: image.height,
    bytes: image.bytes, sha256: image.sha256, decoded: true, provenanceSaved: true });
}

const availability = await research.fulltextAvailable('005764700');
assert.equal(availability.available, true);
passed('Full-Text availability', availability);
const hits = await research.fulltextSearch({ name: 'Walton', dgs: '005764700' }, { count: 5, all: true, limit: 100 });
assert.equal(hits.complete, true);
assert.ok(hits.items.length > 0);
assert.equal(hits.items.length, hits.total);
const filmArks = new Set(film.items.map(item => item.imageArk));
assert.ok(hits.items.every(hit => filmArks.has(hit.imageArk)));
assert.ok(hits.items.some(hit => hit.machineTranscript));
passed('paginated Full-Text Search', { returned: hits.items.length, complete: true, allHitsWithinDgs: true, includesMachineText: true });

const transcript = await research.imageTranscript(image408);
assert.equal(transcript.available, true);
assert.ok(transcript.text.length > 100);
assert.ok(transcript.regions.some(region => region.lines.some(line => line.tokens.some(token => token.rect))));
passed('image transcript', { imageArk: image408, available: true, regions: transcript.regions.length, includesCoordinates: true });

if (values.cli) {
  // Each installed-command invocation restores authentication in a fresh process,
  // from outside the checkout. Never include its raw research output in the report.
  const exec = promisify(execFile);
  async function command(args: string[]) {
    return await exec(process.execPath, [fileURLToPath(new URL('../bin/fam.mjs', import.meta.url)), 'familysearch', ...args], { cwd: directory, maxBuffer: 4 * 1024 * 1024 });
  }
  const help = (await command(['--help'])).stdout;
  assert.ok(help.includes('fam familysearch image download'));
  assert.ok(!help.includes('npm run fam -- familysearch'));
  const example = JSON.parse((await command(['schema', 'sources.recordDetails', '--example'])).stdout);
  assert.equal(typeof example.query.recordUrl, 'string');
  passed('installed CLI help and nested schema example');
  const cliImage = JSON.parse((await command(['image', 'download', image408, '--original', '--out', 'cli-walton-408.jpg'])).stdout);
  assert.equal(cliImage.imageNumber, 408);
  assert.equal(cliImage.width, 3532);
  assert.equal(cliImage.height, 4224);
  passed('installed CLI original download in fresh process', { imageNumber: 408, decoded: true });
  const cliTranscript = JSON.parse((await command(['image', 'transcript', image408])).stdout);
  assert.equal(cliTranscript.available, true);
  assert.equal(cliTranscript.text, transcript.text);
  passed('installed CLI transcript in fresh process');
  const cliSearch = JSON.parse((await command(['fulltext', 'search', '--name', 'Walton', '--dgs', '005764700', '--count', '2'])).stdout);
  assert.equal(cliSearch.items.length, 2);
  assert.ok(cliSearch.items.every((hit: { imageArk: string }) => filmArks.has(hit.imageArk)));
  passed('installed CLI scoped Full-Text Search in fresh process');
}

const report = { verifiedAt: new Date().toISOString(), label: values.label ?? 'local', node: process.version, platform: process.platform,
  scope: 'Authenticated reads with saved native session; public Walton probate examples. Downloads remain in ignored artifacts. No browser session import or service mutations.',
  checks, successful: checks.length };
if (values.report) await writeFile(resolve(values.report), `${JSON.stringify(report, null, 2)}\n`);
else console.log(JSON.stringify(report, null, 2));
console.error(`Verified ${checks.length} document checks. Downloads saved in ${directory}`);
