# Find a Grave operation index

Recovered from Android 4.0.2 (138). `fam findagrave schema NAME` returns the complete document or route. Full GraphQL documents and source references are in [contracts.json](contracts.json).

## GraphQL

| ID | Kind | Variables | Alias |
| --- | --- | --- | --- |
| `graphql.AddCemetery.f8a95445` | mutation | cemetery: CemeteryInput, exp: String, duplicateToken: ID |  |
| `graphql.ApproveEdits.4d31f5b5` | mutation | ids: [ID!]! |  |
| `graphql.Authenticate.41cc792c` | mutation | credentials: Credentials! | auth.password |
| `graphql.Authenticate.f6cd753f` | mutation | input: OAuthInput! | auth.oauth |
| `graphql.CancelEdits.cff0c4ed` | mutation | ids: [ID!]! |  |
| `graphql.CemeteryDuplicates.1147b91d` | query | cemetery: CemeteryInput, max: Int |  |
| `graphql.CemeteryNameTypeahead.0191fb7f` | query | search: CemeterySearchInput |  |
| `graphql.ContributorFriends.e8240ab3` | query | ids: [ID!]!, from: Int, size: Int, contributorId: ID |  |
| `graphql.DeclineEdits.595ae559` | mutation | params: DeclineEditInput! |  |
| `graphql.FindCemetery.d7a2016a` | query | id: ID! |  |
| `graphql.FindContributor.4d23e5a3` | query | id: [ID!]!, contributorId: ID |  |
| `graphql.FindMemorial.c91a797b` | query | ids: [ID!]! | memorial.edits |
| `graphql.FindMemorial.cfbb6c7d` | query | ids: [ID!]! | memorial |
| `graphql.GlobalMemorialTags.5e253b32` | query | — |  |
| `graphql.ListMemorialsInVirtualCemetery.9cd61318` | query | id: ID!, from: Int, size: Int, sort: VirtualCemeteryMemorialSortType |  |
| `graphql.LocationTypeahead.f7da595d` | query | search: LocationSearchInput |  |
| `graphql.MemorialSearch.8cea0640` | query | input: MemorialSearchInput |  |
| `graphql.MyCemeteries.902be4c1` | query | from: Int, size: Int, sort: MyCemeterySort, name: String |  |
| `graphql.PhotoSearch.6c1786f7` | query | input: ContributorPhotoSearchInput |  |
| `graphql.QuerySuggestedEdits.af00c8d5` | query | input: EditSearchInput |  |
| `graphql.QuerySuggestedEditsTotal.12126a69` | query | input: EditSearchInput |  |
| `graphql.RemoveOAuthLink.61d5f38d` | mutation | linkInput: String |  |
| `graphql.SearchCemeteries.6d3eef27` | query | search: CemeterySearchInput |  |
| `graphql.SignedInContributor.4c91d79a` | query | — |  |
| `graphql.SuggestEdits.cc5ee4cf` | mutation | input: CreateEditInput |  |
| `graphql.UnVolunteerForCemetery.6248c150` | mutation | ids: [ID!]! |  |
| `graphql.UpdateContributor.bda869de` | mutation | contributors: [ContributorInput!]! |  |
| `graphql.VirtualCemeterySearch.d4bbf0b3` | query | search: VirtualCemeterySearchInput |  |
| `graphql.VolunteerCemeteries.029c36c3` | query | — |  |
| `graphql.VolunteerForCemetery.b8bd4ef0` | mutation | ids: [ID!]! |  |
| `graphql.createOrUpdateMemorial.e65ef579` | mutation | memorial: MemorialInput! |  |
| `graphql.getDefaultPhotos.f36fe96e` | query | ids: [ID!]! |  |

Authentication/linking documents are cataloged; generic execution is reserved for non-authentication operations. Use `fam findagrave auth` for the native password flow.

## Executable REST

Bodies remain open JSON/form input, not a fully typed server schema. A **write** may use GET. Mutation tests use mocks; live verification performs reads only.

| Name | HTTP | Path | Effect | Body | Query keys | Source method |
| --- | --- | --- | --- | --- | --- | --- |
| `requests.claimed` | GET | `/photo-request/requests-claimed` | read | none | sortBy, limit, skip | t9.A |
| `requests.mine` | GET | `/photo-request/my-requests` | read | none | type, sortBy, limit, skip | t9.B |
| `requests.nearby` | GET | `/photo-request/location/current/{latitude}/{longitude}` | read | none | sortBy, limit, skip, searchRadius | t9.C |
| `requests.volunteer` | GET | `/photo-request/volunteer-cemeteries` | read | none | sortBy, limit, skip | t9.F |
| `virtual-cemeteries.exclude-memorial` | GET | `/memorial/virtual-cemetery/exclude/{memorialId}` | read | none | skip, limit | t9.G |
| `virtual-cemeteries.for-memorial` | GET | `/memorial/virtual-cemetery` | read | none | skip, limit, memorialId | t9.H |
| `cemetery.plots` | GET | `/memorialPlot/{cemeteryId}` | read | none | geoHash | t9.K |
| `cemetery.geohashes` | GET | `/memorialPlot/{cemeteryId}` | read | none | — (fixed {"summary":true}) | t9.L |
| `virtual-cemetery.remove-memorial` | POST | `/virtual-cemetery/remove-memorial` | write | json | — | t9.Q |
| `my-cemetery.remove` | GET | `/my-cemetery/{cemeteryId}/remove` | write | none | — | t9.R |
| `request.report-problem` | POST | `/photo-request/{requestId}/report-problem` | write | json | — | t9.T |
| `photo.rotate` | PUT | `/photo/rotate` | write | json | — | t9.U |
| `requests.contributor` | GET | `/photo-request/search/contributor/{contributorId}` | read | none | limit, skip, includeProblems, sortBy | t9.W |
| `memorial.find-similar` | POST | `/memorial/find-similar` | read | json | — | t9.a |
| `memorial.request-photo` | POST | `/memorial/{memorialId}/photo-request` | write | json | — | t9.b |
| `account.forgot-password` | POST | `/forgot-password` | write | json | — | t9.b0 |
| `friend.toggle` | POST | `/user/friend/add-remove` | write | json | — | t9.c |
| `memorial.set-profile-photo` | POST | `/memorial/set-profile-photo` | write | json | — | t9.c0 |
| `virtual-cemetery.toggle-memorial` | POST | `/memorial/virtual-cemetery/toggle` | write | form | — | t9.f0 |
| `request.unclaim` | GET | `/photo-request/{requestId}/unclaim` | write | none | — | t9.g0 |
| `account.change-email` | POST | `/change-email` | write | json | — | t9.h |
| `account.update-activity` | POST | `/user/update-activity` | write | none | — | t9.i0 |
| `request.claim` | GET | `/photo-request/{requestId}/claim` | write | none | — | t9.j |
| `memorial.update` | POST | `/memorial/update-memorial/{memorialId}` | write | json | — | t9.j0 |
| `account.create` | POST | `/m/create-account` | write | json | — | t9.k |
| `account.change-password` | POST | `/change-password` | write | json | — | t9.l0 |
| `my-cemetery.add` | GET | `/my-cemetery/create/{cemeteryId}` | write | none | — | t9.m |
| `photo.update` | POST | `/memorial/update-photo` | write | json | — | t9.m0 |
| `virtual-cemetery.create` | POST | `/virtual-cemetery/create` | write | json | — | t9.n |
| `virtual-cemetery.update` | POST | `/virtual-cemetery/update` | write | json | — | t9.n0 |
| `memorial.delete` | POST | `/memorial/delete-memorial/{memorialId}/{cemeteryId}` | write | none | — | t9.p |
| `photo.delete` | POST | `/memorial/delete-photo` | write | json | — | t9.q |
| `request.delete` | GET | `/photo-request/{requestId}/delete` | write | none | — | t9.r |
| `virtual-cemetery.delete` | DELETE | `/virtual-cemetery/{virtualCemeteryId}` | write | none | — | t9.s |
| `memorial.create` | POST | `/memorial/create` | write | json | — | t9.w |
| `requests.cemetery` | GET | `/photo-request/search/cemetery/{cemeteryId}` | read | none | sortBy, limit, skip, includeProblems (fixed {"ajax":true}) | t9.x |

## Other call sites

The `http-sites` command exposes all 47 observed HTTP call sites. The 11 without executable route bindings are detailed in [protocol.md](protocol.md#rest-coverage). Upload-URL negotiation is not a photo-download endpoint.
