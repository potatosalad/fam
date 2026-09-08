# American Ancestors

American Ancestors supports native HTTP research in fam: database discovery, indexed record search, citations, record details, and published scan downloads. No API key or browser is needed on the verified network. These are the website's internal endpoints, not a documented public developer API. See the [website contracts](contracts.json) and [observed protocol and sources](protocol.md).

## Setup

Use the [shared credential setup](../setup.md): `AMERICANANCESTORS_USERNAME` and `AMERICANANCESTORS_PASSWORD`, a configured credential helper receiving `americanancestors`, or hidden interactive entry:

```sh
fam americanancestors.credential set
fam americanancestors.session login
fam americanancestors.session verify
fam americanancestors.session get
fam cli.health check --provider americanancestors --offline
```

Login submits one password form, completes the site's SSO redirects, verifies a signed-in page, and atomically saves private cookies in `americanancestors/session.json` under the active fam profile. Each explicit login command can submit once; research and health checks never submit passwords. There is no token refresh command. On session rejection, check the website and deliberately sign in again. Login status contains timestamps and booleans, never cookies or passwords.

GET requests support fam's [HTTP/browser transport](../browser.md) for website challenges. Password POSTs deliberately do not enter request replay or challenge recovery. A blocked login returns an error without retrying. Browser login automation is not part of this provider. `--transport http` keeps reads native; `--transport browser` uses a configured Camofox instance for GET requests. Browser-dependent access is not established by the native verification.

## Discover collections

```sh
fam americanancestors.collection list --filter Massachusetts --anonymous
fam americanancestors.collection get --name 'Boston, MA: Births, 1700-1800' --anonymous
fam americanancestors.api list
fam americanancestors.api describe --operation search
```

The catalog returns exact database titles, categories, projects, and record types. Collection detail supplies its numeric ID, source URL, volumes, typed `fieldSchema`, raw extended fields, and search tips. Search uses the **exact title** in `--collection`, not its numeric ID. An unknown title fails collection lookup. Use `--field NAME=VALUE` or `--field ID=VALUE` with a field returned in `fieldSchema`; unsupported or ambiguous fields fail before the search request.

## Search and follow evidence

```sh
fam americanancestors.record search --first-name John --last-name Adams \
  --collection 'Massachusetts: Vital Records, 1620-1850' \
  --from-year 1730 --to-year 1740 --json
fam americanancestors.record search --last-name Adams --location Massachusetts --exact
fam americanancestors.record search --last-name Adams --page 2 --json
```

Additional filters: `--keywords`, `--category`, `--project`, `--record-type`, `--soundex`, `--free`, and `--images`. `--volume-id` and `--page-name` narrow a selected collection. Exact and Soundex matching are mutually exclusive. Default name matching is broad: even an invented surname can produce approximate matches. Use `--exact` to test for no exact matches. Year bounds apply to the record's event; select a record type such as Birth to distinguish a birth year from a marriage or death year. Follow the collection's search tips because supported fields differ.

The server currently returns **50 records per page**. fam preserves `pageSize`, `total`, `nextPage`, and `nextUrl`; it never silently slices a page or fetches all pages. Repeat the original filters and change `--page` to the returned `nextPage`. Results contain string IDs, database titles, source links, event text, relationships, and an explicit `masked` indicator. A guest search can expose names while concealing event details. `--anonymous` permits public searches without loading saved cookies; signed-in access is the default.

Copy a result's `sourceUrl` or `imageUrl` into these commands:

```sh
fam americanancestors.record get --url 'https://www.americanancestors.org/DB190/r/EXAMPLE_RECORD_ID' --json
fam americanancestors.image get --url 'https://www.americanancestors.org/databases/EXAMPLE_SLUG/image/?volumeId=EXAMPLE_VOLUME&pageName=EXAMPLE_PAGE&rId=EXAMPLE_RECORD_ID' --json
fam americanancestors.image download --url 'https://www.americanancestors.org/databases/EXAMPLE_SLUG/image/?volumeId=EXAMPLE_VOLUME&pageName=EXAMPLE_PAGE&rId=EXAMPLE_RECORD_ID' --out scan.png
```

Replace the example URLs with actual returned links. Both short `/DB…/r/…` links and canonical record/image URLs are supported. Record details preserve labeled indexed fields (including original text when present), database citation, description, and search guidance. Match people using dates, places, relationships, and the scan rather than the name alone. The database citation may describe an entire collection; record the specific volume/page and consult its source guidance to cite the underlying material.

Native image downloads reconstruct the full resolution of the **published Deep Zoom image**, which may be smaller than an archival original. They save PNG plus a `.json` citation/checksum sidecar, refuse existing destination files, make sequential tile requests with a short pause, and cap images at 100 million pixels and 1,024 tiles. No undocumented storage credentials are used. Partner FamilySearch scans return a clean ARK and require the FamilySearch provider's own session/access rules for downloads. No partner access tokens are returned. There is no American Ancestors OCR service implemented; indexed text is not a full-page transcription.

A successful login or search does not guarantee membership access to every database or image. Access gates and malformed pages fail explicitly instead of becoming empty results. All provider operations exposed here are research reads except the explicit login and local credential/file operations; favorites, saved searches, purchases, and annotations are not implemented.

## Family members and collection-specific fields

```sh
fam americanancestors.record search --last-name Adams \
  --collection 'General Society of Mayflower Descendants Membership Applications, 1620-1920' \
  --family '{"relationship":"Spouse","firstName":"Elizabeth","lastName":"Brown"}' \
  --field 'Generation=5' --json
fam americanancestors.record search --collection 'New England Historical and Genealogical Register' \
  --keywords Adams --field 'Article Title Only=true' --json
```

Repeat `--family` up to three times. Each JSON object needs `relationship` (`Any`, `Father`, `Mother`, or `Spouse`) and at least one of `firstName`/`lastName`. These match **structured indexed relationships**. A name appearing only in a source's free text may not match a family filter. Unsupported relationship types and malformed criteria fail locally.

Repeat `--field` for multiple collection-specific criteria. Names are matched without case sensitivity; numeric IDs stay exact strings. fam fetches the selected collection's schema and sends the provider's actual ID/name/type. Boolean fields accept `true`; omit them to remove that restriction. Text fields, including generation and membership numbers, stay strings. Unknown, ambiguous, duplicate, or wrong-type fields are rejected. Only the observed `Attribute` fields are supported; combined-attribute forms remain unimplemented.

Journal title results have `kind: "record"`, a collection `title`, and `name: null`; they are not person-name hits. Indexed person results have `kind: "person"`. The record's text, volume, page, and source URL remain available in both layouts.

## Browse volumes and pages

```sh
fam americanancestors.collection volumes --name 'Massachusetts: Vital Records, 1620-1850' --filter Medway
fam americanancestors.collection browse --name 'Massachusetts: Vital Records, 1620-1850' --volume-id 7748
fam americanancestors.collection browse --name 'Massachusetts: Vital Records, 1620-1850' --volume-id 7748 --page-name 14
fam americanancestors.image list --url 'https://www.americanancestors.org/databases/massachusetts-vital-records-1620-1850/image/?volumeId=7748' --limit 3 --json
```

Volume links open the first published page without requiring an indexed person or record ID. `collection browse` verifies that the volume belongs to the collection and rejects a substituted page. Use the exact printed/indexed page label, including Roman numerals or compound labels such as `2207:1` where supplied by the provider.

`image get`, `collection browse`, and each `image list` item return `pageName`, `previousUrl`, and `nextUrl`. `image list` walks these links sequentially, pauses between requests, and returns at most 100 page metadata items per invocation (10 by default). Continue from its top-level `nextUrl`; `complete` means the volume ended. It never invents a next page by adding one to the label. No tiles are downloaded by these browsing commands. Pass an item's `sourceUrl` to `image download` for the scan and citation sidecar.

## Bounded, resumable research exports

```sh
fam americanancestors.record export --last-name Adams \
  --collection 'General Society of Mayflower Descendants Membership Applications, 1620-1920' \
  --field 'Generation=5' --details --limit 10 --out research.json --json
fam americanancestors.record export --resume research.json --limit 20 --json
```

`--limit` is required and bounds **additional records in this run**, including a stop partway through a provider page. It accepts 1–1,000; one export is capped at 10,000 records and 50 MiB. New exports start at page 1 and refuse existing destinations. `--resume` updates the same file using its saved filters and details setting; do not repeat filters, `--details`, or `--anonymous`. Signed-in access is required. A completed export performs no additional reads when resumed.

The private JSON file contains query options, timestamps, indexed search hits and source links, and a checkpoint. `--details` additionally fetches each record's indexed fields, citation, and research guidance. It does not download scans, collect OCR, or change saved searches on the website. Without `--details`, citations are limited to the search hit's collection and source URL; use record details for the fuller database citation.

Data and checkpoint are replaced atomically together after every saved record. A failed record lookup, network failure, or graceful Ctrl-C leaves completed records available to resume; no automatic login or failed request retry occurs. On resume, fam re-reads the checkpoint page and verifies IDs/order, counts, and the encoded query. Changed results or schema, duplicated records, or ignored pagination stop the export rather than skip records silently. This is not a transactional snapshot of the provider's entire index: start a fresh export if the provider changes its data. At the hard capacity, narrow the search and begin a new export.

A `.lock` file prevents concurrent writers. Ordinary failures and graceful interrupts release it. After a forced termination such as SIGKILL, confirm the writer has stopped before removing the leftover lock and resuming. Keep the export JSON intact; it is both research data and the resume checkpoint.

## API contract and maintenance

[contracts.json](contracts.json) is the checked-in inventory of eight observed website read endpoints, including origins, query bindings, collection-field discovery, pagination, and page navigation. It generates `src/americanancestors/generated/contracts.ts` with `npm run generate:catalogs`; the client uses those paths, and `npm run check:catalogs` checks that the generated catalog is current. This follows the website-contract pattern used by Geneanet and requires no Android APK.

```sh
fam americanancestors.api list
fam americanancestors.api describe --operation search --json
fam americanancestors.api describe --operation collection-fields --json
fam americanancestors.api describe --operation image --json
```

These commands are local and require no credentials. The catalog describes observed inputs and outputs; it is not an exhaustive server schema or permission grant. [protocol.md](protocol.md) records public evidence sources, authentication/SSO, HTML response markers, media downloads, and verification limits. Research exports and volume traversal are client workflows over these reads, not separate server APIs. There is no generic `api call` or write catalog.

## TypeScript

```ts
import {AmericanAncestorsClient} from '@potatosalad/fam/americanancestors';
const client = await AmericanAncestorsClient.open();
const page = await client.search({lastName: 'Adams', page: 1, family: [{relationship: 'Spouse', firstName: 'Elizabeth'}]});
if (page.items[0]?.sourceUrl) {
  const record = await client.record(page.items[0].sourceUrl);
  console.log(record.fields, record.citation);
}
```

Use `AmericanAncestorsClient.open(true)` for anonymous reads. `contracts`, `downloadImage`, `saveDownload`, and `exportRecords` are exported alongside the client. `SearchOptions` includes typed `family` members and a `fields` object; `client.volumes`, `client.browse`, and `client.pages` provide the browsing workflow. CLI `--json` returns the standard fam envelope; `--out` on reads saves provider data privately.
