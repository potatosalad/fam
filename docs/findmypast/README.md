# Findmypast

The `fam findmypast` command browses trees, searches records and newspapers, and downloads record images. Install fam using the [main README](../../README.md#install).

## Sign in

Run browser sign-in and a read-only account check:

```sh
fam findmypast.session login
fam findmypast.account get
```

Camofox retains the website session and tries configured credentials when needed. Complete MFA or CAPTCHA at the printed viewer URL. Use `--region co.uk` for the UK website or `--interactive` to autofill credentials and submit yourself. Add `--no-autofill` to leave the fields untouched. See [browser setup](../browser.md). `--capture` remains an alias, and `--har FILE` imports an existing capture. Browser session renewal is bounded to one attempt per rejected operation.

Login reuses a working fam tab for the selected region, including a sign-in already in progress. Closed or crashed tabs are skipped. It validates the current account before saving the session; retrying after completing sign-in does not open another tab or submit credentials again.

If an old home or research page has lost its authentication, fam opens sign-in in that tab once. It recognizes Findmypast's specific logged-out `BAD_USER_INPUT` response and resumes after account verification. Other API errors are reported directly instead of leaving login waiting indefinitely. A successful renewal replaces the request cookies, headers, and regional API address before retrying the interrupted operation; concurrent failures share that renewal.

Both `--transport browser` and `--transport http` use the saved website session. Browser login remembers browser routing for that website. Public content and requests explicitly marked anonymous do not trigger login renewal.

## Native login and existing HAR files

`fam findmypast.session login --native` retains the mobile password flow. If it requires browser verification, the default Camofox website login is available. For compatibility with a native-app callback file, `fam findmypast.session login --native --browser` starts native authorization and `fam findmypast.session login --callback-file FILE` completes it.

`fam findmypast.session login --har FILE` validates cookies from an existing successful website GraphQL capture. See [capture compatibility](../browser-capture.md).

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
