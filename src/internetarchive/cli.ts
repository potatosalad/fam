import {parseArgs} from 'node:util';
import {InternetArchiveClient} from './client.js';

export async function runProvider(argv: string[]): Promise<unknown> {
  const {values: v, positionals: [command, arg]} = parseArgs({args: argv, allowPositionals: true, options: {
    query: {type: 'string'}, limit: {type: 'string'}, page: {type: 'string'}, offset: {type: 'string'},
    count: {type: 'string'}, cursor: {type: 'string'}, field: {type: 'string', multiple: true}, sort: {type: 'string', multiple: true},
    'file-format': {type: 'string'}, name: {type: 'string'}, source: {type: 'string'}, file: {type: 'string'},
    timeout: {type: 'string'}, 'max-bytes': {type: 'string'}, 'user-agent-suffix': {type: 'string'}, out: {type: 'string'},
    volume: {type: 'string'}, leaf: {type: 'string'}, 'page-label': {type: 'string'}, scale: {type: 'string'},
    book: {type: 'string', multiple: true}, term: {type: 'string', multiple: true}, refresh: {type: 'boolean'}, fuzzy: {type: 'boolean'},
  }});
  const number = (value?: string) => value === undefined ? undefined : Number(value);
  const client = new InternetArchiveClient({timeout: number(v.timeout), userAgentSuffix: v['user-agent-suffix']});
  const paging = {limit: number(v.limit), page: number(v.page), fields: v.field, sort: v.sort};
  const book = {volume: v.volume}, slice = {limit: number(v.limit), offset: number(v.offset)};
  const selected = {...book, page: number(v.page), leaf: number(v.leaf), pageLabel: v['page-label']};
  const image = {...selected, scale: number(v.scale), maxBytes: number(v['max-bytes'])};
  if (command === 'book-list') return client.books.list(arg);
  if (command === 'book-get') return client.books.get(arg, book);
  if (command === 'book-search') return client.books.search(arg, v.query!, {...book, ...slice});
  if (command === 'page-list') return client.books.pages(arg, {...book, ...slice});
  if (command === 'page-get') return client.books.page(arg, selected);
  if (command === 'page-ocr') return client.books.ocr(arg, selected);
  if (command === 'page-download') return client.books.download(arg, v.out!, image);
  if (command === 'citation') return client.books.citation(arg, selected);
  if (command === 'evidence') return client.books.evidence(arg, v.out!, image);
  if (command === 'research-cache') return client.research.cache(v.book!, {refresh: v.refresh, maxBytes: number(v['max-bytes'])});
  if (command === 'research-search') return client.research.search(v.book!, v.term!, {...slice, fuzzy: v.fuzzy});
  if (command === 'search') return client.search(arg, paging);
  if (command === 'scan') return client.scan(arg, {count: number(v.count), cursor: v.cursor, fields: v.field, sort: v.sort});
  if (command === 'collection') return client.collection(arg, v.query, paging);
  if (command === 'fulltext') return client.fulltext(arg, {limit: number(v.limit), offset: number(v.offset)});
  if (command === 'item') return client.item(arg);
  if (command === 'files') return client.files(arg, {format: v['file-format'], name: v.name, source: v.source});
  if (command === 'text') return client.text(arg, {file: v.file, limit: number(v.limit), offset: number(v.offset), maxBytes: number(v['max-bytes'])});
  if (command === 'download') return client.download(arg, v.file!, v.out!, {maxBytes: number(v['max-bytes'])});
  throw new Error('Unknown Internet Archive command.');
}
