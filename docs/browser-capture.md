# Browser sign-in and automatic HAR capture

Run one command on a computer with a desktop display:

```sh
fam myheritage.session login --capture
fam findmypast.session login --capture
```

Sign in in the browser window and complete any verification. You can stay on the home page, search records, or browse normally. fam fetches the supporting account context and makes a read-only account request in the background, closes its capture window, saves a HAR including sensitive data, and imports it after checking the account through the CLI's normal HTTP transport. Success prints session metadata and `harPath`; it never prints the HAR or cookies.

The command starts recording before navigation and records login popups and new tabs in the same browser context. MyHeritage capture includes authenticated tree context, account permissions, and website FamilyGraph/FamilyGraphQL requests; Findmypast capture includes the website Titan GraphQL route. Cookie headers, HTTP-only cookies, bearer tokens, and API request bodies are retained automatically. Password-submission endpoints and unrelated origins are excluded from the HAR. The browser profile itself retains signed-in website state.

## Browser and region

fam uses installed Google Chrome by default. When Chrome is absent, it uses Playwright's Chromium and downloads that browser on first use if necessary. The download needs internet access. Choose a browser explicitly with:

```sh
fam myheritage.session login --capture --browser-channel chromium
fam findmypast.session login --capture --browser-channel msedge
fam findmypast.session login --capture --region co.uk
```

Channels are `chrome`, `msedge`, and `chromium`. Explicit Chrome and Edge selections require those browsers to be installed. Findmypast defaults to `.com` and also supports `.co.uk`. MyHeritage uses `.com`, matching its website-session importer.

Each provider has a dedicated browser profile under the fam configuration directory. Subsequent captures can reuse its login. The capture window is separate from your normal browser profile. Finish or close one capture before starting another for the same provider. To select a specific MyHeritage tree or switch sites, pass `--tree-url` followed by the full MyHeritage family-tree page URL. Only the supported `.com` tree routes are accepted.

## Private output

With the default configuration, HARs are saved under:

```text
~/.config/fam/myheritage/browser/capture-XXXXXX/session.har
~/.config/fam/findmypast/browser/capture-XXXXXX/session.har
```

`FAM_CONFIG_DIR` selects a different profile. Every run uses a new directory. Capture directories and browser profiles have owner-only permissions on POSIX systems, and completed HAR files are mode `0600`. HARs remain available for reuse; delete a capture directory when you no longer need its HAR. They contain active session credentials and may include personal tree data. Keep the configuration directory outside Git and shared folders. Normal commands use the saved provider session and need no running browser.

An existing HAR can be imported separately:

```sh
fam myheritage.session login --har /private/path/session.har
fam findmypast.session login --har /private/path/session.har
```

## If sign-in does not finish

- Complete MFA, CAPTCHA, consent, or a website access restriction yourself in the capture window. fam does not automate password entry or solve verification challenges.
- MyHeritage context is fetched using your current browser cookies. No tree visit, menu label, login-page variable, or readable person is required. Tree links are discovery hints; the provider's default tree route is a fallback. `--tree-url` is an optional site override. A provider verification page still needs your attention.
- The command waits up to ten minutes. Set a different limit with `--capture-timeout 1200` (1–3600 seconds). Ctrl-C, termination, or timeout closes the browser and attempts to flush the HAR. An incomplete capture does not count as authenticated.
- If the final account check fails, the HAR remains private for inspection or a later `auth --har` retry. The previous saved session is preserved when validation fails. A browser success alone does not prove that the CLI's HTTP transport is accepted by the provider.
- If the browser cannot launch, close another capture using the same provider profile, check the desktop display, or select `--browser-channel chromium`. A forced process kill or browser crash may prevent HAR finalization; rerun the capture.
- For a CLI running on a server without a desktop, capture on your desktop, transfer the HAR privately, and import it on the server.

Real-browser regression tests cover synthetic interactive login, record-search pages without login markers or navigation links, empty trees, account validation, and both Findmypast regions. Live MyHeritage capture and account validation were also verified locally; personal observations and HARs remain outside this repository.

Implementation references: Playwright's [persistent browser contexts and HAR options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) and [network request headers](https://playwright.dev/docs/api/class-request#request-all-headers).
