# Provider health checks

```sh
fam doctor                         # Verify sessions online and renew when needed
fam doctor ancestry findmypast     # Check selected providers
fam doctor --verbose               # Individual checks and recovery details
fam doctor --json                  # Structured online report
fam doctor --offline               # Local inspection, no requests or changes
```

Doctor prints one row per provider and an actionable next step for failures. `OK` means an authenticated request succeeded during this run. `Session refreshed and verified` means doctor also renewed and saved the session first. An offline `SAVED` result only describes local files; it cannot establish that credentials still work. `--live` remains accepted as an alias for the default online behavior.

## Session validation and renewal

Doctor makes one small authenticated read for each saved session. If an access token is about to expire, it first uses the provider's existing renewal flow. If a read instead rejects authentication, doctor renews once and retries the read once. The renewed credentials are saved before verification so a rotated refresh token is retained even if the subsequent request fails. Successful checks also retain updated cookies; MyHeritage browser checks save the current API token from the authenticated tree page.

Doctor never submits a password, starts a new login, executes a password lookup helper, requests verification codes, or removes login cooldown markers. Pending password sign-in and credential configuration issues remain visible in detailed output without invalidating a working saved session. Missing or malformed sessions require setup before an online check can run.

Permission errors, verification challenges, rate limits, server errors, and connection failures do not trigger renewal or retries. MyHeritage can return an Incapsula challenge with HTTP 200; this is reported as `request-challenged`, not expired credentials or a password-login block. A failed renewal stops that provider's check. There are no searches, catalog reads, tree traversal, record purchases, downloads, or data writes to provider accounts. Requests do not follow redirects. Session writes use the normal private profile storage and its configured credential sync hook.

| Provider | Authenticated check | Automatic renewal |
| --- | --- | --- |
| FamilySearch | Current account | Saved refresh token |
| Ancestry | Tree listing, limit one | Saved refresh token |
| MyHeritage native | Account ID | Native token renewal |
| MyHeritage browser | Saved signed-in tree page | Current API token and cookies from the page |
| Findmypast native | Current account | Saved refresh token |
| Findmypast browser | Current account on the captured regional API | Retain updated cookies; an expired website login requires sign-in |
| Find a Grave | Signed-in contributor | No known renewal endpoint |
| Geneanet | Signed-in account | Retain updated cookies; an expired website login requires sign-in |
| Storied | Account tree list | Saved refresh token |

## Output and exit codes

Use `--verbose` for individual checks, scoped password-login notices, and coverage limits. JSON contains stable check IDs and issue codes, including `session-rejected`, `refresh-rejected`, `session-save-failed`, `access-denied`, and `rate-limited`. Reports omit tokens, passwords, cookie values, account details, and raw response bodies. `FAM_CONFIG_DIR` selects the profile using the normal CLI rules.

Exit code `0` means no warnings or errors affecting the saved session in performed checks; `1` means attention is needed; `2` means invalid arguments. Offline success never establishes online readiness. Session validation does not prove every search, subscription feature, download, or write capability works. Select providers to avoid setup warnings for services you have never configured.
