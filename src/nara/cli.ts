import {parseArgs} from 'node:util';
import {NaraClient} from './client.js';
import type {SearchOptions} from './url.js';

export async function runProvider(argv: string[]): Promise<unknown> {
  const {values: v, positionals: [command, arg]} = parseArgs({args: argv, allowPositionals: true, options: {
    page: {type: 'string'}, limit: {type: 'string'}, sort: {type: 'string'}, 'available-online': {type: 'boolean'},
    timeout: {type: 'string'}, 'max-bytes': {type: 'string'}, out: {type: 'string'},
  }});
  const number = (value?: string) => value === undefined ? undefined : Number(value);
  const client = new NaraClient({timeout: number(v.timeout)});
  if (command === 'search') return client.search(arg, {page: number(v.page), limit: number(v.limit), availableOnline: v['available-online'], sort: v.sort as SearchOptions['sort']});
  if (command === 'record') return client.record(arg);
  if (command === 'objects') return client.objects(arg);
  if (command === 'object') return client.object(arg, number(v.page));
  if (command === 'transcription') return client.object(arg, number(v.page), true);
  if (command === 'download') return client.download(arg, v.out!, {page: number(v.page), maxBytes: number(v['max-bytes'])});
  throw new Error('Unknown NARA command.');
}
