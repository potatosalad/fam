# Original documents, films, and Full-Text Search

The CLI resolves image ARKs, downloads and validates original distribution images, browses collection waypoints, enumerates DGS images, searches full text, and retrieves machine transcripts. These are authenticated website services exposed through `client.research`; they are separate from the 212 APK-derived genealogy operations.

## Start with the Walton examples

Install or update fam using the [main README](../../README.md#install). Run these examples from the checkout so the output stays in its ignored `artifacts/` folder:

```sh
fam familysearch --help
mkdir -p artifacts/document-research
```

```sh
# Image 3 of the 736-image estate index.
fam familysearch image info 3:1:3QSQ-G935-BNWL
fam familysearch image download 3:1:3QSQ-G935-BNWL --original \
  --out artifacts/document-research/walton-003.jpg

# Image 408, printed page 80.
fam familysearch image download 3:1:3QS7-8935-BJZR --original \
  --out artifacts/document-research/walton-408.jpg
fam familysearch image transcript 3:1:3QS7-8935-BJZR \
  --out artifacts/document-research/walton-408.txt

# The DGS discovered from these images is 005764700.
fam familysearch film image 005764700 --image 408
fam familysearch film images 005764700 --all \
  --out artifacts/document-research/walton-images.json

fam familysearch fulltext available 005764700
fam familysearch fulltext search --name Walton --dgs 005764700 --count 5 --all \
  --out artifacts/document-research/walton-matches.json
```

Full FamilySearch image URLs work too, including viewer query parameters. Indexed-record ARKs (`1:1:...`) and image ARKs (`3:1:...` or `3:2:...`) are distinct; the CLI validates the identifier kind. An [ARK is a persistent identifier](https://developers.familysearch.org/main/docs/persistent-identifiers), so downloading it requires resolving the current image service rather than assuming the ARK itself returns JPEG bytes.

Both example images were downloaded through the new client on September 6, 2026. Image 3 decoded at **4695 × 3229**; image 408 decoded at **3532 × 4224**. The two download manifests contain their checksums and citations. Current availability depends on your account and collection permissions.

## Download behavior and provenance

`image info` returns the canonical ARK, storage identifier, DGS, image position/count, collection, breadcrumbs, citation, available neighboring images, download permission, and original dimensions when accessible. `image download`:

1. Resolves the website viewer metadata with the existing saved native session.
2. Requires explicit permission to download and original dimensions from the Deep Zoom descriptor.
3. Requests the full-resolution `dist.jpg` distribution resource and follows its approved signed storage redirect.
4. Checks the content type, file signature, full pixel decoding, and exact dimensions before publishing the file.
5. Writes an adjacent `FILE.json` with the ARK, citation, image context, retrieval time, byte count, SHA-256, and dimensions.

`--original` means the full-resolution distribution image FamilySearch offers, not an archival master. It is the default and only download representation; the command never substitutes a thumbnail. JPEG, PNG, TIFF, and WebP are supported by the validator, with JPEG verified live. Downloads are bounded to 256 MiB. Image decoding uses `sharp`, including a full pixel decode to catch truncated files.

Image and transcript files and their sidecars are mode `0600`. Complete temporary files are published without overwriting existing files; partial downloads are removed. Choose a new output name to repeat a download. The manifest stores the stable FamilySearch service URL, not an expiring signed URL, bearer token, or cookie.

No browser cookie export is required for the verified examples. The same local session, credential lookup, refresh, and login flow used for tree research applies. Storage redirects receive no FamilySearch credentials. The exact observed S3 host and production path are allowed; an unfamiliar storage host fails explicitly until it has been investigated.

## Collection and film navigation

Collection 1999178 → Walton → Estate index 1820–1938 vol A–Q:

```sh
fam familysearch collection browse 1999178 --all
fam familysearch collection browse \
  'https://www.familysearch.org/service/cds/recapi/waypoints/9SB9-ZNL:267814801?cc=1999178'
fam familysearch collection browse \
  'https://www.familysearch.org/service/cds/recapi/waypoints/9SB9-N3F:267814801,267838601?cc=1999178' \
  --count 100 --all --out artifacts/document-research/estate-images.json

# Generic GET accepts the observed read-only recapi paths too.
fam familysearch get '/service/cds/recapi/collections/1999178/waypoints?count=10'
```

Each listing returns `items`, `total` when supplied by the server, zero-based `offset`, `complete`, and a continuation when more results remain. A waypoint item has a title, URL, kind, and image ARK/one-based image number where applicable. Ancestor source descriptions are excluded from the children.

| Option | Meaning |
| --- | --- |
| `--count N` | Items per waypoint/search page; default 100, maximum 1000. For DGS output, size of the local slice. |
| `--offset N` | Zero-based starting position. |
| `--all` | Follow pages until complete or the limit is reached. |
| `--limit N` | Maximum total items returned by this invocation. |
| `--resume NEXT_URL` | Continue using a prior waypoint/search `next` URL and the same collection/waypoint argument. The URL supplies its page size, offset, and search filters. |
| `--format jsonl` | One item per stdout/output-file line; continuation metadata goes to stderr. |

For example, save a bounded slice with `--count 100 --all --limit 200`, then pass its `next` to `--resume`. Full-text resumption uses `fam familysearch fulltext search --resume 'NEXT_URL'`; do not add new filters. DGS listings resume using `--offset NEXT_OFFSET`, as returned in `nextOffset`.

The film-data service returns a complete image list in one response. DGS pagination bounds the CLI output, not that server response. Waypoint and search pagination follows the actual server links; it rejects repeated/skipped offsets, changed routes, and a missing continuation before the reported total. Pages are accumulated before output, and pagination is not a stable snapshot if server data changes during traversal.

## Full-Text Search and transcripts

```sh
fam familysearch fulltext search --name 'John Smith' --place Georgia \
  --years 1820:1938 --keywords estate --limit 20
fam familysearch fulltext search --keywords Walton --dgs 005764700 --format jsonl
fam familysearch image transcript 3:1:3QS7-8935-BJZR --format text
fam familysearch image transcript 3:1:3QS7-8935-BJZR --format json
```

Search supports name, keywords, place, an inclusive year range (`FROM:TO`, `FROM:`, or `:TO`), DGS, collection ID, and the service's record-type value. The CLI sends the website's `m.queryRequireDefault=on` setting so supplied search criteria are required together. Without it, a name plus DGS can return matches outside that film. These fields correspond to the website's [Full-Text Search controls](https://www.familysearch.org/en/help/helpcenter/article/how-do-i-use-fulltext-search).

Hits expose image ARKs, title, date/place/type, collection context, machine text, highlights, and entities when present. The service's Full-Text collection IDs are not guaranteed to match historical-record collection IDs; use the collection ID returned by a relevant hit. `--record-type` takes the service value, not a guessed display label. Wire mappings for date and collection/type filters are tested; live verification specifically exercises name plus DGS and pagination.

`image transcript` retrieves the image's ordered text separately from search. JSON preserves regions, lines, tokens, and service coordinates (`x,y,width,height` in image pixels). Plain text joins tokens into service-ordered lines and regions; it does not correct handwriting or infer a different reading order. Redacted tokens stay redacted. `--out FILE.txt` always writes plain text plus a `FILE.txt.json` sidecar containing the structured transcript and citation, regardless of stdout format.

No transcript is represented as `available: false` in JSON. Plain-text/file requests then fail explicitly without creating an artifact. Permission failures remain errors. An HTTP 404 from the transcript service is treated as unavailable after the image itself has resolved successfully. Machine text is evidence to review against the image, not a replacement for checking handwriting.

## Easier operation input

```sh
fam familysearch schema sources.recordDetails --example
fam familysearch record details '1:1:REPLACE-WITH-REAL-RECORD-ARK'
fam familysearch call sources.recordDetails \
  --query 'recordUrl=https://www.familysearch.org/ark:/61903/1:1:REPLACE-WITH-REAL-RECORD-ARK' \
  --query hideSectionFields=false

fam familysearch call persons.get --input - <<'JSON'
{"pid":"XXXX-XXX","query":{"oneHops":"summaries"}}
JSON
```

Replace placeholder ARKs and person IDs before running. `schema --example` generates correctly nested input with placeholders, including optional query/header fields. Query flags use the operation's scalar wire type, preserve strings and large integers, and reject duplicate or unknown keys. Complex query values still use JSON. Positional input files continue to work. A misplaced `recordUrl` error explains that it belongs under `query` and points to the example command.

## TypeScript

```ts
import { FamilySearchClient } from '@potatosalad/fam';
const client = await FamilySearchClient.open();
const info = await client.research.imageInfo('3:1:3QS7-8935-BJZR');
const download = await client.research.downloadOriginal(info.imageArk, 'walton-408.jpg');
const images = await client.research.filmImages('005764700', { all: true });
const matches = await client.research.fulltextSearch(
  { name: 'Walton', dgs: '005764700' }, { count: 5, all: true, limit: 100 },
);
const transcript = await client.research.imageTranscript(info.imageArk);
```

`ResearchError.code` distinguishes `access-denied`, `security-challenge`, `not-found`, `throttled`, `temporary-failure`, `unexpected-content`, `schema-change`, and `pagination`. Explicit 401 responses renew authentication once; 403/security challenges do not start login loops. Metadata/image reads retry network failures and 429/502/503/504 at most three times with backoff. A server `Retry-After` above 30 seconds is surfaced instead of retrying early. Once a streamed image body has started, a failed transfer must be rerun; no incomplete image is kept.

## Service evidence and coverage limits

The routes and request shapes were inspected in the live FamilySearch website's JavaScript and checked with authenticated requests on September 6, 2026. Relevant production assets were `31723.eba46d2cff742ddb.chunk.js` (viewer metadata, module 5069), `98776.7854208d3d7d62e5.chunk.js` (full-text search), and the image viewer's `main.c83b7ade85a7e92c.js` (transcript request and service origin mapping). Local copies and response artifacts remain ignored.

| Read | Observed service |
| --- | --- |
| Image metadata, rights, citation | `POST /search/filmdatainfo/image-data` |
| Bulk DGS images | `POST /search/filmdatainfo/film-data` |
| Collection and waypoint children | `GET /service/cds/recapi/collections/{id}/waypoints`, `GET /service/cds/recapi/waypoints/{id}` |
| Original dimensions | `GET /service/records/storage/deepzoomcloud/dz/v1/{apid}/image.xml` |
| Distribution image | `GET /service/records/storage/dascloud/das/v2/{apid}/dist.jpg` → signed storage |
| Full-text search | `GET /service/search/fulltext/search` |
| Full-text availability | `GET /service/search/fulltext/search/groupNumber?ids={dgs}` |
| Structured transcript | `GET https://sg30p0.familysearch.org/service/records/volunteer/orchestration/sls/image/records/{imageArkId}` |

The viewer maps storage URLs from `sg30p0.familysearch.org` to the `www` proxy. Transcripts require the directly observed `sg30p0` route: the `www` equivalent returned HTML/404. The two metadata POSTs are reads. Existing generic mutation routes remain unchanged.

Offline tests cover corrupt/HTML/thumbnail downloads, credential boundaries, denied permissions, session renewal, throttling, pagination errors, transcript redactions, and input ergonomics. Live acceptance checks are available separately with your own account.

This covers the reported document workflow, not every private website service, every image storage backend, all search filters, or all restricted collections. Catalog 157452 is useful context; catalog search is not added by this change. Full-text coverage and image/download permissions depend on the collection and account. These website contracts can change independently of the APK inventory.

Reproduce the read-only acceptance run with `npm run verify:research`. It downloads the two originals to a fresh ignored artifact directory and emits a summary without account data or signed URLs. To save a shareable report, use `npm run verify:research -- --report report.json --label workstation`. Add `--cli` to also check the built `fam familysearch` entry point from this checkout's help, schema example, download, transcript, and search from fresh processes outside the checkout.
