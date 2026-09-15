# fam

`fam` is a command-line tool for genealogy research. Search historical records, browse family trees, and download document scans across FamilySearch and 14 other providers. It also searches Internet Archive books and retrieves archived web pages.

The provider clients are unofficial. They use website and mobile APIs that can change without notice. Your account and subscriptions determine which records you can access.

## Install

You need Node.js 22.16 or newer, npm, and Git.

```sh
git clone https://github.com/potatosalad/fam.git
cd fam
npm ci
npm install --global .
fam cli.completion install
```

Keep the checkout in place. The installed `fam` command runs from it. Open a new bash or zsh shell to use TAB completion for commands, flags, and file paths.

Automatic updates are on by default. After a command exits, fam checks for updates in the background at most once every 24 hours. Run `fam cli.update disable` to turn them off, or `fam cli.update run` to update now. `fam cli.version get` shows the installed version and location.

See [setup](docs/setup.md) for PATH problems, update behavior, and migration from an older installation.

## Agent usage

Agents must append `--reasoning "<brief purpose>"` at the very end of every `fam` command, after all other arguments. The parser accepts it anywhere and preserves repeated values in order; putting it last keeps command inputs easy to scan. Values are saved in local command history and searchable with `fam cli.history list --query TEXT`. See [agent command reasoning](docs/cli.md#agent-command-reasoning).

```sh
fam familysearch.image --help --reasoning "Find the options needed to download the source scan."
```

## Try a search

Search the Internet Archive catalog without an account or browser setup:

```sh
fam internetarchive.item search --query 'collection:genealogy AND mediatype:texts'
```

To search the text inside books, use full-text search:

```sh
fam internetarchive.fulltext search --query '"John Smith" AND "Lancaster"' --limit 10
```

Catalog search matches book metadata. Full-text search matches indexed text from scanned pages and returns snippets. Some matching books have restricted downloads. The [Internet Archive guide](docs/internetarchive/README.md) covers searching within a book, page citations, and downloads.

## Providers

Follow a provider link for its commands and access requirements.

| Provider | What you can research |
| --- | --- |
| [`familysearch`](docs/familysearch/README.md) | Family trees, historical records, original images, and full-text search |
| [`americanancestors`](docs/americanancestors/README.md) | Genealogy databases, records, citations, and scans |
| [`ancestry`](docs/ancestry/README.md) | Family trees, historical records, hints, and media |
| [`cyndislist`](docs/cyndislist/README.md) | Genealogy resources by place and topic |
| [`findagrave`](docs/findagrave/README.md) | Memorials, cemeteries, biographies, relatives, and photos |
| [`findmypast`](docs/findmypast/README.md) | Family trees, historical records, newspapers, and images |
| [`fold3`](docs/fold3/README.md) | Military records, publications, memorials, and images |
| [`geneanet`](docs/geneanet/README.md) | Archival records, trees, portraits, registers, and books |
| [`internetarchive`](docs/internetarchive/README.md) | Books, scanned text, collections, citations, and public downloads |
| [`myheritage`](docs/myheritage/README.md) | Family sites, trees, historical records, matches, and documents |
| [`nara`](docs/nara/README.md) | National Archives Catalog records, digital objects, and transcriptions |
| [`newspaperarchive`](docs/newspaperarchive/README.md) | Newspapers, publications, locations, and page text |
| [`newspapers`](docs/newspapers/README.md) | Newspapers, publications, clippings, and page text |
| [`storied`](docs/storied/README.md) | Family trees, stories, media, hints, and historical records |
| [`wayback`](docs/wayback/README.md) | Archived web pages and captures from a chosen date |

## Find a command

Commands use `fam PROVIDER.OBJECT ACTION --flags`:

```sh
fam ancestry.record search --first-name Abraham --last-name Lincoln --birth-year 1809
```

Use help to browse commands, or search for a task in your own words:

```sh
fam --help
fam familysearch.person --help
fam cli.command search --query "download an original image"
fam cli.command describe --command "familysearch.image download"
```

Command search runs on your machine without an API key. It downloads about 95 MB of models on first use, then works offline. Add `--lexical` to skip the models and search by words alone. Search lists commands; it does not run them.

The guides also ship with the CLI:

```sh
fam cli.doc read --provider familysearch
fam cli.doc read --doc setup
fam cli.doc search --query "collection-specific fields"
```

Reading guides works offline and needs no account. See the [command guide](docs/cli.md) for search options, output formats, and scripting.

## Sign in

Set up only the providers you use. Most account-based providers use `credential set` to save login details and `session login` to sign in. Without configured credentials, `credential set` prompts for a username and hides the password as you type.

You can also supply credentials through environment variables or a [credential helper](docs/setup.md#external-credential-helpers). With either configured, you can usually run `session login` without saving a password first. Browser-session imports do not require a saved password.

### FamilySearch

Use the Church Account linked to your FamilySearch account. Direct FamilySearch username, Google, Apple, and Facebook sign-in are not supported.

```sh
fam familysearch.credential set
fam familysearch.session login
fam familysearch.account get
```

The account command returns your tree person ID. If sign-in requires a password reset or additional verification, complete it on the website before retrying.

### Browser sign-in

Providers such as Findmypast and MyHeritage sign in through a persistent browser. Set it up once:

```sh
fam cli.browser setup --local
fam myheritage.credential set
fam myheritage.session login
```

Local setup runs CloakBrowser in Docker. On macOS, fam offers to install OrbStack if needed. If sign-in needs MFA or a CAPTCHA, fam opens or prints a viewer URL and waits for you to complete it. The browser retains your login for later commands.

The [browser guide](docs/browser.md) covers remote servers, browser engines, and session resets. See your provider's guide for its sign-in requirements. NewspaperArchive shares Storied's credentials and session.

Cyndi's List, Internet Archive public research, NARA, and Wayback need no provider credentials. NARA still requires browser setup.

## Research examples

After signing in to FamilySearch, read a person, follow their ancestors, or download an original scan:

```sh
fam familysearch.person get --person-id PERSON_ID
fam familysearch.person ancestry --person-id PERSON_ID --depth 3
fam familysearch.image download --ark IMAGE_ARK --original --out scan.jpg
fam familysearch.record search --last-name Example --birth-year 1850 --birth-year-range 3 --json
```

Replace `PERSON_ID` and `IMAGE_ARK` with identifiers from FamilySearch.

FamilySearch also supports [record collection filters, local write validation, and memory uploads](docs/familysearch/README.md). For example, `fam familysearch.memory upload --file portrait.jpg --visibility private --dry-run --json` previews a file upload; remove `--dry-run` to upload it.

Search public memorials without signing in:

```sh
fam findagrave.memorial search --anonymous --first-name Abraham --last-name Lincoln --birth-year 1809
```

Retrieve a web page from the Wayback Machine near a chosen date:

```sh
fam wayback.page fetch --url https://example.org/page --date 2015-01-01 --format markdown
```

Commands print readable text, including when piped. Add `--json` for structured results and errors, or `--out FILE` to save results and downloads. Providers have different pagination rules; check the returned continuation information before treating a result as complete.

Some commands can change or delete provider data. fam executes them without a confirmation prompt. Inspect an API operation with `fam PROVIDER.api describe --operation NAME` before using it. See [command effects](docs/cli.md#effects) for details.

## Check provider access

```sh
fam cli.health check --provider ancestry
fam cli.health check --provider ancestry --no-fix
fam cli.health check --offline
```

Online checks try to renew expired sessions or sign in when needed. Use `--no-fix` to check without changing sessions, or `--offline` to inspect local setup. Live results are cached for roughly an hour; add `--force` to check again. Omit `--provider` to check every provider. See [health checks](docs/doctor.md) for coverage and exit codes.

## Local data and history

fam stores configuration, credentials, and sessions in `~/.config/fam` on macOS and Linux, or `%APPDATA%\fam` on Windows. On macOS and Linux, `XDG_CONFIG_HOME` overrides `~/.config`. Set `FAM_CONFIG_DIR` to an absolute path for a separate profile.

Passwords and tokens are stored in plaintext. fam restricts file permissions on macOS and Linux; Windows uses your user profile's permissions. See [storage and profiles](docs/setup.md#storage-and-profiles).

Command history records arguments, diagnostics, and consumed file or stdin inputs without redaction. Keep the profile and personal research files out of Git. Set `FAM_HISTORY=0` to disable recording for a process.

```sh
fam cli.history list
fam cli.history.failures list --since 7d
fam cli.history stats --since 7d
```

See [command history](docs/cli.md#command-history) to inspect individual calls, filter results, or archive reviewed entries. Archiving hides entries from normal views and retains the recorded data.

## Development

From the checkout, run the CLI through npm or check the project:

```sh
npm run fam -- familysearch.person --help
npm run check
```

The checks require Python 3 as well as Node.js. They run type checks, generated-file checks, mocked tests, a build, and packaged-documentation checks. They do not use your service accounts.

See [development](docs/development.md) for the source layout and code generation, or [TypeScript library setup](docs/setup.md#typescript-library-use) to use the clients in another project.

## Uninstall

```sh
npm uninstall --global @potatosalad/fam
```

This removes the `fam` executable. Your profile and saved research stay on disk. To remove shell completion, follow the [completion instructions](docs/setup.md#shell-completion).

## License

fam is licensed under the [MIT License](LICENSE.md).
