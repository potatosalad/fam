# Find a Grave

The `fam findagrave` command searches memorials and cemeteries, reads biographies and relationships, and lists photographs. Install fam using the [main README](../../README.md#install).

## Sign in

Use your Find a Grave email address when `credentials` asks for a username:

```sh
fam findagrave.credential set
fam findagrave.session login
fam findagrave.account get
```

Credential setup uses `FINDAGRAVE_USERNAME` / `FINDAGRAVE_PASSWORD`, then a configured helper, then a hidden prompt. Pipe login JSON to `fam findagrave.credential set --stdin` to bypass those sources. See [credential lookup](../setup.md#credential-lookup). The CLI validates the contributor profile before saving a session. It does not support Ancestry account linking or browser-session import.

`fam findagrave.session get` shows the configuration directory and saved-session metadata without a network request. `fam findagrave.session verify` checks that the session still identifies the same contributor. It does not extend the session; run `auth` again after expiry. Login and failed API requests are never retried automatically.

Credentials and sessions use the `findagrave/` subdirectory of the shared configuration directory. See [setup details](../setup.md) for profiles, permissions, and resetting a session.

For public research, you can skip sign-in:

```sh
fam findagrave.memorial search --anonymous --first-name Abraham --last-name Lincoln --birth-year 1809
```

## Memorial search

```sh
fam findagrave.memorial search --first-name Abraham --last-name Lincoln --birth-year 1809 --exact
fam findagrave.memorial search --last-name Lincoln --bio president --limit 5 --offset 5
fam findagrave.memorial search --first-name Mary --last-name Todd --include-maiden-name
fam findagrave.memorial search --first-name Wyatt --last-name Earp --relative "Nicholas Earp"
fam findagrave.memorial search --last-name Smith --birth-year 1850 --year-range 2
fam findagrave.memorial search --last-name Smith --death-year 1900 --death-filter before
fam findagrave.memorial search --last-name Smith --death-filter unknown
```

Lists use zero-based offsets; `--limit` accepts 1–100. Use `--sort name`, `birth`, `death`, `cemetery`, `created`, or `modified`, with optional `--descending`. `relevance` and `plot` have no descending variant.

`--bio` accepts up to 50 characters and returns the full biography in `memorialSearch.memorials[].bio.value`, with its language. The value may contain HTML. Keyword text passes through unchanged; see the [biography search guide](https://support.findagrave.com/hc/en-us/articles/53933499258259-Searching-the-bio-field-using-keywords) for search syntax.

`--relative` searches linked relatives' names. `--include-maiden-name` and `--include-nickname` broaden the name fields searched. `--similar` enables similar-name matching and cannot be combined with `--exact`. Date comparisons accept `exact`, `before`, `after`, or `unknown`; `unknown` takes no year, and `--year-range` requires an exact comparison.

For native fields without a flag, pass a JSON object or file to `--input`. Explicit flags override matching fields:

```sh
fam findagrave.memorial search --input '{"lastName":"Lincoln","isVeteran":true,"size":10,"from":0}'
fam findagrave.api.model list --filter MemorialSearchInput
fam findagrave.api.enum list --filter MemorialSearchYearFilter
```

The recovered model inventory is incomplete: the server's `bio` field is absent from the APK inventory. Advanced filter combinations and ranking remain service-dependent.

## Memorials and cemeteries

```sh
fam findagrave.memorial get --memorial-id MEMORIAL_ID
fam findagrave.memorial relatives --memorial-id MEMORIAL_ID
fam findagrave.memorial photos --memorial-id MEMORIAL_ID --limit 20 --offset 0
fam findagrave.location search --name "Springfield, Illinois"
fam findagrave.memorial search --last-name Lincoln --location LOCATION_ID
fam findagrave.cemetery search --name "Oak Ridge Cemetery"
fam findagrave.cemetery get --cemetery-id CEMETERY_ID
fam findagrave.memorial search --cemetery CEMETERY_ID --plot "Section 3"
fam findagrave.contributor get --contributor-id CONTRIBUTOR_ID
```

Copy IDs from responses and keep them as strings. Location IDs have prefixes such as `city_`, `county_`, or `state_`. A memorial includes names, dates, biography, burial information, relationships, and the first 20 photos. Use `photos` for further pages. Most other commands retain the service's response envelope; `cemetery`, for example, returns `cemeteries.cemeteries[]`.

Signed-in account commands include `my-cemeteries`, `virtual-cemeteries`, `volunteer-cemeteries`, and `requests mine|claimed|volunteer`. To read a public virtual cemetery, use `virtual-cemeteries CONTRIBUTOR_ID` and `virtual-cemetery VIRTUAL_CEMETERY_ID`.

## Photos

Photo metadata, pagination, and original-image downloads are supported. An original-photo download was verified against a public memorial without signing in. If the CDN denies a request, open the memorial's Photos tab in a browser.

```sh
fam findagrave.memorial photos --memorial-id MEMORIAL_ID
fam findagrave.photo download --memorial-id MEMORIAL_ID --photo-id PHOTO_ID --out headstone.jpg
```

The downloader resolves the photo within the memorial, requests its returned URL, and decodes the image before saving it. The `.json` sidecar records its source, attribution, dimensions, and SHA-256. Downloads omit account headers and cookies, reject redirects and foreign image hosts, and refuse to overwrite either file. A denied CDN response produces no image file. Photo lookup is bounded to 10,000 entries.

## API catalog

```sh
fam findagrave.api list --filter memorial
fam findagrave.api describe --operation memorial
fam findagrave.api.gql query --operation MemorialSearch --variables '{"input":{"lastName":"Lincoln","size":5,"from":0}}'
fam findagrave.api call --operation requests.mine --input '{"query":{"limit":5,"skip":0}}'
fam findagrave.api.gql execute --document /path/to/query.graphql --variables /path/to/variables.json
fam findagrave.api.http-site list --filter transcription
```

JSON input accepts inline objects, filenames, or `-` for stdin. Commands print readable text by default; add `--json` for structured output. `--out FILE` saves provider data as JSON. Keep personal research outside Git.

Some GraphQL names are ambiguous. Use a full operation ID or alias: `memorial` selects the complete profile, and `memorial.edits` selects pending edits. Authentication operations are reserved for `auth`, so generic commands cannot print returned login tokens.

Selected mutations and REST writes execute immediately. Some write routes use HTTP GET, including photo-request claim/unclaim/delete and saved-cemetery add/remove. Inspect `schema NAME` and its `write` flag before running a REST operation.

The catalog has 32 GraphQL documents, 36 executable REST routes, and 47 HTTP call sites from Android 4.0.2. The remaining call sites are inventories, not complete request contracts. See the [operation index](operations.md) and [protocol notes](protocol.md) for coverage and extraction steps.

## TypeScript

First [install fam in your application](../setup.md#typescript-library-use).

```ts
import { FindagraveClient, searchInput, memorialPhotos } from '@potatosalad/fam/findagrave';

const client = await FindagraveClient.open(); // Uses the session saved by the CLI.
const results = await client.search(searchInput({lastName: 'Lincoln', size: 5}));
const photos = await memorialPhotos(client, 'MEMORIAL_ID', 20, 0);
```

Use `FindagraveClient.open(true)` for anonymous reads. `graphql<T>` and `query<T>` accept a response type when your code knows the shape; no complete generated response schema is provided.
