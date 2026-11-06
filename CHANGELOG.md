# Changelog

Versions use `YYYY.MDD.N` (UTC date, daily counter). Newest first.

## 2026.1106.2

Provider fixes from a read-only pass over all 15 providers, plus cleanup.

- NewspaperArchive: use the printed page number (cross-checked against the URL `-p-N`); citations previously said p. 1 for later pages.
- Geneanet: portrait results include attribution, dates, and thumbnails; library results distinguish the book page from the PDF position.
- American Ancestors: collection and category are parsed separately, so returned titles round-trip into `collection get`. `collection browse`, `image list`, and `image download` accept `--anonymous`.
- Fold3: OCR and transcripts carry the image's quality classification and warn on garbage OCR. Upstream `â€”` mojibake is preserved and documented.
- Ancestry: search results expose exact record and collection IDs from multipart GIDs. Hint totals are reported as unknown instead of the limit-dependent count.
- NARA: object pages beyond the record's image count fail fast with `INVALID_ARGUMENT`. Malformed-NAID errors are clearer.
- Wayback: unsafe upstream CDX rows are skipped with warnings and partial-state metadata instead of failing the listing as bad input.
- MyHeritage: person lookup works again (the provider rejected `maxResults`; results are now limited locally). `count: 0` responses are empty results. OldNews `binary/octet-stream` images download.
- Findmypast: `image get --record-id` resolves the record to its image. `newspaper manifest` uses the current issue-level route. `collection get` rejects empty descriptions with a metadata-ID hint. Entitlement `reason: Error` responses fail.
- Cyndi's List: follows HTTP-200 redirect and canonical pages, and fails clearly when every search link is off-site.
- FamilySearch: `source list` treats HTTP 204 as an empty list. `image transcript --format json --out` writes the requested format, with no `.json.json`. Corrected film-listing `--offset`, full-text `--record-type`, and year `FROM:TO` help. Missing `--out` parent directories are created.
- Newspapers.com: existing download destinations are rejected before contacting the provider. Whole-page OCR reports the upstream limitation clearly (the endpoint returns `Invalid objectId`), and article OCR still works.
- Input errors: malformed IDs, ranges, and years in FamilySearch, Storied, Geneanet, Fold3, and NARA return `INVALID_ARGUMENT` (exit 2). JSON validation errors include the recognized command.
- Cleanup:
  - Removed the retired HAR recorder; HAR import is kept.
  - Removed unused exports and imports.
  - Browser-channel options are restricted to CloakBrowser.
  - Fixed tests that could pass vacuously or were timing-dependent.
  - Documented `scripts/download-apk.py`.

## 2026.1106.1

- Removed the Camofox engine, Docker setup, and engine-switch discovery; CloakBrowser is the only browser.
- Relocated the shared browser protocol into CloakBrowser; retained tabs, fetch, login, checkpoints, and reset support.
- Ignore retired config entries; reuse configured CloakBrowser endpoints or request setup. Updated browser docs and regression tests.

## 2026.1106.0

- Dependencies: Playwright 1.65.0, onnxruntime-web 1.31.1, graphql 17.1, impit 0.14.8, sharp 0.35.5, turndown 7.2.5; dev: express 5.3, tsx 4.23.15, @types/node 26.6.6. `npm audit` clean (undici, qs, body-parser fixes).
- CloakBrowser service: wrapper and image 0.5.10 → 0.6.5 (last keyless release; pinned by digest), Playwright 1.65.0, express 5.3.0. Local image tag is now `fam-cloakbrowser:0.6.5`.
- CloakBrowser humanize: removed the selector fallback adapter. 0.6 resolves `:visible`, role, and chained selectors natively, and `UnsupportedHumanizeSelectorError` is no longer thrown.
- Added this changelog.
