# Storied

`fam storied` signs in through Storied's native Auth0 client and calls its REST API. It supports trees, people, pedigrees, relatives, events, hints, saved records, stories, historical search, media, groups, and account metadata. The offline catalog includes 728 consumer operations and 1,021 model schemas.

Use the [shared setup guide](../setup.md) to install `fam`. Node 22.16+ is required. Authentication also needs Chrome or Playwright Chromium. For Chromium, run `node node_modules/playwright/cli.js install chromium` in the installed fam package directory; on Linux its system dependencies must also be installed. `--browser-channel chrome` or `msedge` selects an installed browser. Normal API commands need only Node, including on servers.

## Sign in

```sh
fam storied credentials
fam storied auth
fam storied verify
fam doctor storied
fam storied status
```

Credentials use the shared precedence: `STORIED_USERNAME` and `STORIED_PASSWORD`, configured credential helper, saved `storied/login.json`. Passwords are not command-line arguments. The default `auth` command submits configured credentials once to the real Storied login form in an ephemeral headless browser. It exchanges the native callback's authorization code using PKCE, validates `/userinfo`, and checks the account tree list before saving the session. Direct password grants are disabled for this mobile client.

For Google, Apple, MFA, or another interactive verification step, use `fam storied auth --interactive` on a machine with a display. No browser profile or HAR is saved. Passwords, callback codes, and PKCE verifiers are not persisted. Browser exceptions are suppressed because they can contain credentials.

Session files live under `~/.config/fam/storied/`, or the directory selected by `FAM_CONFIG_DIR`. Files are written atomically with mode 0600 in private directories. `status` reports local metadata only. `verify` and `fam doctor storied` check current API access. `refresh` explicitly renews and validates the session. Normal reads renew at most once; writes are never replayed after an auth rejection. A rotated token is saved before subsequent API work. A configured post-save sync hook also applies to Storied.

## Genealogy and content

```sh
fam storied trees
fam storied tree TREE_UUID
fam storied people TREE_UUID
fam storied find-people Lincoln
fam storied person PERSON_UUID
fam storied pedigree TREE_UUID PERSON_UUID --generations 4
fam storied family TREE_UUID PERSON_UUID
fam storied events TREE_UUID PERSON_UUID
fam storied hints PERSON_UUID
fam storied records PERSON_UUID
fam storied person-stories PERSON_UUID --page 1 --limit 20
fam storied stories
fam storied story STORY_UUID
fam storied feed
fam storied media --limit 20
fam storied groups
fam storied subscription
fam storied me
```

IDs are strings, usually UUIDs. `people` returns objects whose person identifier is `id`; tree lists use `treeId` and `homePersonId`. Paginated commands return one page, with `--page` starting at 1 and `--limit` between 1 and 100. `trees` and `people` use unpaginated provider routes. `--out FILE` saves JSON with owner-only permissions. Full responses may contain personal data.

```sh
fam storied search --first-name Abraham --last-name Lincoln --limit 10
fam storied search --input search.json --page 2
fam storied media --input '{"mediaTypes":["Photo"]}'
fam storied mobile-version
```

Search uses the current structured universal-search API. `--input` accepts its body fields; inspect `fam storied model UniversalSearchDynamicQuery` and referenced models for available filters. Search results can be masked by the account's subscription; an HTTP success does not establish access to every record or image. `--anonymous` omits credentials, with access still enforced by the server. `mobile-version` is public and needs no account.

## Operation and model catalog

```sh
fam storied ops pedigree
fam storied schema pedigree
fam storied schema getFamilyTrees
fam storied models TreeDto
fam storied model TreeDto
fam storied call trees '{"query":{"includePersonCount":true}}'
fam storied call 'GET /api/Persons/{personId}/savedrecords' request.json
```

`call` accepts `{path,query,body}`. Inline JSON, a filename, and `-` for stdin are supported. Required path parameters and structural request types are validated. Arrays in query strings repeat their parameter name. Unknown query keys are rejected. Long integers remain exact. Each operation includes its method, route, API version, parameter schemas, body schema, response schemas, and any matched APK method/function IDs. Model references use the full names from `models` when short names are ambiguous.

Catalog writes execute immediately; inspect their schemas before use. Multipart/form-data routes are documented but not executable through the JSON-only `call` interface. Administrative routes are excluded. The catalog is broader than the convenience commands; most operations have not been exercised live, and the service can change.

## TypeScript

```ts
import {StoriedClient, operation} from '@potatosalad/fam/storied';
const client = await StoriedClient.open();
const trees = await client.trees();
const details = await client.person('12345678-1234-1234-1234-123456789012');
console.log(operation('pedigree'));
```

Responses retain the provider's shape and are typed as `unknown`; the offline model catalog describes their structure. See [protocol.md](protocol.md) and [provenance.json](provenance.json) for sources and scope. No write operations are included in routine live verification.
