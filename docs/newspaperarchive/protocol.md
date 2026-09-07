# Protocol and scope

The provider uses the dedicated `NewsPaperSearch` v2 endpoints hosted at `https://api.storied.com`, authenticated through the same native Auth0 client as the Storied provider. Its contracts and model schemas already exist in `docs/storied/contracts.json`; this provider selects a small read-only subset and reuses `StoriedClient` rather than copying its authentication, transport, catalog, or generated models.

Search is `GET /api/v2/NewsPaperSearch/newspapersearch`. The observed query fields are `FN`, `LN`, `K.AL`, `K.EX`, `K.AN`, `K.WO`, `L.CU`, `L.ST`, `L.CI`, `L.PID`, `PN`, and `PS`. Date ranges use `DT.DFT=between` with `DT.Y/M/D` and `DT.EY/EM/ED`. These bindings are supported by the checked-in Storied contract and its consumer client behavior. Convenience search output preserves result masking and reports one-based continuation.

The public `https://newspaperarchive.com/{publication}-{month}-{day}-{year}-p-{page}/` pages expose bibliographic meta tags, `hdnImageId`, page number, and `.ocr-txt` when OCR is available. Only these fields are parsed; remote JavaScript is not executed. Public page reads send no credentials or tokens, allow only the exact NewspaperArchive HTTPS origin, follow at most five redirects, enforce a 20 MiB response limit, and classify Cloudflare challenges separately from empty OCR.

Live verification is opt-in and is never part of CI. During implementation, authenticated name/date search, identity/catalog verification, publication/place lookup and country/state lookup succeeded. The website exposed public OCR during inspection, but also challenged some subsequent requests. The API OCR endpoint returned an application error for a sample image; this is explicitly treated as failure. Subscription-restricted search hits exposed `isMasked: true`. Tests use synthetic fixtures and verify query bindings, pagination, shared credentials, restricted API operations, response errors, and public-page origin/redaction boundaries.

Full-resolution downloads and clipping mutations are outside this initial scope.
