# Wayback Machine

Read archived web pages from the Internet Archive without an account. Useful when the original site has disappeared or remains blocked by browser verification.

```sh
fam wayback.page fetch --url https://example.org/page
fam wayback.page fetch --url https://example.org/page --format markdown
fam wayback.page fetch --url https://example.org/page --date 2015-01-01 --json
fam wayback.page fetch --url https://example.org/page --format html --out archived.html
fam wayback.page fetch --url https://example.org/file.pdf --format raw --out archived.pdf
```

Fetching chooses the newest indexed HTTP 200 capture. `--date` selects the closest capture to a year, calendar date, or Wayback timestamp (`YYYYMMDDhhmmss`); it may fall before or after the requested date. Years and partial timestamps start at the beginning of that period in UTC. Supply a full `https://web.archive.org/web/TIMESTAMP/ORIGINAL_URL` snapshot URL to read that capture directly. If Wayback redirects to a different capture, the result identifies the capture actually returned.

Text is the default. `markdown` extracts readable markup; `html` returns archived HTML without Wayback's toolbar or link rewriting; `raw` writes the response body bytes exposed by the transport, including binary files. Archived scripts are not executed during normal retrieval. JSON includes the capture timestamp, original URL, replay URL, raw URL, HTTP metadata, and extracted content. Text/Markdown/HTML/raw commands print the capture link to stderr so stdout and `--out` contain only the chosen content. Relative links in extracted text metadata and Markdown resolve against the original page.

Find a link without downloading the page, or browse successful captures:

```sh
fam wayback.snapshot find --url https://example.org/page
fam wayback.snapshot find --url https://example.org/page --date 2010 --json
fam wayback.snapshot list --url https://example.org/page --from 2010 --to 2020 --limit 20
```

Lists use exact URL matching and successful HTTP 200 captures, oldest first. Date bounds are inclusive. The default limit is 20 (maximum 1000). `truncated: true` means more captures exist; increase `--limit` or narrow `--from`/`--to`. Captures with identical content are retained. A missing snapshot is reported as `available: false` by `find`; `fetch` exits with `WAYBACK_NOT_FOUND`. A request failure or rate limit is an error, not evidence that the page was never archived. An indexed capture may still be unavailable at retrieval time.

Requests use HTTP first unless this profile has a successful browser route saved for Wayback. If the archive presents a recognized verification challenge, fam uses the configured Camofox browser in its separate `wayback` context. `--transport=http` disables that fallback; `--transport=browser` uses Camofox directly. Successful browser requests save that route for future automatic requests, just like other providers. `--open=auto` is the default viewer policy, opening for a human prompt or an unresolved challenge; `--open=always` forces browser transport and immediate opening; `--open=never` keeps the viewer closed. The [browser setup and verification timeout options](../browser.md) apply. `--timeout SECONDS` bounds each archive request. HTTP 429 reports the archive's Retry-After value when present and does not retry automatically.

This retrieves existing public snapshots. Archived pages may be incomplete, unavailable, or contain an old error/challenge page; a successful historical HTTP status does not prove useful page content. Internet Archive item/book search and Save Page Now are separate services.

The TypeScript client is exported from `@potatosalad/fam/wayback` as `WaybackClient`.

Protocol references: [CDX index API](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server), [closest-date query implementation](https://github.com/internetarchive/wayback/blob/master/wayback-cdx-server/src/main/java/org/archive/cdxserver/CDXServer.java), and [Wayback replay implementation](https://github.com/internetarchive/wayback). Lookup and listing use CDX directly; the separate availability endpoint is not required.
