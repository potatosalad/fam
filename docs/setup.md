# Setup details

The [README](../README.md) covers installation and sign-in for each service.

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

Use the same prefix when updating or uninstalling. To keep the credentials separate too, set `FAM_CONFIG_DIR` as described below.

## Shell completion

After installing `fam`, run `fam completion install` once, then open a new shell. It detects bash or zsh from `$SHELL` and adds a marked, guarded hook to your startup files. You can select explicitly with `fam completion install bash` or `fam completion install zsh`.

Bash setup covers `.bashrc` and the first existing login profile (`.bash_profile`, `.bash_login`, or `.profile`; a new `.bash_profile` is created if none exists). Zsh uses `$ZDOTDIR/.zshrc` when set, otherwise `~/.zshrc`, and initializes its completion system if needed. Repeating installation does not duplicate the hooks. It does not require a separate bash-completion package.

For the current shell, or to manage the startup hook yourself:

```sh
eval "$(fam completion bash)" # bash
# or
eval "$(fam completion zsh)"  # zsh
```

Try `fam fam<TAB>`, `fam familysearch image <TAB>`, or `fam ancestry search --birth-<TAB>`. File arguments such as `--out` use file completion, including paths containing spaces. Provider options are offered throughout that provider's command line; run `fam PROVIDER --help` to see which commands accept each option. Suggestions come from a catalog generated during the build, without loading credentials or contacting services. Updating fam also updates the suggestions.

To uninstall completion, remove the marked `fam bash completion` or `fam zsh completion` blocks from the files printed by the installer. The installer changes files for the current user; run it as the user who will use the CLI.

## Credential lookup

When a login is needed, fam reads its username and password from the environment first, then an explicitly configured credential helper, then its saved login file. A partial or empty environment pair is an error. API commands never prompt for a password.

`fam PROVIDER credentials` is explicit setup: it uses environment values, then a configured helper, then a hidden interactive prompt. It saves the resulting login details rather than reusing an existing login file. `credentials --stdin` uses only the supplied JSON.

Environment-only login saves session tokens but does not save the password. Running `credentials` with an environment pair saves that username and password. Replacing login details does not switch an active session; run `auth` to sign in with the new account.

### External credential helpers

Configure a helper once in `~/.config/fam/config.json` to use it for every provider and future command. If you use a different [configuration directory](#storage-and-profiles), put `config.json` there instead. Use an absolute path to a trusted helper:

```json
{
  "credentialsCommand": ["node", "/absolute/path/to/credential-helper.mjs"]
}
```

No environment variable is needed for the persistent file setting. `FAM_CREDENTIALS_COMMAND='["node","/absolute/path/to/credential-helper.mjs"]'` is an optional override. fam runs the executable directly, without a shell, appending exactly one argument: `familysearch`, `ancestry`, `myheritage`, `findmypast`, `findagrave`, `geneanet`, or `storied`. The working directory is the caller's directory; use absolute paths for helper files. Environment variables are inherited and stdin is closed.

The helper must exit successfully and print only a JSON object with nonempty string `username` and `password` fields. Password whitespace is preserved. Output is limited to 64 KiB and execution to two minutes. Failures suppress command output and stop lookup; fam never silently falls back to an older saved password. Use this hook for a password manager, local executable, or SSH-backed helper. No helper runs unless configured, and help/status commands do not look up passwords.

The helper takes precedence over saved passwords. Normal authentication does not cache its returned password; `fam PROVIDER credentials` explicitly saves it. `credentials --stdin` bypasses both the helper and environment. Existing sessions are still reused until `auth` or a new password login is needed. Library clients use the same lookup rules.

### JSON input

For noninteractive setup, pipe a JSON object with string `username` and `password` fields to `credentials --stdin`:

```sh
fam familysearch credentials --stdin < /private/path/login.json
```

The same option works with `ancestry`, `myheritage`, `findmypast`, `findagrave`, `geneanet`, and `storied`. It takes precedence over environment variables. The CLI preserves the password exactly and does not print it. Keep the input file private.

## Storage and profiles

All providers use the same configuration root:

| Setting | Directory |
| --- | --- |
| `FAM_CONFIG_DIR` | The absolute path you set |
| macOS or Linux | `$XDG_CONFIG_HOME/fam`, or `~/.config/fam` |
| Windows | `%APPDATA%\fam`, or `~/.config/fam` if `APPDATA` is unset |

`FAMILYSEARCH_CONFIG_DIR` remains a compatibility alias when `FAM_CONFIG_DIR` is unset. New installations default to `fam`; old directories are never imported automatically.

FamilySearch stores `login.json` and `session.json` at the root. The other services use `ancestry/`, `myheritage/`, `findmypast/`, `findagrave/`, `geneanet/`, and `storied/` subdirectories. Device IDs, cookies, and pending authentication state also live here.

On POSIX systems, the CLI uses `0700` directories and `0600` files. Windows uses your user profile's ACLs. Credential writes replace files atomically.

To use a separate profile, set an absolute configuration path before running commands. For example, in a POSIX shell:

```sh
export FAM_CONFIG_DIR="$HOME/.config/fam-work"
fam familysearch credentials
fam familysearch auth
```

Keep that variable set for subsequent commands. Each process reads it at startup. No CLI imports credentials from an older checkout's `.credentials/` directory.

Run one process per profile when renewing sessions. Separate processes do not coordinate token refreshes.

### Reset a session

Run the CLI's `status` command to find its configuration directory. Remove that service's `session.json`, then run `auth`. Remove its `login.json` too if you want to forget the saved password. This clears local files; it does not revoke the session on the service.

For an expired MyHeritage or Findmypast browser session, import a fresh HAR instead. Complete any website verification before capturing it. Findmypast's `refresh` revalidates browser cookies; it does not renew an expired browser login.

Find a Grave has no token refresh command. `fam findagrave verify` checks the saved session without extending it; use `fam findagrave auth` to replace an expired session.

## Optional credential sync hook

Set `credentialsSyncCommand` in your profile's `config.json` to an executable and argument array, for example `["node", "/absolute/path/to/sync-helper.mjs"]`. `FAM_CREDENTIALS_SYNC_COMMAND` overrides it using the same JSON format. Fam runs the helper after saving a provider's login, session, or device file. The helper receives the provider as its final argument and JSON on stdin: `{ "version": 1, "provider": "myheritage", "credentialDirectory": "/absolute/profile/path", "file": "myheritage/session.json", "reason": "save" }`.

The helper decides what to upload and where. Fam waits up to 30 seconds, suppresses helper output, and warns on failure while retaining the saved local credentials. Run `fam PROVIDER sync` to retry manually; this passes `reason: "manual"` and `file: null`. Child processes inherit `FAM_CONFIG_DIR` and `FAM_CREDENTIALS_SYNC_DISABLED=1` to prevent recursive hooks.

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

The root import, `@potatosalad/fam`, also exports the FamilySearch API. Library clients use the same profile, credential helper and saved sessions as the CLI. Set `FAM_CONFIG_DIR` before starting Node when using a separate profile.
