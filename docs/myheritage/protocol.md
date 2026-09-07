# Protocol and coverage

## Recovered surface

| Surface | Count | Meaning |
| --- | ---: | --- |
| Retrofit declarations | 164 | All discovered HTTP-annotated interface methods, including three dynamic URL declarations |
| Distinct method/base/path tuples | 137 | Deduplicates repeated interface declarations; dynamic paths remain placeholders |
| Bundled GraphQL assets | 70 | Original `.gql` files, preserving fragment definitions |
| Distinct embedded GraphQL documents | 65 | Query/mutation string literals recovered from DEX |
| Total GraphQL documents | 135 | 82 queries and 53 mutations; 131 distinct operation names |
| FamilyGraph model definitions | 210 | Instance-field metadata and Gson wire names, not complete GraphQL input/response SDL |

The REST and GraphQL counts overlap: many REST declarations are the HTTP routes carrying GraphQL documents. They must not be added together as a count of independent server endpoints.

The catalog covers account/site/tree selection; individual and family reads/edits; person/family events; relatives and relationship diagrams; Smart Matches, record matches and discoveries; person record insights; timeline/fact views; research collection categories and searches; consistency checking; photos, albums, tags and uploads; scanning and photo processing; AI biography/transcription workflows; inbox operations; selected DNA operations; preferences, subscriptions and purchase declarations. Account deletion and commercial/message operations are cataloged but were not executed.

Not captured: the server's entire API; all WebView JavaScript services (including original document-image downloads and extensive DNA workflows); dynamic URL values that are generated at runtime; complete GraphQL SDL; server-specific validation constraints; guaranteed behavior for every account tier. Historical-person search, collection browsing, visible record fields and citations are captured in [research.md](research.md). Opt-in live verification scripts cover the research and browser routes; reports remain private. Generic native API availability and offline contract tests are not equivalent to live native verification.

## Authentication

`AuthenticationApiInterface` uses form POSTs beneath `https://www.myheritage.com/FP/API/Mobile/`. The login constructor `m48` supplies:

- `Action=login`, `Email`, `Pwd`
- `DisplayLang=EN`, `Version=7.5.44`, `DeviceInfo=Android`, `DevicePlatform=Android`, `DeviceOS`, `DeviceScreen`, persistent `DeviceID`, `AppName=MyHeritage`
- Optional `MfaCode`, `verification_code`, `recaptchaV3Token`

The XML `MyHeritage` envelope contains `Result` (integer text, `desc` attribute), `FamilyGraphAccessToken`, opaque `AccountID`, `PlaintextAccountID`, optional `data12p`, and MFA metadata. Result 0 is success; `-106` requests MFA; `-1002` enters a verification flow; `-1003` is a low-trust reCAPTCHA rejection. A returned AccountID is credential material, not a public profile ID.

`gb4`, `k48`, and the authentication interface show `refresh-token.php` receiving device metadata with `Authorization: Bearer …`. No separate refresh-token field was found in this flow. Returned token/IDs replace old values atomically, preserving omitted IDs. A successful native refresh has not yet been verified against the live native service.

The website's public `CompanyHomePageDesktopBundled` JavaScript additionally reveals a FamilyGraphQL client using a `bearer_token` form field. Website URLs rewrite direct FamilyGraph origins into `/web-family-graph/…` and `/web-family-graphql/…`. HAR import recognizes these request forms. A browser session is validated against its signed-in tree page and current-user-permissions API. The supplied browser token was rejected by the direct native API, and custom website GraphQL documents received HTTP 403. The exact website person query works, including variable changes; the implementation uses that observed document. The cause of the custom-query restriction is not established. It does not perform password login.

## REST and GraphQL transport

| Root | Evidence / use |
| --- | --- |
| `https://familygraph.myheritage.com/` | `a74`: FamilyGraph object/connection REST API |
| `https://familygraphql.myheritage.com/` | `tk5`: asset queries on `mobile_*` routes; `aa8`: newer Apollo queries at `/` |
| `https://www.myheritage.com/` | `iq7`: native XML login/refresh; `y0e`: password policy JSON |
| `https://www.myheritage.com/FP/API/FamilyGraph/` | `j85`: one-time token endpoint; it is not assumed to be a login bootstrap |
| `https://www.myheritage.com/FP/API/DnaEthnicityIntroduction/` | `v`: DNA video-status service |
| `https://origin-www.myheritage.com/` | `g7b`: report-event telemetry; no telemetry is sent automatically |

The native app uses its bearer token for both REST and GraphQL; browser tokens are handled separately. Native interceptors add `lang=EN`, `app_version=7.5.44`, and user agent `MyHeritage/7.5.44 (Android …)`. GraphQL JSON bodies contain the query and variables. The CLI also sends the document's operation name.

FamilyGraph expands nested fields using `fields=id,name,default_site.(id,trees.(id,name))`. `f85` documents the account/membership/site/tree expansions used by `me`, `sites`, and `trees`. Person details and facts use exact embedded GraphQL documents. The `people` shortcut combines pagination arguments from `getIndividualsIndexesForTree` with person fields from `searchIndividualsWithMedia`.

Do not derive a GraphQL route from its document name. The tree-count asset is named `getPhotosCount` but is sent to `mobile_getIndividualCountForTree/`; a site photo-count asset shares that operation name and uses `mobile_getSitePhotos/`. The extractor retains full asset-based IDs and resolves routes from request call sites. A small explicit mapping handles merged classes and inherited interfaces. Source paths are recorded in each contract.

The extractor reads smali annotations for method, path, encoding, arguments, headers, and generic signatures. It handles methods without a fixed path (`@Url`), overloaded methods, and duplicate GraphQL names. Gson's renamed `kwb` annotation supplies wire names. Java decompilation is used for asset-to-route association, with smali available for manual confirmation.

## Validation and credential boundaries

All 135 documents are parsed, fragment references checked, variable inventories compared against their ASTs, and hashes verified. All 164 REST declarations are constructed offline with fixture parameters; aliases and distinct IDs are checked. Tests cover XML/MFA parsing, HAR origin filtering and form tokens, GraphQL errors/partial data, one-time concurrent refresh, query-variable validation, and URL/credential boundaries.

Authenticated requests are restricted to the evidenced service roots. Redirects are not followed. Explicit dynamic file transfers use a separate HTTPS transport without account cookies or authorization. HTTP errors omit request queries, response bodies and tokens. `--out` and session files use private permissions and atomic replacement.

The client does not auto-run purchases, messages, account deletion, consent changes, or genealogy edits. Calling a catalog write or mutation explicitly executes that operation. Verification scripts make no genealogy edits. Research search is a GraphQL mutation that may update recent-search history.

## Verified browser session transport

Browser credentials contain only the MyHeritage cookies, token, user agent and captured tree-page URL. Each new client loads that page through HTTP, parses selected JSON variable assignments without executing JavaScript, checks `isLoggedIn`, and updates the token and cookies atomically. The client adds the page's `csrf_token` to PHP API reads. It never attempts native refresh or password login for a browser session.

| Route | Use |
| --- | --- |
| `/family-trees/...` | Authenticated page, current site/tree menu, token and CSRF refresh |
| `/FP/API/FamilyTree/get-current-user-permissions.php` | Signed-in permissions and associated person |
| `/FP/API/FamilyTree/get-tree-layout.php` | Person cards in the current tree neighborhood |
| `/FP/API/individual-lookup.php` | Name search within a site/tree |
| `/FP/API/FamilyTree/get-extended-card-content.php` | Person, relatives, facts, photo metadata and links |
| `/FP/API/FamilyTree/get-adhoc-matches.php` | Smart/record match counts |
| `/web-family-graphql/individual_data_with_hints_query/` | Family groups, event facts, citations and notes |

The GraphQL proxy receives form fields `bearer_token`, JSON-encoded `query`, JSON-encoded `variables`, empty `operation`, `description`, and `mhc#PHPSESSID`. The query is stored separately in `src/myheritage/web-queries.ts`; it contains no account values and is not included in the 135 APK document count. Website endpoint bindings were checked against the supplied HAR and the public `NewTreeBundled_vece72293ffacc04eeaf05c2911b4b374.js` and `NewTreeLeftPanelBundled_vb591f0f0b4692e27e6f76b51ea2677f6.js` bundles.

This browser implementation does not claim arbitrary GraphQL support, whole-tree export, all account memberships, full match details or website edit coverage. The research WebView service is implemented separately; see [research.md](research.md) for its requests, scope rules, examples and verification.
