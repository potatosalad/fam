# fam

One command-line tool for genealogy research across FamilySearch and other providers. Browse family trees, search historical records and newspapers, find memorials, and download original documents or archived web pages.

These are unofficial clients. They use mobile and website APIs that can change without notice. Access depends on your account and subscriptions.

## Install

Requires Node.js 22.16 or newer, npm, and Git.

```sh
git clone https://github.com/potatosalad/fam.git
cd fam
npm ci
npm install --global .
fam cli.completion install
```

This installs one executable, `fam`, from the checkout. Keep the directory in place. Automatic updates are enabled by default: fam quietly checks for updates after a command exits, at most once every 24 hours. Use `fam cli.update disable` to opt out, or `fam cli.update enable` to turn them back on. Run `fam cli.update` from any directory to update immediately, or `fam cli.update run --dry-run` to preview the update. See [update details](docs/setup.md#updates).

Run `fam --version` to check the installed version and location.

`fam cli.completion install` enables TAB completion for bash or zsh. Open a new shell afterward; for the current shell, run `eval "$(fam --completions zsh)"` (use `bash` in bash). It completes providers, commands, options, and file paths. Try `fam myheritage.record search <TAB>` to discover search flags without typing `--` first. See [completion setup](docs/setup.md#shell-completion) for details.

Upgrading an older installation? See [migration from familysearch](docs/setup.md#migration-from-familysearch) to remove the old executables and retain saved sessions.

If installation fails or your shell can't find the commands, see [installation help](docs/setup.md#installation).

## Providers

| Provider | Research features and guide |
| --- | --- |
| `familysearch` | [Family trees, historical records, original images, and full-text search](docs/familysearch/README.md) |
| `americanancestors` | [Genealogy databases, records, citations, scans, and exports](docs/americanancestors/README.md) |
| `ancestry` | [Family trees, historical records, hints, and media](docs/ancestry/README.md) |
| `cyndislist` | [Genealogy resources by place and topic, plus site search](docs/cyndislist/README.md) |
| `findagrave` | [Memorials, cemeteries, relatives, biographies, and photos](docs/findagrave/README.md) |
| `findmypast` | [Family trees, historical records, newspapers, and images](docs/findmypast/README.md) |
| `geneanet` | [Archival records, trees, portraits, registers, and books](docs/geneanet/README.md) |
| `internetarchive` | [Books, catalog and OCR search, collections, metadata, and public downloads](docs/internetarchive/README.md) |
| `myheritage` | [Family sites, trees, historical records, matches, and documents](docs/myheritage/README.md) |
| `newspaperarchive` | [Newspaper search, publications, locations, and page OCR](docs/newspaperarchive/README.md) |
| `fold3` | [Military records, publications, memorials, OCR, and images](docs/fold3/README.md) |
| `newspapers` | [Newspaper search, publications, clippings, and page OCR](docs/newspapers/README.md) |
| `storied` | [Family trees, stories, media, hints, and historical records](docs/storied/README.md) |
| `wayback` | [Find archived web pages and read captures from a chosen date](docs/wayback/README.md) |

`fam --help` lists every provider. Run `fam familysearch` (or another provider name) to browse its commands. The `Documentation:` line gives the command to read its full guide.

## Find and run commands

Search for what you want to do in plain language. Search uses command descriptions and relevant guide sections. It runs locally without an API key, downloads about 95 MB of models on first use, then works offline. Use `--lexical` to search without downloading models. See [search options](docs/cli.md#local-discovery) for ranking, filters, and caching.

```sh
fam cli.command search --query "download an original image"
fam cli.command search --query "merge duplicate people" --format tree
fam cli.command describe --command "familysearch.image download"
fam ancestry.person get --tree-id TREE --person-id PERSON
fam ancestry.api.gql query --operation GetTreeList --variables '{"limit":20}'
```

Commands use `fam PROVIDER.OBJECT ACTION --flags`. Output is readable text by default. Add `--json` for structured output or `--out FILE` to save results. See the [command guide](docs/cli.md) and [migration mapping](docs/cli-migration.md).

Explore a provider with `fam familysearch`, or its actions with `fam familysearch.person --help`. Command help shows flags and examples; misspelled commands suggest available choices.

## Read and search guides

The full guides are included with the installed CLI:

```sh
fam cli.doc read --provider americanancestors
fam cli.doc list --provider americanancestors
fam cli.doc search --query "collection-specific fields"
fam cli.doc read --doc setup
```

Use `fam cli.doc list --doc americanancestors` to see its section IDs, then add `--section ID` to read one section and its subsections. Reading works offline and requires no account. Search results include the command to read each matching section; command-search results also link to guides when they supply a relevant match. Use `--format markdown` to read the original Markdown, or `--json` for structured output. See [documentation commands](docs/cli.md#documentation) for details.

## Set up the browser

```sh
fam cli.browser setup --local
```

This starts persistent CloakBrowser in Docker with a passwordless localhost viewer. Switch engines with `fam cli.browser use --engine camofox` or `--engine cloakbrowser`; engine changes clear browser sessions at that location. On macOS, fam offers to install OrbStack when needed. For an existing server, use `fam cli.browser setup --remote URL --vnc-url VIEWER_URL`. Switch with `fam cli.browser use --mode local` or `fam cli.browser use --mode remote`; each retains its logins. See [browser setup](docs/browser.md) for remote API keys, custom viewer URLs, start/stop, and timeouts.

Inspect which HTTP/browser transport will start each provider request with `fam cli.browser.transport list --transport auto`. Decisions are per provider and website origin; see [transport inspection](docs/browser.md#automatic-http-recovery) for exact-origin checks.

Browser sign-ins reuse cookies and try configured credentials when needed. fam opens or prints the viewer URL for MFA or CAPTCHA and waits for completion. Provider clients with browser transport automatically recover evidenced Cloudflare challenges through the browser and remember the website until `fam cli.browser.transport reset`. Internet Archive public API commands use HTTP directly. Use `fam cli.browser reset --provider myheritage` to clear that provider's browser site data, or `fam cli.browser reset --all` to reset all fam-managed browser sessions. See [reset scope and backups](docs/browser.md#reset-browser-sessions).

Fetch any HTTP(S) URL through the browser, including pages that require JavaScript verification:

```sh
fam cli.browser fetch --url https://example.org/page --format markdown
fam cli.browser fetch --url https://example.org/page --private --format markdown
fam cli.browser fetch --url https://example.org/page --open=always
fam cli.browser fetch --url https://example.org/page --format html --out page.html
fam cli.browser fetch --url https://example.org/file.pdf --format raw --out file.pdf
fam cli.browser fetch --url https://example.org/page --json
```

Text is the default. HTML captures the rendered document; raw preserves the response body bytes exposed by the browser. Headers, cookie imports, request methods/bodies, content selectors, and persistent sessions are described in [URL fetching](docs/browser.md#fetch-any-url).

For a missing or blocked live page, try the Internet Archive's newest available copy:

```sh
fam wayback.page fetch --url https://example.org/page --format markdown
fam wayback.snapshot find --url https://example.org/page
fam wayback.snapshot list --url https://example.org/page --from 2010 --to 2020
```

Add `--date 2015-01-01` to fetch the closest capture to that date. See the [Wayback guide](docs/wayback/README.md) for formats, capture provenance, and browser fallback.

## Search Internet Archive books and text

Public research needs no credentials or browser setup:

```sh
fam internetarchive.item search --query 'collection:genealogy AND mediatype:texts'
fam internetarchive.fulltext search --query '"John Smith" AND "Lancaster"' --limit 10
fam internetarchive.item get --identifier historyofnewyork00irvi --json
fam internetarchive.text get --identifier historyofnewyork00irvi --limit 2000
```

Catalog search matches item metadata; full-text search matches indexed OCR and returns snippets. Search hits can include restricted books whose files require account access. See the [Internet Archive guide](docs/internetarchive/README.md) for authentication limits, API endpoints, collection browsing, pagination, and verified downloads.

## Set up credentials

Set up the services you use. `fam PROVIDER.credential set` saves login details from environment variables or a configured helper; otherwise, it prompts for your username and hides the password as you type. `fam PROVIDER.session login` signs in. Browser-session imports do not require saving a password.

To use a credential helper for all providers, configure `credentialsCommand` once in `~/.config/fam/config.json`. See [persistent credential-helper setup](docs/setup.md#external-credential-helpers). With a helper configured, password-based sign-in can use `fam PROVIDER.session login` directly.

Cyndi’s List, the Wayback Machine, and the Internet Archive public provider do not require provider credentials.

### FamilySearch

Use the Church Account linked to your FamilySearch account. Direct FamilySearch username, Google, Apple, and Facebook sign-in are not supported.

```sh
fam familysearch.credential set
fam familysearch.session login
fam familysearch.account get
```

`familysearch.account get` returns your account details, including your tree person ID. If sign-in requires a password reset or additional verification, complete it on the website before retrying.

### American Ancestors

Use your American Ancestors website username and password:

```sh
fam americanancestors.credential set
fam americanancestors.session login
fam americanancestors.session verify
```

Browser setup is not required. With a configured credential helper or environment credentials, skip `credential set`. Access to some collections requires membership. See the [American Ancestors guide](docs/americanancestors/README.md) for records, scans, volume browsing, and exports.

### Ancestry

```sh
fam ancestry.credential set
fam ancestry.session login
```

If Ancestry asks for email verification, request a code and enter the one you receive:

```sh
fam ancestry.session login --send-code
fam ancestry.session login --code 123456
```

Then run `fam ancestry.tree list` to list your trees.

### Find a Grave

Use your Find a Grave email address when prompted for a username:

```sh
fam findagrave.credential set
fam findagrave.session login
fam findagrave.account get
```

Run `fam findagrave.session verify` to check a saved session, or `session login` to sign in again when it expires. Public searches also work with `--anonymous`, without credentials.

See the [Find a Grave guide](docs/findagrave/README.md) for memorials, cemeteries, biography search, and photo downloads.

### Findmypast

Sign in through the configured browser:

```sh
fam findmypast.session login
fam findmypast.account get
```

fam validates the account through the selected browser and retains the login. Use `fam findmypast.session login --region co.uk` for the UK website, or `--interactive` to autofill credentials and submit the form yourself. Add `--no-autofill` to leave login fields untouched. See [browser setup](docs/browser.md).

See the [Findmypast guide](docs/findmypast/README.md) for native login, record and newspaper searches, and image downloads.

### Geneanet

```sh
fam geneanet.credential set
fam geneanet.session login
fam geneanet.session verify
fam geneanet.record search --last-name Lincoln --first-name Abraham
fam geneanet.photo search --last-name Lincoln --first-name Abraham
```

The [Geneanet guide](docs/geneanet/README.md) covers archival transcriptions, collections, portraits, register images, and library PDF pages, including browser-challenge and subscription limits.

### MyHeritage

Save credentials for browser autofill, then sign in through the configured browser. If the browser is already signed in or you use a configured credential helper, skip `credential set`:

```sh
fam myheritage.credential set
fam myheritage.session login
fam myheritage.account get
```

fam saves the browser login for future commands. Open the viewer URL if verification is required. See the [MyHeritage guide](docs/myheritage/README.md) for tree browsing, historical records, and account limitations.

### NewspaperArchive

NewspaperArchive shares [Storied’s credentials and session](#storied). Sign in once with `fam storied.session login`, then run `fam newspaperarchive.newspaper search --last-name Lincoln --limit 10`. See the [NewspaperArchive guide](docs/newspaperarchive/README.md) for dates, locations, publications, and OCR.

### Newspapers.com

Save credentials for browser sign-in, or use your configured credential helper:

```sh
fam newspapers.credential set
fam newspapers.session login
fam newspapers.session verify
```

Complete any verification in the browser viewer. See the [Newspapers.com guide](docs/newspapers/README.md) for account setup, newspaper search, clippings, and OCR.

### Storied

Run `fam storied.session login` with configured credentials, then `fam storied.session verify`. Use `fam storied.session login --interactive` for social login or account verification. See the [Storied guide](docs/storied/README.md) for browser setup, trees, pedigrees, stories, media, historical search, and its API catalog.

NewspaperArchive shares this sign-in.

## Research examples

```sh
fam familysearch.person get --person-id PERSON_ID
fam familysearch.person ancestry --person-id PERSON_ID --depth 3
fam familysearch.image download --ark IMAGE_ARK --original --out scan.jpg

fam americanancestors.collection list --filter Massachusetts
fam americanancestors.record search --last-name Adams --collection "Massachusetts: Vital Records, 1620-1850"
fam americanancestors.record export --last-name Adams --details --limit 10 --out research.json

fam ancestry.record search --first-name Abraham --last-name Lincoln --birth-year 1809

fam findagrave.memorial search --anonymous --first-name Abraham --last-name Lincoln --birth-year 1809

fam findmypast.record search --first-name Ada --last-name Lovelace --birth-year 1815
fam findmypast.newspaper search --name "Ada Lovelace" --country England

fam myheritage.record search --first-name Abraham --last-name Lincoln --birth-year 1809
fam myheritage.collection search --name census
```

Replace `PERSON_ID` and `IMAGE_ARK` with IDs from the service. Run `fam --help`, `fam cli.command list --provider PROVIDER`, or append `--help` to a command. Commands print readable text by default, including when piped. Add `--json` for machine-readable results and errors; use `--out FILE` to save results or downloads. Keep personal data outside Git.

The `call` and `gql` commands can execute writes and deletions. Check the operation's schema before running it.

## Check provider access

Check your setup and diagnose provider failures:

```sh
fam cli.health check
fam doctor                             # Alias for fam cli.health check --live
fam doctor --no-pretty                  # Plain report without animation or colors
fam doctor --no-fix                     # Check online without session repairs or saves
fam cli.health check --verbose
fam cli.health check --offline
fam cli.health check --provider ancestry --provider findmypast --json
```

Health checks verify access and try to renew expired sessions or sign in when needed. Use `--no-fix` to check without session changes, `--offline` to inspect local setup, or `--verbose` for details. Terminal output shows each provider’s progress; use `--no-pretty` for a plain report. See [health checks and recovery](docs/doctor.md) for coverage and exit codes.

## Review command history

Review past commands, investigate failures, and inspect activity over time:

```sh
fam cli.history list
fam cli.history.failures list --since 7d
fam cli.history get --id <ID_FROM_LIST>
fam cli.history stats --since 7d
fam cli.history archive --failures --provider ancestry --code AUTH_RETRY
```

History records complete commands, arguments, diagnostics, and consumed inputs without redaction in the active profile. Use `--limit 0` for all matches, filters such as `--provider` and `--since` to narrow results, and `get --id` for full diagnostics. Archiving hides entries while retaining their evidence; use `--include-archived` to view them. See [command history](docs/cli.md#command-history) for filtering, statistics, storage, and disabling recording.

## Configuration

Credentials and sessions live in `~/.config/fam` on macOS and Linux, or `%APPDATA%\fam` on Windows. On macOS and Linux, `XDG_CONFIG_HOME` overrides `~/.config`. Each service keeps its own files. Run `fam PROVIDER.session get` to see its storage directory and session status.

Passwords and tokens are plaintext files. The CLI restricts file permissions on macOS and Linux; Windows uses your user profile's permissions.

For scripts, set both environment variables for the service:

| Service | Username | Password |
| --- | --- | --- |
| FamilySearch | `FAMILYSEARCH_USERNAME` | `FAMILYSEARCH_PASSWORD` |
| American Ancestors | `AMERICANANCESTORS_USERNAME` | `AMERICANANCESTORS_PASSWORD` |
| Ancestry | `ANCESTRY_USERNAME` | `ANCESTRY_PASSWORD` |
| Find a Grave | `FINDAGRAVE_USERNAME` | `FINDAGRAVE_PASSWORD` |
| Findmypast | `FINDMYPAST_USERNAME` | `FINDMYPAST_PASSWORD` |
| Geneanet | `GENEANET_USERNAME` | `GENEANET_PASSWORD` |
| MyHeritage | `MYHERITAGE_USERNAME` | `MYHERITAGE_PASSWORD` |
| NewspaperArchive | `STORIED_USERNAME` | `STORIED_PASSWORD` |
| Newspapers.com | `NEWSPAPERS_USERNAME` | `NEWSPAPERS_PASSWORD` |
| Storied | `STORIED_USERNAME` | `STORIED_PASSWORD` |

Environment credentials take precedence over a configured credential helper, then saved passwords. Existing sessions remain active until a new login is needed or you run `fam PROVIDER.session login`. The CLI does not load `.env` files.

To use a password manager or another external source, configure `credentialsCommand` in the profile's `config.json`, or set `FAM_CREDENTIALS_COMMAND` to a JSON array of executable and arguments. The helper receives the provider name and returns a JSON object with `username` and `password`. See the [credential helper contract](docs/setup.md#external-credential-helpers).

See [setup details](docs/setup.md) for separate profiles, JSON credential input, and resetting a session.

## Development

From the checkout, run:

```sh
npm run check
```

The checks need Python 3 as well as Node.js. They run type checks, code generation checks, mocked tests, and a build. They do not use your service accounts.

See [development notes](docs/development.md) for running from source, regenerating contracts, and live verification.

The provider guides link to API contracts and protocol evidence; see [contract conventions](docs/development.md#provider-api-contracts) and the [FamilySearch TypeScript API](docs/familysearch/typescript.md).

## Uninstall

```sh
npm uninstall --global @potatosalad/fam
```

This removes the `fam` executable. Your credentials and saved research remain on disk.
