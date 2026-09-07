import { parseArgs } from 'node:util';
import { writeFile, chmod, link, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FamilySearchClient } from './client.js';
import { stringifyJson } from '../shared/json.js';
import type { ImageTranscript, PageOptions, ResearchPage } from './research.js';

export const researchHelp = `
fam familysearch image info IMAGE_ARK
fam familysearch image download IMAGE_ARK --original --out FILE.jpg
fam familysearch image transcript IMAGE_ARK [--out FILE.txt] [--format json|text]
fam familysearch collection browse COLLECTION_ID|WAYPOINT_URL [pagination]
fam familysearch film images DGS [pagination]
fam familysearch film image DGS --image NUMBER
fam familysearch fulltext available DGS
fam familysearch fulltext search [--name NAME] [--keywords WORDS] [--place PLACE]
    [--years FROM:TO] [--dgs DGS] [--collection ID] [--record-type TYPE] [pagination]
fam familysearch record details RECORD_ARK

Pagination: --count N --offset N --all --limit N --resume NEXT_URL
  Page size defaults to 100 (maximum 1000). --all follows every page.
  --limit bounds returned items. --offset is zero-based; image numbers are one-based.
  --resume uses a waypoint/search next URL; DGS listings resume with --offset.
  --format jsonl emits one item per line and continuation details on stderr.
Image/transcript downloads also save FILE.json provenance and refuse overwrites.
--original selects FamilySearch's full-resolution distribution image.
`;

export async function runResearchCli(argv: string[], output?: string): Promise<boolean> {
  const [command] = argv;
  if (!['image','collection','film','fulltext','record'].includes(command)) return false;
  const { positionals: args, values: flags } = parseArgs({ args: argv.slice(1), allowPositionals: true, options: {
    format: { type: 'string' }, original: { type: 'boolean' }, image: { type: 'string' },
    count: { type: 'string' }, offset: { type: 'string' }, all: { type: 'boolean' }, limit: { type: 'string' }, resume: { type: 'string' },
    name: { type: 'string' }, keywords: { type: 'string' }, place: { type: 'string' }, years: { type: 'string' },
    dgs: { type: 'string' }, collection: { type: 'string' }, 'record-type': { type: 'string' },
  } });
  const [action, value] = args;
  const key = `${command} ${action}`;
  const pagination = ['count','offset','all','limit','resume'];
  const allowed: Record<string, string[]> = {
    'image info': [], 'image download': ['original'], 'image transcript': ['format'],
    'collection browse': [...pagination,'format'], 'film images': [...pagination,'format'], 'film image': ['image'],
    'fulltext available': [], 'fulltext search': [...pagination,'format','name','keywords','place','years','dgs','collection','record-type'],
    'record details': [],
  };
  if (!allowed[key]) throw new Error('Unknown research command. Use "fam familysearch --help".');
  if (args.length !== (key === 'fulltext search' ? 1 : 2)) throw new Error('Missing or extra research arguments. Use "fam familysearch --help".');
  for (const flag of Object.keys(flags)) if (!allowed[key].includes(flag)) throw new Error(`--${flag} is not supported for ${key}.`);
  const format = flags.format ?? 'json';
  if (!['json','jsonl','text'].includes(format) || format === 'text' && key !== 'image transcript' || format === 'jsonl' && !['collection browse','film images','fulltext search'].includes(key)) throw new Error('Use --format json; jsonl is for listings/search and text is for transcripts.');
  if (flags.resume && flags.offset !== undefined) throw new Error('Use either --resume or --offset.');
  if (flags.resume && ['name','keywords','place','years','dgs','collection','record-type'].some(k => Object.hasOwn(flags,k))) throw new Error('--resume already contains search criteria; do not combine it with new filters.');
  const page: PageOptions = { count: numberFlag(flags.count), offset: numberFlag(flags.offset), all: flags.all,
    limit: numberFlag(flags.limit), resume: flags.resume };
  if (key === 'image download' && !output) throw new Error('Image download requires --out FILE.jpg.');
  if (key === 'film image' && !flags.image) throw new Error('Use --image NUMBER (one-based).');
  const years = flags.years?.match(/^(\d{1,4})?:(\d{1,4})?$/);
  if (flags.years && (!years || !years[1] && !years[2])) throw new Error('--years requires FROM:TO, FROM:, or :TO.');
  const client = await FamilySearchClient.open();
  let result: unknown;
  switch (key) {
    case 'image info': result = await client.research.imageInfo(value); break;
    case 'image download': result = await client.research.downloadOriginal(value, output!); console.log(stringifyJson(result,2)); return true;
    case 'image transcript': {
      const data = await client.research.imageTranscript(value);
      if (output) { await saveTranscript(data, output); console.log(`Saved ${resolve(output)} and its provenance JSON`); return true; }
      if (format === 'text') {
        if (!data.available) throw new Error('No machine transcript is available for this image.');
        process.stdout.write(`${data.text}\n`); return true;
      }
      result = data; break;
    }
    case 'collection browse': result = await client.research.browse(value, page); break;
    case 'film images': result = await client.research.filmImages(value, page); break;
    case 'film image': result = await client.research.filmImage(value, numberFlag(flags.image)!); break;
    case 'fulltext available': result = await client.research.fulltextAvailable(value); break;
    case 'fulltext search': result = await client.research.fulltextSearch({ name: flags.name, keywords: flags.keywords, place: flags.place,
      dgs: flags.dgs, collection: flags.collection, recordType: flags['record-type'],
      fromYear: years?.[1] ? Number(years[1]) : undefined, toYear: years?.[2] ? Number(years[2]) : undefined }, page); break;
    case 'record details': {
      const url = new URL(value.startsWith('1:1:') ? `https://www.familysearch.org/ark:/61903/${value}` : value);
      if (url.protocol !== 'https:' || !['www.familysearch.org','familysearch.org'].includes(url.host) || url.username || url.password || !/^\/ark:\/61903\/1:1:[A-Z0-9-]+$/i.test(url.pathname)) throw new Error('Expected an indexed-record ARK (1:1:...).');
      result = await client.genealogy.sources.recordDetails({ query: { recordUrl: url.origin + url.pathname } }); break;
    }
  }
  let text: string;
  if (format === 'jsonl') {
    const { items, ...continuation } = result as ResearchPage<unknown>;
    text = items.map(x => stringifyJson(x)).join('\n') + (items.length ? '\n' : '');
    console.error(stringifyJson({ ...continuation, returned: items.length }));
  } else text = `${stringifyJson(result,2)}\n`;
  if (output) { await writeFile(resolve(output), text, { mode: 0o600 }); await chmod(resolve(output), 0o600); console.log(`Saved ${resolve(output)}`); }
  else process.stdout.write(text);
  return true;
}

function numberFlag(value?: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error('Pagination/image values must be nonnegative integers.');
  return Number(value);
}
async function saveTranscript(data: ImageTranscript, output: string): Promise<void> {
  if (!data.available) throw new Error('No machine transcript is available; no output file was saved.');
  const file = resolve(output), metadata = `${file}.json`, temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${data.text}\n`, { flag: 'wx', mode: 0o600 });
    await writeFile(`${temporary}.json`, `${stringifyJson(data, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await link(`${temporary}.json`, metadata);
    try { await link(temporary, file); } catch (error) { await rm(metadata, { force: true }); throw error; }
  } finally { await rm(temporary, { force: true }); await rm(`${temporary}.json`, { force: true }); }
}
