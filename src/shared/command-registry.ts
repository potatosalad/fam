/** The public CLI contract. Provider bindings are implementation details, not CLI aliases. */
/** Provider namespaces and commands: FamilySearch first, then alphabetical. */
export function compareCliNames(a: string, b: string): number {
  const familysearch = (name: string) => /^familysearch(?:[. /]|$)/.test(name);
  return Number(familysearch(b)) - Number(familysearch(a)) || (a < b ? -1 : a > b ? 1 : 0);
}
export const providerNames = ['familysearch', 'americanancestors', 'ancestry', 'cyndislist', 'findagrave', 'findmypast', 'geneanet', 'myheritage', 'newspaperarchive', 'newspapers', 'storied', 'wayback'] as const;
export const authenticatedProviderNames = providerNames.filter((name): name is Exclude<typeof providerNames[number], 'cyndislist'|'wayback'> => name !== 'cyndislist' && name !== 'wayback');
export const providerInfo: Record<string, {name: string; description: string}> = {
  familysearch: {name: 'FamilySearch', description: 'Trees, records, images, and full-text research.'},
  americanancestors: {name: 'American Ancestors', description: 'Genealogy databases, records, citations, and scans.'},
  ancestry: {name: 'Ancestry', description: 'Trees, people, records, hints, and media.'},
  cli: {name: 'CLI', description: 'Command discovery, setup, history, and health checks.'},
  cyndislist: {name: 'Cyndi’s List', description: 'Genealogy resource browsing and site search.'},
  findagrave: {name: 'Find a Grave', description: 'Memorials, cemeteries, biographies, and photos.'},
  findmypast: {name: 'Findmypast', description: 'Trees, records, newspapers, and images.'},
  geneanet: {name: 'Geneanet', description: 'Archives, trees, portraits, registers, and books.'},
  myheritage: {name: 'MyHeritage', description: 'Family sites, trees, records, matches, and documents.'},
  newspaperarchive: {name: 'NewspaperArchive', description: 'Newspaper search, publications, locations, and OCR.'},
  newspapers: {name: 'Newspapers.com', description: 'Newspaper search, publications, clippings, and OCR.'},
  storied: {name: 'Storied', description: 'Trees, stories, media, hints, and records.'},
  wayback: {name: 'Wayback Machine', description: 'Archived web pages from the Internet Archive.'},
};
export const namespaceNames = Object.keys(providerInfo).sort(compareCliNames);
export type Provider = typeof providerNames[number];
/** Shared object descriptions used by provider help and command correction. */
export const objectDescriptions: Record<string, string> = {
  category: 'Genealogy directory categories and their nested resource listings.',
  resource: 'Genealogy resource links and directory search.',
  browser: 'Persistent local or remote CloakBrowser/Camofox browser and login viewer.',
  'browser.transport': 'Remembered website decisions for automatic HTTP/browser transport.',
  account: 'Account profiles and current user information.', album: 'Photo albums and their contents.',
  api: 'Provider API catalogs, contracts, and operation execution.',
  'api.enum': 'Enumerated values from provider API contracts.', 'api.gql': 'Cataloged and custom GraphQL operations.',
  'api.http-site': 'Provider website HTTP endpoints.', 'api.model': 'Provider API data models.', 'api.route': 'Provider API routes.',
  cemetery: 'Cemeteries and burial locations.', 'cemetery.virtual': 'Virtual cemetery collections.',
  collection: 'Historical record collections and catalogs.', command: 'Command discovery and inspection.',
  completion: 'Shell completion scripts and setup.', context: 'Resolve provider URLs into command parameters.',
  contributor: 'Contributor profiles and contributions.', credential: 'Saved login credentials and synchronization.',
  document: 'Source documents and document pages.', family: 'Family groups and relationships.', feed: 'Activity feeds.',
  doc: 'Read and search installed CLI and provider guides.',
  film: 'Digitized films and their images.', fulltext: 'Full-text historical record research.', group: 'Groups and membership.',
  health: 'Provider authentication and access checks.', hint: 'Suggested records and research hints.',
  history: 'Recent CLI calls, diagnostics, and failure trends from the active profile.',
  'history.failures': 'Soft and hard failures recorded in CLI history.',
  image: 'Document images, downloads, and transcriptions.', library: 'Books and archival library material.',
  location: 'Geographic locations and location lookup.', media: 'Linked photographs and other media.',
  memorial: 'Memorials, biographies, relatives, and photographs.', 'mobile.version': 'Mobile application version information.',
  newspaper: 'Historical newspaper research.', notification: 'Account notifications.', person: 'People and genealogy profiles.',
  page: 'Website or newspaper pages, source citations, and extracted text.', publication: 'Newspaper titles and publication locations.',
  'person.mobile': 'Person information through mobile API operations.', photo: 'Photographs and photo metadata.',
  'photo.request': 'Grave photograph requests.', place: 'Place names and geographic information.',
  provider: 'Available genealogy providers.', record: 'Historical records and record search.',
  register: 'Digitized archival registers.', session: 'Sign-in, saved sessions, and access verification.',
  snapshot: 'Archived website captures and their dates.',
  'session.metadata': 'Saved session metadata.', site: 'Family sites and site membership.',
  story: 'Family stories and their contents.', subscription: 'Account subscription information.', tag: 'Tags and tagged content.',
  tree: 'Family trees and their contents.', version: 'Installed CLI version.', update: 'Update the installed CLI from Git or npm.',
};
export interface Flag {
  name: string;
  type: 'string' | 'boolean' | 'integer' | 'number';
  description: string;
  required: boolean;
  multiple?: boolean;
  default?: string | number | boolean;
  choices?: string[];
  minimum?: number;
  maximum?: number;
  file?: boolean;
  sensitive?: boolean;
  /** Option name accepted by the provider adapter; false means handled centrally. */
  binding?: string | false;
}
export interface Command {
  id: string;
  provider: Provider | 'cli';
  object: string;
  action: string;
  description: string;
  examples: string[];
  flags: Flag[];
  outputSchema: Record<string, unknown>;
  schemaMode: 'advisory';
  confirmationRequirement: 'none';
  risk: {level: 'read' | 'local' | 'write' | 'operation-dependent'; description: string};
  pagination?: {mode: 'provider'; description: string};
  binding: {command: string[]; positionals: string[]};
}

const descriptions: Record<string, string> = {
  out: 'Destination file. JSON uses private permissions; downloads retain their source/checksum sidecars.',
  input: 'Additional input as inline JSON, a JSON file, or - for stdin (see the operation schema).',
  variables: 'GraphQL variables as inline JSON, a JSON file, or - for stdin.',
  document: 'File containing a custom GraphQL document.',
  operation: 'Exact operation name or ID from this provider’s API catalog.',
  query: 'Additional provider query input; use the provider API schema for field names.',
  filter: 'Filter the catalog, or a provider-native search expression where documented.',
  path: 'Provider API path or approved URL. Existing origin restrictions apply.',
  url: 'Provider record, document, or viewer URL.',
  stdin: 'Read a username/password JSON object from stdin without echoing credentials.',
  anonymous: 'Use public access without loading a saved provider session.',
  har: 'Import a signed-in browser HAR file.', capture: 'Open a browser and capture/import a validated session.',
  'browser-channel': 'Browser used for sign-in or capture.', 'capture-timeout': 'Browser capture timeout in seconds.',
  'tree-url': 'MyHeritage family tree URL to capture.', browser: 'Start browser authorization (PKCE).',
  'callback-file': 'File containing the completed browser authorization callback URL.',
  interactive: 'Autofill configured credentials and wait for you to submit in the browser.',
  'no-autofill': 'Leave login fields untouched and disable automatic credential submission.',
  code: 'Account verification code.', 'verification-code': 'Native account verification code.',
  'send-code': 'Send the pending account verification email.',
  'recaptcha-token-file': 'File containing a native sign-in verification token.',
  limit: 'Provider page size or result limit; existing provider semantics apply.', offset: 'Zero-based provider result offset.',
  page: 'One-based provider result or document page.', cursor: 'Opaque continuation token from the provider.',
  after: 'MyHeritage continuation within a split result page; preserve the original offset.',
  count: 'FamilySearch page size.', all: 'Follow all available pages, subject to an explicit --limit.',
  resume: 'FamilySearch continuation URL from an earlier response.',
  depth: 'Number of pedigree generations.', generations: 'Number of pedigree generations.',
  original: 'Download the original full-resolution distribution image.',
  image: 'One-based image number in the film.', dgs: 'FamilySearch digital film (DGS) number.',
  ark: 'FamilySearch image or indexed-record ARK, including its 3:1: or 1:1: prefix.',
  related: 'Include related record and person leads.', 'related-document': 'Related document key from the viewer manifest.',
  'match-status': 'Provider record match status, for example confirmed.',
  field: 'Collection-specific NAME=VALUE criterion; repeatable and accepts JSON values.',
  'no-translations': 'Disable translated-name matching.',
  'first-name-match': 'Provider given-name matching mode.', 'last-name-match': 'Provider surname matching mode.',
  'record-type': 'MyHeritage historical, family-trees, or all; scoped searches have their own semantics.',
  'with-images': 'Only results with images.', images: 'Only catalog collections with images.',
  'from-page': 'First register image page, inclusive.', 'to-page': 'Last register image page, inclusive; maximum 100 pages.',
  index: 'Geneanet person index within a tree.', occurrence: 'Geneanet occurrence number when resolving a name.',
  exact: 'Use the provider’s exact-match search behavior.', descending: 'Sort in descending order.',
  'include-maiden-name': 'Include maiden names in memorial matching.', 'include-nickname': 'Include nicknames in memorial matching.',
  similar: 'Include similar memorial names.', 'has-gps': 'Only memorials with GPS coordinates.',
  famous: 'Only famous memorials.', veteran: 'Only veteran memorials.',
  'birth-filter': 'Birth date comparison.', 'death-filter': 'Death date comparison.',
  bio: 'Keywords in the memorial biography.', relative: 'Relative’s name.', plot: 'Burial plot text.',
  base: 'Explicit, evidenced API base for a catalog route; origin restrictions still apply.',
  example: 'Return a schema-derived input example instead of the API contract.',
  json: 'Emit structured JSON instead of readable text, including errors.', 'dry-run': 'Validate CLI flags and show the invocation without executing the provider or writing files.',
  help: 'Show this command’s generated usage and flags.',
};
const booleans = new Set('native stdin anonymous capture browser interactive no-autofill send-code all original related no-translations exact images with-images descending include-maiden-name include-nickname similar has-gps famous veteran example json dry-run help offline live verbose'.split(' '));
const integers = new Set('limit offset page count depth generations image capture-timeout birth-year death-year residence-year marriage-year year year-range birth-year-range death-year-range residence-year-range marriage-year-range from-page to-page occurrence'.split(' '));
const files = new Set('out input variables document har callback-file recaptcha-token-file'.split(' '));
const options: Record<string, Partial<Flag>> = {
  limit: {default: 20, minimum: 1}, offset: {default: 0, minimum: 0}, page: {default: 1, minimum: 1},
  count: {default: 100, minimum: 1, maximum: 1000}, depth: {default: 2, minimum: 1},
  generations: {default: 4, minimum: 1, maximum: 8}, 'capture-timeout': {minimum: 0, maximum: 3600},
  'browser-channel': {choices: ['camofox', 'chrome', 'msedge', 'chromium']},
  gender: {choices: ['M', 'F']},
  'first-name-match': {choices: ['exact', 'similar', 'initials', 'prefix']},
  'last-name-match': {choices: ['exact', 'similar', 'soundex', 'metaphone', 'prefix']},
  'birth-filter': {choices: ['exact', 'before', 'after', 'unknown']},
  'death-filter': {choices: ['exact', 'before', 'after', 'unknown']},
  'record-type': {choices: ['historical', 'family-trees', 'all']},
  code: {sensitive: true}, 'verification-code': {sensitive: true},
  latitude: {type: 'number', minimum: -90, maximum: 90}, longitude: {type: 'number', minimum: -180, maximum: 180},
  distance: {type: 'integer', minimum: 1},
  'dry-run': {binding: false}, json: {binding: false}, help: {binding: false},
};
function flag(name: string, override: Partial<Flag> = {}): Flag {
  return {name, type: booleans.has(name) ? 'boolean' : integers.has(name) ? 'integer' : 'string',
    description: descriptions[name] ?? `${name.replaceAll('-', ' ')}${name.endsWith('-id') ? ' (opaque provider ID; kept as a string)' : ' criterion or provider value'}.`,
    required: false, ...(booleans.has(name) ? {default: false} : {}), ...(files.has(name) ? {file: true} : {}),
    ...options[name], ...override};
}
type Extras = {flags?: Record<string, Partial<Flag>>; pagination?: string; risk?: Command['risk']; examples?: string[]; outputSchema?: Record<string, unknown>};
const registry: Command[] = [];
function add(provider: Command['provider'], legacy: string, objectAction: string, description: string,
  positional: string[] = [], names = '', extra: Extras = {}) {
  const [object, action] = objectAction.split(' ');
  const positionals = positional.map(name => name.replace(/^\?/, ''));
  const flagList = [...(provider !== 'cli' ? [flag('transport', {choices: ['auto','http','browser'], binding: false, description: 'Override automatic HTTP/browser transport for this command.'}), flag('browser-timeout', {type: 'integer', minimum: 0, maximum: 3600, binding: false, description: 'Override the wait for browser verification, in seconds.'})] : []), ...positional.map(name => flag(name.replace(/^\?/, ''), {required: !name.startsWith('?')})),
    ...names.split(' ').filter(Boolean).map(name => flag(name)),
    ...['out', 'json', 'dry-run', 'help'].filter(name => !names.split(' ').includes(name) && !positionals.includes(name)).map(name => flag(name))];
  for (const f of flagList) Object.assign(f, extra.flags?.[f.name]);
  const cmd: Command = {id: `${provider}.${object} ${action}`, provider, object, action, description,
    flags: flagList, examples: [], schemaMode: 'advisory', confirmationRequirement: 'none',
    outputSchema: extra.outputSchema ?? {description: 'Provider data, preserved without response validation. Fields and shapes may change.', type: ['object', 'array'], additionalProperties: true},
    risk: extra.risk ?? {level: 'read', description: 'Reads provider data. Existing session renewal and an explicit --out may write local files.'},
    ...(extra.pagination ? {pagination: {mode: 'provider' as const, description: extra.pagination}} : {}),
    binding: {command: legacy.split(' '), positionals}};
  cmd.examples = extra.examples ?? [syntax(cmd)];
  registry.push(cmd);
}
export function syntax(command: Command): string {
  return `fam ${command.id}${command.flags.filter(f => f.required).map(f => ` --${f.name}${f.type === 'boolean' ? '' : ` <${f.name.toUpperCase().replaceAll('-', '_')}>`}`).join('')}`;
}
const local: Command['risk'] = {level: 'local', description: 'Local metadata or catalog; no provider requests.'};
const login: Command['risk'] = {level: 'write', description: 'Signs in or renews authentication and saves private credentials/session state. May initiate account verification.'};
const api: Command['risk'] = {level: 'operation-dependent', description: 'Executes the selected operation immediately, including writes, deletes, and possible credit purchases. Inspect the provider API contract. HTTP GET and GraphQL query do not guarantee absence of side effects.'};
const paging = 'Returns the existing provider page or subset. Provider continuation fields and totals remain in data; an absent continuation field does not prove completeness.';
const names = 'first-name last-name birth-year death-year';
const page = 'limit offset';
const commonRead = 'query';

for (const provider of authenticatedProviderNames) {
  add(provider, 'credentials', 'credential set', 'Save login credentials from helper, environment, prompt, or JSON stdin.', [], 'stdin', {risk: {level: 'local', description: 'Writes private credentials and may invoke the configured credential sync helper.'}});
  add(provider, 'sync', 'credential sync', 'Run the explicitly configured credential synchronization helper.', [], '', {risk: {level: 'write', description: 'Invokes the user-configured synchronization helper, which may contact another host.'}});
  const auth = provider === 'ancestry' ? 'send-code code' : provider === 'myheritage' ? 'interactive no-autofill native capture har code verification-code recaptcha-token-file browser-channel capture-timeout tree-url'
    : provider === 'findmypast' ? 'interactive no-autofill native capture har browser callback-file browser-channel capture-timeout region' : provider === 'newspapers' ? 'interactive no-autofill' : ['storied', 'newspaperarchive'].includes(provider) ? 'interactive no-autofill browser-channel' : '';
  add(provider, 'auth', 'session login', 'Sign in and save a session; use the provider-specific authentication options.', [], auth, {risk: login, flags: provider === 'findmypast' ? {region: {choices: ['com', 'co.uk']}} : undefined});
  add(provider, 'status', 'session get', 'Inspect saved session metadata without tokens or live authentication.', [], '', {risk: local});
  if (['familysearch', 'ancestry', 'myheritage', 'findmypast', 'storied', 'newspaperarchive', 'newspapers'].includes(provider)) add(provider, 'refresh', 'session refresh', 'Renew and save the existing provider session.', [], '', {risk: login});
  if (['familysearch', 'findagrave', 'geneanet', 'storied', 'newspaperarchive', 'newspapers', 'americanancestors'].includes(provider)) add(provider, 'verify', 'session verify', 'Verify saved account access with the existing provider smoke check.');
  if (provider !== 'ancestry') add(provider, provider === 'familysearch' ? 'whoami' : 'me', 'account get', 'Read the current account profile and available tree context.', [], provider === 'myheritage' ? 'query' : '');
  add(provider, 'ops', 'api list', 'List and filter the provider’s known API operations and aliases.', ['?filter'], '', {risk: local,
    ...(provider === 'familysearch' ? {examples: ['fam familysearch.api list', 'fam familysearch.api list --filter memories', 'fam familysearch.api list --filter "duplicate people"']} : {})});
  add(provider, 'schema', 'api describe', 'Inspect the contract, inputs, response information, and availability of one provider API operation.', ['operation'], provider === 'familysearch' ? 'example' : '', {risk: local});
  if (!['familysearch', 'geneanet', 'storied', 'newspaperarchive', 'newspapers', 'americanancestors'].includes(provider)) {
    add(provider, 'gql', 'api.gql query', 'Execute a cataloged GraphQL query or mutation with variables.', ['operation', '?variables'], '', {risk: api});
    if (provider !== 'ancestry') add(provider, 'query', 'api.gql execute', 'Execute a custom GraphQL document from a file.', ['document', '?variables'], '', {risk: api});
  }
  if (!['geneanet', 'newspaperarchive', 'newspapers', 'americanancestors'].includes(provider)) add(provider, 'call', 'api call', provider === 'familysearch'
    ? 'Execute genealogy operations for memories, people, relationships, sources, hints, groups, history, and ordinances. Add --operation NAME --help to inspect inputs, outputs, and effects.'
    : 'Execute a cataloged API operation using its native path, query, headers, and body schema.',
    provider === 'familysearch' ? ['operation'] : ['operation', '?input'], provider === 'familysearch' ? 'input query' : provider === 'ancestry' ? 'query base' : ['myheritage', 'findmypast'].includes(provider) ? 'query' : '',
    {risk: api, flags: provider === 'familysearch' ? {input: {description: 'JSON input file or - for stdin.'}, query: {multiple: true, description: 'Typed key=value query binding; repeatable.'}} : undefined});
  if (['familysearch', 'ancestry', 'myheritage', 'findmypast'].includes(provider)) add(provider, 'get', 'api get', 'GET an approved provider API path or URL.', ['path'], provider === 'familysearch' ? '' : 'query', {risk: api});
  if (['myheritage', 'findmypast', 'findagrave', 'storied'].includes(provider)) add(provider, 'models', 'api.model list', 'List and filter recovered provider model fields.', ['?filter'], '', {risk: local});
}

add('newspapers','call','api call','Execute a documented Newspapers read operation. Authorization tokens are managed internally.', ['operation','?input']);
add('newspapers','search','newspaper search','Search newspaper pages or indexed births, marriages, obituaries, enslavement records, and crime articles.', [], 'type keyword publication-id country region city from to sort limit cursor', {pagination:'One page per request. Pass nextCursor verbatim as --cursor with the same filters and record type.',flags:{type:{choices:['page','obituary','marriage','birth','enslavement','crime'],default:'page'},limit:{type:'integer',minimum:1,maximum:100,default:20},sort:{choices:['score','date-asc','date-desc']}}});
add('newspapers','article','article get','Read one indexed article, including extracted people, relationships, crop coordinates, and citation.', ['page-id','article-id'], 'type', {flags:{'article-id':{description:'Exact article ID from a search result (normally a UUID).'},type:{choices:['obituary','marriage','birth','enslavement','crime']}}});
add('newspapers','article-download','article download','Save an indexed article crop as JPG with its extracted details and citation sidecar.', ['page-id','article-id'], 'type', {flags:{'article-id':{description:'Exact article ID from a search result (normally a UUID).'},type:{choices:['obituary','marriage','birth','enslavement','crime']},out:{required:true,description:'Destination JPG file; also writes a citation and article details sidecar.'}}});
add('newspapers','clipping-search','clipping search','Search public clippings, a user’s public clippings, or your own saved clippings with --mine.', [], 'keyword user mine tag region publication-id from to sort limit cursor', {pagination:'Pass nextCursor as --cursor with the same filters; an absent cursor means the end.',flags:{mine:{type:'boolean',description:'Search your own public and private clippings; requires a verified account and cannot be combined with --user.'},user:{description:'Clipping creator’s username or decimal ID.'},tag:{description:'Clipping tag to match.'},region:{description:'Place name, such as Chicago, Illinois (clipping search uses place names).'},sort:{choices:['modified-desc','modified-asc','date-desc','date-asc','score']},limit:{type:'integer',minimum:1,maximum:100,default:24}}});
add('newspapers','clipping','clipping get','Read a clipping’s title, notes, tags, selection coordinates, and available OCR.', ['clipping-id']);
add('newspapers','clipping-download','clipping download','Save a clipping as JPG with its details and citation sidecar, subject to current page download permission.', ['clipping-id'], '', {flags:{out:{required:true,description:'Destination JPG file; also writes a citation and clipping details sidecar.'}}});
add('newspapers','locations','location search','Suggest places for newspaper search.', ['prefix'], 'limit');
add('newspapers','browse','publication browse','Browse newspaper places and titles using returned paths.', ['?path']);
add('newspapers','publication','publication get','Resolve a newspaper title and browse path.', ['publication-id']);
add('newspapers','issue','publication.issue get','List editions and pages for one publication date.', ['publication-id','date']);
add('newspapers','page','page get','Read page metadata, citation fields, and current account access rights.', ['page-id']);
add('newspapers','download','page download','Save a whole-page JPG export and citation sidecar using current download permission. Existing files are not overwritten.', ['page-id'], '', {flags:{out:{required:true,description:'Destination JPG file; also writes FILE.jpg.json with citation, dimensions, and checksum.'}}});
add('newspapers','hits','page.hits get','Locate keyword matches in scan coordinates.', ['page-id'], 'keyword', {flags:{keyword:{required:true}}});
add('newspapers','clippings','page.clipping list','List public clippings on a newspaper page.', ['page-id'], 'offset limit', {pagination:'Use nextOffset to continue; one page per request.'});
add('newspapers','articles','page.article list','Read structured article categories for an accessible page.', ['page-id']);
add('newspapers','ocr','page.ocr get','Read page OCR, a clipping, an indexed article, or a rectangle; article IDs resolve coordinates automatically.', ['page-id'], 'article-id type clipping-id x y width height', {flags:{'article-id':{description:'Article UUID or decimal ID; omit coordinates to resolve its indexed rectangle automatically.'},type:{choices:['obituary','marriage','birth','enslavement','crime'],description:'Article category when resolving an article ID.'}}});

const cyndiFlags: Extras['flags'] = {
  'all-pages': {type: 'boolean', default: false, description: 'Follow available pagination from the requested page onward.'},
  refresh: {type: 'boolean', default: false, description: 'Refresh the category update index and requested pages; saved copies remain available if requests fail.'},
  depth: {type: 'integer', default: 0, minimum: 0, maximum: 20, description: 'Levels of child category pages to fetch. Zero reads this page and lists its children; one also reads those children. Related categories are not traversed.'},
  url: {description: 'Any absolute Cyndi’s List URL; HTTP/non-www aliases are normalized.'},
};
const cyndiPaging = 'One page by default. --all-pages follows available pagination; nextUrl allows continuation. --depth expands child categories with their resources; pagination does not increase depth. Partial failures and completeness are explicit.';
add('cyndislist', 'category-list', 'category list', 'Read the category index, including link counts and published update dates; optionally filter category names.', ['?filter'], 'refresh', {flags: {...cyndiFlags, filter: {description: 'Case-insensitive words to match in category names.'}}});
add('cyndislist', 'category-get', 'category get', 'Read a category and optionally expand its child categories and resource listings.', ['url'], 'depth all-pages refresh', {flags: cyndiFlags, pagination: cyndiPaging});
add('cyndislist', 'page', 'page get', 'Best-effort reading of any Cyndi’s List page, including text, links, categories, listings, and redirect destinations.', ['url'], 'all-pages refresh', {flags: cyndiFlags, pagination: cyndiPaging});
add('cyndislist', 'resolve', 'resource resolve', 'Resolve a selected Cyndi link to its external destination without fetching that destination.', ['url'], 'refresh', {flags: cyndiFlags});
add('cyndislist', 'search', 'resource search', 'Search Cyndi’s List.', ['query'], 'all-pages cursor', {flags: {...cyndiFlags,
  query: {description: 'Site search keywords or search operators.'},
  cursor: {description: 'Exact continuation URL returned by this same site search.'},
  transport: {choices: ['auto','browser'], description: 'Site search uses the configured browser.'}},
  pagination: 'One results page by default. --all-pages follows available next-page links; --cursor continues the same query. Challenges and partial failures are explicit.',
  examples: ['fam cyndislist.resource search --query "New Zealand probate" --json']});

const waybackFlags: Extras['flags'] = {
  url: {description: 'Original HTTP(S) URL or a full web.archive.org snapshot URL.'},
  date: {description: 'Find the capture closest to YYYY, YYYY-MM-DD, or YYYYMMDDhhmmss. Default: newest indexed HTTP 200 capture.'},
  from: {description: 'Earliest capture date, inclusive: YYYY, YYYY-MM-DD, or YYYYMMDDhhmmss.'},
  to: {description: 'Latest capture date, inclusive: YYYY, YYYY-MM-DD, or YYYYMMDDhhmmss.'},
  limit: {default:20, maximum:1000, description:'Maximum captures to return, oldest first.'},
  timeout: {type:'integer', default:60, minimum:1, maximum:3600, description:'Archive request timeout in seconds.'},
  open: {choices:['auto','always','never'], default:'auto', description:'Viewer policy: auto = open when archive verification needs help; always = use Camofox and open immediately; never = do not open the viewer.'},
  format: {choices:['raw','html','text','markdown','json'], default:'text', description:'Original archived bytes/HTML, extracted text or Markdown, or JSON with capture provenance and content.'},
  out: {binding:false, description:'Save the selected output format to this file.'},
  json: {binding:'json'},
};
add('wayback', 'find', 'snapshot find', 'Find the newest indexed archived copy of a URL, or the capture closest to a date.', ['url'], 'date timeout open', {flags:waybackFlags,
  examples:['fam wayback.snapshot find --url https://example.org/', 'fam wayback.snapshot find --url https://example.org/ --date 2015-01-01 --json']});
add('wayback', 'list', 'snapshot list', 'List successful archived captures of a URL, oldest first, with dates and replay links.', ['url'], 'from to limit timeout open', {flags:waybackFlags,
  examples:['fam wayback.snapshot list --url https://example.org/ --from 2010 --to 2015 --limit 20']});
add('wayback', 'fetch', 'page fetch', 'Find and fetch an archived page without the Wayback toolbar, with text, Markdown, HTML, raw bytes, or JSON output.', ['url'], 'date format timeout open', {flags:waybackFlags,
  examples:['fam wayback.page fetch --url https://example.org/ --format markdown', 'fam wayback.page fetch --url https://example.org/ --date 2015 --format html --out archived.html']});

add('americanancestors', 'collections', 'collection list', 'Browse database titles and research categories.', ['?filter'], 'anonymous');
add('americanancestors', 'collection', 'collection get', 'Read collection volumes, search fields, and research guidance.', ['name'], 'anonymous');
const aaSearchFlags = 'first-name last-name keywords location from-year to-year collection category project record-type volume-id page-name exact soundex free images page family field';
const aaSearchOptions: Extras['flags'] = {soundex:{type:'boolean',default:false},free:{type:'boolean',default:false},'record-type':{choices:undefined,description:'Record type returned by americanancestors.collection list.'},images:{type:'boolean',description:'Restrict results to records with images.'},'from-year':{description:'Four-digit lower year bound.'},'to-year':{description:'Four-digit upper year bound.'},family:{multiple:true,description:'Family member JSON with relationship (Any, Father, Mother, Spouse) and firstName/lastName; repeat up to three times.'},field:{multiple:true,description:'Collection-specific NAME=VALUE or ID=VALUE; validated against collection get fieldSchema. Repeat for multiple criteria.'}};
add('americanancestors', 'search', 'record search', 'Search indexed genealogy records by name, place, year, and collection.', [], `${aaSearchFlags} anonymous`, {
  pagination: 'One provider page per request, 50 records per page observed. Follow nextPage with the same filters. No automatic pagination.',
  flags: aaSearchOptions,
  examples: ['fam americanancestors.record search --first-name John --last-name Adams --from-year 1730 --to-year 1740 --collection "Massachusetts: Vital Records, 1620-1850"'],
});
add('americanancestors', 'volumes', 'collection volumes', 'List collection volumes and browse links, optionally filtering titles.', ['name'], 'filter anonymous');
add('americanancestors', 'browse', 'collection browse', 'Open the first page or an exact page label within a collection volume.', ['name'], 'volume-id page-name', {flags:{'volume-id':{required:true}}});
add('americanancestors', 'pages', 'image list', 'Walk a bounded sequence of published pages with citations and next-page URLs.', ['url'], 'limit', {flags:{limit:{default:10,maximum:100}},pagination:'Follows provider page labels, never arithmetic page numbers. Continue using nextUrl.'});
add('americanancestors', 'export', 'record export', 'Save bounded search results and optional record details with an atomic resume checkpoint.', [], `${aaSearchFlags} limit resume details`, {flags:{...aaSearchOptions,limit:{required:true,default:undefined,maximum:1000,description:'Maximum additional records to save this run; hard cap 10,000 per export.'},resume:{file:true,description:'Existing export JSON to continue with its saved filters and details setting.'},details:{type:'boolean',description:'Include indexed record fields and source citations; adds one record lookup per result.'}},pagination:'Explicit --limit per run. --resume continues the same private export file. Changed result pages halt continuation.',examples:['fam americanancestors.record export --last-name Adams --details --limit 10 --out research.json','fam americanancestors.record export --resume research.json --limit 20']});
add('americanancestors', 'record', 'record get', 'Read indexed fields, source citation, and database guidance.', ['url'], 'anonymous');
add('americanancestors', 'image', 'image get', 'Resolve a published scan or FamilySearch partner ARK.', ['url'], 'anonymous');
add('americanancestors', 'download', 'image download', 'Download published Deep Zoom tiles as a full-resolution PNG with citation and checksum.', ['url'], '', {flags:{out:{required:true}}});

add('familysearch', 'metadata', 'session.metadata get', 'Read mobile login metadata with tokens removed.');
add('familysearch', 'tree-status', 'tree status', 'Read FamilySearch tree status.');
add('familysearch', 'person', 'person get', 'Read a GEDCOM X person.', ['person-id']);
add('familysearch', 'ancestry', 'person ancestry', 'Read GEDCOM X ancestors and pedigree.', ['person-id', '?depth']);
add('familysearch', 'mobile-person', 'person.mobile get', 'Read the mobile v2 person DTO.', ['person-id']);
add('familysearch', 'mobile-pedigree', 'person.mobile pedigree', 'Read the mobile pedigree.', ['person-id', '?depth']);
add('familysearch', 'image info', 'image get', 'Inspect an image ARK, image URLs, and available original scan metadata.', ['ark']);
add('familysearch', 'image download', 'image download', 'Download an original full-resolution document image scan with provenance.', ['ark'], 'original', {flags: {out: {required: true}}, examples: ['fam familysearch.image download --ark 3:1:EXAMPLE --original --out scan.jpg']});
add('familysearch', 'image transcript', 'image transcript', 'Read machine transcription and OCR text for a document image.', ['ark'], 'format', {flags: {format: {default: 'text', choices: ['json', 'text']}}});
const fsPaging = 'count offset all limit resume format';
const fsPageExtra: Extras = {pagination: 'One page by default. --all follows pages, --limit bounds items, --resume continues a returned URL. Completeness and continuation remain in data.', flags: {limit: {default: undefined}, format: {default: 'text', choices: ['text', 'json', 'jsonl']}}};
add('familysearch', 'collection browse', 'collection browse', 'Browse a collection or waypoint URL and its children.', ['collection'], fsPaging, fsPageExtra);
add('familysearch', 'film images', 'film images', 'List the images in a digital film (DGS).', ['dgs'], fsPaging, fsPageExtra);
add('familysearch', 'film image', 'film image', 'Resolve a single numbered image in a digital film.', ['dgs'], 'image', {flags: {image: {required: true, minimum: 1}}});
add('familysearch', 'fulltext available', 'fulltext available', 'Check whether a digital film has full-text research coverage.', ['dgs']);
add('familysearch', 'fulltext search', 'fulltext search', 'Search historical full-text document transcriptions by names, keywords, place, and years.', [], `name keywords place years dgs collection record-type ${fsPaging}`, {...fsPageExtra, flags: {...fsPageExtra.flags, 'record-type': {choices: undefined}}});
add('familysearch', 'record details', 'record get', 'Read details of an indexed historical record ARK (1:1:).', ['ark']);

add('ancestry', 'trees', 'tree list', 'List account trees with cursor pagination.', [], 'limit cursor', {pagination: paging});
add('ancestry', 'tree', 'tree get', 'Read tree metadata and its root person ID.', ['tree-id']);
add('ancestry', 'persons', 'person list', 'Read the first person connection in a tree; use the API catalog for bulk paging.', ['tree-id'], '', {pagination: 'This convenience command returns the first person connection only. Its provider pageInfo is preserved; use ancestry.api.gql query for further pages.'});
for (const [legacy, objectAction, description] of [
  ['person', 'person get', 'Read person details in a tree.'], ['relatives', 'person relatives', 'Read ancestors, descendants, siblings, and spouses.'],
  ['research', 'person research', 'Read facts, citations, and research details.'], ['story', 'person story', 'Read the life story and person card.'],
  ['hints', 'person hints', 'List record hints for a person.'], ['media', 'person media', 'Read person media.'],
]) add('ancestry', legacy, objectAction, description, ['tree-id', 'person-id'], legacy === 'hints' ? 'limit' : legacy === 'media' ? 'query limit page' : legacy === 'relatives' ? commonRead : '', {pagination: ['hints', 'media'].includes(legacy) ? paging : undefined});
for (const noun of ['citations', 'sources']) add('ancestry', noun, `tree ${noun}`, `Read cached tree ${noun}.`, ['tree-id'], 'query limit page', {pagination: paging});
add('ancestry', 'record', 'record get', 'Read record fields, collection metadata, and rights.', ['collection-id', 'record-id']);
add('ancestry', 'search', 'record search', 'Search historical genealogy records by name, life dates, and places.', [], `${names} birth-place death-place limit page cursor filter`, {flags: {'first-name': {binding: 'given'}, 'last-name': {binding: 'surname'}, filter: {multiple: true}}, pagination: paging,
  examples: ['fam ancestry.record search --first-name Abraham --last-name Lincoln --birth-year 1809']});
add('ancestry', 'places', 'place search', 'Autocomplete place names.', ['prefix'], 'query limit', {pagination: paging});

add('myheritage', 'sites', 'site list', 'List family sites.', [], 'query limit offset', {pagination: paging});
add('myheritage', 'trees', 'tree list', 'List trees in a family site.', ['site-id'], 'query limit offset', {pagination: paging});
add('myheritage', 'tree', 'tree get', 'Read tree details.', ['tree-id'], 'query');
add('myheritage', 'people', 'person list', 'List people in a tree; browser sessions retain their existing neighborhood scope.', ['tree-id'], page, {pagination: paging});
add('myheritage', 'find', 'person search', 'Find a person by name in a tree.', ['tree-id', 'name']);
for (const [legacy, action] of [['person', 'get'], ['insights', 'insights'], ['events', 'events'], ['timeline', 'timeline'], ['facts', 'facts'], ['matches', 'matches'], ['records', 'records']])
  add('myheritage', legacy, `person ${action}`, `Read a person’s ${legacy === 'person' ? 'details and relatives' : legacy}.`, ['person-id'], ['events', 'matches'].includes(legacy) ? 'query limit offset' : legacy === 'records' ? 'limit offset match-status' : '', {pagination: ['events', 'matches', 'records'].includes(legacy) ? paging : undefined});
add('myheritage', 'family', 'family get', 'Read a family object.', ['family-id'], 'query');
add('myheritage', 'media', 'media list', 'List media for a person, tree, or site.', ['parent-id'], 'query limit offset', {pagination: paging});
add('myheritage', 'albums', 'album list', 'List photo albums for a family site.', ['site-id']);
add('myheritage', 'consistency', 'tree consistency', 'Read cached tree consistency issues.', ['tree-id'], page, {pagination: paging});
add('myheritage', 'search', 'record search', 'Search historical records by names, dates, places, relatives, and collection-specific fields.', ['?input'],
  `${names} birth-place death-place residence-year residence-place marriage-year marriage-place birth-year-range death-year-range residence-year-range marriage-year-range place keyword exact collection category record-type after gender first-name-match last-name-match no-translations field limit offset`,
  {flags: {field: {multiple: true}, limit: {default: undefined}}, pagination: paging,
    examples: ['fam myheritage.record search --first-name Abraham --last-name Lincoln --birth-year 1809']});
add('myheritage', 'record', 'record get', 'Read record fields, citations, image links, and optionally related leads.', ['url'], 'related');
add('myheritage', 'catalog', 'collection list', 'Browse and filter historical record collections.', [], 'category location years images limit offset', {pagination: paging});
add('myheritage', 'collections', 'collection search', 'Find historical collections by title or description.', ['name'], 'category location years images limit offset', {pagination: paging});
add('myheritage', 'collection', 'collection get', 'Read collection details and supported fields.', ['collection-id']);
add('myheritage', 'search-fields', 'collection fields', 'Discover collection-specific search fields, types, and choices.', ['collection-id']);
add('myheritage', 'document', 'document get', 'Read original document pages, image URLs, and embedded text.', ['url'], 'related-document');
add('myheritage', 'download-document', 'document download', 'Download an original document page and source metadata.', ['url'], 'page related-document', {flags: {out: {required: true}}});

add('findmypast', 'subscription', 'subscription get', 'Read current plan and subscription status.');
add('findmypast', 'trees', 'tree list', 'List account trees.', [], page, {pagination: paging});
add('findmypast', 'tree', 'tree get', 'Read tree settings.', ['tree-id']);
add('findmypast', 'people', 'person list', 'Read people, tree metadata, and root/last-viewed person IDs.', ['tree-id']);
for (const [legacy, action] of [['person', 'get'], ['relatives', 'relatives'], ['hints', 'hints']]) add('findmypast', legacy, `person ${action}`, `Read a person’s ${legacy === 'person' ? 'summary' : legacy}.`, ['tree-id', 'person-id'], legacy === 'hints' ? page : '', {pagination: legacy === 'hints' ? paging : undefined});
add('findmypast', 'facts', 'person facts', 'Read personal, family, and name facts and citations.', ['person-id']);
add('findmypast', 'media', 'person media', 'List person media.', ['person-id'], page, {pagination: paging});
add('findmypast', 'search', 'record search', 'Search historical records by names, dates, keywords, and provider filters.', [], `${names} year keywords collection exact filters country year-range sort descending page`, {pagination: 'One provider-sized page; use --page to continue. This provider does not support --limit or --offset here.', flags: {sort: {choices: ['relevance', 'first-name', 'last-name', 'birth', 'death', 'year', 'collection']}}});
add('findmypast', 'collections', 'collection search', 'Find historical record sets.', ['?name'], page, {pagination: paging});
add('findmypast', 'collection', 'collection get', 'Read record-set metadata.', ['collection-id']);
add('findmypast', 'entitlement', 'record entitlement', 'Read the transcript access decision without confirming a purchase.', ['record-id']);
add('findmypast', 'record', 'record get', 'Read a transcript without confirming a credit purchase.', ['record-id']);
add('findmypast', 'image', 'image get', 'Read record image gateway details.', ['record-id']);
add('findmypast', 'download', 'image download', 'Download a full-resolution record image with source/checksum metadata.', ['record-id'], '', {flags: {out: {required: true, description: 'JPEG destination ending in .jpg or .jpeg; also writes FILE.json.'}}});
add('findmypast', 'newspapers', 'newspaper search', 'Search historical newspapers by person, publication, dates, and location.', [], `name keywords exact publication country county place from to sort descending ${page}`, {pagination: paging, flags: {name: {multiple: true}, publication: {multiple: true}, sort: {choices: ['relevance', 'date']}}});
add('findmypast', 'newspaper-manifest', 'newspaper manifest', 'Read the newspaper image manifest.', ['newspaper-id']);

add('findagrave', 'search', 'memorial search', 'Search cemetery memorials, grave biographies, dates, names, and relatives.', [], `name ${names} middle-name year-range birth-filter death-filter bio relative include-maiden-name include-nickname similar plot location cemetery exact famous veteran has-gps sort descending input ${page}`,
  {pagination: paging, flags: {cemetery: {multiple: true}, limit: {maximum: 100}, sort: {choices: ['relevance', 'name', 'birth', 'death', 'cemetery', 'created', 'modified', 'plot']}}});
add('findagrave', 'memorial', 'memorial get', 'Read a memorial, dates, biography, burial, photos, and relatives.', ['memorial-id']);
add('findagrave', 'relatives', 'memorial relatives', 'Read relationships attached to a memorial.', ['memorial-id']);
add('findagrave', 'photos', 'memorial photos', 'List memorial photographs.', ['memorial-id'], page, {pagination: paging});
add('findagrave', 'download', 'photo download', 'Download the original memorial photograph with source/checksum metadata.', ['memorial-id', 'photo-id'], '', {flags: {out: {required: true}}});
add('findagrave', 'cemeteries', 'cemetery search', 'Search cemeteries by name, location, or coordinates.', ['?name'], `location latitude longitude distance input ${page}`, {pagination: paging});
add('findagrave', 'cemetery', 'cemetery get', 'Read cemetery details.', ['cemetery-id']);
add('findagrave', 'locations', 'location search', 'Look up location IDs for memorial and cemetery search.', ['name'], page, {pagination: paging});
add('findagrave', 'contributor', 'contributor get', 'Read a contributor’s public profile.', ['contributor-id']);
add('findagrave', 'my-cemeteries', 'cemetery saved', 'List your saved cemeteries.', [], page, {pagination: paging});
add('findagrave', 'virtual-cemeteries', 'cemetery.virtual list', 'List virtual cemeteries; contributor defaults to the current account.', ['?contributor-id'], page, {pagination: paging});
add('findagrave', 'virtual-cemetery', 'cemetery.virtual get', 'Read memorials in a virtual cemetery.', ['cemetery-id'], page, {pagination: paging});
add('findagrave', 'volunteer-cemeteries', 'cemetery volunteer', 'Read your volunteer cemeteries.');
add('findagrave', 'tags', 'tag list', 'Read global memorial tags.');
add('findagrave', 'requests', 'photo.request list', 'List your, claimed, or volunteer photo requests.', ['?scope'], page, {pagination: paging, flags: {scope: {default: 'mine', choices: ['mine', 'claimed', 'volunteer']}}});
for (const [legacy, obj, description] of [['enums', 'api.enum', 'APK enum wire values'], ['http-sites', 'api.http-site', 'HTTP call sites including catalog-only routes']]) add('findagrave', legacy, `${obj} list`, `List ${description}.`, ['?filter'], '', {risk: local});

const geneanetSearch = `${names.split(' ').slice(0, 2).join(' ')} place from to event spouse-last-name spouse-first-name category with-images keywords page limit input`;
for (const [legacy, obj, description] of [['search', 'record', 'genealogy records and archival transcriptions'], ['photos', 'photo', 'old portraits and photographs'], ['library', 'library', 'books and newspapers']])
  add('geneanet', legacy, `${obj} search`, `Search ${description}.`, [], geneanetSearch, {pagination: paging, flags: {limit: {default: 10, choices: ['10', '20', '30', '40', '50', '100']}, event: {choices: ['all', 'birth', 'wedding', 'death']}}});
add('geneanet', 'collections', 'collection list', 'Read collection and theme links for a zone (default all).', ['?zone']);
add('geneanet', 'record', 'record get', 'Read a record, viewer, collection, or person page.', ['url']);
add('geneanet', 'person', 'person get', 'Read a tree person using --index, or first/last name and occurrence.', ['tree-id'], 'index first-name last-name occurrence');
add('geneanet', 'tree-media', 'person media', 'Read linked documents, deposit IDs, and view IDs.', ['tree-id', 'person-index']);
add('geneanet', 'media', 'media get', 'Read deposit metadata and image variants.', ['deposit-id']);
add('geneanet', 'media-references', 'media references', 'Read named persons and indexing on one media view.', ['deposit-id', 'view-id']);
add('geneanet', 'images', 'register images', 'Read an inclusive register image range, up to 100 pages.', ['register-id'], 'from-page to-page', {pagination: 'An explicitly selected page range; the provider’s register can contain additional pages.'});
add('geneanet', 'download', 'record download', 'Resolve and download a permitted image or PDF from a record viewer.', ['url'], '', {flags: {out: {required: true}}});
add('geneanet', 'download-media', 'media download', 'Download an original media view with source/checksum metadata.', ['deposit-id', 'view-id'], '', {flags: {out: {required: true}}});
add('geneanet', 'routes', 'api.route list', 'List broader observed website routes; this inventory includes non-executable routes.', ['?filter'], '', {risk: local});

for (const [legacy, objectAction, description, args] of [
  ['trees', 'tree list', 'List account trees.', ''], ['tree', 'tree get', 'Read tree details.', 'tree-id'],
  ['people', 'person list', 'Read people in a tree.', 'tree-id'], ['find-people', 'person search', 'Search people linked to the account.', 'name'],
  ['person', 'person get', 'Read person details.', 'person-id'], ['pedigree', 'person pedigree', 'Read a tree pedigree.', 'tree-id person-id'],
  ['family', 'person family', 'Read immediate family.', 'tree-id person-id'], ['events', 'person events', 'Read life events.', 'tree-id person-id'],
  ['hints', 'person hints', 'Read record hints.', 'person-id'], ['records', 'person records', 'Read saved records.', 'person-id'],
  ['stories', 'story list', 'List your stories.', ''], ['person-stories', 'person stories', 'List stories attached to a person.', 'person-id'],
  ['story', 'story get', 'Read story details.', 'story-id'], ['comments', 'story comments', 'Read story comments.', 'story-id'],
  ['feed', 'feed get', 'Read the home feed.', ''], ['media', 'media list', 'Read your media gallery.', ''],
  ['media-item', 'media get', 'Read media metadata.', 'media-id'], ['groups', 'group list', 'Read your groups.', ''],
  ['notifications', 'notification list', 'Read your notifications.', ''], ['subscription', 'subscription get', 'Read subscription details.', ''],
  ['recent-people', 'person recent', 'Read recently viewed people.', ''], ['home-hints', 'hint list', 'Read homepage hints.', ''],
  ['mobile-version', 'mobile.version get', 'Read public minimum supported app versions.', ''],
  ['search', 'record search', 'Search historical records by name, keywords, and extra native fields.', ''],
]) {
  const paginated = ['stories', 'person-stories', 'comments', 'feed', 'media', 'notifications', 'search', 'find-people'].includes(legacy);
  add('storied', legacy, objectAction, description, args.split(' ').filter(Boolean),
    `input${paginated ? legacy === 'find-people' ? ' page' : ' page limit' : ''}${legacy === 'pedigree' ? ' generations' : ''}${legacy === 'search' ? ' first-name last-name keyword' : ''}`,
    {pagination: paginated ? paging : undefined, flags: {limit: {maximum: 100}}});
}
add('storied', 'model', 'api.model get', 'Read a recovered model schema.', ['name'], '', {risk: local});

add('newspaperarchive', 'search', 'newspaper search', 'Search newspaper OCR for ancestors, obituaries, births, marriages, names, and keywords.', [],
  'first-name last-name keyword phrase any-words exclude-words country-id state-id city-id publication-id from to page limit',
  {pagination: paging, flags: {limit: {default: 20, choices: ['10','20','30','50']},
    from: {description: 'Start publication date, YYYY-MM-DD; use with --to.'}, to: {description: 'End publication date, YYYY-MM-DD; use with --from.'}}});
add('newspaperarchive', 'publications', 'publication search', 'Find newspaper titles and places with publication and location IDs.', ['name'], 'page limit', {pagination: paging, flags: {limit: {maximum: 100}}});
add('newspaperarchive', 'locations', 'location list', 'List countries, or narrow to states, cities, and newspapers using location IDs.', [], 'country-id state-id city-id');
add('newspaperarchive', 'page', 'page get', 'Read newspaper page metadata, a source citation, and available OCR.', ['url']);
add('newspaperarchive', 'transcript', 'page transcript', 'Read machine OCR text and citation from a newspaper page.', ['url']);
add('newspaperarchive', 'ocr', 'page ocr', 'Read provider OCR by image ID and optional article ID; availability depends on the provider.', ['image-id'], 'article-id');
add('newspaperarchive', 'dates', 'publication dates', 'Browse available years, months, or issue dates for a newspaper.', ['publication-id'], 'year month');
add('newspaperarchive', 'call', 'api call', 'Execute a supported NewspaperArchive read operation through the Storied API.', ['operation', '?input']);

// Anonymous mode is limited to providers and workflows that already support it.
for (const cmd of registry) if (['findmypast', 'findagrave', 'geneanet', 'storied', 'newspaperarchive'].includes(cmd.provider)
  && !['credential', 'session', 'account'].includes(cmd.object)) cmd.flags.push(flag('anonymous'));

const browserFlags = {
  local: {type: 'boolean' as const, description: 'Use a managed local Docker browser.'},
  remote: {description: 'fam browser API base URL (including a reverse proxy path if needed).'},
  engine: {choices: ['cloakbrowser', 'camofox'], description: 'Browser engine. CloakBrowser is the default. Changing engines clears browser sessions at the selected location.'},
  'vnc-url': {description: 'Exact viewer URL to open and suggest, including tunnels or custom hostnames.'},
  'api-key-file': {file: true, description: 'Read an existing remote API key from a private file.'},
  install: {type: 'boolean' as const, description: 'Offer/install OrbStack automatically on macOS when Docker is absent.'},
  timeout: {type: 'integer' as const, minimum: 0, maximum: 3600, description: 'Seconds to wait for human verification; zero returns immediately.'},
  'api-port': {type: 'integer' as const, minimum: 1, maximum: 65535}, 'vnc-port': {type: 'integer' as const, minimum: 1, maximum: 65535},
  session: {description: 'Shared browser session name; defaults to default. Clients using the same name share remote logins.'},
  open: {type: 'boolean' as const, description: 'Open the configured viewer automatically when interaction is needed.'},
  'no-open': {type: 'boolean' as const, description: 'Print the viewer URL without opening it automatically.'},
  mode: {choices: ['local','remote']}, transport: {choices: ['auto','http','browser']},
};
add('cli', 'browser-fetch', 'browser fetch', 'Fetch any HTTP(S) URL through the configured browser, execute verification, and extract page content or original response bytes.', [],
  'url mode format method header headers-file cookie cookies-file user-agent referer body body-file context private open timeout browser-timeout wait-for wait-ms keep-tab redirects', {
    flags: {
      url: {required: true, description: 'Absolute HTTP(S) URL, with no provider allowlist.'},
      mode: {choices: ['navigate','request'], description: 'Real GET navigation (default), or browser network request. Raw output and non-GET methods default to request.'},
      format: {default: 'text', choices: ['raw','html','text','markdown','json'], description: 'Original response bytes, rendered HTML, visible text, Markdown, or structured page/response data.'},
      method: {description: 'HTTP method for request mode; defaults to GET, or POST when a body is supplied.'},
      header: {multiple: true, sensitive: true, description: 'Name: value override; repeat as needed. Navigation headers also follow HTTP redirects; request mode strips overrides across origins.'},
      'headers-file': {file: true, sensitive: true, description: 'JSON object of header strings; repeated --header options take precedence.'},
      cookie: {multiple: true, sensitive: true, description: 'name=value; other=value cookies scoped to the URL host and / path; repeat as needed.'},
      'cookies-file': {file: true, sensitive: true, description: 'Playwright cookie array or storage-state JSON (cookies only); retains domain, path, expiry and flags.'},
      'user-agent': {description: 'HTTP User-Agent override; does not change the browser fingerprint or navigator.userAgent.'},
      referer: {description: 'HTTP Referer override.'}, body: {sensitive: true, description: 'Literal UTF-8 request body.'},
      'body-file': {file: true, sensitive: true, description: 'File containing the exact request bytes (up to 48 MiB).'},
      context: {choices: ['web', 'web-private', ...providerNames], default: 'web', description: 'Use web for regular windows, web-private for private windows, or a provider to reuse its login. Each context saves separate cookies.'},
      private: {type: 'boolean', description: 'Use private windows with separate persistent cookies. Off by default; applies to the general web context.'},
      open: {type: 'string', choices: ['auto','always','never'], default: 'auto', description: 'Viewer policy: auto opens for human prompts, challenges lasting 10 seconds, or a page timeout; always opens immediately and retains the tab; never only prints the viewer URL.'},
      timeout: {type: 'integer', minimum: 1, maximum: 3600, default: 60, description: 'Navigation and content wait timeout in seconds.'},
      'browser-timeout': {type: 'integer', minimum: 0, maximum: 3600, description: 'Verification wait in seconds; zero returns the viewer URL immediately when challenged.'},
      'wait-for': {description: 'CSS selector to wait for and extract in navigate mode; full HTML output is retained.'},
      'wait-ms': {type: 'integer', minimum: 0, maximum: 60000, description: 'Additional settling time after the page/selector is ready.'},
      'keep-tab': {type: 'boolean', description: 'Retain the command tab after success. Retained and verification tabs expire after 15 minutes without browser API activity.'},
      redirects: {choices: ['follow','manual','error'], default: 'follow', description: 'Request-mode redirect policy, limited to 20 hops. Navigation uses browser redirects.'},
    },
    risk: {level: 'write', description: 'Navigates user-selected URLs and executes their scripts; explicit request methods/bodies may change remote data. Uses and saves cookies in the selected context.'},
    examples: ['fam cli.browser fetch --url https://example.org --format markdown', 'fam cli.browser fetch --url https://example.org/file.pdf --format raw --out file.pdf',
      'fam cli.browser fetch --url https://example.org/api --mode request --header "Accept: application/json" --json'],
    outputSchema: {type: 'object', description: 'HTTP status, final URL, response headers, byte count, and extracted content. JSON preserves large integers; binary response bodies use base64. HTTP error bodies retain their status.'},
  });
for (const [action, description, flags] of [
  ['setup','Set up and start a persistent local Docker browser or connect to a remote URL.','engine local remote vnc-url api-key-file install timeout session open no-open api-port vnc-port'],
  ['use','Select a location (retains logins) or engine (clears browser sessions). Both engines can be selected with one command.','mode engine'],
  ['start','Start the configured browser, retaining saved website logins.',''],
  ['stop','Stop the local container, or close only fam tabs on a remote browser. Saved logins remain.',''],
  ['status','Inspect browser connectivity and configuration without exposing API keys.',''],
  ['open','Open or print the configured noVNC viewer URL.',''],
  ['configure','Configure the viewer URL, human verification timeout, and transport preference.','vnc-url timeout transport open no-open'],
]) add('cli', `browser-${action}`, `browser ${action}`, description, [], flags,
  {flags: browserFlags, risk: {level: action === 'status' ? 'read' : 'local', description: 'Manages the configured browser or private local configuration. Remote stop closes only fam tabs.'}, examples: [`fam browser ${action}${action === 'setup' ? ' --local' : action === 'use' ? ' --mode remote' : ''}`]});
add('cli', 'browser-reset', 'browser reset', 'Clear browser sessions and site data. Choose --provider or --all; no website is opened or login attempted.', [], 'provider all open no-open',
  {flags: {...browserFlags, provider: {choices: ['web', 'web-private', ...providerNames], description: 'Reset this provider or one general web context. Storied and NewspaperArchive are reset together.'},
    all: {description: 'Reset every fam-managed session on this browser, across session names, plus remembered transport decisions. Preserve unrelated sessions.'}},
  risk: {level: 'write', description: 'Closes the selected browser sessions and archives their site data and local session snapshots. Retains configured credentials and login cooldowns.'},
  examples: ['fam cli.browser reset --provider myheritage', 'fam cli.browser reset --all']});
add('cli', 'browser-transport-reset', 'browser.transport reset', 'Forget automatic HTTP/browser transport decisions for this instance; retain all website logins.', [], '',
  {risk: {level: 'local', description: 'Removes local transport decisions only. Makes no browser or provider requests.'}});
for (const action of ['list', 'get']) add('cli', `browser-transport-${action}`, `browser.transport ${action}`,
  action === 'list' ? 'Inspect starting HTTP/browser transport by provider and origin without making requests.' : 'Explain which transport will start a request to one provider origin without making requests.', [],
  `provider transport${action === 'get' ? ' origin' : ''}`, {
    flags: {provider: {choices: [...providerNames], required: action === 'get'}, transport: browserFlags.transport,
      origin: {required: true, description: 'Exact website origin, for example https://www.familysearch.org; no path or query.'}},
    risk: {level: 'local', description: 'Reads local transport configuration and routing metadata only. Does not connect to Camofox or a provider, load login sessions, or change routing.'},
    examples: [action === 'list' ? 'fam cli.browser.transport list --transport auto'
      : 'fam cli.browser.transport get --provider familysearch --origin https://www.familysearch.org --transport auto'],
  });

const cliRisk: Extras = {risk: local};
const historyFlags: Record<string, Partial<Flag>> = {
  provider: {multiple: true, choices: [...providerNames, 'cli'], description: 'Include calls to this provider; repeat to include several.'},
  command: {description: 'Case-insensitive substring of the command name, such as ancestry.person or cli.health.'},
  outcome: {multiple: true, choices: ['success', 'soft_failure', 'hard_failure', 'incomplete'], description: 'Filter by recorded outcome; incomplete means no finish record. Repeat to include several.'},
  code: {sensitive: false, description: 'Exact diagnostic or error code, case-insensitive, including HTTP_401 or AUTH_RETRY.'},
  query: {description: 'Case-insensitive text to find in recorded arguments, diagnostics, stack traces, and build information.'},
  since: {description: 'Started at or after: today (UTC), 24h, 7d, YYYY-MM-DD, or an ISO timestamp with timezone.'},
  until: {description: 'Started at or before this time. A YYYY-MM-DD date includes the entire UTC day.'},
  'include-utility': {type: 'boolean', description: 'Also show successful history queries and shell completion lookups; their failures are always included.'},
  'include-archived': {type: 'boolean', description: 'Include entries hidden by archive markers.'},
  limit: {default: 20, minimum: 0, description: 'Maximum invocations or summary groups to show; 0 returns all matches. Positive limits have no fixed cap.'},
  offset: {description: 'Skip this many matching invocations or summary groups.'},
  'group-by': {choices: ['command', 'provider', 'code'], default: 'command', description: 'Group matches by command, provider, or diagnostic/error code.'},
};
for (const object of ['history', 'history.failures']) for (const action of ['list', 'summary']) {
  const failure = object === 'history.failures';
  add('cli', `${object}-${action}`, `${object} ${action}`,
    action === 'list' ? `Browse recent ${failure ? 'soft and hard failures' : 'CLI invocations'} with full command lines, timing, diagnostics, and IDs for detail inspection.`
      : `Summarize ${failure ? 'soft and hard failures' : 'CLI history'} and rank recurring issues by command, provider, or error code.`, [],
    `provider command outcome code query since until include-utility include-archived limit offset${action === 'summary' ? ' group-by' : ''}`, {
      ...cliRisk, flags: {...historyFlags, ...(failure ? {outcome: {...historyFlags.outcome, choices: ['soft_failure', 'hard_failure']}} : {}),
        ...(action === 'summary' ? {limit: {...historyFlags.limit, default: 10}} : {})},
      examples: [`fam cli.${object} ${action}`, `fam cli.${object} ${action} --provider familysearch --since 7d`,
        action === 'summary' ? `fam cli.${object} summary --group-by code` : `fam cli.${object} list --code AUTH_RETRY`],
      outputSchema: {type: 'object', description: 'Local history view with entries or groups, read notices, and pagination. No provider requests.'},
    });
}
add('cli', 'history-stats', 'history stats', 'Explore call volume, failures, and duration percentiles over time as a terminal graph, table, or JSON.', [],
  'provider command outcome code query since until include-utility include-archived interval group-by metric format', {
    ...cliRisk, flags: {...historyFlags,
      interval: {default: 'auto', choices: ['auto', 'minute', 'hour', 'day', 'week', 'month'], description: 'Time bucket size in UTC; auto chooses from the selected span. Weeks start on Monday.'},
      'group-by': {default: 'none', choices: ['none', 'provider', 'command', 'outcome', 'code', 'build'], description: 'Split the time series by this dimension. All groups are included.'},
      metric: {default: 'calls', choices: ['calls', 'failures', 'failure-rate', 'avg-duration', 'p50-duration', 'p95-duration'], description: 'Metric to graph. Tables and JSON retain their standard statistics.'},
      format: {default: 'graph', choices: ['graph', 'table', 'json'], description: 'Terminal bar graph (default), numeric table, or raw JSON statistics.'}},
    examples: ['fam cli.history stats --since 7d', 'fam cli.history stats --since 30d --interval day --group-by provider --metric failure-rate',
      'fam cli.history stats --provider ancestry --metric p95-duration --format table', 'fam cli.history stats --interval hour --json'],
    outputSchema: {type: 'object', description: 'Overall and per-series counts, failure rates, duration statistics, and UTC time buckets. All matches and series are included.'},
  });
add('cli', 'history-archive', 'history archive', 'Hide matching CLI history using an archive marker; keep all recorded data and input snapshots.', [],
  'all failures provider command outcome code query since until include-utility', {
    risk: {level: 'write', description: 'Appends a local archive marker. No history or captured inputs are deleted or rewritten. Use --dry-run to preview matching counts.'},
    flags: {...historyFlags, all: {description: 'Archive all history, including successful utility calls; cannot be combined with selection filters.'},
      failures: {type: 'boolean', description: 'Select soft and hard failures; combine with provider, command, code, text, or time filters.'},
      'dry-run': {description: 'Preview matching invocation counts without appending an archive marker.'}},
    examples: ['fam cli.history archive --all', 'fam cli.history archive --failures --provider ancestry --code AUTH_RETRY --dry-run',
      'fam cli.history archive --failures --provider ancestry --code AUTH_RETRY'],
    outputSchema: {type: 'object', description: 'Matching counts by outcome, fixed cutoff, selection, and appended archive marker (or dry-run preview).'},
  });
add('cli', 'history-get', 'history get', 'Inspect one recorded invocation, including error stack, recovery diagnostics, build revision, and source lines.', [], 'id', {
  ...cliRisk, flags: {id: {required: true, description: 'Full invocation UUID or a unique prefix of at least eight characters from a history list.'}},
  examples: ['fam cli.history get --id 12345678', 'fam cli.history get --id 12345678 --json'],
});
add('cli', 'search', 'command search', 'Find commands by intent with 20% BM25 and 80% local semantic search. Downloads and caches a small model on first use.', [], 'query provider context limit offset lexical no-rerank format scores',
  {risk: {level: 'local', description: 'Searches command metadata locally; caches model files and embeddings in the active profile. Never executes a provider.'},
    flags: {query: {required: true, description: 'What you want to do, in your own words.'}, provider: {choices: [...providerNames, 'cli']},
      context: {description: 'Optional provider URL or ID to resolve locally and prefill matching flags.'},
      limit: {default: 10, maximum: 100, description: 'Number of ranked matches to show.'}, offset: {description: 'Zero-based offset into ranked matches.'},
      lexical: {type: 'boolean', description: 'Use only BM25; skip model loading and downloads.'},
      'no-rerank': {type: 'boolean', description: 'Skip the default MiniLM reranker and return BM25 + Arctic scores only.'},
      scores: {type: 'boolean', description: 'Show relevance scores in table, tree, and text output. JSON always includes scores.'},
      format: {default: 'table', choices: ['table', 'tree', 'text', 'json'], description: 'Ranked table, provider/object tree, detailed invocation templates, or JSON.'}},
    examples: ['fam cli.command search --query "save a full resolution scan of a historical document"',
      'fam cli.command search --query "merge duplicate people" --provider familysearch --format tree']});
add('cli', 'describe', 'command describe', 'Read the complete registry entry: syntax, typed flags, examples, output schema, and risk.', [], 'command', {...cliRisk, flags: {command: {required: true, description: 'Command identity, for example familysearch.image download.'}}});
const docFlags: Record<string, Partial<Flag>> = {
  provider: {choices: namespaceNames, description: 'Provider guide, or cli for shared documentation.'},
  doc: {description: 'Document ID from cli.doc list, for example americanancestors or familysearch/document-research.'},
  section: {description: 'Section ID or exact heading from cli.doc list --doc ID; includes its subsections.'},
  format: {default: 'text', choices: ['text', 'json'], description: 'Readable text or structured JSON.'},
};
add('cli', 'docs-list', 'doc list', 'List installed guides, or the sections in a selected document.', [], 'provider doc format',
  {...cliRisk, flags: docFlags, examples: ['fam cli.doc list', 'fam cli.doc list --provider americanancestors', 'fam cli.doc list --doc americanancestors']});
add('cli', 'docs-read', 'doc read', 'Read a full guide or section. Defaults to the main README, or the selected provider guide.', [], 'provider doc section format',
  {...cliRisk, flags: {...docFlags, format: {...docFlags.format, choices: ['text', 'markdown', 'json']}},
    examples: ['fam cli.doc read --provider americanancestors', 'fam cli.doc read --doc setup', 'fam cli.doc read --doc americanancestors --section family-members-and-collection-specific-fields']});
add('cli', 'docs-search', 'doc search', 'Find relevant sections in installed guides using local keyword and semantic search.', [], 'query provider doc limit offset lexical no-rerank format',
  {...cliRisk, flags: {...docFlags, query: {required: true, description: 'What you want to learn from the guides.'},
    limit: {default: 10, maximum: 100, description: 'Number of matching sections to show.'}, offset: {description: 'Zero-based offset into matching sections.'},
    lexical: {type: 'boolean', description: 'Search with BM25 only; no model downloads or loading.'},
    'no-rerank': {type: 'boolean', description: 'Skip MiniLM reranking and use BM25 + Arctic scores.'}},
    examples: ['fam cli.doc search --query "collection-specific fields"', 'fam cli.doc search --provider americanancestors --query "search by spouse" --lexical']});
add('cli', 'list', 'command list', 'List every registered command, optionally restricted to a provider.', [], 'provider', {...cliRisk, flags: {provider: {choices: [...providerNames, 'cli']}}});
add('cli', 'providers', 'provider list', 'List available providers and what each one supports.', [], '', cliRisk);
add('cli', 'resolve', 'context resolve', 'Resolve known provider URLs and IDs locally into candidate commands and prefilled flags.', [], 'context provider', {...cliRisk, flags: {context: {required: true}, provider: {choices: [...providerNames]}}});
add('cli', 'doctor', 'health check', 'Check provider access, then refresh or sign in again when needed; fam doctor is shorthand for --live.', [], 'provider offline live verbose no-pretty no-fix format',
  {risk: {level: 'read', description: 'Live account checks can renew sessions or use configured credentials and browser sign-in to repair access. --no-fix skips repairs and session saves; --offline makes no provider requests.'}, flags: {
    provider: {multiple: true, choices: [...providerNames]}, format: {default: 'text', choices: ['json', 'text']},
    offline: {description: 'Inspect local configuration without provider requests or session changes.'},
    live: {description: 'Check online (the default); cannot be combined with --offline.'},
    verbose: {description: 'Include individual checks, recovery steps, and coverage details.'},
    'no-pretty': {type: 'boolean', description: 'Disable the automatic color TTY display and spinners; print a plain report.'},
    'no-fix': {type: 'boolean', description: 'Check access without refreshing, signing in again, or updating saved sessions.'},
  }});
add('cli', 'version', 'version get', 'Show the running fam version, build revision, installation type, and paths; also available as fam --version.', [], '', cliRisk);
add('cli', 'update', 'update run', 'Update fam from its Git upstream or npm latest; fam cli.update is shorthand.', [], '', {
  risk: {level: 'write', description: 'Pulls the configured Git upstream and reinstalls dependencies, or installs the latest npm package in its existing prefix/project. Builds remove unused snapshots.'},
  flags: {'dry-run': {description: 'Inspect the installation and show update commands without pulling or installing.'}},
  examples: ['fam cli.update', 'fam cli.update run --dry-run'],
});
add('cli', 'completion-script', 'completion script', 'Print bash or zsh completion code for use with eval.', [], 'shell format',
  {...cliRisk, flags: {shell: {required: true, choices: ['bash', 'zsh']}, format: {default: 'text', choices: ['json', 'text']}}});
add('cli', 'completion-install', 'completion install', 'Install or update a guarded completion hook in your shell startup files.', [], 'shell',
  {risk: {level: 'local', description: 'Updates only the marked fam completion hook in shell startup files.'}, flags: {shell: {description: 'Shell to configure; defaults to $SHELL.', choices: ['bash', 'zsh']}}});
add('cli', 'completion-query', 'completion query', 'Return local shell completion candidates from the command registry.', [], 'word format',
  {...cliRisk, flags: {word: {multiple: true, description: 'Command word, repeated in order; include the current incomplete word.'}, format: {default: 'text', choices: ['json', 'text']}}});

export const commands: readonly Command[] = registry.sort((a, b) => compareCliNames(a.id, b.id));
export const commandById = new Map(commands.map(command => [command.id, command]));

/** Curated namespace suggestions also enrich registered command examples. */
export const commonTasks = [
  {command: 'ancestry.record search', title: 'Search historical records', example: 'fam ancestry.record search --first-name Abraham --last-name Lincoln --birth-year 1809'},
  {command: 'familysearch.person get', title: 'Read a person in FamilySearch', example: 'fam familysearch.person get --person-id <PERSON_ID>'},
  {command: 'familysearch.image download', title: 'Download an original document image', example: 'fam familysearch.image download --ark <IMAGE_ARK> --original --out scan.jpg'},
  {command: 'familysearch.image transcript', title: 'Read a document transcription', example: 'fam familysearch.image transcript --ark <IMAGE_ARK>'},
  {command: 'findagrave.memorial search', title: 'Find a grave or memorial', example: 'fam findagrave.memorial search --last-name Lincoln --anonymous'},
  {command: 'findmypast.newspaper search', title: 'Search historical newspapers', example: 'fam findmypast.newspaper search --name "Ada Lovelace"'},
  {command: 'myheritage.collection search', title: 'Find a historical record collection', example: 'fam myheritage.collection search --name census'},
  {command: 'geneanet.record search', title: 'Search archival records', example: 'fam geneanet.record search --last-name Martin --place Paris'},
  {command: 'storied.tree list', title: 'List your Storied trees', example: 'fam storied.tree list'},
  {command: 'myheritage.session login', title: 'Sign in through a browser', example: 'fam myheritage.session login'},
  {command: 'ancestry.api.gql query', title: 'Run a cataloged GraphQL operation', example: 'fam ancestry.api.gql query --operation GetTreeList --variables \'{"limit":20}\''},
  {command: 'cli.health check', title: 'Check account access', example: 'fam cli.health check'},
  {command: 'cli.history.failures list', title: 'Check recent command failures', example: 'fam cli.history.failures list --since 7d'},
];
for (const task of commonTasks) {
  const command = commandById.get(task.command)!;
  if (!command.examples.includes(task.example)) command.examples.push(task.example);
}
