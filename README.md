# fam

One command-line tool for FamilySearch, Ancestry, MyHeritage, Findmypast, Find a Grave, Geneanet, Storied, NewspaperArchive, and American Ancestors. Browse family trees, search historical records and memorials, and download original documents.

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
| `americanancestors` | [Native sign-in, records, citations, scans, volume browsing, and exports](docs/americanancestors/README.md) |

`fam --help` lists every provider. Use `fam myheritage` or `fam americanancestors` to browse that provider's objects and find its installed guide. The guides link to API contracts and protocol evidence; [development notes](docs/development.md#provider-api-contracts) explain website versus mobile catalogs.

## Find and run commands

```sh
fam cli.command search --query "download an original image"
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

This installs one executable, `fam`, from the checkout. Keep the directory in place. To update, run `git pull`, `npm ci`, and `npm install --global .` in it. Provider commands use `fam PROVIDER.OBJECT ACTION --flags`; `fam cli.health check` checks provider health.

`fam cli.completion install` enables TAB completion for bash or zsh. Open a new shell afterward; for the current shell, run `eval "$(fam --completions zsh)"` (use `bash` in bash). It completes providers, commands, options, and file paths. See [completion setup](docs/setup.md#shell-completion) for details.

Upgrading an older installation? See [migration from familysearch](docs/setup.md#migration-from-familysearch) to remove the old executables and retain saved sessions.

If installation fails or your shell can't find the commands, see [installation help](docs/setup.md#installation).

## Set up the browser

```sh
fam browser setup --local
```

This starts persistent Camofox in Docker with a passwordless localhost viewer. On macOS, fam offers to install OrbStack when needed. For an existing server, use `fam browser setup --remote URL --vnc-url VIEWER_URL`. Switch with `fam browser use local` or `fam browser use remote`; each retains its logins. See [browser setup](docs/browser.md) for remote API keys, custom viewer URLs, start/stop, and timeouts.

Browser sign-ins reuse cookies and try configured credentials when needed. fam opens or prints the viewer URL for MFA or CAPTCHA and waits for completion. All provider HTTP clients automatically recover evidenced Cloudflare challenges through the browser and remember the website until `fam cli.browser.transport reset`. Use `fam cli.browser reset --provider myheritage` to clear that provider's browser site data, or `fam cli.browser reset --all` to reset all fam-managed browser sessions. See [reset scope and backups](docs/browser.md#reset-browser-sessions).

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

fam validates the account through Camofox and retains the login. Use `fam findmypast.session login --region co.uk` for the UK website, or `--interactive` to autofill credentials and submit the form yourself. Add `--no-autofill` to leave login fields untouched. See [browser setup](docs/browser.md).

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

Check your setup and diagnose provider failures:

```sh
fam cli.health check
fam cli.health check --verbose
fam cli.health check --offline
fam cli.health check --provider ancestry --provider findmypast --json
```

Health checks verify saved sessions online, renew them automatically when needed, and print one row per provider with recovery steps. Add `--json` for a structured report. Provider commands also renew existing sessions automatically; a manual `session login` is only needed when renewal is unavailable or rejected. `--offline` inspects local files without requests or changes, and `--verbose` shows details. Password-login cooldowns do not mark working browser sessions as blocked. Doctor never submits passwords or runs searches. See [doctor checks and recovery](docs/doctor.md) for coverage and exit codes.

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
