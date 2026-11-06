import {InputError} from '../shared/input-error.js';
import {inspectResult} from '../shared/diagnostics.js';
import { parseArgs } from 'node:util';
import { writeFile, mkdir, link, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {writeOutputFile} from '../shared/storage.js';
import { randomUUID } from 'node:crypto';
import { FamilySearchClient } from './client.js';
import { stringifyJson } from '../shared/json.js';
import type { ImageTranscript, PageOptions, ResearchPage } from './research.js';
import {runRecordSearch} from './record-search.js';


export async function runResearchCli(argv: string[], output?: string): Promise<{data: unknown} | undefined> {
  const [command] = argv;
  if (!['image','collection','film','fulltext','record'].includes(command)) return undefined;
  if (command === 'record' && ['search', 'collections'].includes(argv[1])) {
    const result = await runRecordSearch(argv.slice(2), argv[1] as 'search' | 'collections');
    if (output) {
      await writeOutputFile(resolve(output), `${stringifyJson(result, 2)}\n`);
      return {data: {saved: resolve(output)}};
    }
    return {data: result};
  }
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
  if (!allowed[key]) throw new InputError('Unknown research command. Use "fam cli.command list --provider familysearch".');
  if (args.length !== (key === 'fulltext search' ? 1 : 2)) throw new InputError('Missing or extra research arguments. Use "fam cli.command list --provider familysearch".');
  for (const flag of Object.keys(flags)) if (!allowed[key].includes(flag)) throw new InputError(`--${flag} is not supported for ${key}.`);
  const format = flags.format ?? 'json';
  if (!['json','jsonl','text'].includes(format) || format === 'jsonl' && !['collection browse','film images','fulltext search'].includes(key)) throw new InputError('Use --format text or json; jsonl is for listings/search.');
  if (flags.resume && flags.offset !== undefined) throw new InputError('Use either --resume or --offset.');
  if (flags.resume && ['name','keywords','place','years','dgs','collection','record-type'].some(k => Object.hasOwn(flags,k))) throw new InputError('--resume already contains search criteria; do not combine it with new filters.');
  const page: PageOptions = { count: numberFlag(flags.count), offset: numberFlag(flags.offset), all: flags.all,
    limit: numberFlag(flags.limit), resume: flags.resume };
  if (key === 'image download' && !output) throw new InputError('Image download requires --out FILE.jpg.');
  if (key === 'film image' && !flags.image) throw new InputError('Use --image NUMBER (one-based).');
  const years = flags.years?.match(/^(\d{1,4})?:(\d{1,4})?$/);
  if (flags.years !== undefined && (!years || !years[1] && !years[2])) throw new InputError('--years requires FROM:TO, FROM:, or :TO.');
  const client = await FamilySearchClient.open();
  let result: unknown;
  switch (key) {
    case 'image info': result = await client.research.imageInfo(value); break;
    case 'image download': return {data: await client.research.downloadOriginal(value, output!)};
    case 'image transcript': {
      const data = await client.research.imageTranscript(value);
      if (output) { await saveTranscript(data, output, format as 'text' | 'json'); return {data: {saved: resolve(output), ...(format === 'text' ? {metadata: `${resolve(output)}.json`} : {})}}; }
      if (format === 'text') {
        if (!data.available) throw new Error(transcriptUnavailable(data));
        return {data};
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
      let url: URL;
      try {url = new URL(value.startsWith('1:1:') ? `https://www.familysearch.org/ark:/61903/${value}` : value);}
      catch {throw new InputError('Expected an indexed-record ARK (1:1:...).');}
      if (url.protocol !== 'https:' || !['www.familysearch.org','familysearch.org'].includes(url.host) || url.username || url.password || !/^\/ark:\/61903\/1:1:[A-Z0-9-]+$/i.test(url.pathname)) throw new InputError('Expected an indexed-record ARK (1:1:...).');
      const record = await client.genealogy.sources.recordDetails({ query: { recordUrl: url.origin + url.pathname, hideSectionFields:false, includeFocusPersonSummary:true } });
      const rowCount = (record.sections ?? []).reduce((count, section) => count + (section.rows?.length ?? 0), 0);
      result = {...record, recordSections: {available:rowCount>0,rowCount,
        ...(rowCount===0 ? {reason:'not-supplied-by-provider',note:'The provider returned no related-person rows for this persona. This does not establish that the household was empty; consult the image or another indexed persona.'} : {})}}; break;
    }
  }
  let text: string;
  if (format === 'jsonl') {
    const { items } = result as ResearchPage<unknown>;
    text = items.map(x => stringifyJson(x)).join('\n') + (items.length ? '\n' : '');
    // Completion metadata is retained in the returned data envelope.
  } else text = `${stringifyJson(result,2)}\n`;
  if (output) { inspectResult(result); await writeOutputFile(resolve(output), text); return {data: {saved: resolve(output), ...(format === 'jsonl' ? {pagination: Object.fromEntries(Object.entries(result as object).filter(([key]) => key !== 'items'))} : {})}}; }
  return {data: result};
}

function numberFlag(value?: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new InputError('Pagination/image values must be nonnegative integers.');
  return Number(value);
}
async function saveTranscript(data: ImageTranscript, output: string, format: 'text' | 'json'): Promise<void> {
  if (format === 'text' && !data.available) throw new Error(`${transcriptUnavailable(data)} No output file was saved.`);
  const file = resolve(output), metadata = `${file}.json`, temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), {recursive: true, mode: 0o700});
  try {
    await writeFile(temporary, format === 'text' ? `${data.text}\n` : `${stringifyJson(data, 2)}\n`, { flag: 'wx', mode: 0o600 });
    if (format === 'json') {await link(temporary, file); return;}
    await writeFile(`${temporary}.json`, `${stringifyJson(data, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await link(`${temporary}.json`, metadata);
    try { await link(temporary, file); } catch (error) { await rm(metadata, { force: true }); throw error; }
  } finally { await rm(temporary, { force: true }); await rm(`${temporary}.json`, { force: true }); }
}

function transcriptUnavailable(data: ImageTranscript): string {
  return data.unavailableReason==='indexed-records-only'
    ? 'No machine transcript is available: the service returned indexed records only. Use familysearch.record get for indexed person data, or download the image.'
    : 'No machine transcript is available for this image.';
}
