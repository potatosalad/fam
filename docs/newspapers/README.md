# Newspapers.com

`fam newspapers` searches pages and indexed genealogy records, reads extracted article details, searches saved clippings, and downloads pages, articles, and clippings as JPGs with citation sidecars. It also browses publications and issues and retrieves word coordinates and OCR. It uses the Newspapers website's observed read APIs. These are not a supported public API and can change.

## Sign in

Follow [shared setup](../setup.md) and [browser setup](../browser.md). CloakBrowser is recommended. Local macOS Docker and remote browser services use the same commands, with independent sessions.

```sh
fam newspapers.credential set
fam newspapers.session login
fam newspapers.session verify
fam newspapers.account get
```

A configured credential helper receives `newspapers`. Alternatively, set `NEWSPAPERS_USERNAME` and `NEWSPAPERS_PASSWORD`. No host names or secret-store mappings are built into fam.

Login reuses an existing Newspapers tab and verifies the account through `/account/` before saving anything. It fills the sign-in form and waits for the site's real Turnstile response before submitting. If verification needs interaction, the viewer opens and the existing browser timeout applies. Use `--interactive` to fill without submitting, or `--no-autofill` to do everything manually. Unfinished sign-in remains in the viewer. No private-tab workaround is used.

The saved cookie jar supports native HTTP. `--transport auto` starts with native HTTP for a new session, falls back for evidenced Cloudflare challenges, and remembers the browser route when needed. An existing remembered route remains in effect until changed through the shared browser transport commands. `--transport http` forces native HTTP and never launches a browser to renew sign-in; `--transport browser` uses the selected browser. There is no separate native password or refresh-token grant. `session refresh` re-verifies and captures the browser session. A positively rejected saved session may trigger one browser renewal in automatic mode. Ordinary access errors, rate limits, and unexpected response formats do not trigger password retries.

## Research

```sh
fam newspapers.newspaper search --keyword 'abraham lincoln' --limit 2
fam newspapers.newspaper search --keyword lincoln --publication-id 1618 --from 1900-01-01 --to 1900-12-31 --sort date-asc
fam newspapers.location search --prefix Chicago
fam newspapers.publication browse --path united-states/utah/salt-lake-city
fam newspapers.publication get --publication-id 1618
fam newspapers.publication.issue get --publication-id 1618 --date 1900-10-07
fam newspapers.page get --page-id 80868055
fam newspapers.page.hits get --page-id 80868055 --keyword lincoln
fam newspapers.page.clipping list --page-id 80868055 --limit 25
fam newspapers.page.article list --page-id 80868055
```

Search returns `nextCursor`. Pass it verbatim as `--cursor` with the same filters, record type, and ordering. One page is fetched per command. Place filters use country/region codes (for example `--country us` or `--region us-ut`). `--city "Salt Lake City"` requires one of those codes. The `page.clipping list` command uses `nextOffset` and `--offset`. Browse follows paths returned by the provider. IDs remain exact strings at command boundaries; large integers in API responses are preserved.

`page get` includes citation fields, dimensions, `canView`, and the account's action permissions. Search success, sign-in, and subscription access are separate facts. Access to one scan does not establish access to every newspaper. Image authorization tokens are kept internal.

## Genealogy records and article crops

```sh
fam newspapers.newspaper search --type obituary --keyword lincoln --limit 5
fam newspapers.newspaper search --type marriage --keyword smith --country us --from 1900-01-01 --to 1910-12-31
fam newspapers.newspaper search --type birth --keyword smith --limit 5
```

`--type` accepts `page` (the default), `obituary`, `marriage`, `birth`, `enslavement`, or `crime`. These filters search the site's indexed categories; ordinary page search is still useful for mentions the index missed.

Use the result's `page.id` and `articleId` together. Article IDs are normally UUIDs. They identify the selected record and may differ from a parent `articleId` nested inside its detailed data.

```sh
fam newspapers.article get --page-id 1207971067 --article-id fe78a93b-902d-4a82-a949-feaeb1049113
fam newspapers.page.ocr get --page-id 1207971067 --article-id fe78a93b-902d-4a82-a949-feaeb1049113
fam newspapers.article download --page-id 1207971067 --article-id fe78a93b-902d-4a82-a949-feaeb1049113 --out obituary.jpg
```

`article get` returns the type, scan coordinates, citation, viewer URL, and a `details` array containing every matching extraction, including relatives and events where present. Multiple subjects can share an article ID, so all their extractions are retained. Birth and enslavement coordinates are calculated from the indexed polygon using the viewer's conversion. OCR and downloads resolve the crop automatically. `--type` can disambiguate article retrieval, OCR, and downloads if an ID appears in more than one category. Extractions and OCR can misread names, relationships, and dates; verify them against the scan. A crop can contain more than one notice when the provider grouped them together.

## Saved clippings

```sh
fam newspapers.clipping search --keyword lincoln --from 1900-01-01 --to 1910-12-31 --limit 5
fam newspapers.clipping search --mine --limit 25
fam newspapers.clipping get --clipping-id 205745656
fam newspapers.clipping download --clipping-id 205745656 --out clipping.jpg
```

Clipping search defaults to public clippings. `--user USERNAME_OR_ID` searches that creator's public clippings; `--mine` uses the verified signed-in account and includes its public and private clippings. They cannot be combined. Other filters are `--tag`, `--publication-id`, dates, and `--region "Chicago, Illinois"`; clipping regions use place names. Sort values are `modified-desc`, `modified-asc`, `date-desc`, `date-asc`, and `score`. Continue with `nextCursor` as `--cursor`; a null cursor means the end.

Clipping details include the saved title, notes, tags, rectangles, and any available OCR. Downloads retain these details in the private citation sidecar. A clipping URL such as `https://www.newspapers.com/clipping/205745656/` supplies the clipping ID. Clipping details can encounter Cloudflare over native HTTP; automatic transport can use CloakBrowser, and `--transport browser` selects it explicitly. Rate limits are reported without an automatic retry loop.

## Download a page

```sh
fam newspapers.page download --page-id 80868055 --out salt-lake-herald-1900-10-07-p17.jpg
# Force either transport when needed:
fam newspapers.page download --page-id 80868055 --out page-http.jpg --transport http
fam newspapers.page download --page-id 80868055 --out page-browser.jpg --transport browser
```

Use the page ID from a search result's `page.id` or the number in a viewer URL such as `https://www.newspapers.com/image/80868055/`. On macOS, `open salt-lake-herald-1900-10-07-p17.jpg` opens the saved scan.

The command saves the same whole-page JPG representation as the website's **Save as JPG** action, with default brightness and contrast. Larger scans are downsampled using the viewer's sizing rules; this is not an archival-original download. The `.jpg.json` sidecar records the citation, viewer URL, original and downloaded dimensions, timestamp, byte count, and SHA-256 checksum. Authorization tokens and signed download URLs stay internal. The image is fully decoded and checked before either file is saved, both files use private permissions, and existing image or sidecar files are never overwritten. `--json` changes the command's status output, while `--out` still receives the JPEG.

Page, article, and clipping downloads all obtain fresh page authorization and require both viewing and download permission. They use the same sizing calculation and file checks. Article and clipping sidecars also record the selection coordinates and details; their original dimensions describe the source page. Native HTTP and CloakBrowser use the same commands and saved session. PDF export is not implemented.

## OCR and API catalog

```sh
fam newspapers.page.ocr get --page-id 80868055
fam newspapers.page.ocr get --page-id 80868055 --x 0 --y 0 --width 1000 --height 1000
fam newspapers.api describe --operation ocr
fam newspapers.api list
fam newspapers.api call --operation issue --input '{"publicationId":"1618","date":"1900-10-07"}'
```

OCR reads the whole page by default. Supply an article ID to resolve its rectangle automatically, a clipping ID to use the saved selection, or explicit x/y/width/height coordinates. Coordinates are original scan pixels. The service can return an empty string; fam reports `available: false` rather than presenting it as a successful transcript. OCR availability has not been established for every account or page. Check the scan when using names and dates.

All commands support `--json` and `--out FILE`. `fam cli.context resolve --context https://www.newspapers.com/image/80868055/` resolves a viewer URL into its page ID. Clipping URLs and viewer URLs with `article` or `clipping_id` also resolve their record IDs; access tokens are excluded. Use `fam cli.health check --provider newspapers --no-fix` for an account probe without password repair.

Clipping creation, billing, account changes, and subscription purchase are not implemented. The current read catalog does not bypass subscription or download permissions. Public previews and scan viewing remain available through the returned source URL.

## TypeScript

```ts
import {NewspapersClient, saveDownload} from '@potatosalad/fam/newspapers';
const newspapers = await NewspapersClient.open();
const results = await newspapers.search({keyword: 'Lincoln', limit: 10});
const obituaries = await newspapers.search({type: 'obituary', keyword: 'Lincoln', limit: 10});
const page = await newspapers.page('80868055');
const scan = await newspapers.download('80868055'); // {bytes: Buffer, metadata}
await saveDownload('page.jpg', scan); // also writes page.jpg.json; refuses overwrites
```

The SDK also provides `article(pageId, articleId, type?)`, `downloadArticle(pageId, articleId, type?)`, `searchClippings(options)`, `clipping(clippingId)`, and `downloadClipping(clippingId)`. All three download methods return `{bytes, metadata}` for `saveDownload`.

`NewspapersHttp` exposes native/browser GET transport with origin checks, bounded redirects, cookie handling, byte preservation, and bounded response size. `NewspapersClient.call` accepts only the documented JSON read operations and input keys; binary downloads use the dedicated methods directly. See [protocol observations](protocol.md).
