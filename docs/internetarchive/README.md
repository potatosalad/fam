# Internet Archive

Search books, city directories, county histories, family genealogies, periodicals, maps, audio, and other Archive.org items. This provider uses public APIs directly; it does not require Python or the upstream `internetarchive` package. For archived websites, use the separate [Wayback provider](../wayback/README.md).

All eight commands read remote data. They do not upload, edit metadata, delete files, submit reviews, create loans, or change an account. An explicit output path writes local files. See [installation and shared configuration](../setup.md) for CLI setup.

## Authentication and access

**No credentials are needed for this provider's public research workflow.** It sends anonymous requests and never loads saved fam credentials, browser cookies, the upstream `ia.ini`, or `IA_ACCESS_KEY_ID` / `IA_SECRET_ACCESS_KEY`. There are no Internet Archive login or credential commands in fam. No browser setup is required.

This does **not** mean everything on Archive.org is anonymously downloadable:

| Operation or material | Access behavior |
| --- | --- |
| Catalog search, collection browsing, public item metadata and file listings | Anonymous access verified. |
| Full-text search | Anonymous access verified; may return snippets for restricted items. It is an experimental service. |
| Public OCR, PDFs, images, and other item files | Anonymous when the selected file is available publicly. |
| Private, login-restricted, lending, or print-disability material | Depends on account permissions and Archive.org's access rules. A metadata record or search hit does not grant file access. |

The upstream [configuration guide](https://archive.org/developers/internetarchive/configuration.html) describes two different credential types: **IA-S3 access/secret keys**, available from the signed-in [account keys page](https://archive.org/account/s3.php), and **logged-in-user / logged-in-sig cookies**. Keys authenticate API operations; cookies serve account-bound access. Neither should be interpreted as blanket access to restricted books. fam currently implements neither authenticated access nor borrowing/DRM flows; use the item's Archive.org page for available account access.

That configuration guide says searching requires keys. However, the studied [upstream search implementation](https://github.com/jjjake/internetarchive/blob/a6178c110a94d0cf80fb3a46b6ca36366b72b733/internetarchive/search.py) attaches key authentication only when both keys are present. Anonymous catalog and full-text requests also succeeded during development on **2026-09-11**. This is evidence for the implemented public workflow, not a promise about every endpoint or future access policy. fam surfaces denials instead of attempting account recovery.

## Find research material

Catalog search looks at **item metadata**, not words inside book pages. Use it for titles, authors, subjects, places, dates, languages, and collections. With no media filter, all media types are eligible.

```sh
fam internetarchive.item search --query 'collection:genealogy AND mediatype:texts'
fam internetarchive.item search --query 'title:"city directory" AND year:[1880 TO 1920]' --sort 'date asc'
fam internetarchive.item search --query 'subject:"Lancaster County" AND mediatype:texts'
fam internetarchive.item search --query 'creator:"United States. Bureau of the Census"'
fam internetarchive.item search --query 'mediatype:image AND title:map'
fam internetarchive.item search --query 'mediatype:collection AND genealogy'
```

Use Archive.org's [advanced-search syntax reference](https://archive.org/advancedsearch.php#raw): `field:value`, quoted phrases, `AND`, `OR`, negation, parentheses, and inclusive ranges such as `year:[1880 TO 1920]`. Quote the entire expression in your shell. Dates and subjects depend on contributor-supplied metadata; missing or inconsistent fields can exclude useful material. Try spelling variants and broader searches.

The default result fields include identifier, title, creator, date/year, description, subject, collection, media type, language, and `access-restricted-item`. Arrays remain arrays in JSON. Use repeatable `--field` options to choose fewer fields; identifier and a details-page URL are always included.

```sh
fam internetarchive.item search --query 'collection:genealogy' --field title --field creator --limit 20 --page 2 --json
fam internetarchive.item search --query 'collection:genealogy' --sort 'date asc' --sort 'identifier asc' --json --out catalog.json
```

Search returns one page, default 20 and maximum 1000 items. `data.total`, `data.hasMore`, and `data.nextPage` describe continuation. The supported page window is 10000 results (`page × limit <= 10000`). Follow the returned page or narrow your query; fam does not automatically exhaust the archive. Retain the same query, page size, fields, and sort between calls.

## Browse collections and larger result sets

A collection is itself an item. Read its metadata with `item get`, then browse matching members:

```sh
fam internetarchive.item get --identifier genealogy --json
fam internetarchive.collection items --identifier genealogy --query 'title:history' --limit 20
fam internetarchive.collection items --identifier allen_county --query 'title:directory'
```

`collection items` adds `collection:IDENTIFIER AND (QUERY)` to catalog search; the query defaults to `*:*`. This is indexed membership, not a recursive walk or a frozen collection inventory. An item can belong to multiple collections.

For large catalog queries, use one cursor page at a time:

```sh
fam internetarchive.item scan --query 'collection:genealogy' --count 100 --field title --json
fam internetarchive.item scan --query 'collection:genealogy' --count 100 --field title --cursor 'RETURNED_CURSOR' --json
```

`scan` uses the scrape API, with a minimum count of 100, default 100, and maximum 10000. It preserves the complete returned page; it does not trim a larger page and lose items behind the cursor. Copy `data.cursor` exactly and retain query, fields, and sorts. If sorting by identifier, put it last. `cursor: null` means the API supplied no continuation. `data.total` describes remaining matches when a cursor was supplied. Index changes can repeat or omit items; these results are not a snapshot.

## Search inside indexed text

```sh
fam internetarchive.fulltext search --query '"John Smith" AND "Lancaster"' --limit 10
fam internetarchive.fulltext search --query '"John Smith" AND "Lancaster"' --limit 10 --offset 10 --json
```

Full-text search queries indexed OCR and returns original hit fields and highlighted snippets, plus a normalized item identifier and URL where available. Catalog field syntax is not guaranteed to mean the same thing here. Start with words, quoted phrases, and Boolean expressions. This command uses the Lucene mode of the experimental endpoint also used by the upstream Python client; raw DSL and server-side scroll sessions are not exposed.

The default limit is 20, maximum 100. Offsets start at zero; `offset + limit` must not exceed 10000. `data.nextOffset` supplies continuation within that window. Beyond it, narrow the query. Preserve `data.total` as returned: it may be a number or an object containing a value and relation. Hits may repeat an item, and a total need not count distinct books.

`timedOut: true` and a warning mean partial results, not a complete search. OCR can misread names and dates, omit pages, or fail to index an item. No hits do not establish that a person is absent. Keep the returned `fields`, `highlight`, and provider page information, but verify against the scanned page before citing it; OCR page values are not guaranteed to be printed page numbers. Search visibility does not establish download permission.

## Inspect an item and choose files

```sh
fam internetarchive.item get --identifier historyofnewyork00irvi --json
fam internetarchive.file list --identifier historyofnewyork00irvi
fam internetarchive.file list --identifier historyofnewyork00irvi --file-format DjVuTXT
fam internetarchive.file list --identifier historyofnewyork00irvi --file-format 'Text PDF'
fam internetarchive.file list --identifier historyofnewyork00irvi --name jp2 --source derivative --json
```

`item get` retains the public metadata API response: bibliographic metadata, file inventory, access flags, reviews, and other fields when provided. Metadata keys and value shapes vary. `file list` adds safe download URLs and can filter by exact format label (case insensitive), file-name substring, or `source` (`original` / `derivative`). File sizes remain exact strings when supplied that way, and large JSON integers are preserved by fam.

Useful formats include `DjVuTXT` for plain OCR, `Text PDF` for searchable page scans, `Djvu XML` / `hOCR` for OCR layout, `Scandata` / `Page Numbers JSON` for page metadata, and `Single Page Processed JP2 ZIP` for page images. Not every item has every derivative. File names can differ from the item identifier: always use the returned exact name.

## Read OCR and download sources

```sh
fam internetarchive.text get --identifier historyofnewyork00irvi --limit 2000
fam internetarchive.text get --identifier historyofnewyork00irvi --offset 2000 --limit 2000 --json
fam internetarchive.file download --identifier historyofnewyork00irvi --file historyofnewyork00irvi_djvu.txt --out book.txt
fam internetarchive.file download --identifier historyofnewyork00irvi --file historyofnewyork00irvi.pdf --out book.pdf
```

`text get` selects a unique public `DjVuTXT` / `_djvu.txt` file. If there are multiple volumes, or a differently named plain-text file, specify `--file EXACT_NAME`. Only uncompressed `.txt` files are read; download other formats separately. It fetches at most 50 MiB, verifies available size/MD5 metadata, and displays an excerpt (default 20000, maximum 200000 UTF-16 characters). `nextOffset` continues the excerpt. Every call fetches the complete source file again; download once for repeated local searching. Character offsets are not page numbers.

`file download` downloads exactly one metadata-listed file to an explicit `--out`. It streams to a temporary file, checks available size and MD5, computes SHA-256, and creates `OUT.json` with the identifier, filename, source/download URLs, retrieval time, and checksums. Output and sidecar have private file permissions. It refuses to overwrite either path and removes temporary files after failure. Remote names never determine a local directory path. Files marked private are refused; other access restrictions are reported by the service.

The default download cap is 512 MiB; `--max-bytes` can raise it up to 2 GiB. Increase `--timeout` for large files. There is no resume, multi-file download, archive extraction, or automatic overwrite. An item may change during retrieval; an integrity error requires a fresh metadata/download attempt. Preserve the sidecar with the source and record the actual printed page in your research citation.

## API behavior and diagnostics

| Command | Method and endpoint | Main request / response fields |
| --- | --- | --- |
| `item search`, `collection items` | `GET https://archive.org/advancedsearch.php` | `q`, `output=json`, `rows`, `page`, `fl[N]`, `sort[N]`; `response.docs`, `response.numFound` |
| `item scan` | `GET https://archive.org/services/search/v1/scrape` | `q`, `fields`, `sorts`, `count`, `cursor`; `items`, `total`, `cursor` |
| `fulltext search` | `POST https://be-api.us.archive.org/ia-pub-fts-api` | JSON `{q: "!L QUERY", size, from, scroll: false}`; `hits.hits`, `hits.total`, `timed_out`. This POST is a search, not an archive mutation. |
| `item get`, `file list` | `GET https://archive.org/metadata/IDENTIFIER?extended_err=1` | Item `metadata`, `files`, and optional extra fields |
| `text get`, `file download` | Metadata lookup, then `GET https://archive.org/download/IDENTIFIER/ENCODED_FILE?cnt=0` | Public bytes; `cnt=0` follows upstream download-count behavior |

The [metadata read API](https://archive.org/developers/md-read.html) can report errors inside HTTP 200, or return an empty array for a missing item. fam treats these as errors. `extended_err=1` requests additional error detail, including unavailable/deleted items. Empty search results remain successful responses. JSON is bounded to 32 MiB per response.

Requests identify `fam/VERSION` and use HTTPS. Add `--user-agent-suffix 'YourTool/1.0 (MODEL)'` when running an automated agent, as requested by Archive.org's [automated-access guidance](https://archive.org/developers/bots.html). API calls use HTTP directly, with no browser fallback. Download redirects are limited to Archive.org and recognized Archive.org storage nodes; authentication pages and other origins are refused.

The per-request timeout is 60 seconds by default, configurable with `--timeout` from 1 to 3600. HTTP 429/502/503/504 receive at most two retries. fam honors `Retry-After` values up to ten seconds within that timeout; longer waits fail with guidance to retry later. Calls do not automatically loop through pages. Space out repeated requests and save results instead of repeatedly fetching the same material.

```sh
fam cli.health check --provider internetarchive --offline
fam cli.health check --provider internetarchive --live
fam cli.doc read --provider internetarchive
fam cli.context resolve --context https://archive.org/details/historyofnewyork00irvi
```

The live health check probes catalog search only. It does not verify full-text, downloads, or account access. `--json` selects fam's structured envelope and errors. Search/item/file-list/text `--out` saves the selected readable or JSON representation; a download's `--out` always saves source bytes. `--dry-run` validates CLI flags without provider requests or output-file creation; it does not test the query or access rights.

## Implementation research

Studied [jjjake/internetarchive](https://github.com/jjjake/internetarchive) at commit `a6178c110a94d0cf80fb3a46b6ca36366b72b733` on 2026-09-11, specifically `search.py`, `session.py`, `files.py`, `auth.py`, the search CLI, and configuration documentation. fam implements its own TypeScript HTTP client; it does not vendor or invoke the Python library.

The upstream workflow informed catalog search, cursor scans, metadata, file format selection, and full-text search. Uploads, writes, tasks, account management, loans, and bulk operations are outside this provider. Offline tests use synthetic responses and files; live research requests are manual and do not run in CI. API observations can change; this date records development evidence rather than guaranteeing future availability.

The TypeScript client is exported from `@potatosalad/fam/internetarchive` as `InternetArchiveClient`. Its constructor accepts `timeout`, `userAgentSuffix`, and an optional injected `fetch` for testing. Methods are `search`, `scan`, `collection`, `fulltext`, `item`, `files`, `text`, and `download`.
