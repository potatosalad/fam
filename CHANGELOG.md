# Changelog

Versions use `YYYY.MDD.N` (UTC date, daily counter). Newest first.

## 2026.1106.1

- Removed the Camofox engine, Docker setup, and engine-switch discovery; CloakBrowser is the only browser.
- Relocated the shared browser protocol into CloakBrowser; retained tabs, fetch, login, checkpoints, and reset support.
- Ignore retired config entries; reuse configured CloakBrowser endpoints or request setup. Updated browser docs and regression tests.

## 2026.1106.0

- Dependencies: Playwright 1.65.0, onnxruntime-web 1.31.1, graphql 17.1, impit 0.14.8, sharp 0.35.5, turndown 7.2.5; dev: express 5.3, tsx 4.23.15, @types/node 26.6.6. `npm audit` clean (undici, qs, body-parser fixes).
- CloakBrowser service: wrapper and image 0.5.10 → 0.6.5 (last keyless release; pinned by digest), Playwright 1.65.0, express 5.3.0. Local image tag is now `fam-cloakbrowser:0.6.5`.
- CloakBrowser humanize: removed the selector fallback adapter. 0.6 resolves `:visible`, role, and chained selectors natively, and `UnsupportedHumanizeSelectorError` is no longer thrown.
- Added this changelog.
