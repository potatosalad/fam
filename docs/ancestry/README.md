# Ancestry CLI

Create output folders before using these examples: `mkdir -p research-output/ancestry`. This folder is ignored in the checkout; keep exports outside Git elsewhere.

`fam ancestry` provides a TypeScript client and CLI based on Ancestry Android 18.16.3 contracts. See the [main README](../../README.md) for npm installation, storage locations, environment variables, and isolated installations. Authentication and data are separate from the other providers.

## Authenticate

```sh
fam ancestry credentials
fam ancestry auth
# Only if the service reports pending email verification:
fam ancestry auth --send-code
fam ancestry auth --code 123456
fam ancestry status
fam ancestry trees
```

Credential setup follows the [shared lookup rules](../setup.md#credential-lookup): environment variables, configured helper, then a hidden prompt. `--stdin` supplies login JSON directly. Password login checks `ANCESTRY_USERNAME` / `ANCESTRY_PASSWORD`, then the helper, then saved login details. Existing sessions are reused. Login, device metadata, cookies, pending verification, and tokens are saved in `ancestry/` under the configuration root shown by `status`.

Run one process per profile when refreshing. Mandatory password changes and non-email verification need completion through Ancestry. See [protocol notes](protocol.md) and [APK provenance](provenance.json) for implementation details; catalog coverage is not a guarantee of access with every account.

## Research a person

List your trees and use `treeId`, `rootPersonId`, or `userPersonId` from the response. Substitute actual IDs for `TREE` and `PERSON` below; these are Ancestry IDs, distinct from FamilySearch IDs.

```sh
fam ancestry trees --limit 20
fam ancestry tree TREE
fam ancestry persons TREE --out research-output/ancestry/people.json
fam ancestry person TREE PERSON
fam ancestry relatives TREE PERSON
fam ancestry relatives TREE PERSON --query '{"genup":4,"gendown":2,"childLimit":30}'
fam ancestry research TREE PERSON --out research-output/ancestry/research.json
fam ancestry story TREE PERSON
fam ancestry hints TREE PERSON --limit 20
fam ancestry media TREE PERSON --limit 20 --page 1
fam ancestry citations TREE --limit 20 --page 1
fam ancestry sources TREE --limit 20 --page 1
```

`research` returns facts, sources, web links, and family context. `relatives` defaults to two generations up and one down, including spouses and siblings. REST responses retain the app's wire names: for example `person` returns an envelope with `Persons`, `Names`, and `Events`. GraphQL commands return the `data` object and retain nested connections.

Search historical records using known names, years, and places:

```sh
fam ancestry search --given Abraham --surname Lincoln --birth-year 1809 --limit 5
fam ancestry search --given Abraham --surname Lincoln --birth-year 1809 --limit 5 --page 2
fam ancestry search --surname Lincoln --birth-place Kentucky --out research-output/ancestry/records.json
fam ancestry record 1093 100012925800
fam ancestry places Springfield --limit 5
```

Search results expose `RecordView.Records[].Gid.Value` in `RECORD:COLLECTION` format. Pass those parts to `record` in **COLLECTION RECORD** order. `record` requests fields, household information, collection metadata, and rights. Returned content depends on the account's subscription and the collection's permissions. Inspect service `Status`, per-record status, and rights fields even when HTTP succeeds.

## More operations and pagination

```sh
fam ancestry ops hints
fam ancestry ops citation
fam ancestry schema persons.research
fam ancestry schema GetHints
fam ancestry call persons.weblinks '{"path":{"treeId":"TREE","personId":"PERSON"}}'
fam ancestry call cache.persons '{"path":{"treeId":"TREE"},"query":{"page":1,"limit":100}}'
fam ancestry gql GetRecentlyModifiedPersons '{"treeId":"TREE","limit":10}'
fam ancestry gql PersonAlbumListConnection '{"treeId":"TREE","personId":"PERSON","limit":10}'
fam ancestry gql GetPersonsHints '{"treeId":"TREE","personIds":["PERSON"],"limit":20}'
fam ancestry gql GetTreeList '{"limit":20,"nextPageCursor":"CURSOR_FROM_RESPONSE"}'
```

`call` takes `{path,query,headers,body,base,response}`. `gql` takes the exact variables listed by `schema`. Either accepts inline JSON, a JSON filename, or `-` for stdin. IDs should be JSON strings; unquoted integers beyond JavaScript's safe range are preserved as `bigint` in the SDK. `--out FILE` atomically writes JSON with owner-only permissions. Put personal results under `research-output/` to keep them out of Git.

Pagination is explicit. `trees` and other GraphQL connections return `pageInfo`; pass the returned cursor when `hasNextPage` is true. The embedded `GetPersons` document has **no pagination variables**, so `persons` is only that initial connection, not a complete tree export. Use `cache.persons` or the bulk `sync.persons` route for larger extraction after inspecting its contract. REST cache/media calls expose page and limit; record search uses `PagingInfo.PageNumber`, `RecordsPerPage`, and an optional paging token. Requests do not silently fetch every page.

The catalog includes mutations. `gql` and `call` execute the operation explicitly selected by the user, including writes. No live genealogy mutations were used in this research. There is no automatic hint acceptance, tree editing, messaging, or background export.

## TypeScript

First [install fam in your application](../setup.md#typescript-library-use).

```ts
import { AncestryClient } from '@potatosalad/fam/ancestry';

const client = await AncestryClient.open();
const list = await client.trees(20);
const tree = list.trees.treeConnection.nodes[0];
if (!tree?.rootPersonId) throw new Error('Choose a tree and person');
const person = await client.person(tree.treeId, tree.rootPersonId);
const research = await client.research(tree.treeId, tree.rootPersonId);
const hints = await client.hints(tree.treeId, tree.rootPersonId);
const records = await client.search({given: 'Abraham', surname: 'Lincoln', birthYear: 1809, limit: 5});
const recent = await client.graphql('GetRecentlyModifiedPersons', {treeId: tree.treeId, limit: 10});
```

Use the package import shown above; development examples can also run from the fam checkout with `tsx`. GraphQL names and scalar variable types are derived from the embedded documents. Required/unknown variable names are checked at runtime. Custom GraphQL input objects and most response bodies remain `unknown`; REST contracts list native body classes and wire parameters rather than claiming complete TypeScript models. `AncestryGraphQLError.result` retains partial data and server errors for programmatic handling, while the CLI prints a brief error without sensitive payloads.

## Scope and validation

The inventory contains **267 Retrofit declarations in 40 interfaces** (85 GET, 155 POST, 15 PUT, 10 DELETE, 2 PATCH) and **208 embedded GraphQL operations** (131 queries, 77 mutations). See [contracts.json](contracts.json) for every method, route, parameter, variable, source file, and document hash. The CLI adds readable aliases for common genealogy REST operations.

| Area | Available entry points | Live checks |
| --- | --- | --- |
| Trees and people | `trees`, `tree`, `persons`, `person`, tree membership, recently modified people | Passed |
| Families and pedigrees | `relatives`, `persons.pedigree`, `research`, `story` | Passed |
| Hints | `hints`, GraphQL hint/recommendation operations, legacy hint aliases | Person hints passed; others cataloged |
| Records and places | `search`, `record`, record fields/images, collection metadata, `places` | Search, record details, place lookup passed |
| Citations and sources | `citations`, `sources`, cache/count and bulk sync aliases | Cache reads and citation count passed |
| Media and albums | `media`, media connections, album GraphQL operations | Person media REST and GraphQL passed |
| Other app features | DNA, stories, sharing, messaging, account services, mutations | Cataloged; not live tested |

These counts describe extracted declarations, **not every Ancestry API endpoint or 475 proven operations**. Ktor services and dynamically assembled/legacy routes also exist. Some third-party/logging declarations have no Ancestry gateway mapping. `call` requires an explicit, researched `base` for those; all requests remain restricted to the four approved Ancestry origins. No response-model completeness or compatibility with future app releases is implied.

```sh
npm run typecheck
npm test
npm run test:types
npm run build
npm run check:generated        # Existing FamilySearch generation
npm run check:ancestry         # Needs the locally disassembled APK
npm run verify:ancestry        # Live reads; stores responses privately
# Recheck only selected operations and update their report entries:
npm run verify:ancestry -- search.records records.get
```

## Reproduce the APK analysis

Download the pinned bundle from the [APKMirror release page](https://www.apkmirror.com/apk/ancestry-com/ancestry/ancestry-family-history-dna-18-16-3-release/ancestry-family-history-dna-18-16-3-android-apk-download/) in a browser. The Play listing identifies the requested app; the downloaded version is pinned separately and is not claimed to be Play's latest release. Direct automated downloads were blocked; the browser download worked. Put it at `artifacts/ancestry/ancestry-18.16.3.apkm`.

```sh
# Requires Python 3, apktool and a compatible Java runtime.
bash scripts/analyze-ancestry.sh
# Optional JADX Java output (smali is authoritative):
ANALYZE_JAVA=1 bash scripts/analyze-ancestry.sh
# Android SDK build-tools, if available on PATH:
apksigner verify --verbose --print-certs artifacts/ancestry/base.apk
```

The script verifies both SHA-256 hashes before extraction. APK signature verification succeeded and the signer matched the certificate published for Ancestry. JADX processed 30,467 classes and reported 344 method errors; no code from the APK was executed. Smali extraction completed across all five DEX files. APKs, decompiled source, logs, credentials, and personal responses stay local and ignored. Only derived contracts, code, and protocol provenance are committed. Live reports stay in private configuration storage.
