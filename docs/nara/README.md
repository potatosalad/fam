# National Archives Catalog

Use `nara` for the U.S. National Archives Catalog at <https://catalog.archives.gov/>. This provider reads the public, rendered website through fam’s configured browser. It requires neither a login.gov account nor a Catalog API key.

The provider name identifies the archive, so future authenticated API access can extend the same namespace. A separate provider for the API would duplicate record identities and research commands. Official API access is not implemented yet.

## Setup

Use the shared [installation guide](../setup.md) and [browser guide](../browser.md). If a browser is already configured for fam, these commands use it. Otherwise:

```sh
fam browser setup --local
fam cli.health check --provider nara
```

There are no NARA credential or session commands. The provider never requests login.gov credentials or imports a saved account session. It reads the Catalog in its own provider browser profile and closes each tab after the command. `--transport auto` and `--transport browser` both render the website; `--transport http` fails with an explanation. `--timeout 60` bounds the rendering wait and download request; increase it up to 300 seconds for slow records.

## Search

```sh
fam nara.record search --query naturalization --available-online
fam nara.record search --query '"71st Infantry Division"' --sort naId:asc --page 2 --json
fam nara.record search --query '"John Smith" AND pension' --limit 50
```

Queries are passed to the Catalog unchanged, including quoted phrases and Boolean expressions. Search results include descriptions and authority records; a hit is not necessarily a digitized document. `--available-online` applies the website’s online-access filter.

One command retrieves one results page. `--limit` accepts the website’s page sizes: 20, 50, 75, or 100. Sort values are `relevant`, `title:asc`, `title:desc`, `naId:asc`, and `naId:desc`. Repeat the query and filters with `--page` set to the returned `nextPage`. `nextUrl` retains these settings. Totals and rankings can change between calls.

The result exposes `partial` and preserves server warnings, including the Catalog’s “only some results” timeout notice. `complete` means the response contains the entire search starting at page 1, without a known server failure. Missing content or unrecognized markup raises an error instead of reporting an empty search.

## Records and digital objects

```sh
fam nara.record get --naid 152951241 --json
fam nara.object list --naid 152951241
fam nara.object get --naid 152951241 --page 2
fam nara.object transcription --naid 152951241 --page 2
fam nara.object download --naid 152951241 --page 2 --out map.jpg
```

`--naid` accepts an identifier or a Catalog `/id/NAID` URL. NAIDs remain strings, preserving exact large identifiers. URL query parameters do not silently select an object: always use the one-based `--page` flag. An `objectId` in a website link is an identifier, not a page number.

`record get` returns rendered description text, level of description, hierarchy, related Catalog links, and the object count when the website exposes it. The text retains archival access/use notes, dates, creators, and other displayed metadata. It is not the full API JSON schema. `object list` lists rendered thumbnails; `complete: false` explicitly identifies a potentially partial listing. A missing count is unknown, not zero.

`object get` selects a digital object and returns the original download URL and thumbnail when available. `--page` selects the Catalog object, not a page inside a PDF. Single-file records are supported even when the website omits its pagination controls. `object transcription` reads the existing citizen transcription, preserving line breaks. These are contributed transcriptions, not guaranteed OCR or authoritative readings. Transcribing, tagging, commenting, extracted-text panels, and account features are outside this initial implementation.

Downloads use the selected object’s observed Catalog media URL without cookies or API credentials. They create the requested file plus `FILE.provenance.json`, containing the source record/page URL, retrieval time, byte count, content type, and SHA-256 checksum. Existing files are never overwritten. The default bound is 64 MiB; `--max-bytes` can raise it to 512 MiB. Redirects outside the supported Catalog media paths are rejected. Thumbnails do not substitute for original files. Live verification covered JPEG downloads and single-PDF object selection. PDF downloads, audio, and video have not been live-verified.

All commands support readable text or `--json`. For reads, `--out FILE` saves the selected output format. For `object download`, `--out` is required and names the original binary file.

## Future API access

NARA’s [official API documentation](https://www.archives.gov/research/catalog/help/api) requires an issued key on API requests. Its [getting-started guide](https://www.archives.gov/research/catalog/help/api-getting-started) shows the `x-api-key` header. A login.gov sign-in does not supply that API credential.

When a key is available, add an explicit API transport within `nara`, backed by generic private credential storage. Keep API keys out of source, browser captures, and output. That work can add full structured metadata, API filters, reliable object enumeration, and broader pagination. Writes should remain separate commands with explicit account requirements. This website implementation does not extract or reuse keys embedded in the Catalog application.

## Verification and limits

The implementation was first checked against the anonymous Catalog on September 13, 2026, using public record 152951241 and a quoted military-unit search. Synthetic tests cover exact IDs, origin restrictions, pagination/filter mismatches, partial searches, object selection, browser cleanup, download bounds, provenance, and no-overwrite behavior. Live checks are opt-in and do not run in CI.

This is an unofficial browser adapter. Website changes may require selector updates. Advanced search facets, bulk exports, hierarchy traversal, and the official API are not yet exposed. Search results and record metadata are research leads; follow the returned Catalog links to review the original material.

Informational and success banners appear in `notices` and readable `Notice:` lines. They do not mark an otherwise successful retrieval as a history failure. The reminder to confirm availability before an in-person visit is also a notice, even though the Catalog styles it as a warning. Actual retrieval warnings and incomplete-result reporting remain in `warnings`.
