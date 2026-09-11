# Development

Use Node.js 22.16 or newer, npm, and Python 3. Run `npm ci` to install dependencies and build the commands.

## Source layout

`src/cli.ts` contains the `fam` dispatcher; shared command definitions and help live under `src/shared/`. Each service owns its client, authentication, CLI, and any generated contracts under `src/<provider>/`. The [provider index](../README.md#providers) links every maintained guide.

`src/shared/` contains credential lookup, private storage, and lossless JSON utilities used across providers. `src/index.ts` preserves the root library export; FamilySearch is also available through `@potatosalad/fam/familysearch`, alongside the other provider subpaths.

Builds compile and generate metadata in a fresh `.fam-build-*` directory before switching the linked CLI to it through an atomic `.fam-build.json` pointer. Each CLI invocation registers a process lease before rechecking the pointer, keeping that complete snapshot for its lifetime, including lazy imports. A failed compilation leaves the previous build usable. Publication is serialized and then cleans up unused snapshots, retaining the current build, active readers/compilers, and uncertain usage. Dead process leases are reclaimed on the next build; legacy launchers defer cleanup until they exit. Usage records never enter `dist/` or npm packages. See [updates](setup.md#updates) for installation detection and dependency limitations.

The build also updates the real `dist/` directory using atomic file replacement for library consumers and npm packages. Legacy modules stay available to older running imports, while a generated `dist/.npmignore` excludes obsolete files from packages. Packaged installations use `dist/` and do not include development snapshots. Library consumers should restart after a rebuild to load a consistent version.

## Run from source

```sh
npm run fam -- cli.command list --provider familysearch
npm run fam -- cli.command list --provider ancestry
npm run fam -- cli.command list --provider myheritage
npm run fam -- cli.command list --provider findmypast
npm run fam -- cli.command list --provider findagrave
```

These commands run the shared fam source in this checkout. They do not call a globally installed CLI.

## Checks

```sh
npm run check
```

This runs TypeScript checks, generated-file checks, mocked tests, a build, and a packaged-documentation smoke test. The packaging check removes the extracted source files and original docs, then verifies reading, search, and completion from `dist/`. Tests use temporary configuration directories and remove inherited login variables. CI runs them on Linux and macOS with Node 22 and 24.

`npm run test:search` is an opt-in real-model retrieval check. It downloads public Arctic and MiniLM model files into disposable profiles, checks 18 natural-language command intents and documentation ranking, then disables network access to verify cached restarts, vector-cache recovery, and explicit BM25 fallback for damaged model files. It verifies that command searches do not embed guides and that provider-scoped documentation indexing retains command vectors. It never contacts genealogy providers. Regular `npm test` uses injected synthetic embeddings and lexical CLI calls, so CI needs no model download.

`npm run test:browser` additionally exercises HAR capture in headless Chromium. Install its binary with `npx playwright install chromium`, or set `FAM_TEST_BROWSER_CHANNEL=chrome` to use installed Chrome. These tests intercept every browser request and mock the importer's HTTP transport; they use synthetic logins, HTTP-only cookies, form tokens, and both Findmypast regions. They require no live accounts and use disposable profiles. Run them when changing browser capture or HAR import.

## Provider API contracts

`contracts.json` is not limited to Android providers. It records the observed provider interface; each provider's format reflects the evidence available. It is separate from the public **CLI command contract** in `src/shared/command-registry.ts`, which drives help, discovery, and completion. Recovered declarations do not guarantee live account access or complete response schemas.

| Provider / surface | Contract and evidence | Runtime use |
| --- | --- | --- |
| MyHeritage native mobile APIs | [contracts.json](myheritage/contracts.json), [protocol](myheritage/protocol.md), [provenance](myheritage/provenance.json) | Generates its REST/GraphQL/model catalog. Browser authentication does not grant all native API capabilities. |
| MyHeritage website research | [Research API and examples](myheritage/research.md), [website asset provenance](myheritage/research-provenance.json) | Maintained research adapter; distinct from the mobile catalog. |
| American Ancestors website | [contracts.json](americanancestors/contracts.json), [protocol and sources](americanancestors/protocol.md) | Generates the read-endpoint catalog used by the native client and `api list` / `api describe`. No APK needed. |
| Geneanet website | [contracts.json](geneanet/contracts.json), [protocol](geneanet/protocol.md), [provenance](geneanet/provenance.json) | Generates observed website reads and catalog-only routes. No APK needed. |

Other providers keep their contracts and protocol evidence under their own `docs/<provider>/` directories. Storied loads its checked-in JSON catalog directly; NewspaperArchive documents its website adapter in [protocol.md](newspaperarchive/protocol.md). A separate file is useful when it feeds the implementation or records evidence, rather than duplicating another catalog.

Inspect either provider's catalog without credentials or network access:

```sh
fam americanancestors.api list
fam americanancestors.api describe --operation search --json
fam myheritage.api list --filter individual
fam myheritage.api describe --operation person.update --json
```

American Ancestors exposes supported research commands rather than a generic `api call`. Volume traversal and resumable exports orchestrate the documented read endpoints locally. Authentication, SSO, and published-image transfers are documented in its protocol notes.

## Generated code

Provider guides and contracts live under `docs/<provider>/`. FamilySearch reference docs, APK metadata, endpoint inventory, operation selection, and TypeScript examples are in `docs/familysearch/`. Only shared setup and development documentation lives at the docs root.

Edit the contracts under `docs/<provider>/`, then regenerate:

```sh
npm run generate
npm run generate:catalogs
```

The first command generates FamilySearch code and reference docs. The second generates Ancestry, MyHeritage, Findmypast, Find a Grave, Geneanet, and American Ancestors catalogs. Both use checked-in JSON and need no APK or decompiler. `npm run check:catalogs` detects stale provider catalogs; do not edit generated TypeScript directly.

The extraction scripts need the APK and disassembly files described in the provider protocol notes. `check:ancestry`, `check:myheritage`, `check:findmypast`, and `check:findagrave` compare against those local artifacts, so they are separate from the usual checks. Extraction steps are in the [Findmypast](findmypast/protocol.md#reproduce-the-catalog) and [Find a Grave](findagrave/protocol.md#reproduce-the-catalog) protocol notes.

## Bundled documentation

`npm run build` runs `scripts/build-docs.mjs` after compilation and before publishing the build. It copies the root README and regular Markdown files under `docs/` into the build's `docs/` directory and creates `docs/catalog.json` with document metadata, full Markdown, and heading ranges. Symlinked files and directories are excluded. Both `dist/` and versioned build snapshots contain the same guides. The executable uses its own catalog; it does not depend on a source checkout or the caller's working directory.

Edit the original Markdown, then rebuild. Source runs through `npm run fam -- ...` read those Markdown files directly. `src/shared/documentation.ts` provides reading, section navigation, and passage construction; the command registry provides the command identities that guide sections may reference. Command search embeds short command/operation descriptions and uses guide BM25 matches plus bounded excerpts for reranking. Documentation search embeds only passages allowed by its provider/document filters. Both reuse a content-addressed vector cache, bounded to 4,096 entries and checkpointed every 64 new vectors. Changing one guide or command does not rebuild unrelated vectors. Generated copies and catalogs are build output and should not be hand-edited or committed.

## Packaging

`npm pack --dry-run` lists the files npm will install. To build a distributable archive, run `npm pack` and install the resulting `.tgz` file with `npm install --global /path/to/archive.tgz`.

Check all installed commands from outside the checkout after changing packaging. Use a temporary npm prefix and configuration directory to avoid replacing another installation or using real credentials.

## Live verification

These commands contact the services using your configured account:

```sh
npm run verify:genealogy
npm run verify:research
npm run verify:ancestry
npm run verify:myheritage
npm run verify:myheritage:research
npm run verify:findmypast
npm run verify:findagrave
npm run verify:findagrave:search
```

Run only the checks for services you have set up. They are not part of `npm test` or CI. MyHeritage record searches may update recent-search history. Findmypast uses an existing session and samples account, tree, record, newspaper, and image reads; `npm run verify:findmypast -- --anonymous` runs only its public-endpoint checks. Neither mode attempts password login or confirms credit purchases.

Find a Grave verification also uses an existing session. `npm run verify:findagrave -- --anonymous` checks public reads without a login. Photo CDN denials are reported as blocked downloads; they do not count as successful downloads or fail the other checks. The search verifier checks biography, name, date, and plot filters. Neither verifier signs in or executes account or memorial edits.

Account reports go into the private configuration directory. Document checks save downloads under the checkout's ignored `artifacts/` directory and print a summary. Keep live reports, HARs, credentials, and personal exports out of commits.


## CLI contracts

Public command definitions live in `src/shared/command-registry.ts`. Update a definition and its provider binding together; help, search, inspection, and completion derive from the registry. Provider adapters take explicit arguments and return data to the shared JSON writer. Response schemas are advisory. See [the CLI contract](cli.md).
