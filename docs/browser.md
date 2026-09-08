# Persistent browser setup

Camofox provides the browser for MyHeritage, Findmypast, and Storied/NewspaperArchive sign-in. It also recovers Cloudflare challenges encountered by any provider's HTTP client. Existing working native login flows remain available.

## Local Docker

```sh
fam browser setup --local
fam myheritage.session login
```

Setup reuses your running Docker engine. On macOS, if Docker is unavailable, fam opens OrbStack if installed or offers to install it with Homebrew. `fam browser setup --local --install` accepts that installation in advance. Other platforms need an installed, running Docker runtime.

The first setup downloads the pinned Camofox image, mounts the bundled fam plugin, and starts a persistent container. Both API and noVNC ports bind to `127.0.0.1`. The viewer has no password. The internal API key is generated and configured automatically; there is no extra login step.

Default viewer: <http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=remote>. Use `--api-port` and `--vnc-port` at first setup if the defaults are occupied. Ports are fixed for that container. A separate `FAM_CONFIG_DIR` creates a separate container and profile directory.

## Remote URL

```sh
fam browser setup --remote https://browser.example.org/camofox \
  --vnc-url 'https://browser.example.org/browser/vnc.html?autoconnect=1&path=browser/websockify' \
  --api-key-file /private/path/camofox-api-key
fam browser use remote
```

The API URL may include a reverse-proxy path. The viewer URL is used exactly as configured, so a tunnel, Tailscale hostname, or another published address works. Omit `--api-key-file` when the server does not require a key. fam connects directly by URL; SSH is not required by the CLI.

Remote Camofox must load the bundled `browser/camofox-plugin` directory as `/app/plugins/fam`, with `ENABLE_FAM=1`, persistence enabled, and `CAMOFOX_PROFILE_DIR` on persistent storage. Start the server with `node /app/plugins/fam/start.mjs`. This prepares the Camoufox engine for MyHeritage private contexts before loading the server; it needs Python 3 and the engine at `~/.cache/camoufox` (override with `FAM_CAMOUFOX_DIR`). The original `omni.ja` is preserved alongside the engine. Enable noVNC with `ENABLE_VNC=1`. For Docker, use `VNC_BIND=0.0.0.0` inside the container and publish the viewer port on the host interface you intend to use. The plugin uses Camofox's existing API authentication. `fam browser status` checks whether the plugin is reachable.

Example plugin configuration in `/app/camofox.config.json`:

```json
{"plugins":{"persistence":{"enabled":true},"vnc":{"enabled":true},"fam":{"enabled":true}}}
```

Preserve other plugins and settings when adding these entries to an existing installation. Restart Camofox after installing or updating the plugin. The packaged plugin supports Camofox 1.11.2 and 1.14.0; local setup pins the official 1.14.0 image digest. See [Camofox](https://github.com/jo-inc/camofox-browser) for server configuration.

## Everyday commands

```sh
fam browser status
fam browser use local
fam browser use remote
fam browser start
fam browser open
fam browser stop
fam browser configure --timeout 1200 --open
fam browser configure --vnc-url https://viewer.example.org --no-open
```

Local `stop` stops the owned container and retains saved state. The container forwards shutdown signals to Camofox so it can finish checkpoints. `open` starts an idle browser before opening its viewer. Local idle timeouts are 24 hours; zero in upstream Camofox would mean immediate shutdown. Upgrading an older fam container retains it under a timestamped name and reuses its persistent profiles. Remote `stop` closes only tabs in fam's tab group for the selected session name. It leaves the browser process, other tab groups, and other users' work running. Ordinary commands leave the browser running; successful HTTP operations close their own transport tabs at CLI exit. Login and unfinished verification tabs remain available in the viewer.

`fam browser` is a short alias for `fam cli.browser`. Help, command discovery, and completion describe the same operations.

## Login and verification

```sh
fam myheritage.session login
fam findmypast.session login --region co.uk
fam storied.session login
fam newspaperarchive.session login
```

fam first checks for an existing signed-in browser session. If sign-in is needed, it tries configured credentials once per login-form step. Password lookup follows the [shared credential rules](setup.md#credential-lookup); browser login does not prompt for a password in the terminal.

`--interactive` autofills empty username and password fields by default, including a password field that appears after a username-only step. It never clicks Sign in or submits the form; you submit through the viewer. Autofill preserves values you have already entered. Use `--no-autofill` to leave the fields untouched and disable automatic credential submission, with or without `--interactive`:

```sh
fam myheritage.session login --interactive
fam myheritage.session login --interactive --no-autofill
```

The same flags apply to Findmypast, Storied, and NewspaperArchive browser login. Interactive autofill requires the updated bundled fam Camofox plugin; older remote plugins must be updated and Camofox restarted. Until then, `--no-autofill` retains manual sign-in. For an existing local container, run `fam browser stop` followed by `fam browser start` after updating fam to load the new plugin.

When MFA, CAPTCHA, or another interaction is needed, fam prints the viewer URL, opens it when possible, and waits for account verification. The default wait is ten minutes. `fam browser configure --timeout 0 --no-open` prints the URL and returns when interaction is needed. A command can override the setting with `--browser-timeout 120`. Finish in the viewer and rerun the login command after a timeout. Cookies remain available.

MyHeritage and Findmypast validate account access before saving a browser session. Storied captures its native-app callback in the plugin, validates OAuth state, and exchanges the code with PKCE. NewspaperArchive shares Storied authentication. Saved OAuth refresh tokens continue to support ordinary native requests.

MyHeritage uses actual Firefox private windows. Firefox's ordinary Playwright contexts are containers, which can behave differently even after their storage is erased. The bundled engine bridge scopes private windows to MyHeritage's fam context and exports/restores their cookies and site storage so sign-in survives service restarts. Other browser contexts retain their existing behavior. Updating an existing remote deployment requires the startup command above and one service restart; local setup handles this automatically.

MyHeritage and Findmypast browser commands make at most one login renewal after an explicit session rejection. MFA and provider restrictions may still require your attention. A detected MyHeritage 24-hour login restriction suppresses further automatic password attempts until its recorded deadline; it does not invalidate an existing working session. Health checks do not submit passwords.

MyHeritage login reuses an existing fam tab and follows its family-site page's tree link once to obtain the rendered tree context. A saved cooldown permits verification of an existing session and interactive autofill; it blocks automatic password submission. If the page itself still displays the restriction, fam stops without probing the account or filling credentials. There is no need to delete the cooldown file after signing in manually.

`--capture` remains an alias for Camofox login. It no longer records a HAR. Existing HAR files can still be imported using `fam myheritage.session login --har FILE` or `fam findmypast.session login --har FILE`; when a browser is configured, imported website cookies are installed into the selected instance and validated. Old unscoped HAR sessions are not silently copied to a remote browser. Use an explicit import or `--transport http` for a legacy direct-HTTP session. Native MyHeritage/Findmypast login is available with `--native`.

## Automatic HTTP recovery

A response with Cloudflare challenge evidence triggers browser recovery, including challenge HTML returned with HTTP 403. An ordinary permission denial, rate limit, provider error, or ambiguous network failure does not trigger a replay. The browser sends the original method, body, and allowed headers; provider origin restrictions and redirect checks still apply. Binary content and large JSON integers are preserved.

After recovery, fam remembers the provider and website origin for the selected instance and uses that browser in later commands. Cookies are refreshed from the browser. An existing browser context takes precedence over stale HTTP cookies.

```sh
fam myheritage.account get --transport browser
fam findmypast.account get --transport http
fam browser configure --transport auto
fam cli.browser.transport reset
```

`--transport auto|http|browser` overrides one command. `configure --transport` changes the default. `cli.browser.transport reset` clears remembered browser routing for the selected instance on this client; it retains logins and works without contacting Camofox. Browser requests currently support responses up to 64 MiB. An unresolved challenge returns the viewer URL, including in structured `--json` errors.

## Reset browser sessions

```sh
fam cli.browser reset --provider myheritage
fam cli.browser reset --all
fam cli.browser.transport reset
```

`reset --provider NAME` closes that provider's fam browser context, archives its saved profile and this client's matching session snapshot, and replaces the profile with empty cookies and site storage. Closing the context discards its in-memory cache, session storage, IndexedDB, service workers, and open tabs. A fresh blank tab is left for manual sign-in. The command opens or prints the configured viewer URL; `--no-open` only prints it. It never navigates to the provider or attempts a login. Camofox itself keeps running.

Storied and NewspaperArchive share authentication, so choosing either resets both contexts and snapshots. Other providers and the other local/remote mode retain their sessions. Two clients using the same browser and session name share the reset context.

`reset --all` applies the same reset to **every fam-managed context on the selected Camofox instance**, across fam session names, including saved contexts that are not currently open. It also archives this client's matching provider snapshots and remembered transport decisions. It leaves no new login tab; start the desired provider's login when ready. It preserves unrelated users and tab groups. If a fam context also contains an unrelated tab group, reset refuses before changing the selection because those tabs share the same site storage.

Both forms retain configured usernames/passwords, native sessions, viewer/API settings, and automatic-login cooldowns. They do not reset the provider's server-side restrictions, change the browser fingerprint or network address, or promise that a restriction is lifted. Complete the next login yourself when appropriate; browser sign-ins support `--interactive` to autofill without submitting.

Profiles are archived privately on the browser host under `CAMOFOX_PROFILE_DIR/fam-reset-backups/`. Matching CLI snapshots are archived under this client's `browser/<instance-id>/reset-backups/`. These backups contain old account state and are never automatically restored. After reset, the plugin prevents bootstrap cookies and stale HTTP cookies from silently seeding the cleared context, including requests from another fam client. An explicit HAR import can still add cookies. Other clients keep their local snapshots and routing decisions until reset or a new login there.

Reset requires the updated fam Camofox plugin and persistence. Updating the plugin needs one Camofox service restart to load its routes; running either reset afterward does **not** restart the browser. For an existing local container, stop/start it once after updating fam. For a remote deployment, update the mounted plugin and restart its service.

`fam browser reset` and `fam browser.transport reset` are short aliases. Migration: the old bare `fam browser reset` only forgot transport decisions. It now requires `--provider NAME` or `--all`; use `fam cli.browser.transport reset` for the old behavior.

## Session storage and sharing

Local and remote browser contexts remain separate. Switching modes restores that mode's saved provider session and routing decisions. Two clients using the same remote service and `--session` name (default `default`) share browser cookies and website logins there. They create their own tabs, so normal fetches do not navigate another command's login tab. Remote stop closes fam tabs for that shared session name, including those opened by another fam client.

Configuration is stored in `browser/config.json` under the [fam profile](setup.md#storage-and-profiles). Provider session snapshots and routing preferences live under `browser/<instance-id>/`. Local Docker storage is under `browser/local/profiles/`. Camofox persists cookies, local storage, and supported IndexedDB state; this is not a complete Firefox profile backup. A website can expire or revoke login independently.

An explicit native login selects that native session for the current instance without deleting its previous browser login. Browser login selects the browser session again. Browser checkpoints contain account state and remain on the configured browser host.
