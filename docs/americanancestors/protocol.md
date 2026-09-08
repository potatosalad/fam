# Observed American Ancestors website protocol

Observed 2026-09-08 from first-party pages, their linked JavaScript, and opt-in account verification. The transport is native HTTP using Impit with a scoped cookie jar. The research backend returns a mixture of HTML fragments and JSON, rather than a single REST/GraphQL API. Routes and response fields may change without notice.

## Primary evidence

- [Advanced research search](https://www.americanancestors.org/database-search-advanced-search): the Drupal loader fetches `https://app.americanancestors.org/SearchResults/AdvancedSearch` with browser credentials.
- [Research results](https://www.americanancestors.org/search/database-search): its loader fetches `/searchresults/results`; the linked `Searchjs` bundle constructs the native search query.
- [Search overview](https://www.americanancestors.org/search-overview): the provider describes its database and partner collection offerings.
- [Account login](https://my.americanancestors.org/account/login): TNEW form and anti-forgery token. The main website's login handler builds the app refresh-credentials return URL.
- [Database example](https://www.americanancestors.org/search/databasesearch/27/boston-ma-births-1700-1800): collection-scoped search and guidance.

The source bundles are inspected as evidence, never evaluated by fam. Credentials, captured sessions, live result fixtures, source bundles containing embedded keys, and account reports are not shipped with the shared runtime. Unit fixtures are synthetic.

## Authentication

1. GET `https://my.americanancestors.org/account/login?ReturnUrl=ENCODED_RETURN_URL`, retaining cookies. The return URL is `https://app.americanancestors.org/account/refreshcredentials?returnurl=https://www.americanancestors.org/search/advanced-search`.
2. Find the unique `#tn-login-form` and its `__RequestVerificationToken`. Submit one URL-encoded POST to the same login URL with `PatronAccountLogin.Username`, `PatronAccountLogin.Password`, and that token.
3. Follow the observed SSO GET redirects through the app's refresh endpoint and the shop's `/account/login/multipass/…` endpoint to the public website. Multipass paths and cookies are secret and must not be logged. No password is forwarded on redirects; 307/308 responses to the form are refused.
4. Verify `a.nav-link--user-logout` on a fresh public research page. This establishes a signed-in website session, not a subscription tier. Save cookies only after verification.

Relevant observed cookies include TNEW/account identity, app `.ASPXAUTH`, and shared website session cookies. fam uses cookie-jar domain/path/expiry rules instead of extracting credentials from their values. Website request origins are exactly `www`, `app`, `my`, and `shop.americanancestors.org`. Shop redirects are limited to the observed login route. Published media uses numeric `N.img.americanancestors.org` hosts, with **no cookies** sent. Native requests have a 30-second timeout, bounded redirects, and a 20-MiB per-response cap. Rate limits and failed password submissions do not trigger retries. GET challenge recovery uses the shared transport; password POST recovery is disabled.

## Read endpoints

All paths below are relative to `https://app.americanancestors.org`.

| Method/path | Input | Response/use |
| --- | --- | --- |
| GET `/SearchResults/dropdowns` | `onLoad=true` | `SearchDropdown.Databases`, `.Categories`, `.Projects`, `.RecordTypes`, `.LifeEvents`; `-All-` is a UI sentinel |
| GET `/SearchResults/GetDatabseUrl` | `collectionName` exact title | JSON `ID/slug` string; spelling `Databse` is intentional |
| GET `/SearchResults/ExtendedDropdowns` | `collectionName` | `volumes` with `VolumeId`, `Name`, `SequenceId`, `Pages`; `attributes` and optional collection-specific fields |
| GET `/SearchResults/SearchTips` | `collectionName` | JSON string containing search guidance HTML |
| GET `/searchresults/results` | Search query below | HTML `#tblSearchResult` rows plus pagination inputs |
| GET `/ExploreDatabases/CollectionId` | `alias` slug | JSON `collection_id` used to resolve viewer/record URLs |
| GET `/exploredatabases/RecordDisplay` | `cId`, `rId`, `volumeId`, `pageName` | HTML indexed fields, citation, guidance, or access gate |
| GET `/exploredatabases/image` | Same record/page parameters | HTML viewer, citation, neighboring page names, image source or access gate |

Search query uses `searchPage=Advanced-Search`, `firstname`, `lastname`, `keywords`, `location`, `fromyear`, `toyear`, `database` (title), `category`, `project`, `recordtype`, `volumeId`, `pageName`, and one-based `page`. Boolean flags are `exact`, `soundex`, `free`, and `images`; the advanced form also emits `exactYear=true` and `exactRecordType=true`. Optional fields are omitted. The UI includes additional family/extended-attribute criteria which are not yet exposed by this adapter.

HTML search fields: name links `/DB{collectionId}/r/{recordId}`, image links under `/databases/{slug}/image/`, `.nameValueDiv` collection title, labeled event/value blocks, and relationships in the third cell. IDs remain decimal strings. `.placeholder-text` identifies concealed fields. `.total-hits`, `.index-page`, and `.page-size` provide pagination, with 50 rows per page observed; an attempted `pagesize` query did not change the server page size and is not exposed. Successful empty results still contain pagination inputs. Unexpected HTML is an error.

Record fields come from the site's misspelled `#tblRecordDislpay`. `#divClipboardURLTranscript` supplies the collection citation and short source URL; `#SearchTips` supplies context. Index fields preserve repeated labels as an array rather than overwriting values in an object. Subscription/login HTML is never treated as a valid record.

## Images

The viewer's `initImage` call identifies the published image URL and a FamilySearch boolean. fam parses only those two values; it never evaluates the script or exports the remaining arguments.

Native images use a Deep Zoom XML descriptor on a numeric `N.img.americanancestors.org` host. `<Image TileSize Overlap Format>` and `<Size Width Height>` determine a highest level of `ceil(log2(max(width,height)))`. The provider's standard layout is `{descriptor-stem}_files/{level}/{column}_{row}.{format}`. The CDN may label JPEG tiles `binary/octet-stream`; fam accepts that type only when the bytes decode as an image. fam removes overlap while composing the original published dimensions, validates tiles, and saves a PNG with source URL, citation, dimensions, retrieval time, byte count, and SHA-256. This uses the same published tiles as the website viewer and does not claim an archival original. The website Download button itself exports its rendered canvas.

FamilySearch-backed images expose an ARK; fam reports that source without requesting partner data with embedded tokens. Follow it through the FamilySearch client when access is available. Neither arbitrary media URLs nor storage APIs are exposed.

## Verification scope

Native login and signed-in account checks, collection catalogs/volumes/tips, broad and collection/year-filtered searches, second-page continuation, zero results, indexed records and citations, native image reconstruction, and partner ARK extraction were exercised with opt-in live verification. Shared tests cover password retry bounds, redirect origin restrictions, media cookie isolation, error/token redaction, exact IDs, access gates, parser changes, and image size bounds. Live verification is private and never runs in CI. This does not establish all collection entitlements, browser-mode login, OCR, write operations, or a provider-supported public API.
