# fam

One command-line tool for FamilySearch, Ancestry, MyHeritage, Findmypast, Find a Grave, Geneanet, and Storied. Browse family trees, search historical records and memorials, and download original documents.

These are unofficial clients. They use mobile and website APIs that can change without notice. Access depends on your account and subscriptions.

## Install

Requires Node.js 22.16 or newer, npm, and Git.

```sh
git clone https://github.com/potatosalad/fam.git
cd fam
npm ci
npm install --global .
fam completion install
```

This installs one executable, `fam`, from the checkout. Keep the directory in place. To update, run `git pull`, `npm ci`, and `npm install --global .` in it. Provider commands use `fam PROVIDER COMMAND`.

`fam completion install` enables TAB completion for bash or zsh. Open a new shell afterward; for the current shell, run `eval "$(fam completion zsh)"` (use `bash` in bash). It completes providers, commands, options, and file paths. See [completion setup](docs/setup.md#shell-completion) for details.

Upgrading an older installation? See [migration from familysearch](docs/setup.md#migration-from-familysearch) to remove the old executables and retain saved sessions.

If installation fails or your shell can't find the commands, see [installation help](docs/setup.md#installation).

## Set up credentials

Storied uses Auth0 browser sign-in with PKCE and renewable native tokens. Run `fam storied auth` with configured credentials, then `fam storied verify`. Use `fam storied auth --interactive` for social login or account verification. See the [Storied guide](docs/storied/README.md) for browser setup, trees, pedigrees, stories, media, historical search, and its API catalog.

Set up the services you use. `fam PROVIDER credentials` saves login details from environment variables or a configured helper; otherwise, it prompts for your username and hides the password as you type. `fam PROVIDER auth` signs in. Browser-session imports do not require saving a password.

To use a credential helper for all providers, configure `credentialsCommand` once in `~/.config/fam/config.json`. See [persistent credential-helper setup](docs/setup.md#external-credential-helpers). With a helper configured, password-based sign-in can use `fam PROVIDER auth` directly.

### FamilySearch

Use the Church Account linked to your FamilySearch account. Direct FamilySearch username, Google, Apple, and Facebook sign-in are not supported.

```sh
fam familysearch credentials
fam familysearch auth
fam familysearch whoami
```

`whoami` returns your account details, including your tree person ID. If sign-in requires a password reset or additional verification, complete it on the website before retrying.

### Ancestry

```sh
fam ancestry credentials
fam ancestry auth
```

If Ancestry asks for email verification, request a code and enter the one you receive:

```sh
fam ancestry auth --send-code
fam ancestry auth --code 123456
```

Then run `fam ancestry trees` to list your trees.

### MyHeritage

Start by importing a browser session. Native password login can be blocked by reCAPTCHA.

1. Sign in to MyHeritage and open your browser's Developer Tools, then the Network tab.
2. Reload your family tree and open a person's details so the browser records API requests.
3. Export the network log as a HAR file including sensitive data. Save it outside Git.
4. Import it:

```sh
fam myheritage auth --har /path/to/session.har
fam myheritage me
```

Delete the HAR after importing it. It contains session credentials. If MyHeritage later asks for website verification, complete it in the browser and import a fresh HAR.

Browser sessions support tree browsing and historical-record research. See the [MyHeritage guide](docs/myheritage/README.md) for native login and other limitations.

### Findmypast

Import a browser session:

1. Sign in at Findmypast on `.com` or `.co.uk` and open Developer Tools, then the Network tab.
2. Load the family-tree page. Check that the log includes a successful `/titan/marshal/graphql` request.
3. Export a HAR including sensitive data and save it outside Git.
4. Import it:

```sh
fam findmypast auth --har /path/to/session.har
fam findmypast me
```

Delete the HAR after importing it. It contains session credentials. Import a fresh HAR when the session expires; browser import does not require saving your password.

See the [Findmypast guide](docs/findmypast/README.md) for native login, record and newspaper searches, and image downloads.

### Find a Grave

Use your Find a Grave email address when prompted for a username:

```sh
fam findagrave credentials
fam findagrave auth
fam findagrave me
```

Run `fam findagrave verify` to check a saved session, or `auth` to sign in again when it expires. Public searches also work with `--anonymous`, without credentials.

See the [Find a Grave guide](docs/findagrave/README.md) for memorials, cemeteries, biography search, and photo downloads.

### Geneanet

```sh
fam geneanet credentials
fam geneanet auth
fam geneanet verify
fam geneanet search --last-name Lincoln --first-name Abraham
fam geneanet photos --last-name Lincoln --first-name Abraham
```

Geneanet uses a web password session and JSON media APIs. The [Geneanet guide](docs/geneanet/README.md) covers archival transcriptions, collections, portraits, register images, and library PDF pages, including browser-challenge and subscription limits.

## Use the commands

Check your setup and diagnose provider failures:

```sh
fam doctor
fam doctor --verbose
fam doctor --offline
fam doctor ancestry findmypast --json
```

Doctor verifies saved sessions online, renews them automatically when needed, and shows one row per provider with the next step for issues. `--offline` inspects local files without requests or changes, and `--verbose` shows details. Password-login cooldowns do not mark working browser sessions as blocked. Doctor never submits passwords or runs searches. See [doctor checks and recovery](docs/doctor.md) for coverage and exit codes.

```sh
fam familysearch person PERSON_ID
fam familysearch ancestry PERSON_ID 3
fam familysearch image download IMAGE_ARK --original --out scan.jpg

fam ancestry search --given Abraham --surname Lincoln --birth-year 1809

fam myheritage search --first-name Abraham --last-name Lincoln --birth-year 1809
fam myheritage collections census

fam findmypast search --first-name Ada --last-name Lovelace --birth-year 1815
fam findmypast newspapers --name "Ada Lovelace" --country England

fam findagrave --anonymous search --first-name Abraham --last-name Lincoln --birth-year 1809
```

Replace `PERSON_ID` and `IMAGE_ARK` with IDs from the service. Run `fam --help` or `fam PROVIDER --help`. Commands print JSON by default; use `--out FILE` to save results. Keep personal data outside Git.

The `call` and `gql` commands can execute writes and deletions. Check the operation's schema before running it.

- [FamilySearch guide](docs/familysearch/README.md)
- [FamilySearch operations](docs/familysearch/operations.md) and [coverage](docs/familysearch/coverage.md)
- [FamilySearch images, films, full-text search, and transcripts](docs/familysearch/document-research.md)
- [Ancestry commands](docs/ancestry/README.md)
- [MyHeritage record research](docs/myheritage/research.md)
- [Findmypast commands](docs/findmypast/README.md)
- [Find a Grave commands](docs/findagrave/README.md)
- [Geneanet commands and document downloads](docs/geneanet/README.md)
- [FamilySearch TypeScript API](docs/familysearch/typescript.md)

## Configuration

Credentials and sessions live in `~/.config/fam` on macOS and Linux, or `%APPDATA%\fam` on Windows. On macOS and Linux, `XDG_CONFIG_HOME` overrides `~/.config`. Each service keeps its own files. Run `fam PROVIDER status` to see its storage directory and session status.

Passwords and tokens are plaintext files. The CLI restricts file permissions on macOS and Linux; Windows uses your user profile's permissions.

For scripts, set both environment variables for the service:

| Service | Username | Password |
| --- | --- | --- |
| FamilySearch | `FAMILYSEARCH_USERNAME` | `FAMILYSEARCH_PASSWORD` |
| Ancestry | `ANCESTRY_USERNAME` | `ANCESTRY_PASSWORD` |
| MyHeritage | `MYHERITAGE_USERNAME` | `MYHERITAGE_PASSWORD` |
| Findmypast | `FINDMYPAST_USERNAME` | `FINDMYPAST_PASSWORD` |
| Find a Grave | `FINDAGRAVE_USERNAME` (email) | `FINDAGRAVE_PASSWORD` |
| Geneanet | `GENEANET_USERNAME` (username or email) | `GENEANET_PASSWORD` |

Environment credentials take precedence over a configured credential helper, then saved passwords. Existing sessions remain active until a new login is needed or you run `auth`. The CLI does not load `.env` files.

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
