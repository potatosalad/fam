# Historical-record research

Create output folders before using these examples: `mkdir -p research-output/ancestry research-output/myheritage`. This folder is ignored in the checkout; keep exports outside Git elsewhere.

The Android app has historical-record research. Its `MHResearchView` opens `/FP/genealogySearchMobile.php`, and `ResearchFragment` opens `/research/collection-ID/` through `HybridWebView`. The native APK's REST/GraphQL catalog alone does not include the main search request: that request is implemented in the JavaScript downloaded by these WebViews. The CLI follows that web application protocol with the saved authenticated session, using direct HTTP without a running browser.

## Search records

```sh
myheritage search --first-name Abraham --last-name Lincoln \
  --birth-year 1809 --birth-place Kentucky --exact \
  --limit 20 --out research-output/myheritage/results.json

# Use the same criteria for another page; nextOffset is returned in the JSON.
myheritage search --first-name Abraham --last-name Lincoln \
  --birth-year 1809 --birth-place Kentucky --exact --offset 20

# Restrict to a collection, or to a category such as census and voter lists.
myheritage search --first-name Abraham --last-name Lincoln --collection 10826 --exact
myheritage search --first-name Abraham --last-name Lincoln --category 1000 --exact

# Search family-tree records across the research index.
myheritage search --first-name Abraham --last-name Lincoln --record-type family-trees
```

Unscoped searches default to the website's `historical` record-type filter. `--record-type all` includes family-tree results; `--record-type family-trees` selects those results. These are the website's classifications, which can include third-party tree-derived collections among historical records.

**Do not combine a collection/category scope with a record-type filter.** The service silently switches back to a global search for that combination. The CLI rejects it before making a request; scoped searches use all record types within the scope. Collection responses are also checked to ensure every returned record belongs to the requested collection. Category verification checks returned collections' ancestry.

`--exact` selects the website's exact name, year and place options. Without it the service ranks similar matches. Search results are leads: compare each record's dates, relatives and locations before identifying it as the same person. Counts can change between requests, and a page may contain fewer visible rows than requested. Use `nextOffset` with the original criteria; do not infer total completeness from the number of returned rows. `--after` exposes the website's split-response cursor and retains the original offset; ordinary pagination uses `--offset`.

Results contain `id`, `name`, `collection`, `display_fields`, `hidden_fields`, `link`, `thumbnail`, `is_free`, `user_info` and `cursor`. `user_info` exposes the service's purchase/access metadata; a search hit alone does not establish access to a full record or original image. Nonstandard success status 230 is retained as `serviceStatus` with a notice.

## Dates, relatives and keywords

For more than the simple flags, pass a JSON file, inline JSON object, or `-` for stdin:

```json
{
  "firstName": "Abraham",
  "lastName": "Lincoln",
  "exact": true,
  "events": [
    {"type": "birth", "year": 1809, "yearRange": 2, "place": "Kentucky"},
    {"type": "residence", "year": 1860, "place": "Illinois"}
  ],
  "relatives": [
    {"type": "father", "firstName": "Thomas", "lastName": "Lincoln"},
    {"type": "spouse", "firstName": "Mary"}
  ],
  "keywords": "president",
  "limit": 20,
  "offset": 0
}
```

```sh
myheritage search research-query.json --out research-output/myheritage/results.json
myheritage search --last-name Lincoln --death-year 1865 --death-place Washington
myheritage search --last-name Lincoln --place Illinois --keyword lawyer
```

Events support birth, death, marriage, residence, immigration, military and any, with optional year/month/day/place and a year range. Relatives support father, mother, spouse, child, sibling and any. `gender` accepts `M` or `F`. Names, event fields, relative pointers and keyword values use the web search form's encoding. Some criteria affect ranking rather than strict exclusion, depending on collection support. Unknown JSON keys and malformed filters fail locally. CLI flags override matching JSON fields; event flags append events.

## Advanced name matching and collection fields

```sh
# Keep the first name exact while allowing phonetic surname matches.
myheritage search --first-name Abraham --last-name Lincoln \
  --first-name-match exact --last-name-match soundex \
  --birth-year 1809 --birth-year-range 2 --residence-place Illinois

# Discover the actual form fields and choices for this collection.
myheritage search-fields 10826

# Supply the collection's birth component directly.
myheritage search --collection 10826 --first-name Abraham --last-name Lincoln \
  --field 'birth={"year":1809,"exactYear":true,"yearRange":2}' --limit 10
```

First-name modes: `exact`, `similar`, `initials`, `prefix`. Last-name modes: `exact`, `similar`, `soundex`, `metaphone`, `prefix`. `--no-translations` disables translated-name matching. Explicit name modes override the name portion of `--exact`; it still controls ordinary event years and places. `--gender M|F` adds the gender criterion. Residence and marriage have the same year/place/year-range flags as birth and death.

`search-fields` returns each field's exact `name`, `type`, label and original configuration, including choices where supplied by the collection. Repeat `--field NAME=VALUE` to combine criteria; the equivalent JSON is `"fields":{"birth":{"year":1809}}`. A collection is required. Standard flags and collection fields can be combined, but duplicate component names are rejected. JSON scalar values are parsed; quote numeric-looking strings inside JSON to preserve leading zeros. Unknown field names fail after fetching the collection configuration, before submitting a search.

| Field type | Value for `--field` / JSON `fields` |
| --- | --- |
| Age, Country, Custom, CustomCheckbox, HasPhotos, Keyword, Language | String, number or boolean appropriate to the field; use values from its configuration |
| Name | Object with `firstName`, `lastName`, `gender`, optional `firstNameMode` (1 exact, 2 similar), `lastNameMode` (3 exact, 4 similar) |
| Event | Object with `type`, `year`, `month`, `day`, `place`, `exactYear`, `yearRange`, `placeMatch` (`exact` or `similar`); type defaults to the collection field's type |
| MediaType | Object with `photos`, `documents`, `videos`, `audios` booleans |
| PhoneNumber | Object with `areaCode`, `phoneNumber` strings |
| List / Relative | Use the existing `events` or `relatives` JSON arrays instead |

These controls use the website's component encoder and collection form identifier. Collections vary in supported criteria and whether a criterion filters or ranks results. The discovered field names, rather than guessed universal fields such as occupation, determine what can be sent.

## Find collections and read a record

```sh
myheritage catalog --limit 20
myheritage collections census --limit 20
myheritage catalog --category 1000 --images --limit 20
myheritage collection 10826

RECORD_URL=$(jq -r '.data[0].link' research-output/myheritage/results.json)
myheritage record "$RECORD_URL" --out research-output/myheritage/record.json
myheritage record "$RECORD_URL" --related
```

`collections` searches names and descriptions. The catalog returns collection IDs, descriptions, counts, image/free flags, links, and summary facets. `--category`, `--location` and `--years` accept IDs from those facets; `--images` selects collections with images. `collection` returns description, category ancestry, a sample record, related collections and the website's search-form configuration. `search-fields` decodes that configuration; `search --field` submits the supported collection-specific components described above.

`record` takes the complete `link` from a search result, including its slug. A bare record ID may return 404. It returns readable labeled fields, links, source/citation text, and displayed-image links when present. HTML is parsed as data; page scripts are not executed. Displayed-image links are not guaranteed to be original-resolution scans.

`--related` additionally requests record and relative leads. These services can return no leads or deny a request; the CLI retains accessible fields and includes warnings for unavailable optional operations. Related-record contents have not been comprehensively verified; document support is described below. Subscription, collection and session permissions still apply. Saving a research result locally does not attach it to a tree or purchase access.

## Original documents and page downloads

```sh
# Use the complete link from a search result that has an image.
RECORD_URL=$(jq -r '.data[0].link' research-output/myheritage/results.json)
myheritage document "$RECORD_URL" --out research-output/myheritage/document.json
myheritage download-document "$RECORD_URL" --page 1 \
  --out research-output/myheritage/census-page.jpg
```

`document` reads the record's document viewer and returns all available pages, their `originalUrl`, a preview URL when distinct, page labels, the initially selected page, and indexed records associated with each page when present. It also includes embedded OCR text when the page contains it. Search highlight terms are not treated as a transcription. `transcriptionAvailable` reports the website's feature flag; this CLI does not invoke AI transcription or create OCR text.

`download-document` saves one explicitly selected page (page numbers start at **1**, default 1). It uses the viewer's original-download source, including the higher-resolution entry when the viewer provides a low/high pair. This is the original source exposed by the service, not a guarantee of an archival master. Bytes are preserved without upscaling. A related document can be selected with `--related-document KEY`, using a key from `document.relatedDocuments`.

The download creates **FILE** and **FILE.json**, both private to the owner. The JSON contains record identity, record/source/final URLs, selected page, byte count, SHA-256 checksum, image dimensions when applicable, and download time. The console prints a short JSON summary; it does not overwrite the image. Image data is checked for a readable format, PDF headers are recognized, and login/error HTML is rejected. One invocation fetches one record page and one image, plus provider redirects; there are no bulk downloads or automatic retries.

Original images can be hosted by MyHeritage or another provider such as FamilySearch. MyHeritage cookies are sent only to MyHeritage, never to another provider. A provider requiring its own login, an inaccessible scan, or a subscription restriction results in an error. Some records are indexes without scans; those have no document viewer. `record` remains useful for their fields and citation text.

## TypeScript

```ts
import {MyHeritageClient} from '@potatosalad/familysearch/myheritage';

const client = await MyHeritageClient.open();
const hits = await client.searchRecords({
  firstName: 'Abraham', lastName: 'Lincoln',
  events: [{type: 'birth', year: 1809, place: 'Kentucky'}], exact: true,
});
const record = hits.data[0] ? await client.record(hits.data[0].link) : undefined;
const collections = await client.researchCatalog({text: 'census', images: true});
const collection = await client.collection('10826');
const fields = await client.searchFields('10826');
const advanced = await client.searchRecords({
  collection: '10826', firstName: 'Abraham', lastName: 'Lincoln',
  firstNameMatch: 'exact', lastNameMatch: 'soundex',
  fields: {birth: {year: 1809, exactYear: true, yearRange: 2}},
});
// Use the complete link of an image-bearing result.
const imageRecordUrl = 'https://www.myheritage.com/research/record-COLLECTION-ITEM/RECORD-SLUG';
const document = await client.document(imageRecordUrl);
await client.downloadDocument(imageRecordUrl, 'research-output/myheritage/scan.jpg', 1);
```

## Recovered requests

| Request | Purpose |
| --- | --- |
| `GET /research` | Signed-in page bootstrap, FamilyGraph token, site/guest IDs and CSRF token |
| `POST /web-family-graphql/search_in_historical_records/` | `search_query_upload` mutation with name/event/relative/keyword web-query components, scope, type and pagination |
| `POST /web-family-graphql/collection_catalog/` | Collection search, pagination and category/location/year/image facets |
| `POST /web-family-graphql/fetch_collection_page_data/` | Collection metadata, categories, related collections, sample record and search form |
| `GET /research/record-…/…` | Record fields and documentViewerOptions: page sources, related documents and page records |
| `GET` viewer-provided image URL | Original document bytes, following provider redirects without cross-origin credentials |
| `GET /FP/API/SuperSearch/get-record-citation.php` | Citation text for `colId`, `itemId` |
| `POST /FP/API/SuperSearch/get-record-strip.php` | Optional related records for collection/item/group |
| `POST /FP/API/SuperSearch/get-related-people-panel.php` | Optional related people for collection/item/group |

The GraphQL proxy receives form fields `bearer_token`, JSON-encoded `query`, JSON-encoded `variables`, `operation`, `description`, `guest_id`, `site_id` and `mhc#PHPSESSID`, with saved cookies. Documents retain the website's field selections because arbitrary selections have received HTTP 403. Search variables contain `response_fields`, `limit`, `offset`, `request.web_query` and `request.additional_options`. Search is named a GraphQL mutation and may update recent-search history, but it does not edit genealogical records. Verification makes no tree edits, purchases or messages.

The research page supplies fresh tokens using existing cookies. Expired sessions, challenges and service errors stop without password retries. The CLI does not solve CAPTCHAs. HAR import and session storage are documented in [README.md](README.md).

Public JavaScript evidence and SHA-256 hashes are in [research-provenance.json](research-provenance.json). Relevant modules include SuperSearchMainForm `48877` (documents), `31099` (request variables), `97795` (component encoding), `50050` (event/relative form conversion), and `19160` (scope/type options). DocumentViewer `getAbsoluteImageSource` supplies image selection, source roots and page pairs; its original-download handler removes colorization-only URL parameters. The collection-scoping behavior was additionally compared with the actual request emitted by the authenticated research page.

Run `npm run verify:myheritage:research` with your own configured session for semantic checks of search pagination, scope, record types, catalog filters, form metadata, and citations. It writes a private report under `myheritage/verification/` in the configuration root. HTTP 406 stops the checks until you complete website verification and import a fresh session.

Offline tests cover collection-field encoding and document extraction. Multipage viewers, every field type, related-document variants, and account entitlements are not exhaustively verified.
