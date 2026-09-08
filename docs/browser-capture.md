# Browser capture compatibility

Browser sign-in now uses the configured persistent Camofox service. See [browser setup, remote URLs, session reuse, and verification](browser.md).

These existing commands remain supported as aliases:

```sh
fam myheritage.session login --capture
fam findmypast.session login --capture --region co.uk
```

They use the same flow as `session login`, without generating a HAR or launching a separate Playwright browser. `--capture-timeout` remains a wait-time alias; new scripts can use the shared `--browser-timeout` flag. `--browser-channel camofox` is accepted. Old Chrome, Edge, and Chromium selections produce instructions to configure Camofox.

Existing HAR files remain importable:

```sh
fam myheritage.session login --har /private/path/session.har
fam findmypast.session login --har /private/path/session.har
```

Import validates account access. With a configured browser, website cookies are installed into the selected local or remote instance. Existing historical HARs are left untouched. They contain account credentials and may contain personal research data.
