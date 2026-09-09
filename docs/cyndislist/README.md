# Cyndi’s List

Browse Cyndi’s List directly to find genealogy resources by place and record type. Category browsing, page reading, and redirect resolution use public pages and require no account. Google search runs in the configured Camofox browser; see [browser setup](../browser.md).

## Browse categories without Google

```sh
fam cyndislist.category list
fam cyndislist.category list --filter "New Zealand"
fam cyndislist.category get --url https://www.cyndislist.com/new-zealand/
fam cyndislist.category get --url https://www.cyndislist.com/new-zealand/ --depth 1 --all-pages --json
```

`category list` reads the [main category index](https://www.cyndislist.com/categories/) and returns category names, URLs, published update dates, and link counts. `--filter` matches every supplied word, ignoring case, against category names.

`category get` returns the selected page’s resources, child category links, related categories, breadcrumbs, and pagination. `--depth 0` is the default: it reads the selected page and lists its child links. `--depth 1` also reads each immediate child page, including that child’s resource listings and descriptions. Larger depths expand further, up to 20 levels. Traversal follows explicit child category links, preserves related links separately, and skips already visited category URLs.

Each resource retains its Cyndi ID as a string, clickable Cyndi link, title, description, source markers such as FREE, description links, and nested children. Unlinked headings remain in the hierarchy. Text such as “LDS film # 0094108” is preserved as written, without inventing a generic film-number namespace.

## Read arbitrary Cyndi URLs

```sh
fam cyndislist.page get --url https://www.cyndislist.com/faqs/
fam cyndislist.page get --url https://www.cyndislist.com/new-zealand/wills/ --json
fam cyndislist.resource resolve --url 'https://www.cyndislist.com/openurl/?url=123'
```

The resource ID in the last example is illustrative; use an actual URL returned by a listing.

`page get` extracts main text and links and recognizes categories and resource listings where available. Unfamiliar HTML falls back to available text and links with a warning. Non-text files return their source URL and media type. Cyndi redirects to external sites return the destination URL without fetching that site. HTTP and non-www Cyndi aliases are normalized; arbitrary paths and query parameters are preserved, and fragments are ignored for retrieval.

Native HTTP is preferred, with the existing Camofox recovery for browser challenges. `--transport http|browser|auto` and `--browser-timeout` use the shared browser controls.

## Search through Google in Camofox

```sh
fam cyndislist.resource search --query "New Zealand probate"
fam cyndislist.resource search --query "Richmond County Virginia court records" --all-pages --json
```

Search is always restricted to `site:cyndislist.com`. It returns Google’s result titles, snippets, and actual Cyndi URLs. Google redirect URLs are resolved through the browser without fetching the destination pages. An unresolved result retains its Google link, a null Cyndi URL, and an error explaining the failure. Search does not automatically read Cyndi pages or use a local search index.

One Google page is returned by default. To continue, repeat the original `--query` and pass the returned `cursor` as `--cursor`. `--all-pages` follows Google’s available next-page links. Google controls which results and pagination it exposes; this does not promise exhaustive site coverage. Google consent and verification use the existing viewer and configured timeout. `--browser-timeout 0` returns immediately when interaction is needed. A challenge is never reported as zero results, and an unfinished verification tab remains open.

## Pagination and partial results

For Cyndi reads, `--all-pages` follows available pagination **from the requested page onward**, including each visited child category when combined with `--depth`. Pagination stays at the same depth. Read `nextUrl` with the same page/category command to continue manually.

Results contain `pages`, combined `resources` and `categories`, expanded `children`, `nextUrl`, `complete`, and `errors`. `complete` describes pagination for the requested depth, not whether every descendant or external resource has been fetched. Later-page or child failures retain successful results and report their URLs; an initial page failure without a saved copy is an execution error. Search uses equivalent pagination/error metadata. Scripts should inspect these fields even when the CLI exits successfully.

## Cache behavior

Cache files are private, atomic JSON beneath `cyndislist/cache/` in the active [fam profile](../setup.md). The default profile is `~/.config/fam`; `FAM_CONFIG_DIR` overrides it. No full-site crawl or prebuilt catalog is needed.

- During use, the main category index is checked at most once per hour. Each operation shares one index check across all pages it reads.
- A cached page records its top-level category’s published update date and link count. A changed date or count invalidates cached descendants and pagination when they are next requested. Unchanged categories can remain cached beyond 24 hours.
- Dates have day precision. Content fetched within 48 hours of its published date is checked again after 24 hours, covering same-day changes and the publisher’s unspecified timezone. A later fetch can then rely on the unchanged category marker.
- Pages without an associated update marker, including resource redirects, use a 24-hour fallback. Removing a known marker also causes revalidation.
- `--refresh` forces an index check and fresh reads of the requested pages. If a refresh fails, a saved copy is returned by default with `cache.status: "stale"`, its original `fetchedAt`, age, and warning. Failed fetches never replace successful saved content. Google searches run live.

Cyndi [documents category update dates](https://www.cyndislist.com/faqs/) as change signals. They are not per-resource versions or a guarantee against unannounced edits; `--refresh` remains available when exact current content matters.

## Output and health

Readable text is the default, including when piped. `--json` uses fam’s normal structured envelope. `--out FILE` atomically saves the provider result as JSON with private permissions. Source URLs and cache provenance remain in the result.

```sh
fam cli.health check --provider cyndislist --offline
fam cli.health check --provider cyndislist
```

Offline health checks public-access configuration without credential lookup. Live health reads the category index; it does not search Google or visit external resource destinations.

TypeScript clients are exported from `@potatosalad/fam/cyndislist`.
