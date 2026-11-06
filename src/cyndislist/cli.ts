import {writeOutputFile} from '../shared/storage.js';
import {inspectResult} from '../shared/diagnostics.js';
import {parseArgs} from 'node:util';
import {CyndisListClient} from './client.js';
import {search} from './search.js';

export async function runProvider(argv: string[]): Promise<unknown> {
  const {values: v, positionals: [command, arg]} = parseArgs({args: argv, allowPositionals: true, options: {
    depth: {type: 'string'}, cursor: {type: 'string'}, 'all-pages': {type: 'boolean'}, refresh: {type: 'boolean'}, out: {type: 'string'},
  }});
  const client = new CyndisListClient();
  const options = {depth: v.depth === undefined ? 0 : Number(v.depth), allPages: v['all-pages'], refresh: v.refresh};
  let result: unknown;
  if (command === 'category-list') result = await client.categories(arg, v.refresh);
  else if (command === 'category-get' || command === 'page') result = await client.read(arg, options);
  else if (command === 'resolve') result = await client.resolve(arg, v.refresh);
  else if (command === 'search') result = await search(arg, {allPages: v['all-pages'], cursor: v.cursor});
  else throw new Error('Unknown Cyndi’s List command.');
  if (v.out) inspectResult(result);
  if (v.out) {
    await writeOutputFile(v.out, JSON.stringify(result, null, 2) + '\n');
    return {saved: v.out};
  }
  return result;
}
