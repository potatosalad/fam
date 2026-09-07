# Storied REST protocol

The protocol was traced from `com.storied` Android 1.11.18 (version code 213), then checked against the provider's public [production OpenAPI document](https://api.storied.com/swagger/v1/swagger.json) on 2026-09-07. APK hashes and extraction counts are in [provenance.json](provenance.json). The APK predates the current Play release; it is evidence for the mobile implementation at that version, not a claim to the latest Android binary.

## Authentication

The app uses Auth0 at `https://auth.storied.com`. The public native client ID is `fv3DapFIYX6h5bBUsU8QwZixI9bs9LLs`; its API audience is `https://prodapiendpoint.com`. That audience is an identifier, not the URL to which API calls are sent. These client identifiers are public application configuration, not user credentials.

1. Generate random state and a random PKCE verifier. Send `/authorize` with `response_type=code`, `code_challenge_method=S256`, the verifier's SHA-256 challenge, and scopes `openid profile email offline_access`.
2. Use the APK's registered callback: `com.storied.auth0://auth.storied.com/android/com.storied/callback`. The manifest defines the scheme/host, and Auth0 Android's `CallbackHelper` adds `/android/com.storied/callback`.
3. Complete the hosted login. Accept a redirect only from the Auth0 origin, require the exact callback and matching state, and exchange the code once at `/oauth/token` with `grant_type=authorization_code`, `client_id`, `redirect_uri`, and `code_verifier`.
4. Read `/userinfo` using the access token; require `sub`. Validate a small authenticated `/api/Users/trees` response before saving the session.
5. Renew at `/oauth/token` with `grant_type=refresh_token`, `client_id`, and `refresh_token`. Retain the previous refresh token if the response omits it; save rotation atomically before another API request.

The issuer's [OpenID discovery document](https://auth.storied.com/.well-known/openid-configuration) advertises several grant types, but that is tenant metadata. This native client rejected password-realm login with `unauthorized_client`; the supported and verified path is browser authorization with PKCE. Authentication is explicit, without automatic password-login retries.

## Transport

REST requests target **`https://api.storied.com`** and paths begin `/api/`. The client sends:

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer ACCESS_TOKEN` for authenticated calls |
| `wa-clientId` | Mobile client identifier `cc64746c-54eb-1231-a70e-3762b64fce63` |
| `wa-requestId` | Fresh UUID for each request; required by the server |
| `wa-sessionId` | Stable random UUID for the saved CLI session |
| `x-api-version` | Version from the operation's declared media types; usually `1.0`, `2`, or `3` |
| `Content-Type` | `application/json` when a body is present |

The APK contains both generated REST clients and handwritten request helpers. Recovered helpers use the same client, request, session, and bearer headers. Public calls still need client/request IDs. The CLI restricts credentials to fixed first-party origins and refuses redirects instead of forwarding tokens.

The live OpenAPI document has 778 paths and 1,021 schemas. Normalization retains 728 consumer operations, excluding 66 administrative or non-`/api/` operations. 153 methods from the APK's generated client were cross-referenced to current routes; this is a subset of the APK's total call sites. The normalized catalog omits examples, source descriptions, and unrelated SDK configuration.

## Major resources

| Capability | Route |
| --- | --- |
| Account trees | `GET /api/Users/trees` |
| Tree details / people | `GET /api/Trees/detail?treeIds=…`; `GET /api/Trees/{treeId}/listPeople` |
| Person | `GET /api/Persons/{personId}/treePersonInfo` |
| Pedigree | `GET /api/Persons/pedigree/{treeId}/{personId}/{generations}` |
| Immediate family | `GET /api/Persons/immediatefamily?treeId=…&personId=…` |
| Events / saved records | `GET /api/Persons/{treeId}/{personId}/lifeevents`; `GET /api/Persons/{personId}/savedrecords` |
| Account stories / feed | `GET /api/Users/{pageNumber}/{pageSize}/authorstories`; `GET /api/Users/stories/{pageNumber}/{pageSize}` |
| Story | `GET /api/Story/{storyId}` |
| Media gallery | `POST /api/v2/Users/media` with filter and pagination JSON |
| Historical search | `POST /api/search/forms/universal-search` |
| Raw historical search | `POST /api/HistoricalSearch` with `query` (serialized Elasticsearch JSON) and `indexName` |
| Groups | `GET /api/Users/groups` |

Pagination is operation-specific: many lists put the one-based page and size in the route; media and structured historical searches use a JSON body. Tree lists can request a maximum with `numberOfTrees`, where zero means all. Dates and field casing are preserved, including the event response's `Events` property. Several enums are incorrectly declared as `type: object` in OpenAPI despite string wire values; the CLI uses their explicit enum values.

The legacy `GET /api/Users/{pageNumber}/{pageSize}/listmedia` returned HTTP 500 during research; the APK's current v2 media filter route is used by the convenience command. Empty groups, stories, or subscription lists are valid successful responses. Catalog declarations and empty responses do not prove populated-item reads or writes. Search masking fields describe restricted record access.

The media filter body needs `sortBy: {field: "creationdate", direction: "descending"}` plus empty `taggedPersonIds`, `mediaTypes`, and `contributorSources` arrays when no filters are selected. Those fields are nullable in OpenAPI, but omitting them caused a server null-reference error. The APK supplies them, and the CLI follows that behavior. Media results use an envelope with `data.mediaDetails`, `meta`, and `error`; detail reads use the item's `id`.

## Scope and limitations

The APK also references SignalR notifications (`/notificationHub`), media/image services, newspaper search, storybook production, and FamilySearch import. Their documented REST operations are discoverable where present in OpenAPI; this CLI does not implement live notification subscriptions, interactive editing, multipart uploads, payment flows, or a replacement mobile UI. It makes no changes to trees, stories, billing, or account settings during login or verification.

API errors expose status and an allowlisted auth code, not response bodies or tokens. Local metadata does not prove server access. Session validation and selected live read verification are distinct from schema coverage.
