# FamilySearch CLI

TypeScript clients and three command-line tools for genealogy research:

| Command | Service | Capabilities |
| --- | --- | --- |
| `familysearch` | FamilySearch | People, pedigrees, sources, memories, historical images, full-text search, and 212 typed genealogy operations |
| `ancestry` | Ancestry | Trees, relatives, hints, citations, record search, and REST/GraphQL catalogs |
| `myheritage` | MyHeritage | Tree browsing, historical records, collections, original documents, and REST/GraphQL catalogs |

This is an unofficial integration based on mobile and website protocols. Access depends on your account, subscriptions, and the service. FamilySearch currently supports **Church Account sign-in only**. MyHeritage's browser-session import is the practical starting point; its native password flow can require reCAPTCHA. See the authentication instructions below before installing for a particular service.

## Install

Requires **Node.js 22.16 or newer**, npm, and Git. Python and Android tools are not needed to install or run the CLIs. Native HTTP/image dependencies are installed by npm; keep optional dependencies enabled.

```sh
git clone https://github.com/potatosalad/familysearch.git
cd familysearch
npm ci
npm pack
npm install --global ./potatosalad-familysearch-0.1.0.tgz

familysearch --help
ancestry --help
myheritage --help
```

`npm ci` and `npm pack` build the TypeScript automatically. The archive installs all three commands and their runtime dependencies, so the installed commands work from any directory and do not depend on keeping this checkout. Use the filename printed by `npm pack` when installing a later version. Nothing needs an SSH host, a secrets CLI, an APK, or a preexisting session.

If a command is missing from PATH, run `npm prefix --global`: add its `bin` subdirectory on macOS/Linux, or the prefix itself on Windows. Use a user-owned Node installation or npm prefix if global installation reports a permissions error.

To keep a second installation separate (for example, alongside an internal CLI), use its own prefix and invoke the resulting executable by absolute path:

```sh
npm install --global --prefix "$HOME/.local/share/familysearch-public" ./potatosalad-familysearch-0.1.0.tgz
"$HOME/.local/share/familysearch-public/bin/familysearch" --help
```

These path examples use a POSIX shell; on Windows, use an absolute Windows prefix and its `familysearch.cmd`, `ancestry.cmd`, or `myheritage.cmd` wrapper. You can also run directly from the checkout without installing commands:

```sh
npm run fs -- --help
npm run ancestry -- --help
npm run myheritage -- --help
```

## Set up credentials

Configure only the services you use. Each has its own login and session. The `credentials` command prompts for a username and a hidden password, saves them locally, and makes no network request. Run `auth` afterward to sign in. Replacing saved login details does not replace an existing session until you run `auth`.

### FamilySearch

Use your **Church Account** username and password, associated with your FamilySearch account. Direct FamilySearch username, Google, Apple, and Facebook sign-in are not implemented.

```sh
familysearch credentials
familysearch auth
familysearch status
familysearch whoami
```

`status` reads local metadata and shows the credential directory without printing tokens. `whoami` makes an authenticated request and returns your tree `personId`. If sign-in needs an additional factor, password reset, or enrollment, complete it through the normal website; this CLI does not implement those steps.

### Ancestry

```sh
ancestry credentials
ancestry auth
```

If Ancestry reports pending email verification, explicitly request and submit the code:

```sh
ancestry auth --send-code
ancestry auth --code 123456
ancestry trees
```

Replace `123456` with the code you receive. Other verification methods and mandatory password changes need completion through Ancestry. More examples: [Ancestry guide](docs/ancestry/README.md).

### MyHeritage

Import a successful session from your own browser:

1. Sign in to MyHeritage in a browser and open Developer Tools → Network.
2. With network recording active, load or reload your family-tree page and open a person's details. Keep successful API requests in the log.
3. Export a HAR **including sensitive data** so the needed cookies and authorization are retained. Store it in a private directory outside Git.
4. Import the file, then check the account:

```sh
myheritage auth --har /absolute/path/to/session.har
myheritage status
myheritage me
```

The importer validates the session before saving it. If the HAR has no usable session, capture tree/person API requests again; sanitized HARs usually omit the credentials it needs. Delete the exported HAR after successful import. It can contain personal data and credentials for other requests; the CLI saves only the extracted MyHeritage session.

Browser sessions support tree browsing and historical-record research. They do not authorize every native catalog operation or a complete tree export. Expired cookies or HTTP 406 verification challenges require completing website verification and importing a fresh HAR.

Native password login is also available, but can be blocked by reCAPTCHA and is not fully verified:

```sh
myheritage credentials
myheritage auth
```

See [MyHeritage authentication and limits](docs/myheritage/README.md) for native MFA options and session coverage.

### Environment variables and automation

API commands look up login details in this order: a complete environment pair, then the saved login file. They never prompt or run external commands automatically. Existing valid sessions are reused; environment changes take effect when a login is needed or you explicitly run `auth`.

| CLI | Username variable | Password variable |
| --- | --- | --- |
| `familysearch` | `FAMILYSEARCH_USERNAME` | `FAMILYSEARCH_PASSWORD` |
| `ancestry` | `ANCESTRY_USERNAME` | `ANCESTRY_PASSWORD` |
| `myheritage` | `MYHERITAGE_USERNAME` | `MYHERITAGE_PASSWORD` |

Set both variables using your shell, CI secret settings, or password manager. A partial or empty pair is an error. Environment-only login does not save the password, but does save session tokens. Running `credentials` with an environment pair explicitly saves those login details. `.env` files are **not** loaded automatically.

For noninteractive setup, pipe a JSON object with string `username` and `password` fields to any CLI's `credentials --stdin` command. Input is read literally, without trimming the password or passing it as an argument:

```sh
familysearch credentials --stdin < /private/path/login.json
ancestry credentials --stdin < /private/path/ancestry-login.json
myheritage credentials --stdin < /private/path/myheritage-login.json
```

Keep the input file private; malformed input errors and successful setup output never echo credentials. `--stdin` takes precedence over environment variables.

### Storage and separate profiles

All three tools share a configuration root, with separate service files:

| Setting | Directory |
| --- | --- |
| Explicit override | Absolute path in `FAMILYSEARCH_CONFIG_DIR` |
| macOS/Linux | `$XDG_CONFIG_HOME/familysearch`, or `~/.config/familysearch` |
| Windows | `%APPDATA%\familysearch`, or `~/.config/familysearch` |

FamilySearch stores `login.json` and `session.json` in the root. Ancestry uses `ancestry/`; MyHeritage uses `myheritage/`. Tokens, cookies, device information, and pending authentication state stay here. `status` shows the resolved directory. Credentials are plaintext files, protected on POSIX systems by `0700` directories and `0600` files; Windows access is governed by your user profile's ACLs. Updates use atomic replacement.

Set the override **before every command** (or export it for the shell) to keep accounts or installations isolated:

```sh
export FAMILYSEARCH_CONFIG_DIR="$HOME/.config/familysearch-public"
familysearch credentials
familysearch auth
```

No credentials are imported from an older checkout's `.credentials/` directory. To reset local authentication, remove the relevant service's `session.json` from the directory reported by `status`, then run `auth`. Removing the login file too forgets the saved password. Run one process per profile when renewing sessions; cross-process refresh locking is not implemented.

## Use the commands

```sh
familysearch person XXXX-XXX
familysearch ancestry XXXX-XXX 3
familysearch ops persons
familysearch schema persons.get --example
familysearch call persons.get --input person-query.json
familysearch image info IMAGE_ARK
familysearch image download IMAGE_ARK --original --out scan.jpg
familysearch fulltext search --name Smith --dgs DGS_NUMBER

ancestry trees
ancestry person TREE_ID PERSON_ID
ancestry search --given Abraham --surname Lincoln --birth-year 1809

myheritage me
myheritage people TREE_ID --limit 20
myheritage search --first-name Abraham --last-name Lincoln --birth-year 1809
myheritage collections census
```

Replace uppercase IDs with real values. Use `--help` on each command for the full reference. Output is JSON by default; `--out FILE` saves it privately. Image downloads also save citation/provenance JSON and refuse overwrites. Create output directories first and keep personal exports outside Git. `ops`, `schema`, and `--help` work without credentials.

Catalog `call`/`gql` commands execute the operation you select, including writes and deletions. Inspect the schema first. HTTP permission errors do not trigger login loops, and ambiguous failed mutations are not automatically replayed. MyHeritage record search itself may update recent-search history.

- [FamilySearch operation reference](docs/operations.md) and [coverage](docs/coverage.md)
- [FamilySearch images, film navigation, full-text search, transcripts](docs/document-research.md)
- [Ancestry usage and catalog](docs/ancestry/README.md)
- [MyHeritage usage](docs/myheritage/README.md) and [historical-record research](docs/myheritage/research.md)
- [TypeScript SDK usage](docs/typescript.md), with exports at `@potatosalad/familysearch`, `@potatosalad/familysearch/ancestry`, and `@potatosalad/familysearch/myheritage`

## Update and uninstall

Pull the latest source, run `npm ci` and `npm pack`, then install the new archive using the same prefix as before. Credentials persist independently of the installed package.

```sh
npm uninstall --global @potatosalad/familysearch
```

For an isolated installation, include the same `--prefix` used during installation. Uninstalling leaves your configuration directory and research outputs in place; remove those separately if you want to erase them.

## Development

Requires Node.js 22.16+, npm, and Python 3 for deterministic code generation:

```sh
npm ci
npm run check
```

This runs type checks, generated-file checks, mocked tests, and a build. Tests use disposable configuration directories, remove inherited login variables, and need no service account. CI runs these checks on Linux, macOS, and Windows with Node 22 and 24. Use `npm pack --dry-run` to inspect the installable contents.

Edit checked-in contracts under `docs/`, then run `npm run generate` (FamilySearch) and `npm run generate:catalogs` (Ancestry/MyHeritage). No APK or decompiler is needed for regeneration. Optional extraction scripts need the ignored APK/disassembly artifacts described in the provider protocol notes; `check:ancestry` and `check:myheritage` compare against those artifacts and are not part of normal CI.

Live verification is separate and requires your own configured account: `npm run verify:genealogy`, `npm run verify:research`, `npm run verify:ancestry`, `npm run verify:myheritage`, or `npm run verify:myheritage:research`. Account reports are saved in the private configuration directory; document checks put downloads in ignored `artifacts/` and print a summary. These checks contact the services and are never run by `npm test` or CI. Historical internal deployment reports and credentials are not included in this repository.
