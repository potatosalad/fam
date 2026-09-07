# FamilySearch mobile API notes

Evidence: `org.familysearch.mobile` version 5.4.4, version code 43530, downloaded September 6, 2026. See [APK provenance](apk.json). Findings marked **observed** below describe observations from the original protocol research. The [endpoint inventory](endpoints.json) comes from static analysis; its presence does not prove that every endpoint is accessible or supported for every account.

## Hosts and request conventions

| Purpose | Production origin |
| --- | --- |
| FamilySearch OAuth | `https://ident.familysearch.org` |
| Church Account identity provider | `https://id.churchofjesuschrist.org` |
| Mobile and GEDCOM X APIs | `https://www.familysearch.org` |

Decoded resources also name `identbeta.familysearch.org`, `identint.familysearch.org`, `beta.familysearch.org`, and `integration.familysearch.org`. This client uses production only.

The APK's `yd3` interceptor sends `Accept: application/json`, `Accept-Language`, `User-Agent`, and `FS-User-Agent-Chain`. `va3.f` constructs an `FS-Android-Tree/<version> ...` user agent. `sd3` supplies `Authorization: Bearer <access_token>`. These tokens work even though the OAuth response labels `token_type` as `family_search`.

Mobile endpoints accept ordinary JSON. Public endpoints use GEDCOM X envelopes and media types such as `application/x-gedcomx-v1+json` or `application/x-fs-v1+json`. Both API families accepted the same access token in live checks.

Plain curl received a 403 from the identity page during research; the `impit` HTTP transport configured for Chrome completed the flow. API requests use the mobile user-agent headers. TLS certificate verification remains enabled. This implementation sends HTTP requests; it does not launch or automate a browser.

## Church Account sign-in — observed

The APK separates providers by **public client identifier** (`wmf`); these identifiers are not passwords or client secrets:

| Provider | Client identifier |
| --- | --- |
| Church Account | `fs-internal-dev-key-000080` |
| FamilySearch username | `fs-internal-dev-key-000201` |
| Google | `fs-internal-dev-key-000086` |
| Facebook | `fs-internal-dev-key-000082` |
| Apple | `fs-internal-dev-key-000083` |

Only the Church Account flow is implemented and tested. Supplying Church credentials to the FamilySearch username form would be a different authentication path.

1. Generate a random PKCE verifier and SHA-256/base64url challenge. Generate an independent random `state` value.
2. GET `/cis-web/oauth2/v3/authorization` on the identity host with:

   ```text
   client_id=fs-internal-dev-key-000080
   redirect_uri=org.familysearch.tree://oauth/redirect
   response_type=code
   scope=profile offline_access
   prompt=login
   code_challenge=<S256 challenge>
   code_challenge_method=S256
   state=<random state>
   ```

3. Preserve cookies and follow redirects to the Church's `/oauth2/default/v1/authorize`. FamilySearch federates through Church OAuth client `0oa5ivbdfncemZdsO357`, with a callback to `https://ident.familysearch.org/login/oauth2/code/churchAccount`.
4. The Church's hosted Okta widget exposes a transaction `stateToken`. Decode its string escapes as data, without executing the page's JavaScript. POST that token to `/idp/idx/introspect` using `application/ion+json; okta-version=1.0.0`.
5. Follow the response's `identify` action, sending `identifier` and `stateHandle`.
6. Select the offered **Password** authenticator using its returned ID and `methodType`. POST to the returned challenge action.
7. Submit `credentials: { passcode: <password> }` with the current `stateHandle` to the returned password challenge action.
8. On success, follow the returned `/login/token/redirect` URL through the federated callbacks. Stop when the redirect reaches `org.familysearch.tree://oauth/redirect?code=...&state=...`; do not try to navigate to the native scheme.
9. Validate the callback and state. POST to `/cis-web/oauth2/v3/token` with form fields `grant_type=authorization_code`, `client_id`, `redirect_uri`, `code_verifier`, and `code`.

The successful response contained `access_token`, `token_type: family_search`, and `refresh_token`. It did **not** include `expires_in`; the client does not invent an expiry time. All subsequent data requests send a bearer header.

APK evidence: `le8.e` builds the authorization request, `le8.f` prepares PKCE, and Retrofit interface `l27` exchanges the code. The APK uses query parameters on a POST for the exchange; this client uses a POST form, which was verified to work and keeps the code out of the request URL. The Okta IDX steps above were observed from the live Church flow, rather than recovered from APK code.

The [FamilySearch OAuth guide](https://developers.familysearch.org/main/docs/authorization-code-flow) describes the general authorization-code/PKCE protocol. Provider-specific mobile identifiers and the mobile refresh wrapper are findings from this APK.

## Session renewal and metadata — observed

POST `/service/mobile/api/v1/login` to renew a token:

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "<saved refresh token>",
  "devkey": "fs-internal-dev-key-000080",
  "currentTreeId": ""
}
```

The client sends its existing bearer token and mobile headers. This succeeded in testing and returned a usable access token. A returned refresh token replaces the old one atomically; if no refresh token is returned, the prior one is retained. APK evidence: `nd8` and `RefreshRequest`.

For account metadata, POST `/service/mobile/api/v1/login?includeScopes=true` with an existing bearer token:

```json
{
  "grant_type": "password",
  "deviceRegistrationToken": "",
  "appId": "org.familysearch.mobile",
  "currentTreeId": ""
}
```

Despite the `password` label, this **metadata request contains no username or password**. The API uses the bearer session. The response contains `user`, `access_token`, scope/capability fields, and account feature flags. `loginMetadata()` removes tokens from its return value. APK evidence: `vag`, `MetadataOnlyLoginRequest`, and calls in `a8d`.

Automatic renewal reacts to HTTP 401, then retries the rejected request once. Refresh HTTP 400/401 triggers a fresh username/password flow. Rate limits, network failures, and permission errors propagate. Writes are not retried after ambiguous network or server failures. Cross-process refresh coordination and interactive MFA are not implemented. Completing sign-in from a brand-new session, refreshing, and reading with the renewed session were tested; waiting for actual server-side token expiry was not.

## Verified read endpoints

| Method and path | Relevant parameters | Result |
| --- | --- | --- |
| GET `/platform/users/current` | `Accept: application/x-fs-v1+json` | `users[]`; contains account ID and `personId` |
| GET `/platform/tree/persons/{pid}` | GEDCOM X Accept header | Person, relationships, places, sources |
| GET `/platform/tree/ancestry` | `person`, `generations=2` | `persons[]` |
| GET `/service/mobile/api/v2/tree/person/{pid}` | Optional `oneHops` in APK | Rich mobile person DTO |
| GET `/service/mobile/api/v2/pedigree/ancestry/{person_id}/portrait` | `numGenerations=2`, `includeGoldenHints=false` | `positions`, `persons` |

The mobile person DTO includes names/facts, relationship collections, source and memory counts, portrait URL, and capability fields such as `canUserEdit`. These are presentation-oriented objects, rather than GEDCOM X envelopes. Detailed DTO references are included in the inventory.

The older guided-tree GET `/service/mobile/api/v1/tree/builder/pedigree/{personId}?numGenerations=2` returned HTTP 400 in the initial test. Its server prerequisites remain unresolved. A typed operation is available, while normal ancestry uses the verified v2 portrait-pedigree endpoint. Tree status subsequently passed live verification.

Run `npm run verify:genealogy` for opt-in authenticated read checks and response-schema validation with your account. Reports stay in private configuration storage. Read-only One Search POSTs use `searchType: "TREE"` and `from` / `size` pagination.

## Payload and response recovery

The client implements 212 selected genealogy operations, with 297 models covering 1,502 fields. [contracts.json](contracts.json) links every method to smali evidence and every model to a serializer file hash. Moshi serializers reveal exact JSON field names, nested collection types, fields that reject null, and fields whose absence causes an error. Defaults are represented as optional properties. The extractor validates the complete field list and fails on unrecognized serializer patterns.

APK `z5b` calls person details with `oneHops=summaries`. This is a string selector. Omitting it can return a different expansion in extra fields; `persons.get` allows the caller to choose the parameter.

The APK's string reader (`fk7.M`, `jk7.M`) accepts number tokens and returns their textual form. Production uses this for some source timestamps, place IDs, and contribution years. Typed operations apply that conversion; numeric strings in numeric fields are also decoded. Generic `request()` returns the raw parsed structure. Production change-history version values exceed JavaScript's safe integer range: the parser uses Node's JSON token source to preserve those integer literals as bigint, and serialization emits exact JSON numbers. No rounding is permitted for integer request values.

Record hints returned HTTP 204 for no matches; `hints.recordMatches` explicitly returns undefined in that case. Other operations whose APK return type is Kotlin Unit discard/drain successful bodies. Binary ordinance-card responses remain bytes, with headers/status accessible via `operationDetailed()`.

Memory upload was recovered from `ie0.g` and multipart helpers `ik9.R/S`: a `file` part with filename/content type, separate `filename`, optional `title` and `description`, and explicit `isPrivate` text. Group-image upload (`kh6`) adds `mediaType=image/jpeg`, normalized crop `x=0,y=0,width=1,height=1`, and `rotation=0`. The transport sets the multipart boundary. Story replacement (`vd0`, `s90.f`) sends raw `text/plain` to the artifact files endpoint. Helpers implement these exact formats; uploads were tested locally with synthetic files.

Genealogy repositories (`a1a`, `m6b`, `lsa`, `a99`, `pce`, `pe`) apply Java `URLEncoder` with UTF-8 to `X-Reason`. Typed methods accept plain reason text and perform that encoding, including Unicode and spaces. Source detachment (`pce`) and record-hint updates (`afc`) default to `application/x-gedcomx-v1+json`. Merge (`a99`) defaults to `Product: int-android-merge-000`; person creation uses the person context from `rx6`, `int-android-person-000`. Explicit declared header inputs can override those defaults. The raw request API leaves header encoding to its caller.

Change history follows `nextPageToken` until `lastPage`; search follows `results` / `total` with offsets. Both iterators impose a page bound, accept cancellation between requests, and detect invalid continuation behavior. Other operation-specific pagination parameters and response envelopes remain available directly rather than assuming one generic pagination convention.

## Inventory and analysis limits

The extraction script found **319 declarations / 317 distinct literal method-path pairs**: 140 GET, 106 POST, 36 PUT, and 37 DELETE declarations. It preserves path/query/header/body parameters, generic response signatures, static headers, DTO class references, and exact smali file/line locations. Literal paths retain placeholder names; canonical route counts normalize those names in the [coverage report](coverage.md).

The inventory covers Retrofit annotations containing `service/mobile/api/`, `cis-web/oauth2/`, or `service/cmn/user-preferences/`. The last prefix adds two event-related preferences omitted by the initial extraction. It does not claim to include dynamically constructed URLs, every website service, or a complete OpenAPI specification. HTTP method mappings are for this obfuscated build (`o66=GET`, `xla=POST`, `yla=PUT`, `te3=DELETE`) and must be checked when analyzing another version.

Write endpoints have callable typed methods and mocked transport tests, but were not called against production. Tree-context switching remains the one selected operation without a recovered payload serializer; source-link attachment has a typed request and an intentionally unstructured acknowledgement in the APK. See [coverage.md](coverage.md) for individual areas and exclusions. No family-tree records were changed. The APK was not run; complete smali and resources were produced with apktool, while Java reconstruction remains partial because JADX stalled. No passwords, account records, or live tokens belong in the checked-in research files.
