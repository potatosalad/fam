# Geneanet web protocol

Observed on 2026-09-07 using the official website, rendered public pages, the Symfony JavaScript routing map, and JavaScript bundles served by `geneacdn.net`. [Provenance](provenance.json) records URLs and SHA-256 hashes. Downloaded bundles were read as text, not executed. No mobile APK is required. These are observed website contracts, not a supported public developer API or a complete schema.

## Authentication and session lifecycle

1. `GET https://en.geneanet.org/connexion/` starts the cookie jar and supplies a form with `_csrf_token`.
2. `POST https://en.geneanet.org/connexion/login_check` uses `application/x-www-form-urlencoded` fields `_username`, `_password`, `_remember_me=on`, and the same CSRF token. `Origin` and `Referer` identify the login page.
3. Follow the website's normal redirects, retaining first-party cookies. Refuse redirects that would replay the password, leave supported HTTPS origins, or exceed five redirects.
4. Read the homepage's `GeneanetKeys` JSON literal. `user.username` identifies the session; `user.jwt_token` is a bearer token used by the separate JSON account API.
5. `GET https://api.geneanet.org/user/current` with `Authorization: Bearer TOKEN` must return the same username before a session is saved. A cookie-only request returned HTTP 403; the bearer request succeeded.

The inspected JWT contains `iat`, `exp`, `roles`, and `username`; its observed lifetime was 86,400 seconds. That observation is not a guaranteed future lifetime. The CLI keeps it only in memory and obtains one from the website when validating an account. `/user/current` also returns `jwt_token`; the account command uses a field whitelist so it never prints it.

The observed cookies were `gntsess5` (session), `REMEMBERME` (remember-me, approximately 60 days in this run), `autolang`, and Cloudflare's short-lived `__cf_bm`. They were scoped to `.geneanet.org`. A browser cookie's expiry is not a server guarantee of account access. The CLI does not synthesize tokens, change expiry, replay a password after a failed read, or claim an OAuth refresh endpoint. `verify` reads the current identity and saves refreshed cookies; `auth` explicitly starts a new password login. Cookies from the previous account are not reused for a new login.

The request transport uses `impit` with its Chrome profile, a 30-second timeout per request, and manual redirect validation. It sends jar cookies only to the exact `en`, `www`, `gw`, and `api` Geneanet origins, bearer tokens only to `api.geneanet.org`, and no account cookies to `static.geneanet.org`. Unrecognized origins, non-HTTPS URLs, embedded credentials, nonstandard ports, and fragments fail locally. HTTP errors omit response bodies. Ordinary JSON/profile output omits authentication fields.

## Searches and HTML extraction

The main search is `GET /fonds/individus/`. Old portraits use `/old-photos/search/`; library search uses `/fonds/bibliotheque/`. All three render results in `.ligne-resultat[data-id-es]`. The result's `data-type-fonds` distinguishes tree entries, registers, association indexes, library documents, and other sources. `.fake-a`, `.content-individu`, `.content-periode`, `.ligne-lieu`, and `.vignette` expose the name/title, source, dates, places, and thumbnail. `data-nb-results` holds the total; the Next link carries one-based pagination.

`nom`/`prenom` are surname/given name, `_conjoint` adds a spouse, `_pere`/`_mere` add parents, `place__0__` is the first place, `from`/`to` are year limits, `periode_mode` chooses `all|birth|wedding|death`, and `type_periode` supplies comparison semantics. `restrict_images=1` is the with-image filter. Category keys include `categories_1[archives]` and `categories_2[archives#etatcivil]`. The website also renders equivalent hidden-field encodings. Filter inputs' `data-url` values are preserved in search output, which makes current service syntax inspectable without inventing filter IDs.

`privilege`, `non-privilege`, and `external-document` CSS classes are retained verbatim as `accessMarkers`. The client does not infer an entitlement or payment requirement from these classes; access is determined by the record/viewer response. A successful empty search requires an explicit zero count. Missing result/count structure throws a format error. A Cloudflare page is detected before HTML parsing, including HTTP 200 challenge pages.

The [official search guide](https://en.geneanet.org/help/search-engine-features-and-options-2) describes result pictograms and Premium filters. The [old-photos announcement](https://en.geneanet.org/genealogyblog/post/2026/06/a-new-menu-on-geneanet-old-photos) describes public main portraits in family trees; it is not a search across every attached image. Search results are pointers to sources, not proof that same-name people are the same person.

## Records and trees

`/cercles/view/{collection}/{record}` renders a transcription with field rows and collection/source notes. Verified example fields included groom/bride names, date, and city. Some indexes have no attached image. Collections use `/collections/catalog/`, optionally `zone`, with `/theme/{slug}/` and `/collection/{slug}/` detail pages; the returned detail's links provide its collection search.

GeneWeb person URLs use `https://gw.geneanet.org/{tree}?lang=en&n=SURNAME&p=FIRSTNAME&oc=OCCURRENCE`, or `i=PERSON_INDEX`. Public rendered profiles expose biography, relatives, notes, sources, and the `gntGeneweb` JSON literal. `gntGeneweb.person.index` is the tree's person index; it is different from the search index ID. `gntGeneweb.media` supplies linked documents.

The observed JSON read `GET https://gw.geneanet.org/api/{tree}/media/{personIndex}` returns the same linked-document information without requiring the profile HTML. Relevant fields are `id` (link ID), `doc_id` (deposit), `doc_part_id` (view), `doc_title`, `doc_type`, `private`, `is_default`, and `doc_images`. The CLI preserves that response. Big integers use the shared lossless JSON parser/serializer.

The routing inventory includes `gw` endpoints `/api/modelperson`, `/api/graph`, `/api/number/ancestors`, `/api/tree/main/person`, `/api/tree/access`, and numerous tree edit/export/import/maintenance operations. Their full argument/response contracts were not established. They remain catalog-only. No genealogy edits, uploads, tree creation, indexing submissions, messages, or account changes were executed.

## Media API and download resolution

- `GET /media/api/deposits/{depositId}`: document metadata (`id`, `slug`, `username`, `title`, `type`, `private`, `date_create`) and `views[]` (`id`, `page`, `files`). Observed variants are `normal`, `screen`, `medium`, and `thumbnail`.
- `GET /media/api/deposits/{depositId}/views/{viewId}/references`: indexed names and references back to a GeneWeb person. The client first confirms view membership.
- `GET /media/public/{depositId-or-slug}`: public document page, often redirecting to its canonical descriptive slug.
- `GET /media/download/{depositId}/{viewId}`: downloadable image/PDF. It is declared by the website's routing map. The CLI resolves and validates the view through the metadata API first.

Do not derive deposit IDs from image paths. A verified portrait used deposit `2803128` with view `2803127`; requesting the latter as a deposit selected a different document. That distinction is covered by a synthetic regression test. A portrait's largest stored image may be small: original means the file offered by the download route, not a guaranteed resolution or camera original.

The public media bundle also declares resource patterns for deposit listing/filtering, updates, views, references, tags, moderation, deletion, merging, and uploads. Those writes and their payloads are not exposed through the CLI. Private documents remain subject to owner permissions.

## Archival registers

`GET /archival-registers/view/{registerId}/{page}` contains `#viewer-map` attributes `data-doc-id`, `data-min-page`, `data-max-page`, `data-api-url`, and `data-img-url`. The `.svg-icon-viewer-download` button's `data-url` is the full-image download route, `/archival-registers/download/{registerId}/{page}`. The client verifies its IDs match the requested viewer.

The viewer loads `GET /registres/api/images/{registerId}?min_page=N&max_page=M`. Both bounds are required; omitting them returned 404 during research. The response is an array of `page`, `idimage`, `nom_image`, `image_route`, `image_src`, and `image_base_url`. The website requests chunks of up to 1,001 pages; the CLI deliberately bounds each request to 100. It does not crawl a whole register automatically.

The viewer's Zoomify base exposes `ImageProperties.xml` and `TileGroup…` images. Those describe the tiled viewer, not an original download. One direct XML request received a browser challenge; the viewer download still returned the full 5,952 × 4,064 JPEG. Tile assembly is neither required nor implemented.

## Library and PDF.js

Search results link to `/library/livre/{bookId}/{collectionKey}?page=N&nom=…`, which redirects to `/library/viewer/{bookId}?page=N&name=…`. `#viewer-meta` supplies `data-livre-id`, `data-livre-nb-pages`, `data-page`, `data-single-page-mode`, `data-telechargeable`, and `data-pdf-url`. When downloading is allowed, the PDF URL is `/library/viewer/pdf/{bookId}` with a page parameter in single-page mode. A tested 786-page book supplied a valid PDF for its selected page, not the entire book.

The client honors `data-telechargeable`, validates book/page identity, and checks the received PDF signature and EOF marker before saving it. It does not claim full semantic PDF validation or OCR extraction. Library external-layer links can lead to another repository; they are retained as source URLs but are not automatically fetched. A Geneanet subscription does not imply access at an external repository.

## Reproduction and limits

`docs/geneanet/contracts.json` is the maintained selected-operation catalog plus broader route inventory. `npm run generate:catalogs` builds `src/geneanet/generated/contracts.ts`; `npm run check:catalogs` checks it offline. The other providers' historical catalogs are unchanged. Public source hashes are evidence of the inspected version; routine generation does not fetch the website.

Mocked tests cover CSRF/login validation, single password submission, cookie scope, bearer restrictions, redirect denial, response redaction, exact search IDs, empty-vs-challenged pages, view ownership, file integrity, and overwrite refusal. Live reports and fetched account pages belong in a private configuration/research directory, never the shared repository. The deployment's private integration maintains the optional live verifier and its timestamped results.

Verified HTTP coverage includes login, account validation, main and old-photo search, collection browsing, transcribed records, tree-media JSON, media references, register image metadata, original image downloads, and a library PDF page. Browser-rendered library search and tree profiles were inspected, but some direct HTTP requests to those pages received challenges. Tests do not establish every filter combination, every account entitlement, every media format, anonymous access to every collection, or any write operation.
