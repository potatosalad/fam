# Setup details

The [README](../README.md) covers installation and sign-in for each service.

## Installation

`npm ci` installs dependencies and builds the TypeScript. `npm install --global .` links the commands to your checkout, so keep it in place. You do not need to create or install an archive.

If npm reports a permissions error, use a Node installation or npm prefix owned by your user.

If your shell can't find a command, run `npm prefix --global`. Add that directory's `bin` subdirectory to PATH on macOS or Linux. On Windows, add the prefix itself.

### Separate installations

To keep another installation alongside this one, choose a separate npm prefix and invoke its commands by their full path. Run this from the checkout on macOS or Linux:

```sh
npm install --global --prefix "$HOME/.local/share/familysearch-public" .
"$HOME/.local/share/familysearch-public/bin/familysearch" --help
```

On Windows, use an absolute Windows path for the prefix. npm puts the four `.cmd` launchers directly in that directory.

Use the same prefix when updating or uninstalling. To keep the credentials separate too, set `FAMILYSEARCH_CONFIG_DIR` as described below.

## Credential lookup

When a login is needed, each CLI reads its username and password from the environment first, then its saved login file. A partial or empty environment pair is an error. API commands never prompt for a password.

Environment-only login saves session tokens but does not save the password. Running `credentials` with an environment pair saves that username and password. Replacing login details does not switch an active session; run `auth` to sign in with the new account.

### JSON input

For noninteractive setup, pipe a JSON object with string `username` and `password` fields to `credentials --stdin`:

```sh
familysearch credentials --stdin < /private/path/login.json
```

The same option works with `ancestry`, `myheritage`, and `findmypast`. It takes precedence over environment variables. The CLI preserves the password exactly and does not print it. Keep the input file private.

## Storage and profiles

All four CLIs use the same configuration root:

| Setting | Directory |
| --- | --- |
| `FAMILYSEARCH_CONFIG_DIR` | The absolute path you set |
| macOS or Linux | `$XDG_CONFIG_HOME/familysearch`, or `~/.config/familysearch` |
| Windows | `%APPDATA%\familysearch`, or `~/.config/familysearch` if `APPDATA` is unset |

FamilySearch stores `login.json` and `session.json` at the root. The other services use `ancestry/`, `myheritage/`, and `findmypast/` subdirectories. Device IDs, cookies, and pending authentication state also live here.

On POSIX systems, the CLIs use `0700` directories and `0600` files. Windows uses your user profile's ACLs. Credential writes replace files atomically.

To use a separate profile, set an absolute configuration path before running commands. For example, in a POSIX shell:

```sh
export FAMILYSEARCH_CONFIG_DIR="$HOME/.config/familysearch-work"
familysearch credentials
familysearch auth
```

Keep that variable set for subsequent commands. Each process reads it at startup. No CLI imports credentials from an older checkout's `.credentials/` directory.

Run one process per profile when renewing sessions. Separate processes do not coordinate token refreshes.

### Reset a session

Run the CLI's `status` command to find its configuration directory. Remove that service's `session.json`, then run `auth`. Remove its `login.json` too if you want to forget the saved password. This clears local files; it does not revoke the session on the service.

For an expired MyHeritage or Findmypast browser session, import a fresh HAR instead. Complete any website verification before capturing it. Findmypast's `refresh` revalidates browser cookies; it does not renew an expired browser login.

## Output files

Commands print JSON unless you pass `--out FILE`. Create output directories first. Image downloads also save a JSON file with the source citation and checksum. Findmypast output replaces files at the chosen path; use a new filename for each download. Other providers' image-download commands refuse to overwrite existing files.

Keep personal exports outside Git. The checkout ignores `research-output/` and `artifacts/` for local research.
