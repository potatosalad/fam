# Ancestry Android protocol notes

This describes observations from signed build 18.16.3, with paths relative to `analysis/ancestry/java/sources/`. Corresponding smali under `analysis/ancestry/smali/` is the authoritative evidence when JADX cannot reconstruct a method. Full artifact hashes are in [provenance.json](provenance.json).

## Origins and request transport

`rs0/c` supplies production environment hosts; `rs0/b` holds their endpoint configuration. The client permits HTTPS requests only to `gateway.ancestry.com`, `auth.ancestry.com`, `www.ancestry.com`, and `mediaupload.ancestry.com`. Userinfo URLs and redirects are rejected. FamilySearch transport and cookies remain separate.

Genealogy REST interfaces use the gateway, generally with a service prefix such as `treeservices`, `personprovider`, `ssv-recordsearch`, or `ssv-recordservice`. Tree/person IDs are distinct from the signed-in account ID. `l2/m0` and `pq/b` provide auth/header evidence. Live checks used `Authorization: Bearer …`, `Ancestry-UserId`, `Ancestry-ClientPath: Mobile.AndroidApp`, `Ancestry-CultureId: en-US`, and `X-PreferredCountry: US`. The client supplies a descriptive Android user-agent; this is not a byte-for-byte reconstruction of every device header.

HTTP status and response headers are preserved by `client.request`; cookies are stored privately and removed from exposed headers. JSON uses the project's lossless integer parser/stringifier. The transport retains operation-specific media types, including `Accept: application/ssv_rcd.v4+json` for record search. Errors omit response bodies and query strings. A definitive 401 triggers at most one refresh and retry; permission errors, rate limits, server failures, and ambiguous network failures are not replayed. `AncestryHttpError.retryAfter` exposes the response's retry hint.

## Authentication

Evidence: `com/ancestry/apigateway/auth/a`, `PreAuthServices`, `mq/a`, service-provider classes `oq/d`, `oq/j`, `oq/e`, and pre-auth solution logic `f6/h`.

1. Obtain an application token by form POST to `https://auth.ancestry.com/ancauth/tokens`, using `service_provider=client_credentials`, `scope=*`, and the APK's public client ID/secret constants. They are embedded application identifiers, not the user's password or tokens.
2. Send that bearer token to `POST https://gateway.ancestry.com/auth/pre-auth` with `identity` (username), device information, and `supportedAlgorithms: ["sha256-mod-v1"]`.
3. The server returns `sessionId`, `algorithm`, and `algorithmParameters: {n,r}`. For integer key values starting at zero, compute uppercase SHA-256 hex of the concatenated UTF-8 string `sessionId + key + username + deviceId`. Select a hash whose unsigned integer value modulo `n` equals `r`.
4. Base64-encode JSON `{solution_hash,solution_time_ms,key,session_id}`. The implementation caps this computation at five seconds and rejects unsupported algorithms or invalid parameters.
5. POST another form to `/ancauth/tokens` with `service_provider=user_credentials`, username/password, proof as `token`, device fields, and `autosend=false`.
6. Save a successful account token response. If the response instead contains a verification token, persist the pending state. The observed response was HTTP 200 with an email verification method, rather than a successful account access token.
7. `ancestry auth --send-code` obtains an application token and POSTs to `/ims/mfa/email/resendcode`, with bearer authorization and `verify-uauth-v1` containing the pending verification token. `auth --code` form-POSTs `service_provider=mfa_credentials`, `mfa_code`, `verification_token`, and device-description fields to `/ancauth/tokens`. Successful verification replaces the saved session and removes pending state.
8. Refresh uses a different URL: `POST https://auth.ancestry.com/oauth20/tokens` with `grant_type=refresh_token`, the refresh token, and application identifiers. Preserve the account ID if the refreshed response omits it. Save rotated tokens before another API request.

The stable random device ID is saved separately. Session expiry is computed when tokens are issued/refreshed and is not extended merely by using a token. Password, MFA, and refresh exchanges were all exercised successfully. Codes are never committed to the project.

## GraphQL

`w60/a` constructs Apollo with `graphql/federation`, resolved against the gateway by `a21/v.Q0`. Requests are JSON `{operationName,query,variables}` to `/graphql/federation`. The shipped app contains full query/mutation documents; sending those documents worked without a persisted-query negotiation.

The extractor reads query strings directly from smali, records their SHA-256 hashes and source classes, and collects declared variables, non-null requirements, and defaults. Examples: `gt/d0` (`GetTreeList`), `gt/h0` (`GetTree`), `gt/x` (`GetPersons`), `or/k0` (`GetPersonsHints`), and `as/l` (`PersonNode`). A 200 response can still contain GraphQL errors, including partial data; the client treats those as errors and retains the envelope in `AncestryGraphQLError.result`.

The app's selected fields and custom input types are not a full server schema. No schema introspection or exhaustive input/output model reconstruction was performed. Each catalog operation retains its native document so its selections remain reviewable.

## REST genealogy contracts

Retrofit runtime annotations yield the verb/path, static headers, path/query/header/body bindings, form encoding, and native method signature. The inventory includes multiple declarations for the same route with different parameters, and both read and write POSTs. A declaration alone does not prove its base URL, account permissions, or whether the service still supports it. Common genealogy interfaces have gateway mappings; unconfirmed declarations require explicit `base` selection.

`TreeIOApi` supplies tree/person aggregation, family graphs, web links, media, membership, citation counts, and bulk sync. `TimelineApi` supplies person research, life stories, family source data, and fact/citation/media modifications. `Pm3CacheApi` supplies paged people, citations, sources, and media. `RecordApi` supplies record fields, records, images, and document checks. See the generated contracts for exact casing; for example `treeId`, `treeid`, and `treeID` occur in different declarations.

Legacy wrappers often retain short or capitalized fields: person aggregation uses `Persons`, research uses `PersonFacts`/`PersonSources`/`PersonFamily`, and caches use `Citations` or `Sources`. Preserve these responses rather than assuming they match GraphQL models. Some services also report application status/error fields in successful HTTP responses, which callers should inspect.

## Record search and retrieval

`zk0/m0` declares POST `ssv-recordsearch/queryterm` and `hitcountquery`. `SearchRequestBody` and its Moshi adapter define capitalized wire fields. `cl0/a` registers query-term polymorphism using `type` with the class's simple name: `GivenNameQueryTerm`, `SurnameQueryTerm`, `EventQueryTerm`, etc. Name terms use `GivenName`/`Surname`, `Relationship: Self`, and optional matching fields. Event terms use `EventName: Birth|Death`, `Date: {Year: …}`, and/or `Place: {Place: …}`.

`cj0/n.b` constructs default requests, and `jj0/a` supplies the category filters:

```json
["1|Category|SET=HistoricalRecords", "1|Category|SET=StoriesPublications", "1|Category|SET=PhotosMaps"]
```

`CollectionFocus.Default` serializes as lowercase `default`. `PagingInfo` defaults to page 1, an empty paging token, and 20 records. `RequestContext.Data` includes user ID, culture, and `AncestrySearchClient: androidAncestryApp`. The working convenience builder reproduces these values, `MinimumScore: -1`, `SearchBlock: 0`, `JudgmentFilter: 1`, and an empty judgment token. Initial reduced requests returned 400; the completed native defaults returned successful records. The command accepts explicit filter expressions for advanced searches.

Results use `RecordView.Records`, `TotalResults`, and `PagingInfo`; the record GID is `RECORD:COLLECTION`. `GetRecordsRequest` / `gl/b` then POST to `ssv-recordservice/getrecords` with `Documents: [{CollectionId,RecordId}]`, culture context, and requested features. Unlike GraphQL, the feature names here use `Name` and `Options`. The implemented `record` command requests display fields, collection metadata, household members, and content rights. Record fields and metadata still depend on the account's access rights.
