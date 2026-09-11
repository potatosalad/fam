# Newspapers.com

`fam newspapers` searches newspaper pages, browses publications and issues, downloads whole-page JPG scans, reads page metadata and access rights, and retrieves public clippings, article categories, word coordinates, and page and selection OCR. It uses the Newspapers website's observed read APIs. These are not a supported public API and can change.

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

Search returns `nextCursor`. Pass it verbatim as `--cursor` with the same filters and ordering. One page is fetched per command. Place filters use country/region codes (for example `--country us` or `--region us-ut`). `--city "Salt Lake City"` requires one of those codes. Clipping pagination uses `nextOffset` and `--offset`. Browse follows paths returned by the provider. IDs remain exact strings at command boundaries; large integers in API responses are preserved.

`page get` includes citation fields, dimensions, `canView`, and the account's action permissions. Search success, sign-in, and subscription access are separate facts. Access to one scan does not establish access to every newspaper. Image authorization tokens are kept internal.

## Download a page

```sh
fam newspapers.page download --page-id 80868055 --out salt-lake-herald-1900-10-07-p17.jpg
# Force either transport when needed:
fam newspapers.page download --page-id 80868055 --out page-http.jpg --transport http
fam newspapers.page download --page-id 80868055 --out page-browser.jpg --transport browser
```

Use the page ID from a search result's `page.id` or the number in a viewer URL such as `https://www.newspapers.com/image/80868055/`. On macOS, `open salt-lake-herald-1900-10-07-p17.jpg` opens the saved scan.

The command saves the same whole-page JPG representation as the website's **Save as JPG** action, with default brightness and contrast. Larger scans are downsampled using the viewer's sizing rules; this is not an archival-original download. The `.jpg.json` sidecar records the citation, viewer URL, original and downloaded dimensions, timestamp, byte count, and SHA-256 checksum. Authorization tokens and signed download URLs stay internal. The image is fully decoded and checked before either file is saved, both files use private permissions, and existing image or sidecar files are never overwritten. `--json` changes the command's status output, while `--out` still receives the JPEG.

Every download obtains fresh page authorization and requires both viewing and download permission. Native HTTP and CloakBrowser use the same command and saved session. PDF export and clipping downloads are not implemented.

## OCR and API catalog

```sh
fam newspapers.page.ocr get --page-id 80868055
fam newspapers.page.ocr get --page-id 80868055 --x 0 --y 0 --width 1000 --height 1000
fam newspapers.api describe --operation ocr
fam newspapers.api list
fam newspapers.api call --operation issue --input '{"publicationId":"1618","date":"1900-10-07"}'
```

OCR reads the whole page by default. Supply a clipping ID or a rectangle (and optional article ID) to select a smaller area. Coordinates are original scan pixels. The service can return an empty string; fam reports `available: false` rather than presenting it as a successful transcript. OCR availability has not been established for every account or page. Check the scan when using names and dates.

All commands support `--json` and `--out FILE`. `fam cli.context resolve --context https://www.newspapers.com/image/80868055/` resolves a viewer URL into its page ID. Use `fam cli.health check --provider newspapers --no-fix` for an account probe without password repair.

Clipping creation, billing, account changes, and subscription purchase are not implemented. The current read catalog does not bypass subscription or download permissions. Public previews and scan viewing remain available through the returned source URL.

## TypeScript

```ts
import {NewspapersClient, saveDownload} from '@potatosalad/fam/newspapers';
const newspapers = await NewspapersClient.open();
const results = await newspapers.search({keyword: 'Lincoln', limit: 10});
const page = await newspapers.page('80868055');
const scan = await newspapers.download('80868055'); // {bytes: Buffer, metadata}
await saveDownload('page.jpg', scan); // also writes page.jpg.json; refuses overwrites
```

`NewspapersHttp` exposes native/browser GET transport with origin checks, bounded redirects, cookie handling, byte preservation, and bounded response size. `NewspapersClient.call` accepts only the documented JSON read operations and input keys; binary downloads use `download` directly. See [protocol observations](protocol.md).
