# Persistent browser setup

CloakBrowser is the default browser for MyHeritage, Findmypast, and Storied/NewspaperArchive sign-in. Camofox remains selectable through the same fam API. A shared transport recovers Cloudflare and Imperva/Incapsula challenges across provider APIs, document metadata, and image downloads. Existing working native login flows remain available.

## Local Docker

```sh
fam cli.browser setup --local
fam myheritage.session login
```

Setup reuses your running Docker engine. On macOS, if Docker is unavailable, fam opens OrbStack if installed or offers to install it with Homebrew. `fam cli.browser setup --local --install` accepts that installation in advance. Other platforms need an installed, running Docker runtime.

The first setup builds the bundled service from the pinned CloakBrowser image and starts a persistent container. It includes a headed Chromium browser, the fam HTTP API, and noVNC. Both API and noVNC ports bind to `127.0.0.1`. The viewer has no password. The internal API key is generated and configured automatically; there is no extra login step.

Default CloakBrowser API port: `9378`; viewer: <http://127.0.0.1:6082/vnc.html?autoconnect=1&resize=scale>. Camofox uses API `9377` and viewer `6080`, so both can be installed together. Use `--api-port` and `--vnc-port` at first setup if the defaults are occupied. Ports are fixed for that container. A separate `FAM_CONFIG_DIR` creates a separate container and profile directory.

## Choosing a browser

```sh
fam cli.browser use --engine cloakbrowser
fam cli.browser use --engine camofox
fam cli.browser use --mode local
fam cli.browser use --mode remote
fam cli.browser use --mode remote --engine cloakbrowser
```

Changing engines clears **both engines' browser profiles and browser-derived
session snapshots at the selected location**, including reset backups. It does
not import cookies. Configured credentials, credential helpers, connection
settings, native sessions, and login cooldowns remain. Re-selecting the current
engine simply starts it. Switching between local and remote retains each
location's independent logins. Switching back to a different engine starts fresh.

New installations default to CloakBrowser. Existing local installations select it
on their next browser use/start/open, building the service automatically. Existing
remote installations switch when their operator deploys CloakBrowser and advertises
its endpoint (see below). Until then `status` shows `upgradePending`. An explicit
Camofox selection is retained on subsequent commands and updates.

Use `setup --local --engine camofox` to install the fallback directly. Local
containers use separate profile directories and ports. MyHeritage uses ordinary
persistent Chromium profiles in CloakBrowser; the Firefox private-window workaround
is confined to Camofox. Both engines reuse the same login polling, credential
submission limits, HTTP fallback, and `--browser-timeout` behavior. The existing
600-second verification setting and zero-wait option remain unchanged.

## Remote URL

```sh
fam cli.browser setup --engine cloakbrowser --remote https://browser.example.org/cloakbrowser \
  --vnc-url 'https://browser.example.org/cloakbrowser-viewer/vnc.html?autoconnect=1&path=cloakbrowser-viewer/websockify' \
  --api-key-file /private/path/browser-api-key
fam cli.browser use --mode remote
```

The API URL may include a reverse-proxy path. The viewer URL is used exactly as configured, so a tunnel, Tailscale hostname, or another published address works. Omit `--api-key-file` when the server does not require a key. fam connects directly by URL; SSH is not required by the CLI.

### Deploying CloakBrowser

The npm package includes the complete service under `browser/`. Build from that
installed directory or a committed fam checkout:

```sh
docker build -t fam-cloakbrowser:0.5.10 -f /path/to/fam/browser/cloakbrowser/Dockerfile /path/to/fam/browser
docker run -d --name fam-cloakbrowser --init --restart unless-stopped --shm-size 1g \
  --env-file /path/to/private/browser.env \
  -p 127.0.0.1:9378:9377 -p 127.0.0.1:6082:6080 \
  -v /path/to/private/profiles:/data/profiles fam-cloakbrowser:0.5.10
```

The private env file supplies `FAM_BROWSER_API_KEY` (a random secret of at least
16 characters). Every API endpoint requires `Authorization: Bearer KEY`. Raw CDP
is restricted to loopback inside the container. The viewer follows the same
passwordless model as the local browser; place its route behind your intended
network/access boundary. Only the viewer proxy needs WebSocket upgrade headers.
API requests support bodies up to 72 MiB; configure matching proxy limits.

```sh
fam cli.browser setup --engine cloakbrowser --remote https://browser.example.org/cloakbrowser \
  --vnc-url 'https://browser.example.org/cloakbrowser-viewer/vnc.html?autoconnect=1&path=cloakbrowser-viewer/websockify' \
  --api-key-file /path/to/private/api-key
```

To switch remote engines with one command, configure each once with `setup`, or
advertise sibling endpoints using `FAM_BROWSER_ALTERNATIVES` on each service:

```json
{"cloakbrowser":{"url":"/cloakbrowser","vncUrl":"/cloakbrowser-viewer/vnc.html?autoconnect=1&path=cloakbrowser-viewer/websockify"}}
```

The Camofox service advertises CloakBrowser; CloakBrowser advertises Camofox using
the corresponding key and URLs. Discovered API/viewer URLs must retain their
respective existing origins, and the API endpoints must share the existing key.
Different origins or keys require explicit setup. Upgrade the Camofox fam plugin
before switching: both remote services must support deletion without backups.

Persistent profiles and storage checkpoints include cookies, local storage, and
IndexedDB. Successful requests checkpoint immediately, manual sessions checkpoint
periodically, and shutdown checkpoints before Chromium exits. If a browser
process crashes, a new tab relaunches it from its last durable state. The service
starts browsers lazily per session and releases them after their final fam tab closes.

### Deploying the Camofox fallback

For the Camofox fallback, remote Camofox must load the bundled `browser/camofox-plugin` directory as `/app/plugins/fam`, with `ENABLE_FAM=1`, persistence enabled, and `CAMOFOX_PROFILE_DIR` on persistent storage. Start the server with `node /app/plugins/fam/start.mjs`. This prepares the Camoufox engine for MyHeritage private contexts before loading the server; it needs Python 3 and the engine at `~/.cache/camoufox` (override with `FAM_CAMOUFOX_DIR`). The original `omni.ja` is preserved alongside the engine. Enable noVNC with `ENABLE_VNC=1`. For Docker, use `VNC_BIND=0.0.0.0` inside the container and publish the viewer port on the host interface you intend to use. The plugin uses Camofox's existing API authentication. `fam cli.browser status` checks whether the plugin is reachable.

Example plugin configuration in `/app/camofox.config.json`:

```json
{"plugins":{"persistence":{"enabled":true},"vnc":{"enabled":true},"fam":{"enabled":true}}}
```

Preserve other plugins and settings when adding these entries to an existing installation. Restart Camofox after installing or updating the plugin, including to enable the 15-minute fam tab cleanup. The packaged plugin supports Camofox 1.11.2 and 1.14.0; local setup pins the official 1.14.0 image digest. See [Camofox](https://github.com/jo-inc/camofox-browser) for server configuration.

## Everyday commands

```sh
fam cli.browser status
fam cli.browser use --mode local
fam cli.browser use --mode remote
fam cli.browser start
fam cli.browser open
fam cli.browser stop
fam cli.browser configure --timeout 1200 --open
fam cli.browser configure --vnc-url https://viewer.example.org --no-open
```

Local `stop` stops the owned container and retains saved state. The container forwards shutdown signals so the browser can finish checkpoints. `open` starts an idle browser before opening its viewer. Camofox retains its 24-hour browser idle setting; CloakBrowser releases individual browser processes when their final fam tab closes. Upgrading an older fam container retains it under a timestamped name and reuses its persistent profiles. Remote `stop` closes only tabs in fam's tab group for the selected session name. It leaves the browser process, other tab groups, and other users' work running.

Ordinary commands leave the browser running. HTTP operations close their own transport tabs at CLI exit; completed logins and failed setup/API operations also close their tabs. Unfinished sign-in and verification tabs remain available in the viewer. The fam plugin checks every minute and closes fam tabs after 15 minutes without browser API activity, including tabs abandoned by an interrupted or killed CLI. Active requests are protected, saved cookies/storage are checkpointed before cleanup, and unrelated users or tab groups are untouched. Closing the last tab also releases its browser context while preserving the saved login. Camofox retains its existing 24-hour shared browser idle setting.

`fam browser` is a short alias for `fam cli.browser`. Help, command discovery, and completion describe the same operations.

## Fetch any URL

`fam cli.browser fetch` (also `fam cli.browser fetch`) accepts any HTTP or HTTPS URL without a provider allowlist. It uses the configured browser engine and its network connection, locally or remotely. Set up the browser first using the instructions above.

```sh
# Visible page text is the default, including in a pipe.
fam cli.browser fetch --url https://example.org/page
fam cli.browser fetch --url https://example.org/page --format markdown
fam cli.browser fetch --url https://example.org/page --format html --out page.html
fam cli.browser fetch --url https://example.org/page --json --out page.json

# Original response bytes, including images, PDFs and other binary resources.
fam cli.browser fetch --url https://example.org/file.pdf --format raw --out file.pdf
# Capture the original final document response from a real navigation.
fam cli.browser fetch --url https://example.org/page --mode navigate --format raw --out source.html

# Wait for dynamic content and extract one element's text/Markdown.
fam cli.browser fetch --url https://example.org/page --wait-for article --wait-ms 500 --format markdown
```

| Format | Output |
| --- | --- |
| `text` | Visible rendered text in navigate mode; decoded response text or HTML text extraction in request mode. |
| `markdown` | Content converted to Markdown with headings, lists, links, code and GFM tables. Relative links resolve against the page's base URL. |
| `html` | Full serialized document after scripts run in navigate mode; original decoded HTML in request mode. |
| `raw` | Exact response body bytes exposed by the browser, with no newline or CLI envelope. Browser decompression has already happened; this is not a wire capture. |
| `json` / `--json` | The normal fam envelope with original/final URL, HTTP status, response headers (including repeated headers), MIME type and byte count. HTML includes rendered HTML, text, Markdown, links, metadata and valid JSON-LD. JSON responses include parsed data with exact large integers; binary responses include `bodyBase64`. |

HTML/raw are single-document captures, not offline website archives: they do not bundle external images, stylesheets, frames or shadow roots. `--wait-for` selects the first matching visible element for text and Markdown; HTML remains the full document. Without a selector the whole body is extracted, including navigation and footers. Hidden content and scripts are excluded from Markdown. `--wait-ms` adds settling time for asynchronous content; `--timeout` bounds navigation and selection waits (default 60 seconds).

`--mode navigate` performs a real GET document navigation so verification scripts can execute. It follows browser redirects. This is the default for page formats. `--mode request` issues the actual network request through the selected browser from a temporary same-origin document; it does not use a Node HTTP client or Playwright's APIRequestContext. It defaults for raw output and methods other than GET. Use request mode for APIs, binary resources, HTTP HEAD, or responses that should not execute scripts.

```sh
fam cli.browser fetch --url https://example.org/api --mode request \
  --header 'Accept: application/json' --headers-file /private/headers.json --json
fam cli.browser fetch --url https://example.org/api --method POST \
  --header 'Content-Type: application/json' --body '{"query":"example"}' --json
fam cli.browser fetch --url https://example.org/upload --method PUT \
  --body-file /private/payload.bin --format raw --out response.bin
fam cli.browser fetch --url https://example.org/page --cookie 'preference=en; another=value' \
  --cookies-file /private/cookies.json --format markdown
```

Repeat `--header 'Name: value'` and `--cookie 'name=value'` as needed. A header file is a JSON object of string values; command-line headers override its entries. A cookie file is a Playwright cookie array or storage-state object (only `cookies` are imported), preserving domain, path, expiry, secure, HTTP-only and SameSite attributes. Each entry needs name/value and either URL or domain/path. Inline cookies, including an explicit `Cookie` header, are imported with the requested host and `/` path. Website cookies persist normally. Imported cookies may replace existing cookies with matching name/domain/path.

`--user-agent` and `--referer` override those HTTP headers. They do not change the browser engine, TLS fingerprint or JavaScript `navigator.userAgent`. Browser-controlled headers such as Host, Origin, Content-Length, Accept-Encoding, Connection and Sec-* are rejected instead of silently discarded. Browsers forbid CONNECT, TRACE and TRACK and request bodies on GET/HEAD. `--body` sends literal UTF-8; `--body-file` preserves bytes. A body defaults the method to POST. Request bodies are limited to 48 MiB and captured response bodies to 64 MiB.

Navigation overrides apply to main-document requests on the starting origin and, as with Playwright header overrides, to their HTTP redirect chains. They are not added to third-party subresources. Request mode handles each HTTP redirect explicitly and drops all caller headers when crossing origins, while the browser applies cookie domain/path rules. Select `--redirects manual` to inspect a 3xx without following it, or `--redirects error` to reject it; the default follows up to 20 redirects. These policies apply to request mode.

The default persistent context is `web`, separate from provider logins. Select `--context myheritage` (or another provider) to explicitly reuse that provider's browser cookies. The configured browser session name still scopes contexts. Each command creates and closes its own tab; `--keep-tab` retains it after success and includes its ID/viewer URL in JSON. Retained tabs (including `--open=always` and unfinished verification) still expire after 15 minutes without browser API activity; viewer interaction alone does not extend that deadline. Clear general browsing state with `fam cli.browser reset --provider web`; browser stop and reset-all also include it.

Private browsing is off by default. Add `--private` for Chromium incognito windows in CloakBrowser or Firefox private windows in Camofox, using cookies separate from `web` and all provider logins. `--context web-private` selects the same context. Private-window behavior and durable session storage are separate: fam checkpoints private cookies so a browser restart can restore them. Clear this context with `fam cli.browser reset --provider web-private`. It requires the updated plugin's `privateFetch` capability.

Fetching renders in the configured browser in the background. One flag controls the viewer for this command:

- `--open=auto` (default) opens for a recognized human-verification prompt, a challenge that remains unresolved for 10 seconds, or a page/content timeout. A shorter verification timeout opens it before returning the error. Fast automatic checks and ordinary loading pages stay in the background.
- `--open=always` opens immediately and retains the result tab.
- `--open=never` never opens the viewer; verification notices and errors still include its URL.

After auto opens a challenge, the fetch keeps waiting within `--browser-timeout` and resumes if verification completes. Blocked request-mode operations also open for inspection without replaying a write. These policies override the saved viewer preference for this fetch without changing it. The former bare `--open` and `--no-open` fetch flags are replaced by `--open=always` and `--open=never`. Cloudflare, Incapsula/Imperva and the other supported interstitials use the same challenge detection as HTTP recovery. The updated plugin's `fetchInteraction` capability detects visible prompts and controls inside CAPTCHA frames; the persistent-challenge fallback also works when those controls cannot be inspected.

Challenges wait up to the configured browser verification timeout; override with `--browser-timeout SECONDS`. If interaction is needed, fam reports the viewer URL and retains the tab. A zero timeout returns immediately when a challenge is detected. Successful clearance is reused by subsequent commands. Request mode automatically recovers a challenged GET/HEAD once via real navigation; other methods are never automatically replayed after a challenge. A normal HTTP error such as 403 or 404 is returned with its body and status, not treated as a browser failure. JSON `ok` describes command completion; inspect `data.status` for the HTTP outcome. Some sites still require manual CAPTCHA, sign-in, or may continue to deny access; browser fetching cannot guarantee every site will allow a request.

Outputs use private atomic files with `--out`. As with all fam commands, command history records arguments and consumed input files verbatim for reproduction; use `FAM_HISTORY=0` if a particular fetch should not enter history. JSON response headers/content can include session information from the requested site. Nothing is imported from another provider unless its context was explicitly selected.

URL fetching requires the bundled plugin's `fetch` capability. After updating fam, stop/start a local browser once. On a remote browser, update the mounted fam plugin and restart its service once. An older plugin produces an actionable error rather than falling back to plain HTTP.

## Login and verification

```sh
fam myheritage.session login
fam findmypast.session login --region co.uk
fam storied.session login
fam newspaperarchive.session login
```

fam first checks for an existing signed-in browser session. If sign-in is needed, it submits configured credentials at most once per visible login-form step. Hidden login fields do not trigger password entry. If the form disappears before input and the browser confirms that nothing was submitted, fam can try that step again. Account verification runs again when the page changes or the form disappears, so a completed login can resume on the next poll. Password lookup follows the [shared credential rules](setup.md#credential-lookup); browser login does not prompt for a password in the terminal.

`--interactive` autofills empty username and password fields by default, including a password field that appears after a username-only step. It never clicks Sign in or submits the form; you submit through the viewer. Autofill preserves values you have already entered. Use `--no-autofill` to leave the fields untouched and disable automatic credential submission, with or without `--interactive`:

```sh
fam myheritage.session login --interactive
fam myheritage.session login --interactive --no-autofill
```

The same flags apply to Findmypast, Storied, and NewspaperArchive browser login. Interactive autofill requires the updated bundled fam cli.browser service; older remote services must be updated and restarted. Until then, `--no-autofill` retains manual sign-in. For an existing local container, run `fam cli.browser stop` followed by `fam cli.browser start` after updating fam to load the new plugin.

When MFA, CAPTCHA, or another interaction is needed, fam prints the viewer URL, opens it when possible, and waits for account verification. The default wait is ten minutes. `fam cli.browser configure --timeout 0 --no-open` prints the URL and returns when interaction is needed. A command can override the setting with `--browser-timeout 120`. Finish in the viewer and rerun the login command after a timeout. Cookies remain available.

Automatic sign-in allows up to five seconds for the page to load or redirect after submission before asking for interaction. Interactive sign-in and an expired timeout still show the viewer immediately when needed.

MyHeritage and Findmypast validate account access before saving a browser session. Storied captures its native-app callback in the plugin, validates OAuth state, and exchanges the code with PKCE. NewspaperArchive shares Storied authentication. Saved OAuth refresh tokens continue to support ordinary native requests.

In the Camofox fallback, MyHeritage uses actual Firefox private windows. CloakBrowser uses an ordinary persistent Chromium profile. Firefox's ordinary Playwright contexts are containers, which can behave differently even after their storage is erased. The bundled engine bridge scopes private windows to MyHeritage's fam context and exports/restores their cookies and site storage so sign-in survives service restarts. Other browser contexts retain their existing behavior. Updating an existing remote deployment requires the startup command above and one service restart; local setup handles this automatically.

MyHeritage and Findmypast browser commands make at most one login renewal after an explicit session rejection. MFA and provider restrictions may still require your attention. A detected MyHeritage 24-hour login restriction suppresses further automatic password attempts until its recorded deadline; it does not invalidate an existing working session. Health checks do not submit passwords.

MyHeritage login reuses an existing fam website tab, skips blank transport documents, and follows its family-site page's tree link once to obtain the rendered tree context. Renewed login cookies replace the active request cookies before an interrupted operation resumes. A saved cooldown permits verification of an existing session and interactive autofill; it blocks automatic password submission. If the page itself still displays the restriction, fam stops without probing the account or filling credentials. There is no need to delete the cooldown file after signing in manually.

`--capture` remains an alias for browser login. It no longer records a HAR. Existing HAR files can still be imported using `fam myheritage.session login --har FILE` or `fam findmypast.session login --har FILE`; when a browser is configured, imported website cookies are installed into the selected instance and validated. Old unscoped HAR sessions are not silently copied to a remote browser. Use an explicit import or `--transport http` for a legacy direct-HTTP session. Native MyHeritage/Findmypast login is available with `--native`.

## Automatic HTTP recovery

A response with browser-challenge evidence triggers the same recovery for every provider using the shared transport. Detection includes Cloudflare challenge headers and interstitials, Imperva/Incapsula block pages, and “Pardon Our Interruption.” It inspects a bounded body prefix even when the server returns HTTP 200 or a misleading content type. An ordinary permission denial, rate limit, provider error, or ambiguous network failure does not trigger a replay; CDN branding or a 403 alone is not sufficient evidence.

Recovery first sends the request through the persistent browser. If that also encounters a challenge, fam performs a real document navigation: the requested URL for GET, or the site's origin for other methods. This lets verification scripts execute and clearance cookies persist. It waits through blank script-only pages until the browser has loaded visible content, then retries the original method, body, and allowed headers once. A fabricated Referer or an ordinary browser `fetch()` cannot execute an HTML interstitial. Requests still use the provider's origin restrictions and redirect validation; binary content and large JSON integers are preserved. Explicitly non-replayable password submissions retain their provider's no-retry policy.

If verification does not finish, fam retains the verification tab and reports its viewer URL. If the retried request is challenged again, it returns a browser-verification error instead of passing HTML to a JSON or image decoder. Successful browser routing is remembered per provider and origin for the selected browser instance.

After recovery, fam remembers the provider and website origin for the selected instance and uses that browser in later commands. Cookies are refreshed from the browser. An existing browser context takes precedence over stale HTTP cookies.

```sh
fam myheritage.account get --transport browser
fam findmypast.account get --transport http
fam cli.browser configure --transport auto
fam cli.browser.transport reset
```

`--transport auto|http|browser` overrides one command. `configure --transport` changes the default. `cli.browser.transport reset` clears remembered browser routing for the selected instance on this client; it retains logins and works without contacting the browser service. Browser requests currently support responses up to 64 MiB. An unresolved challenge returns the viewer URL, including in structured `--json` errors.

Inspect which transport will start a request without contacting the browser or provider:

```sh
# Every provider, its remembered origins, and its default for other origins.
fam cli.browser.transport list --transport auto
fam cli.browser.transport list --provider familysearch --transport auto

# FamilySearch account reads use this origin.
fam cli.browser.transport get --provider familysearch --origin https://www.familysearch.org --transport auto
```

The output shows the selected policy and its source, the browser mode/session, and each origin's resolved `http` or `browser` choice with its reason. Add `--json` for structured output; `origin: null` is the default for origins without a saved route. Omitting `--transport` uses the current default preference. Precedence is command flag, saved browser configuration, `FAM_TRANSPORT` when no browser configuration exists, then `auto`.

Routing is per provider **and origin**, not one switch for an entire provider. An account API, regional website, and image host can start with different transports. In `auto`, a remembered browser route starts in the configured browser; other origins start in HTTP and can switch after a challenge. The inspector reads the same decision logic as actual requests, but does not predict whether a future response will be challenged or whether authentication will need another origin. Explicit non-replayable operations keep their documented transport restrictions.

These decisions belong to the local fam profile (`FAM_CONFIG_DIR`, normally `~/.config/fam`) and the selected browser endpoint/mode/session. Two CLI hosts can share a remote browser's cookies while having different routing decisions. Run the inspection on the host where you will run the provider command. `fam cli.browser status` reports connectivity and the overall policy; the transport commands report resolved routing without connecting or modifying it.

## Reset browser sessions

```sh
fam cli.browser reset --provider myheritage
fam cli.browser reset --all
fam cli.browser.transport reset
```

`reset --provider NAME` closes that provider's fam cli.browser context, archives its saved profile and this client's matching session snapshot, and replaces the profile with empty cookies and site storage. Closing the context discards its in-memory cache, session storage, IndexedDB, service workers, and open tabs. A fresh blank tab is left for manual sign-in. The command opens or prints the configured viewer URL; `--no-open` only prints it. It never navigates to the provider or attempts a login. The browser service keeps running.

Storied and NewspaperArchive share authentication, so choosing either resets both contexts and snapshots. Other providers and the other local/remote mode retain their sessions. Two clients using the same browser and session name share the reset context.

`reset --all` applies the same reset to **every fam-managed context on the selected browser instance**, across fam session names, including saved contexts that are not currently open. It also archives this client's matching provider snapshots and remembered transport decisions. It leaves no new login tab; start the desired provider's login when ready. It preserves unrelated users and tab groups. If a fam context also contains an unrelated tab group, reset refuses before changing the selection because those tabs share the same site storage.

Both forms retain configured usernames/passwords, native sessions, viewer/API settings, and automatic-login cooldowns. They do not reset the provider's server-side restrictions, change the browser fingerprint or network address, or promise that a restriction is lifted. Complete the next login yourself when appropriate; browser sign-ins support `--interactive` to autofill without submitting.

Profiles are archived privately on the browser host under the configured profile directory’s `fam-reset-backups/` (CloakBrowser: `FAM_BROWSER_PROFILE_DIR`; Camofox: `CAMOFOX_PROFILE_DIR`). Matching CLI snapshots are archived under this client's `browser/<instance-id>/reset-backups/`. These backups contain old account state and are never automatically restored. After reset, the plugin prevents bootstrap cookies and stale HTTP cookies from silently seeding the cleared context, including requests from another fam client. An explicit HAR import can still add cookies. Other clients keep their local snapshots and routing decisions until reset or a new login there.

Reset requires the updated fam cli.browser service and persistence. Updating the service requires rebuilding/restarting CloakBrowser or restarting Camofox to load its mounted plugin; running either reset afterward does **not** restart the browser. For an existing local container, stop/start it once after updating fam. For a remote deployment, update the mounted plugin and restart its service.

`fam browser reset` and `fam browser.transport reset` are short aliases. Migration: the old bare `fam cli.browser reset` only forgot transport decisions. It now requires `--provider NAME` or `--all`; use `fam cli.browser.transport reset` for the old behavior.

## Session storage and sharing

Local and remote browser contexts remain separate. Switching modes restores that mode's saved provider session and routing decisions. Two clients using the same remote service and `--session` name (default `default`) share browser cookies and website logins there. They create their own tabs, so normal fetches do not navigate another command's login tab. Remote stop closes fam tabs for that shared session name, including those opened by another fam client.

Configuration is stored in `browser/config.json` under the [fam profile](setup.md#storage-and-profiles). Provider session snapshots and routing preferences live under `browser/<instance-id>/`. Local Docker storage is under `browser/local-cloakbrowser/profiles/` for CloakBrowser and `browser/local/profiles/` for Camofox. CloakBrowser retains ordinary Chromium profiles plus cookie/storage checkpoints. Camofox persists cookies, local storage, and supported IndexedDB state; this is not a complete Firefox profile backup. A website can expire or revoke login independently.

An explicit native login selects that native session for the current instance without deleting its previous browser login. Browser login selects the browser session again. Browser checkpoints contain account state and remain on the configured browser host.

CloakBrowser uses a headed window, GeoIP timezone/language detection, and the default humanization preset. Humanization is applied to fam’s Playwright CDP connection, including locator-based form filling. The binary remains pinned; no browser upgrade is required. GeoIP uses the server’s public IP (no proxy is configured by fam) and may download its database on first startup. Lookup is bounded to 40 seconds; if unavailable, the service logs a warning and starts with the binary defaults. These settings can improve consistency but do not guarantee that a site will accept the browser.

For service troubleshooting, set `FAM_CLOAKBROWSER_GEOIP=false` or `FAM_CLOAKBROWSER_HUMANIZE=false` on the container before recreating it. This does not switch engines or erase profiles. The CDP interaction regression can be run with `npm --prefix browser/cloakbrowser ci --ignore-scripts` followed by `node --test test/cloakbrowser-human.integration.mjs`.
