# Findmypast

The `fam findmypast` command browses trees, searches records and newspapers, and downloads record images. Install fam using the [main README](../../README.md#install).

## Sign in

Run the capture command and sign in in the window that opens. Complete any verification there; fam captures the account request, saves a sensitive HAR privately, and validates and imports it automatically.

```sh
fam findmypast.session login --capture
fam findmypast.account get
fam findmypast.tree list
```

Use `fam findmypast.session login --capture --region co.uk` for the UK website. No saved password or DevTools export is required. See [browser capture](../browser-capture.md) for storage and browser options. Run the same command if the session expires. `refresh` checks browser cookies and saves updates, but cannot sign back in for you.

To import an existing file, use `fam findmypast.session login --har /path/to/session.har`. It must include a successful `/titan/marshal/graphql` request with cookies from `.com` or `.co.uk`; a sanitized HAR will not work. The importer checks your profile before saving the session.

Run `fam findmypast.session get` to see the configuration directory and saved-session metadata. Findmypast keeps its files in the `findmypast/` subdirectory of that directory. See [setup details](../setup.md) for profiles and file permissions.

### Native password login

If your account allows the app's password login:

```sh
fam findmypast.credential set
fam findmypast.session login
fam findmypast.account get
```

`credentials` uses `FINDMYPAST_USERNAME` / `FINDMYPAST_PASSWORD`, then a configured helper, then a hidden prompt. Pipe login JSON to `fam findmypast.credential set --stdin` to bypass those sources. See [credential lookup](../setup.md#credential-lookup).

Findmypast may require browser verification. The CLI remembers that response and stops further password attempts. Use HAR import, or complete the app's browser flow:

```sh
fam findmypast.session login --browser
```

Open the returned URL. After signing in, save the full `com.findmypast.prod://...` callback URL to a private file. A desktop browser may show it in the console when no app handles the link. Exchange it within 30 minutes:

```sh
fam findmypast.session login --callback-file /private/path/callback.txt
```

Delete the callback file afterward. This flow requires access to the callback URL; use HAR import if your browser does not expose it. Native login and token renewal are covered by mocked tests, but have not been verified against a live account in this project.

API commands require a saved session and never start password login. Native sessions can renew once on expiry or HTTP 401; failed requests do not fall back to password login.

## Trees and people

```sh
fam findmypast.tree list --limit 20 --offset 0
fam findmypast.tree get --tree-id TREE_ID
fam findmypast.person list --tree-id TREE_ID
fam findmypast.person get --tree-id TREE_ID --person-id PERSON_ID
fam findmypast.person relatives --tree-id TREE_ID --person-id PERSON_ID
fam findmypast.person facts --person-id PERSON_ID
fam findmypast.person hints --tree-id TREE_ID --person-id PERSON_ID
fam findmypast.person media --person-id PERSON_ID
```

Use IDs returned by your account's trees and people. `people` includes tree metadata and root-person information. `person` selects a person from the family view. `subscription` returns your plan details.

## Historical records

```sh
fam findmypast.collection search --name census
fam findmypast.record search --first-name Ada --last-name Lovelace --birth-year 1815  --year-range 2 --country England --exact --sort birth
fam findmypast.record search --last-name Lovelace --page 2
fam findmypast.collection get --collection-id COLLECTION_ID
fam findmypast.record entitlement --record-id RECORD_ID
fam findmypast.record get --record-id RECORD_ID --out transcript.json
fam findmypast.image download --record-id RECORD_ID --out scan.jpg
```

Record pages start at 1 and use the service's page size. Use `--year`, `--birth-year`, or `--death-year` with `--year-range` for a date range. Sorting accepts `relevance`, `first-name`, `last-name`, `birth`, `death`, `year`, or `collection`; add `--descending` for a field sort.

For additional search fields, pass `--filters` an inline object or JSON file containing `{"filter":[{"field":"LastName","values":["Lovelace"]}]}`.

`record` requests the transcript with purchase confirmation disabled. Access still depends on your account. `download` accepts only free or already-unlocked images, validates the full-resolution JPEG, and saves `scan.jpg.json` with source information, dimensions, and SHA-256. It replaces existing files at those paths. PDF and newspaper-page downloads are not supported.

## Newspapers

```sh
fam findmypast.newspaper search --name "Ada Lovelace" --country England  --from 1839-01-01 --to 1852-12-31 --sort date --limit 20
fam findmypast.newspaper search --keywords mathematics --publication "Example Gazette"  --offset 20
fam findmypast.newspaper manifest --newspaper-id MANIFEST_ID
```

Names and publication titles can be repeated. Location filters are `--country`, `--county`, and `--place`. Date filters require both endpoints. Results contain snippets, issue metadata, and page references, rather than full OCR. Use a manifest ID from those references with `newspaper-manifest`.

## API access

```sh
fam findmypast.api list --filter hint
fam findmypast.api describe --operation GetListOfTrees
fam findmypast.api.gql query --operation GetListOfTrees --variables '{"offset":0,"limit":20}'
fam findmypast.api.model list --filter SearchFilter
fam findmypast.api call --operation content.repository --anonymous
```

`gql` executes a catalog operation; `query FILE [JSON_OR_FILE]` executes a named custom GraphQL operation. `call NAME [JSON_OR_FILE]` accepts REST arguments in `{path,query,headers,body,parts}`. Run `--help` for all commands and flags. JSON arguments accept inline objects, filenames, or `-` for stdin. Keep IDs as strings.

Catalog operations can edit or delete data and spend credits. In particular, the embedded `GetTranscriptById` mutation confirms purchases; use `record` for a transcript read without confirmation. Inspect `schema NAME` before executing unfamiliar operations.

The catalog contains 110 GraphQL operations and 17 REST declarations extracted from Android 2.59.0. These counts describe recovered contracts, not successful live calls. Browser sessions cannot use the legacy asset service. See the [protocol notes](protocol.md) for routes, extraction steps, and coverage limits.

## TypeScript

First [install fam in your application](../setup.md#typescript-library-use).

```ts
import { FindmypastClient, searchFilters } from '@potatosalad/fam/findmypast';

const client = await FindmypastClient.open(); // Uses the session saved by the CLI.
const records = await client.search(searchFilters({lastName: 'Lovelace'}));
```

Responses default to `unknown`; supply a generic type to `graphql<T>` or `query<T>` when your code knows the response shape. `FindmypastGraphQLError` retains partial GraphQL results for inspection, so treat the error object as private account data.
