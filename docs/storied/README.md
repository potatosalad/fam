# Storied

`fam storied` signs in through Storied's native Auth0 client and calls its REST API. It supports trees, people, pedigrees, relatives, events, hints, saved records, stories, historical search, media, groups, and account metadata. The offline catalog includes 728 consumer operations and 1,021 model schemas.

Use the [shared setup guide](../setup.md) to install fam and [browser setup](../browser.md) to configure local Docker or a remote Camofox URL. Node 22.16+ is required. Ordinary API commands use renewable native tokens.

## Sign in

```sh
fam storied.credential set
fam storied.session login
fam storied.session verify
fam cli.health check --provider storied
fam storied.session get
```

Credentials use the shared precedence: `STORIED_USERNAME` and `STORIED_PASSWORD`, configured credential helper, saved `storied/login.json`. Passwords are not command-line arguments. The default `auth` command submits configured credentials once to the real Storied login form in the selected persistent Camofox browser. It exchanges the native callback's authorization code using PKCE, validates `/userinfo`, and checks the account tree list before saving the session. Direct password grants are disabled for this mobile client.

For Google, Apple, MFA, or another interactive verification step, use `fam storied.session login --interactive` and open the configured noVNC URL from any machine that can reach it. Empty login fields are autofilled from configured credentials; you submit the form yourself. Add `--no-autofill` to leave the fields untouched. Cookies and browser storage are retained on the browser host; no HAR is generated. Passwords, callback codes, and PKCE verifiers are not persisted. Browser exceptions are suppressed because they can contain credentials.

Session files live under `~/.config/fam/storied/`, or the directory selected by `FAM_CONFIG_DIR`. Files are written atomically with mode 0600 in private directories. `status` reports local metadata only. `verify` and `fam cli.health check --provider storied` check current API access. `refresh` explicitly renews and validates the session. Normal reads renew at most once; writes are never replayed after an auth rejection. A rotated token is saved before subsequent API work. A configured post-save sync hook also applies to Storied.

## Genealogy and content

```sh
fam storied.tree list
fam storied.tree get --tree-id TREE_UUID
fam storied.person list --tree-id TREE_UUID
fam storied.person search --name Lincoln
fam storied.person get --person-id PERSON_UUID
fam storied.person pedigree --tree-id TREE_UUID --person-id PERSON_UUID --generations 4
fam storied.person family --tree-id TREE_UUID --person-id PERSON_UUID
fam storied.person events --tree-id TREE_UUID --person-id PERSON_UUID
fam storied.person hints --person-id PERSON_UUID
fam storied.person records --person-id PERSON_UUID
fam storied.person stories --person-id PERSON_UUID --page 1 --limit 20
fam storied.story list
fam storied.story get --story-id STORY_UUID
fam storied.feed get
fam storied.media list --limit 20
fam storied.group list
fam storied.subscription get
fam storied.account get
```

IDs are strings, usually UUIDs. `people` returns objects whose person identifier is `id`; tree lists use `treeId` and `homePersonId`. Paginated commands return one page, with `--page` starting at 1 and `--limit` between 1 and 100. `trees` and `people` use unpaginated provider routes. `--out FILE` saves JSON with owner-only permissions. Full responses may contain personal data.

```sh
fam storied.record search --first-name Abraham --last-name Lincoln --limit 10
fam storied.record search --input search.json --page 2
fam storied.media list --input '{"mediaTypes":["Photo"]}'
fam storied.mobile.version get
```

Search uses the current structured universal-search API. `--input` accepts its body fields; inspect `fam storied.api.model get --name UniversalSearchDynamicQuery` and referenced models for available filters. Search results can be masked by the account's subscription; an HTTP success does not establish access to every record or image. `--anonymous` omits credentials, with access still enforced by the server. `mobile-version` is public and needs no account.

## Operation and model catalog

```sh
fam storied.api list --filter pedigree
fam storied.api describe --operation pedigree
fam storied.api describe --operation getFamilyTrees
fam storied.api.model list --filter TreeDto
fam storied.api.model get --name TreeDto
fam storied.api call --operation trees --input '{"query":{"includePersonCount":true}}'
fam storied.api call --operation 'GET /api/Persons/{personId}/savedrecords' --input request.json
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
