# Setup details

The [README](../README.md) covers installation and sign-in for each service. See [persistent browser setup](browser.md) for local Docker, remote URLs, and automatic Cloudflare recovery.

## Installation

`npm ci` installs dependencies and builds the TypeScript. `npm install --global .` links `fam` to your checkout, so keep it in place. You do not need to create or install an archive.

If npm reports a permissions error, use a Node installation or npm prefix owned by your user.

If your shell can't find a command, run `npm prefix --global`. Add that directory's `bin` subdirectory to PATH on macOS or Linux. On Windows, add the prefix itself.

### Separate installations

To keep another installation alongside this one, choose a separate npm prefix and invoke `fam` by its full path. Run this from the checkout on macOS or Linux:

```sh
npm install --global --prefix "$HOME/.local/share/fam-alt" .
"$HOME/.local/share/fam-alt/bin/fam" --help
```

On Windows, use an absolute Windows path for the prefix. npm puts the `.cmd` launchers directly in that directory.

`fam cli.update` preserves the running installation; use the same prefix when uninstalling. To keep the credentials separate too, set `FAM_CONFIG_DIR` as described below.

### Updates

```sh
fam cli.update
fam cli.update run --dry-run
fam cli.update run --json
fam --version
fam --version --json
```

`fam cli.update` is shorthand for `fam cli.update run`. It finds the running package independently of your working directory. Help, discovery, history, and completion register `cli.update run`. `--dry-run` inspects the installation and reports the exact commands without pulling or installing; it records command history normally.

`fam --version` is shorthand for `fam cli.version get`. Both report the executing build's version and Git revision, its installation type and path, and its runtime path. Modified builds are labeled. JSON includes the full revision and `dirty` status; `null` means build metadata is unavailable. Each new build saves its package version alongside its revision, so a process pinned to an older build reports that build even after an update. TypeScript source execution is labeled `source` and reads the package version without claiming a compiled revision.

- **Git checkout, including npm links and custom symlinks:** requires a clean working tree, an attached branch, and a configured upstream. Runs `git pull --ff-only --no-rebase --no-autostash`, then `npm ci --include=dev --ignore-scripts=false`. npm's prepare step rebuilds fam; existing executable links automatically use the new build. A failed pull stops before installation. The updater never stashes, resets, or switches branches.
- **Global npm package:** installs `@potatosalad/fam@latest` in the package's existing prefix, including a nondefault prefix.
- **Local npm dependency:** installs the latest release in its owning project, updating that project's manifest and lockfile. Indirect dependencies and unrecognized layouts need to be updated through their owning installer.

Update progress goes to stderr, leaving stdout available for the usual result or JSON envelope. Concurrent updates to an installation are serialized. A failed install is reported; it does not roll back the Git pull or npm's dependency changes. Resolve the reported problem and rerun the update.

Every successful checkout build, including `npm ci` and `npm run build`, removes unused `.fam-build-*` folders. The current build stays, and running CLI commands register their build until they exit. A terminated command's stale record is reclaimed once its process is gone. A later installation removes its now-unused build. Builds with uncertain ownership, unreadable usage records, or processes on another host stay. Older launchers without tracking defer cleanup while they are running. If process inspection is unavailable, cleanup retains snapshots. Use the installed `fam` launcher for tracked execution.

Snapshot retention protects checkout CLI modules. npm package replacement and dependency reinstallation follow npm's normal behavior; they do not snapshot `node_modules` or guarantee that other running commands can load replaced dependencies. Library consumers should restart after updating.

## Shell completion

After installing `fam`, run `fam cli.completion install` once, then open a new shell. It detects bash or zsh from `$SHELL` and adds a marked, guarded hook to your startup files. You can select explicitly with `fam cli.completion install --shell bash` or `fam cli.completion install --shell zsh`.

Bash setup covers `.bashrc` and the first existing login profile (`.bash_profile`, `.bash_login`, or `.profile`; a new `.bash_profile` is created if none exists). Zsh uses `$ZDOTDIR/.zshrc` when set, otherwise `~/.zshrc`, and initializes its completion system if needed. Repeating installation does not duplicate the hooks. It does not require a separate bash-completion package.

For the current shell, or to manage the startup hook yourself:

```sh
eval "$(fam --completions bash)" # bash
# or
eval "$(fam --completions zsh)"  # zsh
```

Try `fam fam<TAB>`, `fam familysearch.image <TAB>`, or `fam myheritage.record search <TAB>`. After an action with no positional argument to complete, TAB on an empty word offers its available flags; typing `--birth-<TAB>` narrows the suggestions. When a flag expects a value, completion offers that value's choices or file paths instead. File arguments such as `--out` support paths containing spaces. Flags are scoped to the selected command; append `--help` for its generated schema and examples. Suggestions come from a catalog generated during the build, without loading credentials or contacting services. Updating fam also updates the suggestions.

To uninstall completion, remove the marked `fam bash completion` or `fam zsh completion` blocks from the files printed by the installer. The installer changes files for the current user; run it as the user who will use the CLI.

## Credential lookup

American Ancestors uses `AMERICANANCESTORS_USERNAME` and `AMERICANANCESTORS_PASSWORD` or the configured helper with the `americanancestors` argument. See its [provider guide](americanancestors/README.md) for native login, collections, record search, and scans.

NewspaperArchive shares Storied authentication: use `STORIED_USERNAME` and `STORIED_PASSWORD`. Its credential helper receives `storied`, and both providers use `storied/login.json` and the selected Storied session. See the [NewspaperArchive guide](newspaperarchive/README.md).

When a login is needed, fam reads its username and password from the environment first, then an explicitly configured credential helper, then its saved login file. A partial or empty environment pair is an error. API commands never prompt for a password.

`fam PROVIDER.credential set` is explicit setup: it uses environment values, then a configured helper, then a hidden interactive prompt. It saves the resulting login details rather than reusing an existing login file. `credentials --stdin` uses only the supplied JSON.

Environment-only login saves session tokens but does not save the password. Running `credentials` with an environment pair saves that username and password. Replacing login details does not switch an active session; run `auth` to sign in with the new account.

### External credential helpers

Configure a helper once in `~/.config/fam/config.json` to use it for every provider and future command. If you use a different [configuration directory](#storage-and-profiles), put `config.json` there instead. Use an absolute path to a trusted helper:

```json
{
  "credentialsCommand": ["node", "/absolute/path/to/credential-helper.mjs"]
}
```

No environment variable is needed for the persistent file setting. `FAM_CREDENTIALS_COMMAND='["node","/absolute/path/to/credential-helper.mjs"]'` is an optional override. fam runs the executable directly, without a shell, appending exactly one argument: `familysearch`, `ancestry`, `myheritage`, `findmypast`, `findagrave`, `geneanet`, `storied`, or `americanancestors`. The working directory is the caller's directory; use absolute paths for helper files. Environment variables are inherited and stdin is closed.

The helper must exit successfully and print only a JSON object with nonempty string `username` and `password` fields. Password whitespace is preserved. Output is limited to 64 KiB and execution to two minutes. Failures suppress command output and stop lookup; fam never silently falls back to an older saved password. Use this hook for a password manager, local executable, or SSH-backed helper. No helper runs unless configured, and help/status commands do not look up passwords.

The helper takes precedence over saved passwords. Normal authentication does not cache its returned password; `fam PROVIDER.credential set` explicitly saves it. `credentials --stdin` bypasses both the helper and environment. Existing sessions are still reused until `auth` or a new password login is needed. Library clients use the same lookup rules.

### JSON input

For noninteractive setup, pipe a JSON object with string `username` and `password` fields to `credentials --stdin`:

```sh
fam familysearch.credential set --stdin < /private/path/login.json
```

The same option works with `ancestry`, `myheritage`, `findmypast`, `findagrave`, `geneanet`, `storied`, and `americanancestors`. It takes precedence over environment variables. The CLI preserves the password exactly and does not print it. Keep the input file private.

## Storage and profiles

All providers use the same configuration root:

| Setting | Directory |
| --- | --- |
| `FAM_CONFIG_DIR` | The absolute path you set |
| macOS or Linux | `$XDG_CONFIG_HOME/fam`, or `~/.config/fam` |
| Windows | `%APPDATA%\fam`, or `~/.config/fam` if `APPDATA` is unset |

`FAMILYSEARCH_CONFIG_DIR` remains a compatibility alias when `FAM_CONFIG_DIR` is unset. New installations default to `fam`; old directories are never imported automatically.

FamilySearch stores `login.json` and `session.json` at the root. The other services use `ancestry/`, `myheritage/`, `findmypast/`, `findagrave/`, `geneanet/`, `storied/`, and `americanancestors/` subdirectories. Device IDs, cookies, and pending authentication state also live here. Camofox configuration and instance-scoped provider sessions live under `browser/`; see [browser storage](browser.md#session-storage-and-sharing).

On POSIX systems, the CLI uses `0700` directories and `0600` files. Windows uses your user profile's ACLs. Credential writes replace files atomically.

To use a separate profile, set an absolute configuration path before running commands. For example, in a POSIX shell:

```sh
export FAM_CONFIG_DIR="$HOME/.config/fam-work"
fam familysearch.credential set
fam familysearch.session login
```

Keep that variable set for subsequent commands. Each process reads it at startup. No CLI imports credentials from an older checkout's `.credentials/` directory.

Provider commands renew saved sessions automatically before known token expiry or after an authentication rejection, save rotated credentials, and continue the command. This includes GraphQL authentication errors returned with HTTP 200. Each operation makes at most one renewal attempt; permission errors, rate limits, network failures, and server errors do not trigger renewal. MyHeritage browser commands load current API credentials from the authenticated website. MyHeritage and Findmypast sessions created through Camofox can renew through that browser, trying configured credentials once when needed. Native token renewal does not fall back to password login after rejection; required verification uses the viewer URL.

Run one process per profile when renewing sessions. Separate processes do not coordinate token refreshes.

### Reset a session

Run `fam cli.health check --provider PROVIDER` to verify the session and automatically renew it if needed before resetting anything. Use `--offline` only for local inspection. See [doctor coverage](doctor.md) for details.

Run the CLI's `status` command to find its configuration directory. Remove that service's `session.json`, then run `auth`. Remove its `login.json` too if you want to forget the saved password. This clears local files; it does not revoke the session on the service.

For MyHeritage or Findmypast browser login, run `fam myheritage.session login` or `fam findmypast.session login`. The configured Camofox instance retains cookies, supports automatic credential entry, and supplies a viewer URL for verification. Browser session snapshots are scoped to the selected instance. See [browser state and recovery](browser.md).

Find a Grave has no token refresh command. `fam findagrave.session verify` checks the saved session without extending it; use `fam findagrave.session login` to replace an expired session.

## Optional credential sync hook

Set `credentialsSyncCommand` in your profile's `config.json` to an executable and argument array, for example `["node", "/absolute/path/to/sync-helper.mjs"]`. `FAM_CREDENTIALS_SYNC_COMMAND` overrides it using the same JSON format. Fam runs the helper after saving a provider's login, session, or device file. The helper receives the provider as its final argument and JSON on stdin: `{ "version": 1, "provider": "myheritage", "credentialDirectory": "/absolute/profile/path", "file": "myheritage/session.json", "reason": "save" }`.

The helper decides what to upload and where. Fam waits up to 30 seconds, suppresses helper output, and warns on failure while retaining the saved local credentials. Run `fam PROVIDER.credential sync` to retry manually; this passes `reason: "manual"` and `file: null`. Child processes inherit `FAM_CONFIG_DIR` and `FAM_CREDENTIALS_SYNC_DISABLED=1` to prevent recursive hooks.

## Migration from familysearch

The repository and package are now `potatosalad/fam` and `@potatosalad/fam`. Existing GitHub clones can update their remote with `git remote set-url origin git@github.com:potatosalad/fam.git`.

Uninstall the old npm package before installing fam:

```sh
npm uninstall --global @potatosalad/familysearch
npm install --global .
fam --help
```

If the older executables were installed manually, remove only the `familysearch`, `ancestry`, `myheritage`, `findmypast`, and `findagrave` links belonging to that installation. `fam` is the only executable the new package installs.

To keep an existing profile, set `FAM_CONFIG_DIR` to its absolute directory. Alternatively, copy the old configuration directory to the new `fam` directory before first use, retaining private permissions. Do not overwrite a populated destination. An old source installation may store its profile in the checkout's ignored `.credentials/` directory. Keep downloaded research separately.

## Output files

Commands print JSON unless you pass `--out FILE`. Create output directories first. Image downloads also save a JSON file with the source citation and checksum. Findmypast output replaces files at the chosen path; use a new filename for each download. Other providers' image-download commands refuse to overwrite existing files.

Keep personal exports outside Git. The checkout ignores `research-output/` and `artifacts/` for local research.

## TypeScript library use

Install the package in the application that imports it. A global CLI installation makes `fam` available on PATH, but does not add a dependency to another Node project. After building your fam checkout with `npm ci`, run this from your application directory:

```sh
npm install /absolute/path/to/fam
```

Keep that checkout and its dependencies in place, or install a packed archive created by `npm pack` instead. The package uses ESM; use `.mjs` files or set `"type": "module"` in your application's `package.json`.

| Provider | Import path | Examples |
| --- | --- | --- |
| FamilySearch | `@potatosalad/fam/familysearch` | [TypeScript guide](familysearch/typescript.md) |
| Ancestry | `@potatosalad/fam/ancestry` | [Provider guide](ancestry/README.md#typescript) |
| MyHeritage | `@potatosalad/fam/myheritage` | [Provider guide](myheritage/README.md#typescript) |
| Findmypast | `@potatosalad/fam/findmypast` | [Provider guide](findmypast/README.md#typescript) |
| Find a Grave | `@potatosalad/fam/findagrave` | [Provider guide](findagrave/README.md#typescript) |
| Geneanet | `@potatosalad/fam/geneanet` | [Provider guide](geneanet/README.md#api-catalog-and-typescript) |
| American Ancestors | `@potatosalad/fam/americanancestors` | [Provider guide](americanancestors/README.md#typescript) |

The root import, `@potatosalad/fam`, also exports the FamilySearch API. Library clients use the same profile, credential helper and saved sessions as the CLI. Set `FAM_CONFIG_DIR` before starting Node when using a separate profile.
