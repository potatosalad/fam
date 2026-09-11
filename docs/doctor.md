# Provider health checks

```sh
fam cli.health check                         # Verify sessions online and renew when needed
fam doctor                                   # Alias for fam cli.health check --live
fam cli.health check --provider ancestry --provider findmypast     # Check selected providers
fam cli.health check --verbose               # Individual checks and recovery details
fam cli.health check --json                  # Structured online report
fam cli.health check --offline               # Local inspection, no requests or changes
fam cli.health check --live --force          # Rerun live checks and replace cached results
fam doctor --no-pretty                        # Plain report without animation or colors
fam doctor --no-fix                           # Check online without changing saved sessions
```

Doctor prints one row per provider and an actionable next step for failures. Add `--json` for a structured report. `OK` means access passed its latest live check; reused results are labeled `cached live result`. `Session refreshed and verified` means token renewal restored access during this run; `Signed in again and verified` means the normal login flow restored it. An offline `SAVED` result only describes local files. `--live` remains accepted as an alias for the default online behavior.

Each individual live check caches its completed result for one hour plus or minus 15 minutes of random jitter (45–75 minutes). The expiry is chosen independently when each result is saved; reading it does not extend its lifetime. Cache entries are keyed by provider and check ID under `<profile>/cache/health/`, using private atomic storage. Both successes and failures are reused, including failures after attempted recovery. Offline session, credential, pending-authentication, and browser-configuration checks run every time. Local blockers that prevented an online attempt are not cached.

Overlapping invocations coordinate separately for each live check: the later invocation waits and reads the completed result. Other check IDs remain independent. If a check's lock cannot be acquired within one minute, it reports a warning and sends no provider requests.

Use `--force` to bypass and replace the selected live checks' cached results, including immediately after changing credentials or sessions. This works with the default online mode, `--live`, and `fam doctor`. `--force --no-fix` checks again without repairing or saving sessions. `--offline --force` still performs only local inspection. Cache hits never repeat renewal or login, replay old recovery actions, or restore session data. `--no-fix` can still write the live-result cache. Missing, damaged, or unreadable cache entries are checked again; a cache write failure leaves the health result intact.

In a color-capable TTY with room for the provider rows, doctor immediately shows every selected provider with a spinner, the current check, and elapsed time. Completed providers change to a green check mark, yellow warning, or red failure while other checks continue. Browser verification links and other notices remain visible above the display. `--verbose` retains the live display and adds detailed results afterward.

Use `--no-pretty` to disable animation and colors. Piped output, `--out` files, JSON, CI, `TERM=dumb`, `NO_COLOR`, and `NODE_DISABLE_COLORS` use the plain output path automatically. Checks run concurrently in every output mode, and final reports retain the selected provider order. Integrations sharing a session, currently Storied and NewspaperArchive, take turns so renewal and session writes cannot race.

`fam doctor` accepts the health command's flags and records the canonical `cli.health check` command in history. It explicitly selects `--live`, so use `fam cli.health check --offline` for local inspection.

## Session validation and renewal

When a live check is due or forced, every authenticated provider follows the same sequence: check access with the saved session, try token renewal if supported, then try the provider's normal `session login` flow. Doctor checks access after each repair and stops as soon as it succeeds. Expiry metadata alone does not trigger renewal when access still works. Missing or malformed sessions can go directly to login when credentials and any required browser are configured.

There is at most one refresh and one login attempt per saved session in a run, including sessions shared by Storied and NewspaperArchive. Rotated tokens are saved before verification. Successful checks retain updated cookies and browser credentials. `--no-fix` disables refresh, login, and doctor session saves; it still checks access online. `--offline` only inspects local state.

Authentication rejection, account-access denial, and unexpected account responses can all trigger recovery: a stale session does not always produce HTTP 401. Rate limits, outages, connection failures, and local save failures stop recovery. Browser providers can use their normal browser flow to resolve website challenges. Login uses existing credentials or the configured browser, respects login cooldowns, and reports required human verification. Doctor does not configure a new browser, request verification codes, or retry a failed password submission. Healthy sessions never trigger login or credential-helper execution.

Account probes and login validation make only the reads needed to establish access. There are no research searches, record purchases, downloads, or account-content writes. Login retains its normal origin and redirect restrictions. Session writes use private profile storage and its configured sync hook.

| Provider | Authenticated check | Recovery |
| --- | --- | --- |
| FamilySearch | Current account | Refresh token, then normal Church Account login |
| Ancestry | Tree listing, limit one | Refresh token, then normal login |
| MyHeritage native | Account ID | Native renewal, then browser login |
| MyHeritage browser | Saved signed-in tree page | Recapture the configured browser session or sign in there |
| Findmypast native | Current account | Refresh token, then browser login |
| Findmypast browser | Current account on the captured regional API | Browser login, preserving the region |
| Find a Grave | Signed-in contributor | Normal login |
| Geneanet | Signed-in account | Normal login |
| Storied | Account tree list | Refresh token, then browser authorization |
| NewspaperArchive | Identity and newspaper country catalog | Shared Storied refresh and browser authorization |
| American Ancestors | Signed-in website session | Normal login |

Public providers Cyndi’s List and Wayback have no account login to repair. Ordinary provider commands retain their existing renewal behavior; doctor performs the additional login recovery described here.

## Output and exit codes

Use `--verbose` for individual checks, their original check and expiry times, recovery attempts, scoped password-login notices, and coverage limits. JSON live results include `cached`, `checkedAt`, and `expiresAt` (when successfully cached). The report-level `checkedAt` describes the current invocation. JSON also includes each provider's attempted `recovery` steps and their outcomes, plus stable issue codes such as `session-rejected`, `refresh-rejected`, `login-failed`, `session-save-failed`, `access-denied`, and `rate-limited`. Reports omit tokens, passwords, cookie values, account details, and raw response bodies. `FAM_CONFIG_DIR` selects the profile using the normal CLI rules.

Exit code `0` means no warnings or errors affecting the saved session in performed checks; `1` means attention is needed; `2` means invalid arguments. Offline success never establishes online readiness. Session validation does not prove every search, subscription feature, download, or write capability works. Select providers to avoid setup warnings for services you have never configured.

Health checks now use `fam cli.health check`. The compact table is the default; add `--verbose` for details or `--json` for a structured report. Provider filtering uses repeated `--provider NAME` flags.
