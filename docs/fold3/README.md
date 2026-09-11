# Fold3

Search military and genealogy records, browse publications, read indexed records and memorials, follow neighboring scans, and save permitted images with citations. Fold3 focuses on military service, pensions, casualty records, draft registrations, and related family history; its catalog also includes nonmilitary material.

Use the [shared setup](../setup.md) for installation, profiles, and credential helpers. Run `fam fold3 --help` to explore commands or `fam cli.doc read --provider fold3` to read this guide in the CLI. The [protocol notes](protocol.md) distinguish observed website APIs from a supported public developer API.

## Authentication

```sh
fam fold3.credential set
fam fold3.session login
fam fold3.session get
fam fold3.session verify
fam fold3.account get
```

Credentials come from `FOLD3_USERNAME` and `FOLD3_PASSWORD`, an explicitly configured generic credential helper, or the profile's private `fold3/login.json`. The shared runtime has no host or secret-store defaults. See [credential lookup](../setup.md).

Browser login is the default. It opens Fold3's `/login`, fills and submits configured credentials once per login step, and verifies the account through `/node/refreshUser` before saving cookies. Use `--interactive` to fill without submitting, or `--no-autofill` for manual login. Only the exact Fold3 origin receives automatic credential entry. The website also offers Ancestry sign-in; complete that route manually in the viewer when needed. A linked Ancestry account or Ancestry subscription does not establish Fold3 premium access.

Browser cookies stay in the selected local or remote browser instance. Session snapshots use private, atomic profile storage; credentials and session tokens are not returned by status/account commands. See [browser setup and routing](../browser.md).

`fam fold3.session login --native --transport http` makes a native attempt: GET `/login`, read its CSRF value, POST `{username,password}` once to `/node/auth/user`, and verify the account. The observed native POST received a Cloudflare challenge, so browser login is the verified path. Native login does not replay credentials through redirects or switch to another host. A failed login leaves the previous saved session intact.

`fam fold3.session refresh` revalidates existing cookies and saves rotations. It is not an OAuth refresh-token grant; expired cookies require login again. `fam cli.health check --provider fold3` checks session structure and current identity. It does not prove access to every record.

## Find ancestors and collections

```sh
fam fold3.record search --name 'Abraham Lincoln' --type record --limit 20
fam fold3.record search --keyword 'pension' --conflict 'US Civil War'
fam fold3.record search --name 'Abraham Lincoln' --birth-year 1886
fam fold3.record search --publication-id 3 --type image --limit 20
fam fold3.record search --publication-id 3 --type image --offset 20 --limit 20
fam fold3.publication list --keyword 'Civil War' --limit 20
fam fold3.publication get --publication-id 3
fam fold3.catalog browse --name 'Abraham Lincoln' --facet general.title.id --facet military.conflict
```

The default `--type research` searches scans, indexed records, and memorials. Other types are `image`, `record`, `memorial`, `unit`, `publication`, and `all`. Names use Fold3's analyzed `full-name` field; they are not a guaranteed literal phrase match. `--keyword` includes OCR. Search results retain native identifiers, indexed metadata, highlights, publication IDs, and source links.

Filter by `--place`, `--conflict`, `--service-number`, `--year`, `--birth-year`, or `--death-year`. Facet values are provider identifiers: copy returned values instead of guessing labels. Use `--filter NAME=VALUE` for a returned facet and `--field NAME=VALUE` for additional fielded text. Repeat a filter with the same name to add alternatives; different filter names narrow the query together. `--facet NAME` includes counts in search responses; catalog browsing returns counts without record hits. Examples of facet names include `general.title.id`, `place`, `military.conflict`, `military.service.branch`, and `date.vital.birth`.

Search is one page per request. Pass `nextOffset` with unchanged filters. `incomplete` reports timeout, failed search shards, or an unexpectedly empty continuation. The CLI bounds search to 10,000 results; narrow queries when `windowLimitReached` is true. Facets may be truncated to the requested `--limit`, and a filmstrip is only a fragment. Publication listing fetches the site's catalog once per call and applies keyword filtering and pagination locally; it reflects the current site's available catalog, not every historical Fold3 publication.

Sort with `RELEVANCE`, `ALPHABETICAL`, `LAST_MODIFIED`, `CHRONOLOGICAL_ASC`, or `CHRONOLOGICAL_DESC`.

### Narrow similar names and military connections

```sh
fam fold3.record search --name 'Abraham Lincoln' --birth-from 1880 --birth-to 1890 --type record
fam fold3.record search --name 'Abraham Lincoln' --exclude-filter general.title.id=830 --type record
fam fold3.record search --name 'Abraham Lincoln' --match expanded --type record
fam fold3.record search --unit-id 138483 --type all
fam fold3.record search --regiment-id 138483 --type all
fam fold3.record search --commanders-of 138483 --type memorial
```

Date ranges use paired `--from`/`--to`, `--birth-from`/`--birth-to`, or `--death-from`/`--death-to`. Values may be `YYYY` or `YYYY-MM-DD`; year bounds expand to January 1 and December 31. Ranges are inclusive and cannot be combined with the corresponding single-year flag. Calendar dates and range order are validated before a request.

Use repeatable `--exclude-filter NAME=VALUE`, `--exclude-field NAME=VALUE`, or `--exclude-name TEXT`. Included and excluded facets remain separate; excluding a value never adds it to the included alternatives. `--match strict` is the default website matching mode. `--match expanded` requests the website's less-relevant results, which may omit some criteria; inspect each result. These modes do not promise literal names, phonetic matching, or exhaustive name variants.

`--unit-id` searches objects linked from a military unit. `--regiment-id` applies Fold3's regiment connection filter, which can return child units with `--type all`. `--commanders-of` takes a **unit ID** and applies its indexed commander connection filter. These follow the provider's indexed links; they do not independently establish an ancestor's military service. Combine them with names, dates, and source inspection as appropriate.

## Browse a collection without a name index

```sh
fam fold3.publication browse --publication-id 750 --limit 20
fam fold3.publication browse --publication-id 750 --prefix VPB --limit 20
fam fold3.publication browse --publication-id 3 --json --out browse.json
fam fold3.api call --operation publication-browse --input browse-request.json
```

Publication browsing follows the website's collection-specific hierarchy, such as source, subject, series, or file. A `kind: branches` response supplies each branch's label, count, and full `path`. Pass every value in that path as a repeated `--path` flag in order. The values are opaque and can contain tabs or control separators; preserve them exactly. For programmatic use, copy the array into a JSON request file shaped as `{"id":"3","path":["EXACT_RETURNED_VALUE"],"limit":20}` and use the API command above. SDK callers can pass the returned array directly to `client.browse(publicationId, {path})`.

Branches use a bounded alphabetic list with `truncated` and `incomplete` indicators. Narrow a truncated list with `--prefix`. At the end of the hierarchy, `kind: images` returns scan IDs in filmstrip order; continue with `nextOffset` as `--offset`, keeping the path unchanged. Image pagination retains the 10,000-result bound. Branch counts describe provider search matches, not necessarily individual pages. Use an image ID to inspect and export its file.

## Read and export a complete file

```sh
fam fold3.file get --image-id 295842756
fam fold3.file.image list --image-id 295842756 --limit 10
fam fold3.file.image list --image-id 295842756 --limit 10 --offset 10
fam fold3.file download --image-id 4346701 --out declaration-file --max-pages 2
fam fold3.file download --image-id 4346701 --out declaration-file --max-pages 2 --resume
```

An image anywhere in the file identifies its website scan cluster. `file get` reports that boundary and its page count; `file.image list` starts at the file's first page, regardless of the anchor's position. It returns ordered pages and `nextOffset`. The reader checks cluster identity, page positions, duplicate IDs, and the declared page count. It stops on missing pages or changing boundaries instead of silently including pages from the next file.

`file download` enumerates the whole cluster before saving images sequentially. Its default bound is 500 pages; set `--max-pages` explicitly for larger files, up to 10,000. It creates a new private directory containing numbered JPGs, per-image citation/checksum sidecars, and `manifest.json` with the ordered page inventory and progress. The manifest becomes `complete: true` only after every page is saved. Every new image download requires current viewing and download permission.

To continue an interrupted export, pass the same anchor image ID, directory, and adequate page bound with `--resume`. The exporter re-enumerates the file and checks the manifest's identity and page order, then verifies the size and SHA-256 of every existing image against its sidecar and recorded checksum. Completed pairs are reused; remaining pages are downloaded. Corrupt, missing, or half-written pairs cause a stop and remain unchanged. A completed image/sidecar pair can be recovered when a crash occurred before its manifest update. Concurrent exporters are excluded by `.fam-fold3.lock`; if the process was killed, remove that lock only after confirming no exporter is still running.

A complete export means every page in Fold3's current cluster. It does not establish that the archival file itself is complete. Files can be grouped differently by collection, and the website JPG export may downsample. PDF assembly and bulk publication downloading are outside this workflow.

## Search a file's OCR

```sh
fam fold3.file.ocr get --image-id 295842756 --max-pages 20 --out diary-ocr.json
fam fold3.file.ocr search --input diary-ocr.json --keyword AIRCRAFT --limit 20
fam fold3.file.ocr search --image-id 295842756 --max-pages 20 --keyword AIRCRAFT --limit 20
```

`file.ocr get` enumerates the file and returns a reusable JSON transcript with ordered page titles, image IDs, source URLs, and OCR text. Every page has an `available`, `unavailable`, or `access-denied` status. `complete` is true only when every enumerated page has OCR. Missing OCR is retained explicitly; authentication, verification, rate-limit, and unexpected API failures stop the operation. The default bound is 100 pages, configurable through `--max-pages` up to 10,000, with a separate 16 MiB text bound. This reads Fold3's existing OCR; it does not generate handwriting transcription or OCR for missing pages.

`file.ocr search` performs a literal, case-insensitive search and returns page citations, text snippets, character offsets, and `nextOffset`. Supply either a live `--image-id` or a saved `--input` transcript. Saved transcript searches run locally without opening a session or making provider requests. Save the transcript using `--out` as shown; this writes the transcript itself rather than the CLI's `--json` response envelope. Repeat the same keyword and transcript with `--offset` to continue, up to 10,000 matches. Live searches fetch OCR again, so use a saved transcript for repeated research.

Results report pages without OCR and `incomplete`; no match in the available text cannot establish that a name is absent from the original file. OCR can split words or misread names. Inspect the cited scan when evaluating a match.

## Read individual entries and contributions

```sh
fam fold3.image.entry list --image-id 100005464 --limit 20
fam fold3.entry get --entry-id 100005474
fam fold3.image.contribution list --image-id 4346701
```

Some scans contain separately indexed entries, such as people on a census page. Entry listing returns their exact IDs, provider ordinals, titles, and decoded source-image rectangles. `entry get` includes the parent scan, indexed metadata, available permissions, and annotations or corrections associated with the entry. A `/sub-image/ID` URL resolves to `fold3.entry get` through `fam cli.context resolve`.

The index reader uses bounded viewports when the provider limits their area and deduplicates entries that overlap them. Pagination is local over the retrieved region; pass `nextOffset` with the same image and viewport. `complete` describes coverage of the advertised image index, not whether every person on the scan was indexed. To restrict the region, provide all four of `--x`, `--y`, `--width`, and `--height` in original scan pixels. At most 64 viewports and 10,000 unique entries are read per call; choose a smaller region if necessary.

`image.contribution list` reads annotations, corrections, comments, and other available contributions. Output preserves contribution IDs, types, contributor IDs where supplied, modification times, and decoded annotation rectangles. Corrections retain their field and proposed value. These contributions remain separate from the indexed fields and original scan; they are research leads, not automatically accepted facts. All contribution commands are reads.

## Follow linked evidence

```sh
fam fold3.connection list --type memorial --object-id 653615411 --direction outgoing --limit 20
fam fold3.connection list --type image --object-id 4346701 --direction incoming --limit 2
fam fold3.connection list --type image --object-id 4346701 --direction incoming --limit 2 --offset 2
```

Outgoing connections lead from the anchor to linked objects; incoming connections identify objects that link to the anchor. Results include the linked object's type, ID, title, metadata, source URL when known, and the connection's endpoints and available metadata. Supported anchor types are `image`, `record`, `memorial`, `unit`, `file`, `subject`, `battle`, and `sub-image`. File IDs are exact cluster keys returned by `file get`; other types use their own decimal IDs.

Pass `nextOffset` with the same type, ID, and direction. A lookahead entry determines whether another page exists; the local bound is 10,000 connections. These are website links and contributions, and may include contextual documents rather than relatives. Verify the underlying evidence before treating a connection as a family relationship. This command complements the facts and relationships already embedded in record, memorial, and unit reads.

## Read evidence and follow pages

```sh
fam fold3.record get --record-id 50189
fam fold3.memorial get --memorial-id 653615411
fam fold3.unit get --unit-id 138483
fam fold3.image get --image-id 4346701
fam fold3.image.source get --image-id 4346701
fam fold3.image.neighbor list --image-id 4346701 --limit 10
fam fold3.image.ocr get --image-id 295842756
fam fold3.image.hits get --image-id 295842756 --keyword Navy
fam fold3.image download --image-id 4346701 --out declaration.jpg
```

Indexed record IDs (`/record/`) and image IDs (`/image/` or `/document/`) identify different kinds of content. Memorials and military units have their own IDs. Use `fam cli.context resolve --context URL` to discover the matching commands for a Fold3 URL. Large decimal IDs stay exact.

Record, memorial, unit, and image-source reads parse the site's structured hydration data without executing its scripts. Their `data` retains the provider's nested facts, events, relationships, source links, related collections, and available permissions. Image reads use the compact JSON API and normalize dimensions, metadata, publication IDs, and permissions. Sign-in context, CSRF values, and image tokens are excluded from research output.

OCR availability is independent of viewing and subscription status. Some images have no transcription; others expose OCR even when the scan is subscription restricted. OCR hits retain the API's compact rectangle encoding. Always check important names and dates against the scan.

Downloads require the current response to allow both `VIEW` and `DOWNLOAD` and provide a fresh image token. The CLI uses the viewer's whole-image JPG export, reports both source and exported dimensions (the website may downsample), checks that it decodes as JPEG, and writes a private `.jpg.json` sidecar with source metadata, citation, download time, dimensions, and SHA-256. Existing image or sidecar files are not overwritten. Subscription restrictions are reported instead of requesting the image. PDF export, annotation editing, tree writes, and bulk collection downloading are not implemented.

## Direct API and browser transport

```sh
fam fold3.api list
fam fold3.api describe --operation search
fam fold3.api call --operation search --input '{"name":"Abraham Lincoln","type":"record","limit":5}'
fam fold3.publication get --publication-id 3 --transport http
fam fold3.record search --name 'Abraham Lincoln' --transport browser
```

The operation catalog exposes curated reads using the same input fields as the TypeScript client, in camelCase. It does not accept arbitrary URLs, methods, credentials, or raw backend flags. Use `--json` for structured output, or `--out FILE.json` to save research responses privately.

`auto` starts with native HTTP and uses the configured browser when it encounters an evidenced website challenge. Reads do not initiate password login. Explicit `--transport http` never opens a browser; explicit `browser` uses browser requests. The website's same-origin proxy API is the verified integration surface. Availability and fields may change without notice.
