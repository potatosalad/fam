# American Ancestors

American Ancestors supports native HTTP research in fam: database discovery, indexed record search, citations, record details, and published scan downloads. No API key or browser is needed on the verified network. These are the website's internal endpoints, not a documented public developer API. See the [observed protocol](protocol.md).

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

The catalog returns exact database titles, categories, projects, and record types. Collection detail supplies its numeric ID, source URL, volumes, extended fields, and search tips. Search uses the **exact title** in `--collection`, not its numeric ID. An unknown title fails collection lookup. Extended attributes are described for research but do not yet have arbitrary CLI field bindings.

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

## TypeScript

```ts
import {AmericanAncestorsClient} from '@potatosalad/fam/americanancestors';
const client = await AmericanAncestorsClient.open();
const page = await client.search({lastName: 'Adams', page: 1});
if (page.items[0]?.sourceUrl) {
  const record = await client.record(page.items[0].sourceUrl);
  console.log(record.fields, record.citation);
}
```

Use `AmericanAncestorsClient.open(true)` for anonymous reads. `downloadImage` and `saveDownload` are exported alongside the client. CLI `--json` returns the standard fam envelope; `--out` on reads saves provider data privately.
