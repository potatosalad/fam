# Fold3 protocol observations

Observed on 2026-09-11 from Fold3's own website pages, client configuration, and shipped JavaScript. These are undocumented website contracts, not a supported developer API or a service-level guarantee. Public documentation research did not establish a currently supported, self-service Fold3 developer API. Do not assume that a former Footnote/Fold3 API or a partner key grants access to the modern website.

## Sources and service boundaries

Primary sources: [Fold3](https://www.fold3.com/), [login](https://www.fold3.com/login), [search](https://www.fold3.com/search), [search help](https://www.fold3.com/help/search), [client configuration](https://www.fold3.com/clientConfig.js), and the shipped [search](https://www.fold3.com/script/SearchPage.js), [login](https://www.fold3.com/script/LoginPage.js), and [viewer](https://www.fold3.com/script/ViewerPage.js) bundles. Record hydration was checked on `/record/`, `/document/`, `/memorial/`, and `/unit/` pages. Bundles are evidence of paths and wire field names; they are not vendored into fam.

`clientConfig.js` advertises separate backend services for search, image data, indexed records, memorials, units, commerce, and tokens. Browser code maps these to same-origin `/fold31-*` proxy paths. The advertised search backend hostname did not resolve from the research environment; that alone does not establish its global availability. Use `www.fold3.com` proxies, which were verified. No guessed partner keys or internal authentication headers are required.

| Capability | Observed route | Response / access |
| --- | --- | --- |
| Login bootstrap | `GET /login` | HTML `#hydrate-data`: CSRF plus page context; initial `sess` cookie |
| Password login | `POST /node/auth/user` | JSON username/password with `x-csrf-token`; native attempt challenged |
| Account verification | `GET /node/refreshUser` | Expanded account JSON; anonymous response observed as empty HTTP 200 |
| Search / browse | `POST /fold31-search/doc-search` | Hits, total, facets, timing, shard failures; browser transport verified |
| Publication catalog | `GET /fold31/api/publication` | Compact publication objects; native HTTP verified |
| Publication detail | `GET /fold31/api/publication/pub/{id}` | Title, source metadata, access configuration |
| Indexed record | `GET /record/{id}` | Canonical redirect then structured HTML hydration |
| Memorial / unit | `GET /memorial/{id}`, `GET /unit/{id}` | Hydrated facts, events, stories, sources, and connections |
| Image source | `GET /document/{id}` | Source details, publication, related records, and filmstrip context |
| Image metadata | `GET /fold31-image-data/image/document/IMAGE/{id}?flag=PERMISSIONS` | Wrapped image plus actual allowed/denied actions |
| Image authorization | Same image route, with `flag=TOKEN` too | `r.o.token` only when granted; consumed internally |
| Neighboring pages | `GET /fold31-search/filmstrip/{id}?count=N&prev-count=0` | Nodes and clusters; a bounded fragment |
| File pages by position | `POST /fold31-search/filmstrip/by-offset?offset=N&count=N&prev-count=0` | Compact cluster sort key body; anchor plus subsequent pages, possibly spilling into the next cluster |
| Collection hierarchy labels | `GET /fold31-search/search-util/browse-levels/{publicationId}` | Ordered collection-specific level labels |
| Collection branches / leaf images | `POST /fold31-search/doc-search` | `general.title.browse.1` through `.6` facets and filters; `FILMSTRIP` image ordering |
| Linked research objects | `POST /fold31/api/connection/list-objs?thumb-height=100&thumb-width=100` | Directional object connections, with `offset` and `count` in the body |
| OCR | `GET /fold31-image-data/ocr/text/IMAGE/{id}` | Plain transcription; unsupported/denied responses also occur |
| OCR hits | `GET /fold31-image-data/ocr/hits/IMAGE/{id}?keyword=TEXT` | Compact scan-coordinate rectangles |
| Image export | `GET https://img.fold3.com/img/img` | JPG using `id`, fresh `token`, `a=download`, `width=0`, `height=0`, `rotation=0`, `anchor`, and `title` |

## Authentication and permissions

The website manages cookies including `sess`; no reusable public OAuth token exchange was established. Login hydration carries `F3_PAGE_DATA.csrf`, while research hydration is under `F3_COMPONENT_DATA`. Do not return the entire hydration envelope as research output. The website also advertises Ancestry OIDC sign-in via its own browser redirects. This integration does not request or reuse an Ancestry API session.

Browser login with account verification succeeded. Direct login and direct search POSTs encountered Cloudflare challenges in the research environment. Public metadata reads succeeded with native HTTP. Login attempts remain bounded, ordinary API failures do not trigger password retries, and failed verification never replaces a saved session.

Account metadata distinguishes linked Ancestry subscription status from Fold3 premium access. Scan metadata supplies current `VIEW` and `DOWNLOAD` permissions independently of sign-in. Registered-access collections and subscription collections can differ, and OCR may remain available when scan viewing is denied. The integration preserves each permission separately.

## Search contract

The JSON body uses expanded names: `keywords`, `fieldedKeywords`, `filters`, `facetRequests`, `offset`, `maxCount`, `sortOrder`, `ocr`, and `highlight`. A name criterion is `{type:"full-name",texts:["Name"],strict:true,exclude:false}`. Filters have `type`, string `values`, `filterType:"TERM"`, `strict`, and `exclude`. The content-type facet is `general.title.content.doc-type`; publication IDs use `general.title.id`.

Hits use compact keys (`doc.id.ct`, `doc.id.id`, `doc.t`, `doc.pid`, `doc.md`, `hp`, `ohp`, `s`); metadata has `n`, `v`, and optional `l`. Facets contain `type` and entries with `v` (value), `c` (count), and optional `l` (label). The CLI normalizes hits and retains facet values for subsequent filtering. Sorting names were taken from the website's selector.

The CLI's 10,000-result window is a conservative local bound, not a claim about a permanent server limit. It reports incomplete responses and does not automatically exhaust result sets. Facet results and page fragments can be partial.

## File boundaries and collection traversal

Filmstrip nodes carry `i` (image ID), `c` (cluster ID), and `o` (zero-based position). Clusters carry `i`, `t` (title), `z` (page count), `s` (sort key), and `f` (indexed-file flag). A cluster ID begins with its publication ID followed by a dot. A by-offset request serializes the `ClusterSortKey` as `{p: publicationId, s: clusterSortKey}`. The response includes its anchor plus `count` subsequent nodes. Live verification confirmed that the response can cross the next cluster boundary; the file reader restricts output to the original cluster and checks each expected ordinal and the declared size.

The shipped viewer also exposes `/fold31/api/file/index/image/{id}` and `/index/cluster/{key}`. The image-index probes returned empty bodies for the tested non-indexed clusters, so file traversal uses the verified filmstrip route. A scan cluster is a website grouping, which can represent a case file, report, or another collection-specific unit. It is not independent proof of archival completeness.

Hierarchy labels describe `general.title.browse.1` through `.6`. Branch requests use a facet with `sort: ALPHA`, then apply the exact selected value as a `TERM` filter at that level. Values contain provider sort keys, labels, and separators; they must not be reconstructed from display labels. A `PREFIX` filter on the next browse field narrows a long branch list. Empty levels may have label `␀`; their values remain in the path so subsequent levels keep the correct index. Leaf requests use `sortOrder: FILMSTRIP` and the image document type. Live verification covered two hierarchy levels, image results, and prefix filtering.

File exports first enumerate the complete bounded cluster, then obtain fresh authorization and save each JPG with its normal citation sidecar. A private manifest records page order and completion; resume re-enumerates and compares page identities, then checks existing bytes against SHA-256 and sidecar metadata. Live verification covered a permitted two-page export and a second run that reused both pages. Synthetic tests cover interrupted downloads, corrupt or mismatched artifacts, locks, and recovery after an image/sidecar pair was saved before its manifest update.

## Connection traversal

`list-objs` accepts `{id: {ct: contentType, id: objectId}, forward: boolean, offset, count}`. `forward: true` follows the anchor's outgoing links; `false` follows incoming links. Live checks confirmed distinct pages using `offset` and `count` and both directions. The CLI requests one lookahead entry and retains a 10,000-entry bound.

Each returned content object has a compact reference `id`, title `t`, metadata `md`, and connection `c`. Connection fields include `id` (connection ID), `p` (principle/source reference, using the provider's spelling), `t` (target reference), `md` (optional metadata), and `c` (creation time). The reader validates that each connection has the requested directional anchor and normalizes references to type, exact ID, and source URL when known. Public output excludes authorization fields and account context. Website connections may represent contextual links or contributions; they must not be automatically interpreted as biological relationships.

## Images and research provenance

Image responses wrap `w` (document metadata), `d` (image details), `de` (contributions), and `r` (runtime properties). `r.p.allowed` and `r.p.denied` establish current permissions. The download token is `r.o.token`; URLs carrying it never appear in normal output or citation sidecars.

The transport allows only exact HTTPS `www.fold3.com` and `img.fold3.com` origins, checks every redirect, uses domain-scoped cookies, limits redirects and response size, and suppresses provider response bodies in errors. POST destinations are fixed. JPG exports are decoded before being written, and sidecars preserve source metadata and checksums. Live account data, browser sessions, screenshots, HARs, downloaded scans, and response captures are excluded from the shared repository. Automated tests use synthetic data; live verification is opt-in.
