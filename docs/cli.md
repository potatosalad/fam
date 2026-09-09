# Command interface

Provider and CLI operations use `fam <provider>.<object> <action> --flags`. Objects can have another dotted component for API protocols and existing provider concepts. IDs and other inputs use named flags. The `cli` provider owns discovery, inspection, context resolution, health checks, completion, and version information.

```sh
fam cli.command search --query "download an original document image"
fam cli.command search --query "find a grave biography" --provider findagrave
fam cli.command describe --command "familysearch.image download" --json
fam cli.command list --provider ancestry
fam ancestry.person get --tree-id TREE --person-id PERSON
fam ancestry.api.gql query --operation GetTreeList --variables '{"limit":20}'
fam myheritage.api.gql execute --document query.graphql --variables variables.json
fam cli.health check --provider ancestry --offline
```

`src/shared/command-registry.ts` is the authoritative command registry. It supplies command identities, descriptions, examples, typed flags, required inputs and documented defaults, advisory response schemas, side effects, execution bindings, help, and completion. The build also exports it as `dist/shared/commands.json`. Provider adapters keep the existing clients and service behavior.

## Local discovery

Provider and object prefixes show local help without signing in or making provider requests:

```sh
fam ancestry
fam ancestry.person --help
fam ancestry.api --help
fam ancestry.api.gql
```

Provider help lists every registered object type, documentation, and suggested next commands. Object help lists available actions and nested object types. Append `--json` to either for structured help. Namespace help uses the usual success envelope with `command: null` and the inspected namespace in `data`.

`fam cli.command describe --command "ancestry.person get"` prints a compact, indented description with provider, object, action, operation type, effects, typed options, requirements, and examples. `--json` returns the complete registry schema. Confirmation requirements are `none`; fam does not add confirmation prompts.

Unknown providers, object types, and actions show the relevant available choices and a “Did you mean?” list with option hints. Suggestions use registered names and local spelling similarity. They are never executed automatically. JSON errors include the same choices and suggestions; invalid invocations retain exit code 2.

Search combines BM25 keyword scoring with a small, inspectable vocabulary of related concepts. It runs entirely locally, needs no profile or model download, and never executes a provider command. This initial version uses vocabulary expansion rather than embedding inference. Results come only from the registry.

Results include shell syntax, an argument array, required and missing flags, prefilled values, examples, risk, and an inspection command. A template containing `<REQUIRED_VALUE>` needs that value replaced before execution. `ready` indicates that the registry's required flags are present; provider-specific input constraints and account access still apply. Results default to the top three; `--limit` and `--offset` expose further matches and explicit continuation metadata.

```sh
fam cli.command search --query "download original image" --context 'https://www.familysearch.org/ark:/61903/3:1:EXAMPLE'
fam cli.context resolve --context 'https://www.findagrave.com/memorial/12345/example'
```

Recognized URL shapes prefill provider IDs or URLs without network requests. Unknown shapes and bare ambiguous IDs remain unresolved. This is a deliberately small resolver; it does not inspect browser state or recent command history.

## Results and failures

Readable text is the default, even when stdout is piped. Bare `fam` and `fam --help` show common tasks, global options, and discovery shortcuts. Command listings group commands by provider; search shows ready-to-edit invocations, required flags, and examples. `fam cli.provider list` lists available providers.

Add `--json` for machine output. A successful invocation then writes one envelope to stdout:

```json
{"schemaVersion":1,"ok":true,"command":"ancestry.person get","data":{"provider":"result"}}
```

Provider data is preserved, including exact large integer values. The response schemas describe expected shapes; fam does not reject unexpected provider fields or changed shapes. Consumers should handle optional fields. Large identifiers should be passed as strings and read with a lossless JSON parser where necessary.

By default, failures print a readable error and suggested invocation to stderr. With `--json`, failures write a JSON envelope with `ok: false` and `error.code` / `error.message` to stderr. Invalid syntax includes `error.suggestedInvocation`; execution failures include a command inspection invocation. Exit codes are 0 for success, 1 for execution failure or health issues, and 2 for invalid command/flags. Health findings remain in the JSON report even when the exit code is 1.

`--out FILE` preserves existing private file and download behavior and prints a file receipt in the selected output format. Provider JSON files contain the provider data; CLI metadata exports use readable text by default or the CLI envelope with `--json`. Downloads retain source/checksum sidecars where already supported. Binary results require an output file.

Provider pagination defaults and continuation fields are preserved. Paginated commands include a note describing their existing scope; no extra global result cap is applied. Ancestry's person-list shortcut still returns its first connection. FamilySearch's existing `--all`, `--limit`, and continuation options remain available. An absent next-page field is not a claim that all records have been retrieved.

`--format text` and `--format json` remain available for transcripts, FamilySearch listings, health summaries, and shell scripts. Conflicting `--json` and `--format text`/`jsonl` flags fail before execution. FamilySearch listing `--format jsonl` emits tagged item records followed by a summary containing continuation information; file output retains item JSONL and returns continuation metadata in the receipt.

## Command history

Every invocation writes a `start` record and, on normal process exit, a `finish` record to `<profile>/history/YYYY-MM-DD.jsonl`. The default is `~/.config/fam/history/`; `FAM_CONFIG_DIR`, XDG configuration, and platform defaults follow the [profile rules](setup.md#storage-and-profiles). Dates are UTC. Both records use the starting date's file, even if the command crosses midnight. Help, completion, discovery, invalid invocations, and dry runs are included. This starts with the installed logging version; earlier calls cannot be reconstructed.

The schema has `schemaVersion: 1`, a shared invocation `id`, timestamps, `command`, `provider`, redacted `argv`, CLI `version`, `build.revision` / `build.dirty`, and Node/platform information. The start record has the attempted argv; the canonical command becomes available after lookup. Finish records include `durationMs`, the actual `exitCode`, `settled`, `error`, and up to 32 `diagnostics` with codes, messages, result paths and selected error details. Error details include HTTP status, stack frames and bounded causes, when available. `build` is null when running TypeScript source directly; installed builds retain the Git revision from build time (or null when built without Git metadata).

- `success`: exit code zero, command settled, and no detected failure diagnostics.
- `soft_failure`: exit code zero with explicit returned errors/warnings, failure status, or a recorded recovery. Examples include GraphQL partial errors, stale-cache warnings, credential-sync failure, authentication rejection followed by a retry, transient document-service HTTP retries, and automatic browser fallback after a website challenge. Expected proactive token renewal is not a failure.
- `hard_failure`: nonzero exit (including syntax errors and health-check findings), an uncaught error, or exit before the command settled. Existing CLI output and exit-code behavior stay the same.

Inspection looks for explicit `error(s)`, `warning(s)`, `ok: false`, `success: false`, failure/warning/partial status, and `partial: true`, including nested results and results saved using `--out`. Empty searches, `authenticated: false` in local session status, and pagination such as `complete: false` are not failures by themselves. Schema/discovery results are excluded from inspection. Inspection is bounded to 10,000 objects and 20 levels; a success classification means no detected marker, not proof that a provider's answer is correct. Newly discovered silent failure cases should add a regression test and either a provider validation or an explicit diagnostic using `src/shared/diagnostics.ts`.

Search completed failures with `jq` (substitute your profile path if different):

```sh
jq -c 'select(.event == "finish" and .outcome != "success")' ~/.config/fam/history/*.jsonl

# Soft failures only; the CLI still exited zero.
jq -c 'select(.event == "finish" and .outcome == "soft_failure")' ~/.config/fam/history/*.jsonl

# Find a recovery or error code.
jq -c 'select(.event == "finish" and any(.diagnostics[]?; .code == "AUTH_RETRY"))' ~/.config/fam/history/*.jsonl

# Most frequent failing commands (slurps the selected files into memory).
jq -s '[.[] | select(.event == "finish" and .outcome != "success")]
  | group_by(.command) | map({command: .[0].command, count: length}) | sort_by(-.count)' ~/.config/fam/history/*.jsonl
```

A start without a finish can mean a still-running process, signal termination (including Ctrl-C or SIGKILL), a crash, or a failed history write. It is not automatically a confirmed bug. Find these calls across the selected files, then check whether their process is still running:

```sh
jq -s 'group_by(.id)[] | select(any(.event == "start") and all(.event != "finish")) | .[]' ~/.config/fam/history/*.jsonl
```

History is local to each host and profile; it is not uploaded or synchronized with credentials. Direct library calls do not create history. Files use mode `0600` and directories `0700`; concurrent CLI processes append individual JSON records. Daily files are retained until you archive or delete them. Archive inactive days to manage disk use. Logging failures emit one warning per invocation and preserve the command's behavior. Disk failure or abrupt termination can still leave missing records or an incomplete final line.

Argument values, stdin, environment dumps, full stdout/stderr, request/response bodies, headers, and credential objects are omitted. Diagnostic text redacts known argument/environment values, URL paths and queries, email addresses, and common token/password/cookie patterns. Free-form provider messages can contain other personal details, so keep history private and review selected diagnostics before including them in a public bug report. Messages and stacks are bounded; `droppedDiagnostics` counts additional emitted findings omitted after the 32-entry limit. Set `FAM_HISTORY=0` to disable recording for a process, including help and dry runs:

```sh
FAM_HISTORY=0 fam cli.version get
```

## Shell completion

`fam --completions bash` and `fam --completions zsh` print shell scripts. Enable completion in the current shell with `eval "$(fam --completions bash)"` (use `zsh` in zsh), or run `fam cli.completion install` to enable it in future shells. `fam cli.completion script --shell bash` remains available.

## Effects

There are no confirmation prompts or confirmation flags. Selecting an operation executes it, including writes. Generic API entries declare operation-dependent effects: an HTTP GET or GraphQL query can have side effects, and Findmypast's cataloged GetTranscriptById can confirm a credit purchase. Inspect the provider operation with `fam PROVIDER.api describe --operation NAME` when needed.

`--dry-run` checks command flags and returns a plan without provider requests, credential lookup, or output file writes. The invocation is still recorded in command history unless `FAM_HISTORY=0`. It does not simulate the service or validate arbitrary operation bodies. Provider response schemas are advisory during normal execution too.

## Migration

The old provider/command grammar is removed. See the [complete command mapping](cli-migration.md). Authentication, provider transports, credential helpers, origin checks, token redaction, and session storage keep their existing behavior. Reinstall completion with `fam cli.completion install` to replace the marked startup hook.
