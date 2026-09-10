# MyHeritage CLI

Create output folders before using these examples: `mkdir -p research-output/myheritage`. This folder is ignored in the checkout; keep exports outside Git elsewhere.

`fam myheritage` is a TypeScript/Node CLI derived from MyHeritage Android 7.5.44. It includes 164 REST declarations, 135 GraphQL documents, and 210 FamilyGraph models, plus website-backed historical-record research. Sign-in uses persistent Camofox. Research requests use direct HTTP or the browser according to the selected transport and remembered website challenges.

See the [main README](../../README.md) for installation and credential storage. Browser sessions support selected tree reads and historical research; native API availability is not fully verified and can be blocked by reCAPTCHA. Offline catalog coverage does not establish live API access.

## Documentation and API evidence

- [Historical-record research](research.md): website search fields, record citations, document pages, and downloads.
- [Native contracts](contracts.json): recovered REST declarations, GraphQL documents, and models; generated with `npm run generate:catalogs`.
- [Protocol and APK provenance](protocol.md), [provenance.json](provenance.json), and [website research provenance](research-provenance.json): what was recovered and how.

`fam myheritage.api list` and `fam myheritage.api describe --operation NAME` inspect the native catalog locally. Website research is maintained separately from that Android catalog. See [provider contract conventions](../development.md#provider-api-contracts).

## Authentication

For browser autofill, run `fam myheritage.credential set` to save a username and password, or configure `MYHERITAGE_USERNAME` / `MYHERITAGE_PASSWORD` or a helper receiving `myheritage`. An existing browser login can be reused without saving a password. All modes use the [shared credential lookup](../setup.md#credential-lookup).

Run `fam myheritage.session login`. fam reuses the selected browser session or tries configured credentials, and opens or prints the viewer URL when interaction is needed. It validates the signed-in tree and account permissions before saving. See [browser setup](../browser.md). `fam myheritage.session get` shows metadata; `fam myheritage.account get` checks live access.

Use `fam myheritage.session login --interactive` to autofill empty username and password fields while leaving submission to you. Add `--no-autofill` to leave those fields untouched. Interactive mode never submits the form automatically, including during an earlier login cooldown.

For optional native password login:

```sh
fam myheritage.credential set
fam myheritage.session login --native
```

For native password login, `credentials` follows the [shared lookup rules](../setup.md#credential-lookup): environment variables, configured helper, then a hidden prompt. `--stdin` supplies login JSON directly. Native login checks `MYHERITAGE_USERNAME` / `MYHERITAGE_PASSWORD`, then the helper, then saved credentials. Browser-session import uses the HAR instead. Existing sessions are reused.

Native login posts the APK's form fields to `/FP/API/Mobile/login.php`. It persists the returned FamilyGraph bearer token, opaque AccountID, user ID, device ID, and cookies. It supports the APK's MFA and verification parameters:

```sh
fam myheritage.session login --code CODE
fam myheritage.session login --verification-code CODE
fam myheritage.session login --recaptcha-token-file research-output/myheritage/recaptcha-token.txt
```

The reCAPTCHA option accepts an actual token obtained through legitimate verification; the CLI does not generate or bypass a challenge. A password alone may be insufficient. Respect any temporary access restriction. A service rejection can record a local cooldown that prevents repeated password requests.

### Use an already authenticated browser session

If the browser is already signed in, no password login is needed:

1. Open DevTools → Network and reload your MyHeritage family tree.
2. Export a HAR **including sensitive data**, so cookies and authorization are retained. Save it under the ignored `research-output/myheritage/` directory.
3. Import and validate the existing API token:

```sh
fam myheritage.session login --har research-output/myheritage/session.har
fam myheritage.account get
```

The importer reads successful requests to FamilyGraph, FamilyGraphQL, their MyHeritage website proxy paths, or a full signed-in tree response containing its account token. For a browser HAR it retains the tree-page URL, user agent, token and MyHeritage API cookies. It validates a freshly fetched, signed-in tree page and the account-permissions API before saving. Browser tokens are not assumed to authorize the native API. A direct native API HAR is separately validated against FamilyGraph `/me`. A sanitized HAR, or one containing only HTML, may lack the needed API credentials.

HAR files contain session credentials and personal data. Keep them outside Git and delete the exported HAR after import. Sessions are stored under `myheritage/` in the configuration root reported by `fam myheritage.session get`; nothing is copied from another machine automatically.

## Search historical records

```sh
fam myheritage.record search --first-name Abraham --last-name Lincoln  --birth-year 1809 --birth-place Kentucky --exact
fam myheritage.collection search --name census
fam myheritage.record search --first-name Abraham --last-name Lincoln --collection 10826 --exact
fam myheritage.collection get --collection-id 10826
# Copy a complete link from search results:
fam myheritage.record get --url "RECORD_URL"
```

These commands use the saved website session. Search supports names, dates, places, relatives, keywords, collection/category scopes, record types and pagination. Advanced options add independent name matching, year ranges, translated-name controls, and collection-specific criteria through `search-fields` and `search --field`. `record` returns visible fields and source citations, plus image links when present. `document URL` lists the viewer’s original pages; `download-document URL --page 1 --out scan.jpg` saves a page with a source/checksum sidecar. [Full examples and coverage](research.md) include JSON input and TypeScript usage.

Both `--transport browser` and `--transport http` support record search with the saved website login. Browser login currently remembers a browser route for the website, so subsequent `auto` requests use Camofox. Add `--transport http` to use direct HTTP for an individual command; this retains the same saved login.

## Research someone already in a tree

IDs are service IDs such as `site-…`, `tree-…`, `individual-…`, and `family-…`; copy them from API results rather than website URLs. Keep them as strings.

After authentication, discover the account's defaults:

```sh
fam myheritage.account get --out research-output/myheritage/me.json
fam myheritage.site list

SITE=$(jq -r '.default_site.id' research-output/myheritage/me.json)
TREE=$(jq -r '.default_site.default_tree.id' research-output/myheritage/me.json)
PERSON=$(jq -r '.default_individual.id' research-output/myheritage/me.json)

fam myheritage.tree list --site-id "$SITE"
fam myheritage.tree get --tree-id "$TREE"
fam myheritage.person list --tree-id "$TREE" --limit 25 --offset 0
fam myheritage.person search --tree-id "$TREE" --name 'Smith'
fam myheritage.person get --person-id "$PERSON"
fam myheritage.person facts --person-id "$PERSON"
fam myheritage.person timeline --person-id "$PERSON"
fam myheritage.person events --person-id "$PERSON"
fam myheritage.person matches --person-id "$PERSON" --limit 20
fam myheritage.person insights --person-id "$PERSON"
fam myheritage.media list --parent-id "$PERSON"
```

For browser sessions, `sites` covers the captured site and `trees` lists its tree menu. `people` returns the visible tree neighborhood with explicit `total_tree_people`, `available_people` and pagination; distant people may be pruned. `find` searches names in the selected tree through the website lookup API. Browser tree/person commands also accept numeric IDs local to that site. To switch sites, run `fam myheritage.session login --tree-url URL` for the other site.

`person` returns the website profile card, relatives, facts, photo metadata and research links. `events`, `timeline` and `facts` return the card's fact/event list. `insights` returns family groups and event facts with available citations, notes and media. `matches` returns Smart Match and record-match **counts**, not full match records. `media` accepts a person ID in browser mode. Empty results mean the request succeeded with no visible records.

The remaining shortcuts (`family`, `records`, `albums`, `consistency`), custom GraphQL/REST calls, and mutations require native API authentication. They are implemented from the APK and tested offline, but are not fully verified against the native service. Native `people` uses a curated paginated query; native `sites` reads memberships. These differ from the explicitly scoped browser results.

Historical-person search and record viewing use the web service reached from the APK's research WebViews. The CLI implements that research flow separately from the native catalog. DNA, image processing, subscriptions and other features remain subject to account permissions and service entitlements.

## Every recovered operation (native API session required for execution)

```sh
fam myheritage.api list --filter individual
fam myheritage.api list --filter match
fam myheritage.api list --filter transcription
fam myheritage.api list --filter mutation
fam myheritage.api describe --operation person.update
fam myheritage.api describe --operation graphql.embedded.getRelationshipDiagram
fam myheritage.api.model list --filter Individual

fam myheritage.api.gql query --operation graphql.individual.search_individuals --variables '{"treeId":"TREE_ID","query":"Smith","limit":20,"lang":"EN"}'
fam myheritage.api call --operation person --input '{"path":{"individualId":"PERSON_ID"}}'
fam myheritage.api get --path me --query '{"fields":"id,name,default_site.(id)"}'
```

`gql` accepts the full catalog ID or an unambiguous GraphQL operation name. Duplicate names are deliberately rejected rather than selecting a different query. `schema` includes the complete document, variables, source reference, and actual route. REST schemas include path/query/body bindings, generic response signatures, headers, encoding, and base URL.

JSON arguments can be inline objects, filenames, or `-` for UTF-8 stdin. Use `--out FILE` for private, atomic output. For custom GraphQL, use `fam myheritage.api.gql execute --document query.graphql --variables variables.json`.

Mutations are exposed and run when explicitly selected. Inspect the schema and current object before editing. For example, `fam myheritage.api call --operation person.update --input update.json` takes `{"path":{"individualId":"PERSON_ID"},"body":{"first_name":"NAME"}}`. No genealogy edits, purchases or messages were executed during research or verification. Record search uses a GraphQL mutation and may update recent-search history.

Multipart operations accept `parts` in their JSON input:

```json
{
  "path": {"parentId": "PARENT_ID"},
  "parts": {
    "data": {"value": "{\"title\":\"Photo title\"}"},
    "file": {"file": "/path/to/photo.jpg", "type": "image/jpeg"}
  }
}
```

Dynamic file upload/download declarations take `url`; uploads can also take `bodyFile` to read bytes from disk. External signed file transfers omit account authorization and cookies and reject redirects; they do not forward the bearer token to storage providers. Binary results require `--out`.

## TypeScript

First [install fam in your application](../setup.md#typescript-library-use).

```ts
import {MyHeritageClient} from '@potatosalad/fam/myheritage';

const client = await MyHeritageClient.open();
const person = await client.person('PERSON_ID');
const matches = await client.matches('PERSON_ID', {limit: 20, offset: 0});
// Native API session required for catalog GraphQL execution:
const photos = await client.graphql('graphql.photos.get_individual_photos', {
  individualID: 'PERSON_ID', photosLimit: 20, photosOffset: 0,
});
```

GraphQL variable names, required fields, scalar types, and arrays are typed from the catalog. Complex input objects and most responses remain open structural types: this is not a complete server SDL or a fully generated response SDK. The recovered models are a field inventory, not a guarantee of server-required fields. Large JSON integers round-trip losslessly.

## Reproduce and verify

```sh
python3 scripts/download-myheritage.py
# Requires apktool, JADX, and a compatible Java runtime:
bash scripts/analyze-myheritage.sh
npm run check:myheritage
npm run typecheck
npm run test:types
npm test
# Requires a saved session; never attempts password login:
npm run verify:myheritage
npm run verify:myheritage:research
```

Set `JAVA_HOME` to your Java installation if the analysis tools require it. The bundle and base hashes are pinned; changed content is rejected. Full smali is authoritative because JADX reported 75 partial decompilation errors. APKs and decompiled vendor code stay ignored; the reproducible scripts, contract metadata, client, tests, and docs are committed.

See [protocol and coverage](protocol.md), [provenance](provenance.json), and the machine-readable [contracts](contracts.json).
