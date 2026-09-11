# fam

One command-line tool for FamilySearch, Ancestry, MyHeritage, Findmypast, Find a Grave, Geneanet, Storied, NewspaperArchive, American Ancestors, Cyndi’s List, and the Wayback Machine. Browse family trees, search historical records and memorials, and download original documents or archived web pages.

These are unofficial clients. They use mobile and website APIs that can change without notice. Access depends on your account and subscriptions.

## Providers

| Provider | Research and API guide |
| --- | --- |
| `familysearch` | [Family trees, records, images, and transcripts](docs/familysearch/README.md) |
| `ancestry` | [Trees, historical records, hints, and media](docs/ancestry/README.md) |
| `myheritage` | [Browser sign-in, trees, record search, and documents](docs/myheritage/README.md) |
| `findmypast` | [Historical records, newspapers, and scans](docs/findmypast/README.md) |
| `findagrave` | [Memorials, cemeteries, biographies, and photos](docs/findagrave/README.md) |
| `geneanet` | [Archival records, trees, portraits, and registers](docs/geneanet/README.md) |
| `storied` | [Trees, stories, media, and historical records](docs/storied/README.md) |
| `newspaperarchive` | [Newspaper search and OCR; shares Storied sign-in](docs/newspaperarchive/README.md) |
| `cyndislist` | [Genealogy resource categories, page reading, and site search](docs/cyndislist/README.md) |
| `americanancestors` | [Native sign-in, records, citations, scans, volume browsing, and exports](docs/americanancestors/README.md) |
| `wayback` | [Find snapshots and fetch archived web pages from the Internet Archive](docs/wayback/README.md) |

`fam --help` lists every provider. Use `fam myheritage` or `fam americanancestors` to browse that provider's objects and find its installed guide. The guides link to API contracts and protocol evidence; [development notes](docs/development.md#provider-api-contracts) explain website versus mobile catalogs.

## Find and run commands

Command search retrieves candidates with 20% BM25 and 80% local Arctic embeddings, then uses MiniLM to rerank the top 100 automatically. The small models download on first search (about 48 MB total) and then work offline. No API key or service is needed. Use `--no-rerank` to compare the original BM25 + Arctic ranking, or `--lexical` to skip both models. See [search options and caching](docs/cli.md).

```sh
fam cli.command search --query "download an original image"
fam cli.command search --query "merge duplicate people" --format tree
fam cli.command describe --command "familysearch.image download"
fam ancestry.person get --tree-id TREE --person-id PERSON
fam ancestry.api.gql query --operation GetTreeList --variables '{"limit":20}'
```

Commands use `fam PROVIDER.OBJECT ACTION --flags`. Discovery, help, and completion come from one registry. Search is local; output is readable text by default. Add `--json` for structured output. See the [command contract](docs/cli.md) and [migration mapping](docs/cli-migration.md).

Explore a provider with `fam ancestry`, or its actions with `fam ancestry.person --help`. Command descriptions show metadata, options, and examples; misspelled commands show available choices and suggested invocations.

## Install

Requires Node.js 22.16 or newer, npm, and Git.

```sh
git clone https://github.com/potatosalad/fam.git
cd fam
npm ci
npm install --global .
fam cli.completion install
```

This installs one executable, `fam`, from the checkout. Keep the directory in place. Run `fam cli.update` from any directory to pull its Git upstream and reinstall, or update from npm if installed as an npm package. `fam cli.update run --dry-run` previews the selected installation and commands. Builds automatically remove unused build folders while retaining versions used by running commands. See [update details](docs/setup.md#updates). Provider commands use `fam PROVIDER.OBJECT ACTION --flags`; `fam cli.health check` checks provider health.

Run `fam --version` to see the running version and Git revision, whether it comes from a Git checkout or npm, and the installation and active build paths. `fam --version --json` returns the same information as structured data.

`fam cli.completion install` enables TAB completion for bash or zsh. Open a new shell afterward; for the current shell, run `eval "$(fam --completions zsh)"` (use `bash` in bash). It completes providers, commands, options, and file paths. Try `fam myheritage.record search <TAB>` to discover search flags without typing `--` first. See [completion setup](docs/setup.md#shell-completion) for details.

Upgrading an older installation? See [migration from familysearch](docs/setup.md#migration-from-familysearch) to remove the old executables and retain saved sessions.

If installation fails or your shell can't find the commands, see [installation help](docs/setup.md#installation).

## Set up the browser

```sh
fam cli.browser setup --local
```

This starts persistent CloakBrowser in Docker with a passwordless localhost viewer. Switch engines with `fam cli.browser use --engine camofox` or `--engine cloakbrowser`; engine changes clear browser sessions at that location. On macOS, fam offers to install OrbStack when needed. For an existing server, use `fam cli.browser setup --remote URL --vnc-url VIEWER_URL`. Switch with `fam cli.browser use --mode local` or `fam cli.browser use --mode remote`; each retains its logins. See [browser setup](docs/browser.md) for remote API keys, custom viewer URLs, start/stop, and timeouts.

Inspect which HTTP/browser transport will start each provider request with `fam cli.browser.transport list --transport auto`. Decisions are per provider and website origin; see [transport inspection](docs/browser.md#automatic-http-recovery) for exact-origin checks.

Browser sign-ins reuse cookies and try configured credentials when needed. fam opens or prints the viewer URL for MFA or CAPTCHA and waits for completion. All provider HTTP clients automatically recover evidenced Cloudflare challenges through the browser and remember the website until `fam cli.browser.transport reset`. Use `fam cli.browser reset --provider myheritage` to clear that provider's browser site data, or `fam cli.browser reset --all` to reset all fam-managed browser sessions. See [reset scope and backups](docs/browser.md#reset-browser-sessions).

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

## Set up credentials

Set up the services you use. `fam PROVIDER.credential set` saves login details from environment variables or a configured helper; otherwise, it prompts for your username and hides the password as you type. `fam PROVIDER.session login` signs in. Browser-session imports do not require saving a password.

To use a credential helper for all providers, configure `credentialsCommand` once in `~/.config/fam/config.json`. See [persistent credential-helper setup](docs/setup.md#external-credential-helpers). With a helper configured, password-based sign-in can use `fam PROVIDER.session login` directly.

### FamilySearch

Use the Church Account linked to your FamilySearch account. Direct FamilySearch username, Google, Apple, and Facebook sign-in are not supported.

```sh
fam familysearch.credential set
fam familysearch.session login
fam familysearch.account get
```

`familysearch.account get` returns your account details, including your tree person ID. If sign-in requires a password reset or additional verification, complete it on the website before retrying.

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

### MyHeritage

Save credentials for browser autofill, then sign in through the configured browser. If the browser is already signed in or you use a configured credential helper, skip `credential set`:

```sh
fam myheritage.credential set
fam myheritage.session login
fam myheritage.account get
```

fam reuses the browser login, validates account access, and saves its session for the selected instance. Use the viewer URL if verification is required. `--capture` remains an alias; existing HAR imports remain supported. See [browser setup](docs/browser.md).

Browser sessions support tree browsing and historical-record research. See the [MyHeritage guide](docs/myheritage/README.md) for native login and other limitations.

### Findmypast

Sign in through the configured browser:

```sh
fam findmypast.session login
fam findmypast.account get
```

fam validates the account through the selected browser and retains the login. Use `fam findmypast.session login --region co.uk` for the UK website, or `--interactive` to autofill credentials and submit the form yourself. Add `--no-autofill` to leave login fields untouched. See [browser setup](docs/browser.md).

See the [Findmypast guide](docs/findmypast/README.md) for native login, record and newspaper searches, and image downloads.

### Find a Grave

Use your Find a Grave email address when prompted for a username:

```sh
fam findagrave.credential set
fam findagrave.session login
fam findagrave.account get
```

Run `fam findagrave.session verify` to check a saved session, or `session login` to sign in again when it expires. Public searches also work with `--anonymous`, without credentials.

See the [Find a Grave guide](docs/findagrave/README.md) for memorials, cemeteries, biography search, and photo downloads.

### Geneanet

```sh
fam geneanet.credential set
fam geneanet.session login
fam geneanet.session verify
fam geneanet.record search --last-name Lincoln --first-name Abraham
fam geneanet.photo search --last-name Lincoln --first-name Abraham
```

Geneanet uses a web password session and JSON media APIs. The [Geneanet guide](docs/geneanet/README.md) covers archival transcriptions, collections, portraits, register images, and library PDF pages, including browser-challenge and subscription limits.

### Storied and NewspaperArchive

Storied uses Auth0 browser sign-in with PKCE and renewable native tokens. Run `fam storied.session login` with configured credentials, then `fam storied.session verify`. Use `fam storied.session login --interactive` for social login or account verification. See the [Storied guide](docs/storied/README.md) for browser setup, trees, pedigrees, stories, media, historical search, and its API catalog.

NewspaperArchive uses the same credentials and session. After Storied sign-in, run `fam newspaperarchive.newspaper search --last-name Lincoln --limit 10`. See the [NewspaperArchive guide](docs/newspaperarchive/README.md) for dates, locations, publications, and OCR.

### American Ancestors

Use your American Ancestors website username and password:

```sh
fam americanancestors.credential set
fam americanancestors.session login
fam americanancestors.session verify
```

Native HTTP handles sign-in and research; browser setup is not required for the verified flow. A configured credential helper or environment pair lets you skip `credential set`. Login submits once and saves the verified session; subsequent reads reuse it. Membership restrictions still apply. See the [American Ancestors guide](docs/americanancestors/README.md) for collection fields, relatives, scans, volume browsing, and resumable exports.

## Use the commands

Every CLI invocation also appends private JSONL history to `<profile>/history/YYYY-MM-DD.jsonl` (normally `~/.config/fam/history/`). History distinguishes hard failures from returned warnings, embedded errors, and recovered failures. It records complete argument values, the working directory, timing, exit codes, diagnostic text and build revision without redaction. Consumed file and stdin inputs are saved as exact byte snapshots for reproduction. See [searching command history](docs/cli.md#command-history) for queries, coverage, and disabling history.

```sh
fam cli.history list
fam cli.history list --limit 0
fam cli.history.failures list --since 7d
fam cli.history.failures summary --group-by code
fam cli.history stats --since 7d
fam cli.history stats --since 30d --interval day --group-by provider --metric failure-rate
fam cli.history stats --since 7d --format table
fam cli.history stats --since 7d --json
fam cli.history get --id <ID_FROM_LIST>
fam cli.history archive --failures --provider ancestry --code AUTH_RETRY
fam cli.history archive --all
fam cli.history list --include-archived
```

History lists show the complete shell-quoted command, including every argument, and support `--json`. Use `--limit 0` for all matches; positive limits have no fixed cap. This also applies to failure lists and summaries. Filter with `--provider`, `--command`, `--outcome`, `--code`, `--query`, `--since`, and `--until`. IDs in the list open full diagnostics with `get`; successful history queries and completion lookups stay hidden unless you add `--include-utility`. `stats` applies the same filters and graphs calls, failures, failure rates, or duration percentiles in UTC time buckets, with optional provider/command/outcome/code/build breakdowns. Use `--format table` or `--json` for numeric output; all matches, groups, and buckets are included. `archive` appends a visibility marker and retains every log and input snapshot. Use `--all` or `--failures` with selection filters, and add `--dry-run` to preview the counts. Archived entries remain available with `--include-archived` or `get --id`.

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

Health checks try saved-session access, token renewal where supported, then normal login, stopping when access is verified. Recovery uses configured credentials or the existing browser and makes at most one refresh and one login attempt per session. Healthy sessions do not trigger login. `--no-fix` checks online without repairs or session saves; `--offline` inspects local files without requests. Use `--verbose` for recovery details or `--json` for a structured report. Login cooldowns remain in force, and required website verification is reported. See [doctor checks and recovery](docs/doctor.md) for coverage and exit codes.

Independent providers check concurrently. Color-capable terminals show all providers immediately with animated progress and success, warning, or failure indicators. `--no-pretty` disables this display; pipes, JSON, output files, CI, and `NO_COLOR` use plain output automatically. Storied and NewspaperArchive take turns because they share a saved session.

```sh
fam familysearch.person get --person-id PERSON_ID
fam familysearch.person ancestry --person-id PERSON_ID --depth 3
fam familysearch.image download --ark IMAGE_ARK --original --out scan.jpg

fam ancestry.record search --first-name Abraham --last-name Lincoln --birth-year 1809

fam myheritage.record search --first-name Abraham --last-name Lincoln --birth-year 1809
fam myheritage.collection search --name census

fam findmypast.record search --first-name Ada --last-name Lovelace --birth-year 1815
fam findmypast.newspaper search --name "Ada Lovelace" --country England

fam findagrave.memorial search --anonymous --first-name Abraham --last-name Lincoln --birth-year 1809

fam americanancestors.collection list --filter Massachusetts
fam americanancestors.record search --last-name Adams --collection "Massachusetts: Vital Records, 1620-1850"
fam americanancestors.record export --last-name Adams --details --limit 10 --out research.json
```

Replace `PERSON_ID` and `IMAGE_ARK` with IDs from the service. Run `fam --help`, `fam cli.command list --provider PROVIDER`, or append `--help` to a command. Commands print readable text by default, including when piped. Add `--json` for machine-readable results and errors; use `--out FILE` to save results or downloads. Keep personal data outside Git.

The `call` and `gql` commands can execute writes and deletions. Check the operation's schema before running it.

- [FamilySearch guide](docs/familysearch/README.md)
- [FamilySearch operations](docs/familysearch/operations.md) and [coverage](docs/familysearch/coverage.md)
- [FamilySearch images, films, full-text search, and transcripts](docs/familysearch/document-research.md)
- [Ancestry commands](docs/ancestry/README.md)
- [MyHeritage setup and API catalog](docs/myheritage/README.md), [record research](docs/myheritage/research.md), and [contracts](docs/myheritage/contracts.json)
- [American Ancestors commands](docs/americanancestors/README.md), [website contracts](docs/americanancestors/contracts.json), and [protocol](docs/americanancestors/protocol.md)
- [Findmypast commands](docs/findmypast/README.md)
- [Find a Grave commands](docs/findagrave/README.md)
- [Geneanet commands and document downloads](docs/geneanet/README.md)
- [FamilySearch TypeScript API](docs/familysearch/typescript.md)

## Configuration

Credentials and sessions live in `~/.config/fam` on macOS and Linux, or `%APPDATA%\fam` on Windows. On macOS and Linux, `XDG_CONFIG_HOME` overrides `~/.config`. Each service keeps its own files. Run `fam PROVIDER.session get` to see its storage directory and session status.

Passwords and tokens are plaintext files. The CLI restricts file permissions on macOS and Linux; Windows uses your user profile's permissions.

For scripts, set both environment variables for the service:

| Service | Username | Password |
| --- | --- | --- |
| FamilySearch | `FAMILYSEARCH_USERNAME` | `FAMILYSEARCH_PASSWORD` |
| Ancestry | `ANCESTRY_USERNAME` | `ANCESTRY_PASSWORD` |
| MyHeritage | `MYHERITAGE_USERNAME` | `MYHERITAGE_PASSWORD` |
| Findmypast | `FINDMYPAST_USERNAME` | `FINDMYPAST_PASSWORD` |
| Find a Grave | `FINDAGRAVE_USERNAME` | `FINDAGRAVE_PASSWORD` |
| Geneanet | `GENEANET_USERNAME` | `GENEANET_PASSWORD` |
| Storied / NewspaperArchive | `STORIED_USERNAME` | `STORIED_PASSWORD` |
| American Ancestors | `AMERICANANCESTORS_USERNAME` | `AMERICANANCESTORS_PASSWORD` |

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

## Uninstall

```sh
npm uninstall --global @potatosalad/fam
```

This removes the `fam` executable. Your credentials and saved research remain on disk.
