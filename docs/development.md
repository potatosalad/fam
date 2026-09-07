# Development

Use Node.js 22.16 or newer, npm, and Python 3. Run `npm ci` to install dependencies and build the commands.

## Run from source

```sh
npm run fs -- --help
npm run ancestry -- --help
npm run myheritage -- --help
npm run findmypast -- --help
npm run findagrave -- --help
```

These commands use the public checkout. They do not call a globally installed CLI.

## Checks

```sh
npm run check
```

This runs TypeScript checks, generated-file checks, mocked tests, and a build. Tests use temporary configuration directories and remove inherited login variables. CI runs them on Linux and macOS with Node 22 and 24.

## Generated code

Edit the contracts under `docs/`, then regenerate:

```sh
npm run generate
npm run generate:catalogs
```

The first command generates FamilySearch code and reference docs. The second generates Ancestry, MyHeritage, Findmypast, and Find a Grave catalogs. Both use checked-in JSON and need no APK or decompiler.

The extraction scripts need the APK and disassembly files described in the provider protocol notes. `check:ancestry`, `check:myheritage`, `check:findmypast`, and `check:findagrave` compare against those local artifacts, so they are separate from the usual checks. Extraction steps are in the [Findmypast](findmypast/protocol.md#reproduce-the-catalog) and [Find a Grave](findagrave/protocol.md#reproduce-the-catalog) protocol notes.

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
