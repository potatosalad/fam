# Newspapers website protocol

Observed 2026-09-11 against `https://www.newspapers.com`. This is a curated website read catalog, maintained in `src/newspapers/client.ts` and exposed by `fam newspapers.api list` and `api describe`. Responses are not an official stability guarantee.

| Capability | Request | Notes |
| --- | --- | --- |
| Sign-in | `POST /api/userauth/public/authenticate` | Website submits hostname, username, password, cookie=true, and a real Turnstile token. fam uses the rendered form. |
| Account verification | `GET /account/` | Serialized Next data includes an account object with `isAuthenticated`, ID, username, and subscription flags. Parsed as JSON, never evaluated. |
| Page and indexed record search | `GET /api/search/query` | `product=1`, entity-types=page, obituary, marriage, birth, enslavement, or crime (one per request), keyword, count, start, publication-ids, country, region, city, date-start, date-end, sort. |
| Places | `GET /api/title/location/search` | prefix, product-id=1, count. Returns place names and their country/state/city components. |
| Browse | `GET /api/browse/1/{path}` | Follow returned hierarchy paths. |
| Publication | `GET /api/browse/get-publication/1/{id}` | ID, title, location, and browse path. |
| Issue | `GET /api/browse/get-issue/{publicationId}/{date}` | Editions and page IDs for YYYY-MM-DD. |
| Page authorization | `GET /api/client/image/authorize/` | id, fcfToken, pqsid. fam requests current authorization without supplying a forged token. Returns image metadata, rights, and internal image authorization. |
| Whole-page JPG | `GET https://img.newspapers.com/img/img` | Fresh authorization's iat, page id, verified account's user ID, institutionId=0, a=download, filename, width, height, brightness=0, contrast=0, invert=0, highlight=light, and current Unix ts. Requires canView and rights.Download.allowed. Binary CLI: `fam newspapers.page download`; SDK: `download(pageId)`. |
| Word coordinates | `GET /api/search/hits` | images=pageId and terms separated by `\|`. |
| Clippings on page | `GET /api/clipping/page` | page_id, start offset, count; more_clippings and total_count. |
| Clipping search | `GET /api/clipping/list` | product_id=1, visibility=public or all, user, keyword, tag, region (place name), title (publication ID), date_start, date_end, count, sort, cursor_mark. visibility=all is used only with the verified account's own ID. |
| Clipping details | `GET /article/api/{clippingId}/` | Saved title/body/tags, page identity, rectangle(s), OCR, and other clipping metadata. page_token and signed URL parameters stay internal. Native requests encountered Cloudflare; CloakBrowser succeeded. |
| Article categories | `GET /api/article/page/{id}/articles` | The observed website uses the unusual `Authorization: Bearer: …` header with current image authorization. |
| Article JPG | `GET https://img.newspapers.com/img/img` | Whole-page export parameters plus crop=x_y_width_height. Output dimensions are computed from the selected crop. CLI: `fam newspapers.article download`; SDK: `downloadArticle(pageId, articleId, type?)`. |
| Clipping JPG | `GET https://img.newspapers.com/img/img` | clippingId, fresh page iat, width, height, a=download, filename, highlight=light, ts. Current page viewing and download permission are checked first. CLI: `fam newspapers.clipping download`; SDK: `downloadClipping(clippingId)`. |
| Selection OCR | `GET /api/client/image/ocr/` | page, type=article or clipping, objectId, iat, and x/y/width/height for a rectangular selection. Whole-page OCR sends the full scan dimensions with explicit x=0 and y=0; omitting the zero coordinates returned empty text during testing. Empty OCR is still possible. |

Search continuation uses an opaque `nextStart`, exposed as `nextCursor`; it is not a page number. Dates use ISO calendar dates. CLI sort values map to `score-desc`, `paper-date-asc`, and `paper-date-desc` on the service.

Indexed search records supply `page.id` and a UUID `articleId`. Detailed article retrieval selects that entity from the page's `obituaries`, `marriages`, `births`, `enslavements`, or `crimeArticles`. The first four match `id`; crime records match `crime.CrimeId`. A nested parent `articleId` can differ from the search ID. Birth and enslavement geometry comes from normalized polygons: multiply each minimum/maximum edge by the original page dimension, round each edge, and subtract to obtain width/height. This matches the viewer's conversion. fam exposes all matching extractions in a `details` array with a citation and resolved rectangle; multiple birth subjects can share one article ID. Conflicting coordinates are rejected. It does not treat extracted relationships as verified genealogical facts.

Clipping search returns `clippings`, `more_results`, and `next_cursor_mark`. fam exposes a cursor only when more results exist and rejects a missing or repeated continuation. An observed empty own-clippings response had `next_cursor_mark: 0` and `more_results: false`; that is a successful empty collection. Modified-date sorts use `modified-desc` and `modified-asc`. The search mapping was observed in `/_next/static/chunks/9144-9f2e1c828e80e04d.js`, and clipping detail retrieval in `/_next/static/chunks/6439-34dd67e1225f1ad5.js`.

The viewer also uses `/image/{id}/`, public previews at `/img/thumbnail/{id}/400/400/.jpg`, and authorized image tiles at `https://img.newspapers.com/img/img`. The native transport preserves binary responses. Viewing and downloading have distinct account permissions. fam requests the website's whole-page JPG export, not a reconstruction of full-resolution tiles.

The **Save as JPG** link was observed in `/_next/static/chunks/7055-e29764577a6ba5d9.js`. Its size helper keeps scans of at most 10,240,000 pixels unchanged. For larger scans with area A, the scale is `sqrt(min(max(10240000, A/4), 64000000) / A)`; each dimension is rounded to the nearest integer. For example, a 6,792 × 8,596 scan exports at 3,396 × 4,298. fam follows this calculation, validates the returned JPEG dimensions, and fully decodes the image before saving the original response bytes. Native HTTP and CloakBrowser both returned a valid whole-page export during testing. PDF generation is performed in the website client and is not implemented by fam.

Article exports use the resolved crop's dimensions with the same size cap. Clipping exports send the clipping ID so the server applies its saved selection; multiple rectangles are retained in metadata, and their bounding box determines the requested dimensions. A native article crop and a CloakBrowser clipping export both returned valid JPEGs with the expected dimensions. Sidecars preserve the citation, selection details, exact large integers, and image checksum while withholding authorization. No clipping creation or correction request is issued by these commands.

The website's viewer helpers were observed in `/_next/static/chunks/5651-ff5a7080de1bfff2.js`; search request mappings were observed in `/_next/static/chunks/1304-5a668c878d06c8cf.js`. These public bundle names identify the observation, not permanent dependencies. fam calls the website endpoints and does not load these bundles as executable CLI code.

Cookies, image authorization, account linkage, signed query parameters, and captures are excluded from the public catalog. Login keeps cookies in the selected browser instance's private profile. Native cookie replay worked for account verification, search, browsing, page metadata, and JPEG previews during testing. Cloudflare can still require the configured browser when a session or network changes.
