# Newspapers website protocol

Observed 2026-09-11 against `https://www.newspapers.com`. This is a curated website read catalog, maintained in `src/newspapers/client.ts` and exposed by `fam newspapers.api list` and `api describe`. Responses are not an official stability guarantee.

| Capability | Request | Notes |
| --- | --- | --- |
| Sign-in | `POST /api/userauth/public/authenticate` | Website submits hostname, username, password, cookie=true, and a real Turnstile token. fam uses the rendered form. |
| Account verification | `GET /account/` | Serialized Next data includes an account object with `isAuthenticated`, ID, username, and subscription flags. Parsed as JSON, never evaluated. |
| Page search | `GET /api/search/query` | `product=1`, `entity-types=page`, keyword, count, start, publication-ids, country, region, city, date-start, date-end, sort. |
| Places | `GET /api/title/location/search` | prefix, product-id=1, count. Returns place names and their country/state/city components. |
| Browse | `GET /api/browse/1/{path}` | Follow returned hierarchy paths. |
| Publication | `GET /api/browse/get-publication/1/{id}` | ID, title, location, and browse path. |
| Issue | `GET /api/browse/get-issue/{publicationId}/{date}` | Editions and page IDs for YYYY-MM-DD. |
| Page authorization | `GET /api/client/image/authorize/` | id, fcfToken, pqsid. fam requests current authorization without supplying a forged token. Returns image metadata, rights, and internal image authorization. |
| Whole-page JPG | `GET https://img.newspapers.com/img/img` | Fresh authorization's iat, page id, verified account's user ID, institutionId=0, a=download, filename, width, height, brightness=0, contrast=0, invert=0, highlight=light, and current Unix ts. Requires canView and rights.Download.allowed. Binary CLI: `fam newspapers.page download`; SDK: `download(pageId)`. |
| Word coordinates | `GET /api/search/hits` | images=pageId and terms separated by `\|`. |
| Clippings on page | `GET /api/clipping/page` | page_id, start offset, count; more_clippings and total_count. |
| Article categories | `GET /api/article/page/{id}/articles` | The observed website uses the unusual `Authorization: Bearer: …` header with current image authorization. |
| Selection OCR | `GET /api/client/image/ocr/` | page, type=article or clipping, objectId, iat, and x/y/width/height for a rectangular selection. Whole-page OCR sends the full scan dimensions with explicit x=0 and y=0; omitting the zero coordinates returned empty text during testing. Empty OCR is still possible. |

Search continuation uses an opaque `nextStart`, exposed as `nextCursor`; it is not a page number. Dates use ISO calendar dates. CLI sort values map to `score-desc`, `paper-date-asc`, and `paper-date-desc` on the service.

The viewer also uses `/image/{id}/`, public previews at `/img/thumbnail/{id}/400/400/.jpg`, and authorized image tiles at `https://img.newspapers.com/img/img`. The native transport preserves binary responses. Viewing and downloading have distinct account permissions. fam requests the website's whole-page JPG export, not a reconstruction of full-resolution tiles.

The **Save as JPG** link was observed in `/_next/static/chunks/7055-e29764577a6ba5d9.js`. Its size helper keeps scans of at most 10,240,000 pixels unchanged. For larger scans with area A, the scale is `sqrt(min(max(10240000, A/4), 64000000) / A)`; each dimension is rounded to the nearest integer. For example, a 6,792 × 8,596 scan exports at 3,396 × 4,298. fam follows this calculation, validates the returned JPEG dimensions, and fully decodes the image before saving the original response bytes. Native HTTP and CloakBrowser both returned a valid whole-page export during testing. PDF generation is performed in the website client and is not implemented by fam.

The website's viewer helpers were observed in `/_next/static/chunks/5651-ff5a7080de1bfff2.js`; search request mappings were observed in `/_next/static/chunks/1304-5a668c878d06c8cf.js`. These public bundle names identify the observation, not permanent dependencies. fam calls the website endpoints and does not load these bundles as executable CLI code.

Cookies, image authorization, account linkage, signed query parameters, and captures are excluded from the public catalog. Login keeps cookies in the selected browser instance's private profile. Native cookie replay worked for account verification, search, browsing, page metadata, and JPEG previews during testing. Cloudflare can still require the configured browser when a session or network changes.
