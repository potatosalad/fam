# MyHeritage CLI

Create output folders before using these examples: `mkdir -p research-output/ancestry research-output/myheritage`. This folder is ignored in the checkout; keep exports outside Git elsewhere.

`myheritage` is a TypeScript/Node CLI derived from MyHeritage Android 7.5.44. It includes 164 REST declarations, 135 GraphQL documents, and 210 FamilyGraph models, plus website-backed historical-record research. The CLI sends HTTP directly and has no browser automation dependency.

See the [main README](../../README.md) for installation and credential storage. Browser sessions support selected tree reads and historical research; native API availability is not fully verified and can be blocked by reCAPTCHA. Offline catalog coverage does not establish live API access.

## Authentication

For the practical browser-session setup, follow the [HAR capture instructions](../../README.md#myheritage), then run:

```sh
myheritage auth --har /absolute/path/to/session.har
myheritage status
myheritage me
```

For optional native password login:

```sh
myheritage credentials
myheritage auth
```

`credentials` uses a hidden prompt, `MYHERITAGE_USERNAME` / `MYHERITAGE_PASSWORD`, or a JSON object piped to `credentials --stdin`. API login uses environment values before saved credentials. An existing session is reused until a new login is requested or required.

Native login posts the APK's form fields to `/FP/API/Mobile/login.php`. It persists the returned FamilyGraph bearer token, opaque AccountID, user ID, device ID, and cookies. It supports the APK's MFA and verification parameters:

```sh
myheritage auth --code CODE
myheritage auth --verification-code CODE
myheritage auth --recaptcha-token-file research-output/myheritage/recaptcha-token.txt
```

The reCAPTCHA option accepts an actual token obtained through legitimate verification; the CLI does not generate or bypass a challenge. A password alone may be insufficient. Respect any temporary access restriction. A service rejection can record a local cooldown that prevents repeated password requests.

### Use an already authenticated browser session

If the browser is already signed in, no password login is needed:

1. Open DevTools → Network and reload your MyHeritage family tree.
2. Export a HAR **including sensitive data**, so cookies and authorization are retained. Save it under the ignored `research-output/myheritage/` directory.
3. Import and validate the existing API token:

```sh
myheritage auth --har research-output/myheritage/session.har
myheritage me
```

The importer reads successful requests to FamilyGraph, FamilyGraphQL, or their MyHeritage website proxy paths. For a browser HAR it retains the tree-page URL, user agent, token and MyHeritage API cookies. It validates a freshly fetched, signed-in tree page and the account-permissions API before saving. Browser tokens are not assumed to authorize the native API. A direct native API HAR is separately validated against FamilyGraph `/me`. A sanitized HAR, or one containing only HTML, may lack the needed API credentials.

HAR files contain session credentials and personal data. Keep them outside Git and delete the exported HAR after import. Sessions are stored under `myheritage/` in the configuration root reported by `myheritage status`; nothing is copied from another machine automatically.

## Search historical records

```sh
myheritage search --first-name Abraham --last-name Lincoln \
  --birth-year 1809 --birth-place Kentucky --exact
myheritage collections census
myheritage search --first-name Abraham --last-name Lincoln --collection 10826 --exact
myheritage collection 10826
# Copy a complete link from search results:
myheritage record "RECORD_URL"
```

These commands use the saved website session. Search supports names, dates, places, relatives, keywords, collection/category scopes, record types and pagination. Advanced options add independent name matching, year ranges, translated-name controls, and collection-specific criteria through `search-fields` and `search --field`. `record` returns visible fields and source citations, plus image links when present. `document URL` lists the viewer’s original pages; `download-document URL --page 1 --out scan.jpg` saves a page with a source/checksum sidecar. [Full examples and coverage](research.md) include JSON input and TypeScript usage.

## Research someone already in a tree

IDs are service IDs such as `site-…`, `tree-…`, `individual-…`, and `family-…`; copy them from API results rather than website URLs. Keep them as strings.

After authentication, discover the account's defaults:

```sh
myheritage me --out research-output/myheritage/me.json
myheritage sites

SITE=$(jq -r '.default_site.id' research-output/myheritage/me.json)
TREE=$(jq -r '.default_site.default_tree.id' research-output/myheritage/me.json)
PERSON=$(jq -r '.default_individual.id' research-output/myheritage/me.json)

myheritage trees "$SITE"
myheritage tree "$TREE"
myheritage people "$TREE" --limit 25 --offset 0
myheritage find "$TREE" 'Smith'
myheritage person "$PERSON"
myheritage facts "$PERSON"
myheritage timeline "$PERSON"
myheritage events "$PERSON"
myheritage matches "$PERSON" --limit 20
myheritage insights "$PERSON"
myheritage media "$PERSON"
```

For browser sessions, `sites` covers the captured site and `trees` lists its tree menu. `people` returns the visible tree neighborhood with explicit `total_tree_people`, `available_people` and pagination; distant people may be pruned. `find` searches names in the selected tree through the website lookup API. Browser tree/person commands also accept numeric IDs local to that site. To switch sites, import a HAR from the other site.

`person` returns the website profile card, relatives, facts, photo metadata and research links. `events`, `timeline` and `facts` return the card's fact/event list. `insights` returns family groups and event facts with available citations, notes and media. `matches` returns Smart Match and record-match **counts**, not full match records. `media` accepts a person ID in browser mode. Empty results mean the request succeeded with no visible records.

The remaining shortcuts (`family`, `records`, `albums`, `consistency`), custom GraphQL/REST calls, and mutations require native API authentication. They are implemented from the APK and tested offline, but are not fully verified against the native service. Native `people` uses a curated paginated query; native `sites` reads memberships. These differ from the explicitly scoped browser results.

Historical-person search and record viewing use the web service reached from the APK's research WebViews. The CLI now implements that research flow separately from the native catalog. DNA, image processing, subscriptions and other features remain subject to account permissions and service entitlements.

## Every recovered operation (native API session required for execution)

```sh
myheritage ops individual
myheritage ops match
myheritage ops transcription
myheritage ops mutation
myheritage schema person.update
myheritage schema graphql.embedded.getRelationshipDiagram
myheritage models Individual

myheritage gql graphql.individual.search_individuals \
  '{"treeId":"TREE_ID","query":"Smith","limit":20,"lang":"EN"}'
myheritage call person '{"path":{"individualId":"PERSON_ID"}}'
myheritage get me --query '{"fields":"id,name,default_site.(id)"}'
```

`gql` accepts the full catalog ID or an unambiguous GraphQL operation name. Duplicate names are deliberately rejected rather than selecting a different query. `schema` includes the complete document, variables, source reference, and actual route. REST schemas include path/query/body bindings, generic response signatures, headers, encoding, and base URL.

JSON arguments can be inline objects, filenames, or `-` for UTF-8 stdin. Use `--out FILE` for private, atomic output. For custom GraphQL, use `myheritage query query.graphql variables.json`.

Mutations are exposed and run when explicitly selected. Inspect the schema and current object before editing. For example, `myheritage call person.update update.json` takes `{"path":{"individualId":"PERSON_ID"},"body":{"first_name":"NAME"}}`. No genealogy edits, purchases or messages were executed during research or verification. Record search uses a GraphQL mutation and may update recent-search history.

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

```ts
import {MyHeritageClient} from '@potatosalad/familysearch/myheritage';

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
