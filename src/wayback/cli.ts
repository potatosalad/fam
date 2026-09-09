import {parseArgs} from 'node:util';
import {WaybackClient} from './client.js';
import type {FetchFormat} from '../shared/browser-fetch.js';

export async function runProvider(argv: string[]): Promise<unknown> {
  const {values:v, positionals:[command,url]} = parseArgs({args:argv, allowPositionals:true, options:{
    date:{type:'string'}, from:{type:'string'}, to:{type:'string'}, limit:{type:'string'},
    format:{type:'string'}, timeout:{type:'string'}, open:{type:'string'}, json:{type:'boolean'},
  }});
  const client = new WaybackClient({timeout:v.timeout === undefined ? undefined : Number(v.timeout), open:v.open as 'auto'|'always'|'never'|undefined});
  if (command === 'find') return client.find(url, v.date);
  if (command === 'list') return client.list(url, {from:v.from, to:v.to, limit:v.limit === undefined ? undefined : Number(v.limit)});
  if (command === 'fetch') {
    const result = await client.fetch(url, {date:v.date, format:v.json ? 'json' : v.format as FetchFormat|undefined});
    if (!v.json && v.format !== 'json') process.stderr.write(`Archived capture: ${result.snapshot.archiveUrl}\n`);
    return result;
  }
  throw new Error('Unknown Wayback command.');
}
