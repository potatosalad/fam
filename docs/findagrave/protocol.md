# Find a Grave Android 4.0.2 protocol

Primary evidence is the signed `com.ancestry.findagrave` APK, build 138, retrieved on 2026-09-07. [Provenance](provenance.json) records artifact/certificate/source hashes. The [Google Play listing](https://play.google.com/store/apps/details?id=com.ancestry.findagrave&hl=en_US) identifies the application; the binary was obtained from [APKPure's version listing](https://apkpure.net/find-a-grave/com.ancestry.findagrave/download) using its pinned build URL. It was never installed or executed.

## Transport

The app uses Ktor with serialized JSON. The principal endpoint is `POST https://www.findagrave.com/orc/graphql`. Requests contain `operationName`, `query`, and `variables`. The backend is also used by same-origin REST routes.

Recovered default headers (`ny2.smali`, `az2.smali`):

| Header | Value / meaning |
| --- | --- |
| `User-Agent` | `FindAGrave-Android-2349Ced0` |
| `ak` | Static Android application identifier distributed in the APK |
| `locale` | User locale; CLI uses `en-US` |
| `bv` | Backend version `1` |
| `mv` | Mobile version `android:4.0.2` |
| `Ancestry-ClientPath` | `findagrave-android` |
| `Accept`, `Content-Type` | `application/json` for JSON requests |
| `fgm` | Signed-in contributor ID |
| `fgmSeed` | Token returned by authentication |
| `x-emb-path` | Per-operation instrumentation path, when present |

The static `ak` value is in `src/findagrave/http.ts`. It is not a user password or bearer credential. `fgm` and `fgmSeed` are account-scoped headers. `ud1` stores the contributor object and token; the shared request builder attaches both. The main GraphQL API uses these headers instead of OAuth bearer authorization.

The CLI sends cookies only to `www.findagrave.com`, manages account headers itself, rejects redirects, and prevents foreign-origin requests. The image host is `https://images.findagrave.com`; its requests omit account authorization, cookies, and application identifiers. HTTP/GraphQL errors report status/recognized codes without response bodies, query parameters, passwords, or tokens.

## Password authentication

The `Authenticate` password document is declared in `t9.e`; its input serializer is `Credentials` (`xi1`/`zi1`):

```json
{
  "operationName": "Authenticate",
  "query": "mutation Authenticate($credentials: Credentials!) { ... }",
  "variables": {
    "credentials": {
      "email": "ACCOUNT_EMAIL",
      "password": "ACCOUNT_PASSWORD",
      "remember": true,
      "isMobile": true
    }
  }
}
```

The optional `oAuthLink` field belongs to account linking and is omitted by the CLI. The full checked-in document requests `authenticate.result`, `token`, `reactivation`, and the contributor profile. Subsequent requests use the returned contributor ID and token. The client validates the same ID via `SignedInContributor` before saving a session and never exposes the token in ordinary auth output.

The native password document does not request an expiration or refresh token. No refresh grant was recovered. The CLI therefore treats the token lifetime as unknown, offers live session validation, and requires explicit sign-in again after expiration. It never turns a failed API request into another password attempt.

Ancestry account linking is a separate flow. The APK opens `/auth/ancestry/mobile`, constructs `Authenticate($input: OAuthInput!)`, and calls `authenticateOAuth`. This document is assembled from three string literals in `qe.<clinit>` and used from `t9.P`. `RemoveOAuthLink` is another token-returning mutation. Their full documents are cataloged, but the CLI does not implement an interactive Ancestry linking flow or execute these through generic commands.

## GraphQL coverage and data representation

The 32 recovered documents cover memorial search/profile/pending edits, relationships and photographs, cemetery search/details/typeahead/duplicates/creation, contributor profile/update/friends, virtual cemetery membership listing, saved and volunteer cemeteries, location typeahead, global tags, edit submission/approval/decline/cancel, and authentication/linking.

Two distinct `FindMemorial` documents and two distinct `Authenticate` documents retain stable SHA-256-derived IDs. Selecting an ambiguous bare name fails locally. GraphQL variables are separate from query text, checked for required fields and scalar/list shape, and serialized with the repository's lossless JSON helpers. IDs should remain strings.

The 270 serializer inventories describe 1,766 wire fields. `optionalInApp` records Kotlin serialization optionality; it is not a server-side required-field assertion. The 16 enum inventories record explicit wire renames. Other enums, nullability, nested input types, and complete response schemas are not fully generated. Full server introspection returned HTTP 400 / `GraphQL introspection is not allowed`; it is not used by the CLI or required for reproduction.

One ordinary `__type(name: "Memorial")` read exposed the `photos(from: Int, size: Int, ...)` argument names. The CLI's paginated photo helper extends the APK's profile document with those two arguments, and separate pages were live-verified. This extension is distinguished from the unchanged embedded document catalog.

Search dates use `birthYear` / `deathYear`, lowercase `birthYearFilter` / `deathYearFilter`, and optional ranges. Ordering uses uppercase wire values such as `RELEVANCE` and `BIRTH_ASC`. Searches use `from` and `size`, not page numbers. REST photo-request lists use `skip` and `limit`. `LocationSearchInput.autocomplete` is the enum `location`, not a boolean. It uses the app's `city`, `county`, `state`, and `loc` categories.

### Research search extensions

The website's search form and [official biography search guide](https://support.findagrave.com/hc/en-us/articles/53933499258259-Searching-the-bio-field-using-keywords) expose `bio`. Although absent from the APK's `MemorialSearchInput` serializer, the existing GraphQL endpoint accepts it. The CLI adds `bio { value language }` to the result selection only for biography searches, using the same field shape as the APK's full memorial document. The original extracted documents and inventories remain unchanged.

New CLI flags bind directly to existing native inputs: `--relative` → `linkedToName`, `--include-maiden-name` → `includeMaidenName`, `--include-nickname` → `includeNickname`, `--similar` → `fuzzyNames`, `--plot` → `plot`, and the date-filter flags → `birthYearFilter` / `deathYearFilter`. The optional search verifier uses positive and negative controls for linked-relative and nickname filters, checks dates and plot fields, and exercises anonymous biography search.

The website's `GET /memorial/search` route returned JSON under native headers with `memorials`, `total`, `hasMoreRows`, and `highlight.bio[]` snippets; `limit` / `skip` pagination worked. This was investigative evidence only. The CLI uses GraphQL and does not add a second search transport or a snippet-merging layer.

## REST coverage

The 36 executable routes are listed with verbs, side effects, body encoding, query keys, and source methods in [operations.md](operations.md) and `src/findagrave/rest.ts`. The generic call API accepts `{path, query, body}`. It encodes path components, rejects unknown path/query keys and undeclared bodies, and serializes JSON or form data as declared.

Most REST writes use JSON. `/memorial/virtual-cemetery/toggle` uses URL-encoded `virtualCemeteryId`, `memorialId`, and `checked`. Several endpoints mutate through GET: `/photo-request/{id}/claim`, `/unclaim`, `/delete`, `/my-cemetery/create/{id}`, and `/my-cemetery/{id}/remove`. Their catalog `write` flag is true. The API's HTTP verb alone is insufficient to classify a read.

The remaining 11 call sites are inventories only:

- `pe1.b/c/d/e`: cemetery, memorial, transcription, and user `photo-url` negotiation. These belong to uploads, not original-image downloads.
- `fz4.V/X`: skip and submit transcription operations.
- `fz4.a/q/r/v`: transcription locks, deletion, flagging, and contributor queues. These explicitly attach `Authorization: Bearer TOKEN` using the same `ud1.c()` token source used for `fgmSeed`. Their complete execution/payload handling is not exposed by this CLI.
- `sk9.a`: public mobile Android configuration JSON on the image host.

Call-site inventories retain observed URL **prefixes** where IDs/suffixes are constructed dynamically. They do not claim to be complete routes or complete payload schemas. Model field inventories supplement the manually traced route bindings, but most REST body structures remain open JSON and are validated by the service.

## Verification and limits

The optional live verifier exercises native identity/session validation, exact name/year search, search sorting/pagination, memorial relationships, photo pagination, cemetery search/details, location typeahead, public contributor profile, tags, saved/virtual/volunteer lists, and three photo-request lists. Empty results prove successful transport/response shape, not populated account features. The verifier does not execute genealogy mutations, profile edits, account-link changes, messages, photo uploads, or request claims. Reports are saved in the private configuration directory.

The image downloader requests the URL returned in `photos.photos[].path`. Binary image GETs use Node's standard `fetch` with a browser user-agent, the memorial page as `Referer`, and `Accept: */*`. The impersonating API transport encountered CDN challenges even with those headers; the standard transport successfully downloaded an original photo anonymously. API requests continue to use the existing transport. Both paths strip account credentials from image requests and reject redirects.

The CLI decodes image bytes before saving them and records source attribution, dimensions, and a checksum. Tests cover credential stripping, redirect and CDN-error handling, image decoding, and rejection of unrelated photos. A denied CDN response produces no image file; the optional verifier reports it as blocked.

API requests have a 30-second timeout; binary image requests have 45 seconds. Neither retries automatically. Tokens are stored atomically with owner-only permissions. No automatic token rotation or cross-process refresh lock is claimed. These are private Android API contracts and may change independently of the installed CLI.


## Reproduce the catalog

Install Python 3, curl, apktool, JADX, and a compatible Java runtime, then run from the checkout:

```sh
bash scripts/analyze-findagrave.sh
npm run check:findagrave
```

The script downloads the pinned XAPK, verifies its hash and the base APK hash, and disassembles it without executing APK code. Artifacts and analysis stay in ignored directories. Smali is authoritative when JADX cannot recover a method. The extractor reconstructs the OAuth document from its StringBuilder literals and checks enum wire values against smali.

Normal development regenerates from the checked-in JSON:

```sh
npm run generate:catalogs
npm run check:catalogs
```

These commands need no APK, Java, or decompiler. `src/findagrave/rest.ts` holds the manually traced REST bindings; its source methods and side effects are indexed in [operations.md](operations.md). Keep both in sync when changing a route. See [development notes](../development.md) for the full checks and optional live verification.
