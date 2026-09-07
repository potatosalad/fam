# Findmypast Android 2.59.0 protocol

The machine-readable [contracts](contracts.json) are extracted from APK smali by `scripts/extract-findmypast.py`. Each entry records its source path; each GraphQL document has a SHA-256 digest. This documents the app's observed contract, not an official public API or a complete server schema.

## Services and request envelope

| Service | Base/endpoint | Authentication and source |
| --- | --- | --- |
| Titan GraphQL | `https://www.findmypast.co.uk/titan/marshal/graphql` | Native bearer; manifest `com.findmypast.titan.url`, `h9a.java`, `TitanDataSource.java` |
| Website Titan | `https://www.findmypast.com/titan/marshal/graphql` or the `.co.uk` equivalent | Cookies imported from a successful same-region HAR request; profile validation required |
| OAuth token | `https://auth.findmypast.com/oauth/token` | Public client + password-realm, refresh token, or code/PKCE; `o90.java`, `hj.java` |
| Assets REST | `https://tree.findmypast.co.uk/api/asset/` | Native bearer; manifest `com.findmypast.assets.url`, `w40.java`, `rz5.java` |
| Image/newspaper REST | Titan base plus `/record-gateway/` or `/obscura/` | Bearer in APK, same-region cookies in browser client; `eh7.java`, `b99.java` |
| Editorial content | `https://findmypast-titan.cdn.prismic.io/api/v2` | Public Prismic API; `hl0.java`, `y80.java` |

GraphQL is HTTP POST with JSON:

```json
{
  "operationName": "GetListOfTrees",
  "query": "query GetListOfTrees($offset: Int!, $limit: Int!) { ... }",
  "variables": {"offset": 0, "limit": 20}
}
```

The snippet abbreviates the query; executable complete documents are in `contracts.json` and `fam findmypast.api describe --operation NAME`. Apollo headers are `apollographql-client-name: fmp-mobile-app-android` and `apollographql-client-version: 2.59.0`. Native authorization is `Bearer ACCESS_TOKEN`. The user-agent format is `Findmypast/VERSION (Android RELEASE; SDK NUMBER; MANUFACTURER MODEL)`.

GraphQL success is `{data:...}`. HTTP 200 may still carry an `errors` array and partial data; the client throws a `FindmypastGraphQLError` retaining the partial response for programmatic inspection. CLI errors avoid printing private server diagnostics. HTTP 401 is eligible for one native renewal/retry; HTTP 403/429/5xx are not. Browser sessions do not attempt native renewal.

## Authentication evidence

Decoded `res/values/strings.xml` contains public client ID `HdCksGN9pb2NxepbUqO6Q0iwksi43pwe` and domain `auth.findmypast.com`. `o90.a` builds JSON fields `client_id`, `username`, `password`, `grant_type:http://auth0.com/oauth/grant-type/password-realm`, and `realm:account`. The login call in `hj.java` adds audience `https://www.findmypast.com/api` and scope `offline_access`; `hc0.b`/`dad.b` append `openid`, producing effective scope `offline_access openid`.

`o90.b` uses JSON `client_id`, `grant_type:refresh_token`, `refresh_token`. The native credential manager stores `access_token`, `refresh_token`, `id_token`, `token_type`, scope and expiration (`e02.java`, `j90.java`). The ID token can contain `https://www.findmypast.com/member_id`. The CLI does not trust decoded JWT claims as a replacement for server validation.

The browser fallback (`lb6.java`) uses connection `account`, `mode:mobile`, prompt `login`, the same audience, and scope `offline_access openid profile email`. The manifest registers `com.findmypast.prod://auth.findmypast.com/android/com.findmypast.prod/callback`. The OIDC discovery document observed during protocol research advertised authorization code, S256 PKCE and form-post response mode. Local callback validation binds the exact redirect, unique state/code parameters and a 30-minute pending-request lifetime before exchanging the code.

Native login can return HTTP 401 with `requires_verification`. The CLI persists that condition and stops further password attempts. Browser-session import validates `GetCurrentUserProfile` before saving cookies. Native password/code/refresh flows have mocked coverage; this public port makes no claim of live verification for those flows.

## Main GraphQL surface

| Area | Representative operations | Input/pagination |
| --- | --- | --- |
| Account | `GetCurrentUserProfile`, `GetSubscription` | None |
| Trees | `GetListOfTrees`, `GetTreeSettings`, `GetPeopleInTree` | `offset/limit`; string `treeId` |
| People | `GetFamilyViewForNode`, `GetFamiliesForNode`, `GetFactsForPerson` | Tree/node or person ID |
| Hints | `GetHintsForPerson`, `GetHintsForTree`, `GetHintById` | `offset/limit`, status/category filters |
| Media | `GetPersonMedia`, `GetMediaDetails`, collection media operations | `offset/limit` or `startFrom/rows` |
| Historical records | `GetSearchResults`, `GetSearchResultsWithSort`, `GetRecordSearchResultCount` | `[SearchFilter!]!`, **page starts at 1** |
| Record sets | `SearchRecordSets`, `recordSetInformation` | `startFrom/rows`; metadata ID |
| Fulfillment | `GetTranscriptEntitlement`, `GetRecordFulfillment`, `GetTranscriptById` | Record IDs, entitlement decision and action |
| Newspapers | `GetNewspaperSearchResults`, `GetNewspaperSearchResultCount`, `GetClipping` | Names, keywords, dates, publication places, ordering, offset/pageSize |
| Other | Stories, life-story generation, quizzes, podcasts, profiles and notification preferences | See operation schemas |

Search filters have `field`, `values`, optional `offset`, `proximity`, `variants`. Evidence: `cd9.java`, `cs8.java`, and `xc9.java`. `RecordSearchOrder` has `by` and optional direction (`ds8.java`). The app's sort field IDs are `FirstName`, `LastName`, `YearOfBirth`, `YearOfDeath`, `EventYear`, `DatasetName` (`ts8.java`). The CLI starts record pagination at 1 and rejects page 0.

Transcript fulfillment is a mutation even when used to read a record. The APK sets `confirmedPurchase:true`. The CLI `record` shortcut intentionally sets false and returns the action alongside any transcript. `iv3.java` enumerates fulfillment actions including subscription/free access, credit purchases, repeat access, access restrictions and confirmation requirements. Entitlement returns a boolean decision and numeric action; fulfillment returns an enum name such as `SUCCESS_USING_FREE`. The verifier skips a transcript unless entitlement indicates free, covered, or previously fulfilled access; it never confirms a purchase.

## REST surface

| Owner | Declarations | Route details |
| --- | --- | --- |
| `w40` | 5 asset operations | GET `GetAsset`, GET `GetAssetsByEntity`, PUT `DetachEntitysFromAssets`, PUT `SetProfileImage`, multipart POST `CreateAsset` |
| `eh7` | 5 image/newspaper operations | GET `obscura/api/image/coordinates`, GET `record-gateway/image/{id}/detail.json`, GET `obscura/api/manifest/fn/{id}`, GET `obscura/api/manifest/{publication}/{issue}`, POST `obscura/api/clipping/store` |
| `hl0` | 3 content declarations | GET `api/v2`, two variants of GET `api/v2/documents/search` |
| `cj` | 4 telemetry declarations | Two POST `app/logs` and two POST `app/metrics`, bearer or signed-anonymous variants |

`SetProfileImage` additionally takes `Family-Tree-Ref`. Asset methods carry their parameters in the query string, including the APK spelling **`entitys`**. Query/path/header names and primitive descriptors are preserved in each contract. Multipart requires real file bytes; content-type boundaries come from FormData. The CLI refuses to execute the two signed-anonymous telemetry declarations. No analytics signing secret is copied into the client or documentation.

There are additional call-site-built image URLs (`/asset/{id}/download`, `/image-cache...`, `/record-gateway/image/{id}`, thumbnail handlers). These are noted as call-site URLs, not counted as Retrofit declarations.

The record-image downloader follows `bt0.java`, `fh7.java`, and `sm6.java`: resolve the image item through record search, request `/record-gateway/image/{encodedImageId}/info.json` with `recordMetadataId` and `parentRecordId`, then `/full/max/0/default.jpg`. The image ID is different from the parent transcript ID. The downloader checks the decoded JPEG dimensions against the IIIF metadata. It uses its own approved API base instead of following the `@id` URL in the metadata. It adds `confirmedPurchase=false` and, independently, refuses credit-priced images unless `GetRecordFulfillment` says they are already fulfilled. The query parameter alone is not treated as a proven protection against spending. PDFs and newspaper page images are not handled by this shortcut.

Newspaper search uses date strings `YYYY-MM-DD` in `date.from/to` and location objects containing `country`, `county`, and/or `place`. `kc7.java` and `dc7.java` define ordering: `PUBLICATION_DATE` or `RELEVANCE` with `ASC`/`DESC`. Record sorting instead uses `ASCENDING`/`DESCENDING` (`eo7.java`). Newspaper results contain snippets, page references, issue metadata and facets; full OCR is not part of this response.

## Coverage limits

All 110 embedded query/mutation strings were recovered from full smali and parsed offline; that count is extraction coverage, not 110 successful live calls. Twelve custom-input field inventories were recovered from smali `toString` methods. They do not include complete enum values, required-field rules or response types. Some unused input fields may have been optimized away.

Mocked tests cover contract integrity, variable validation, route boundaries, redirect handling, error redaction, native renewal behavior, OAuth callback binding, cookie import and region isolation, search pagination, and transcript requests without purchase confirmation. Live verification is optional and account-dependent; its private reports distinguish passed, failed, and skipped operations. It does not exercise account/genealogy edits or confirm purchases.


## Reproduce the catalog

The [provenance file](provenance.json) records the APK version, download source, hashes, and extraction tools. To repeat the analysis, install Python 3, curl, apktool, and JADX, then run from the checkout:

```sh
bash scripts/analyze-findmypast.sh
npm run check:findmypast
```

The script downloads the pinned XAPK, checks its hash, and disassembles it without executing APK code. Downloads and disassembly stay in ignored `artifacts/findmypast/` and `analysis/findmypast/` directories. Smali is authoritative when JADX cannot recover a method.

Normal development uses the checked-in JSON instead:

```sh
npm run generate:catalogs
npm run check:catalogs
```

These commands need no APK or decompiler. See [development notes](../development.md) for the full checks and optional live verification.
