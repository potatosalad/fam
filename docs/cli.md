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

`fam doctor` is shorthand for `fam cli.health check --live`, with the same flags, output, and exit codes. Independent provider checks run concurrently. Each authenticated provider checks access, tries refresh if supported, then tries normal login, stopping on success. Use `--no-fix` to check without repairs or session saves. Interactive color terminals show animated provider rows; use `--no-pretty` for plain output. Pipes, JSON, files, CI, and `NO_COLOR` disable the display automatically. See [health checks](doctor.md) for details and offline inspection.

## Local discovery

Provider and object prefixes show local help without signing in or making provider requests:

```sh
fam ancestry
fam ancestry.person --help
fam ancestry.api --help
fam ancestry.api.gql
```

Provider help lists every registered object type, the `fam cli.doc read --provider PROVIDER` command for its full guide, and suggested next commands. Object help lists available actions and nested object types. Provider and command listings put FamilySearch first, then sort alphabetically; objects and actions are alphabetical within each provider. Search results remain ordered by relevance. Append `--json` to either for structured help. Namespace help uses the usual success envelope with `command: null` and the inspected namespace in `data`; `documentation` contains the runnable guide command.

`fam cli.command describe --command "ancestry.person get"` prints a compact, indented description with provider, object, action, operation type, effects, typed options, requirements, and examples. `--json` returns the complete registry schema. Confirmation requirements are `none`; fam does not add confirmation prompts.

Unknown providers, object types, and actions show the relevant available choices and a “Did you mean?” list with option hints. Suggestions use registered names and local spelling similarity. They are never executed automatically. JSON errors include the same choices and suggestions; invalid invocations retain exit code 2.

Search retrieves candidates with **0.20 BM25 lexical + 0.80 semantic** scores using [Snowflake Arctic Embed XS](https://huggingface.co/Snowflake/snowflake-arctic-embed-xs). It runs locally on the CPU with a quantized 384-dimensional model, requires no API key, Python, GPU, or separate service, and never executes a provider command. The first search automatically downloads about 95 MB of pinned model/tokenizer files for Arctic and the Ettin reranker from Hugging Face and indexes the command catalog. Later searches work offline. Query text stays on the machine; the normal [command history](#command-history) policy still applies.

The ranked table shows ten results by default, with command, type, description, and useful flags (required flags first). Scores are hidden in human output unless you pass `--scores`; JSON always includes them. Use `--format tree` to group matches by provider and object, `--format text` for detailed invocation templates, or `--json` / `--format json` for structured results. `--limit` and `--offset` paginate matches. For example:

```sh
fam cli.command search --query "save a full resolution scan of a historical document"
fam cli.command search --query "merge duplicate people" --provider familysearch --format tree
fam cli.command search --query "show the CLI calls that failed recently" --limit 5 --json
```

BM25 uses k1=1.2 and b=0.75, normalized by the highest lexical score in the relevant corpus for the query. Command descriptions and documentation passages have separate BM25 corpora, so long guides do not affect short command descriptions' length normalization. Semantic scores are cosine similarity between normalized CLS embeddings, clamped to [0, 1]. Hybrid retrieval combines `0.20 * lexicalScore + 0.80 * semanticScore`; scores are relevance signals, not probabilities. Provider filtering and pagination do not change BM25 normalization. Semantic matches can rank even when they share no lexical tokens with the query.

Command search embeds registered names and descriptions and implemented FamilySearch operation names and descriptions. It applies the provider filter before embedding. Installed Markdown guides contribute fast BM25 matches without building a guide vector index. Guide passages are grouped by heading and split into overlapping chunks of at most 200 words. A passage can help discover the registered commands explicitly mentioned in its section. The lexical component uses the larger of the command's BM25 score and 90% of its best supporting passage's BM25 score; the semantic component always uses the command's embedding. JSON retains the direct command's `lexicalScore` and `semanticScore`; `documentation` identifies supporting guide text, its discounted lexical score, and the command to read it. Human output shows that guide command. Search returns registered actions or operations, never executable instructions invented from prose.

Search then automatically applies a second ranking stage with [Ettin 17M](https://huggingface.co/cross-encoder/ettin-reranker-17m-v1). It reads each query and command description, including the best matching window of up to 64 words from a supporting guide passage when present, and orders the top **100** BM25 + Arctic candidates by relevance. Results retain the full supporting excerpt and guide link. Use `--no-rerank` to skip this stage for comparison or lower latency. It runs locally with the same inference runtime, using the optimized fp32 ONNX encoder and its published scoring layers. Query/document pairs are bounded to 512 tokens. It automatically downloads about 71 MB of pinned Ettin weights and tokenizer files on first use; existing Arctic vectors remain reusable. Subsequent searches work offline.

```sh
fam cli.command search --query "search for Abraham Lincoln from 1809"
fam cli.command search --query "search for Abraham Lincoln from 1809" --limit 100 --scores
```

Reranking applies after provider filtering and before pagination. Its fixed 100-candidate shortlist does not change with `--limit` or `--offset`; a search with reranking returns at most 100 matches. It cannot recover commands outside that shortlist. JSON reports `engine: "local-bm25-embeddings-reranked"`, the pinned `reranker`, and `retrievedTotal` before the shortlist. Each match's `score` and `rerankScore` are raw model logits (which can be negative); `retrievalScore` retains the 20/80 score and `weights` describes that retrieval stage. Scores remain hidden in human output unless `--scores` is passed, and logits are not probabilities or comparable to retrieval scores. If reranking fails, an explicit warning accompanies the original BM25 + Arctic results. `--lexical` skips both models.

Model files and the embedding index live in `<profile>/cache/command-search/`, following `FAM_CONFIG_DIR` and the [usual profile rules](setup.md#storage-and-profiles). Model files are verified with SHA-256 and saved atomically; missing or damaged files download again. Vectors are cached by text under a pinned model/preprocessing fingerprint. Editing one entry computes only its new vector; reordering entries or switching between command and documentation searches retains unchanged vectors. Invalid vectors are repaired individually, and longer indexing runs save checkpoints. A model/preprocessing change or an older cache format requires fresh vectors. Deleting that cache safely forces a fresh setup. If model setup fails (for example, first use without internet), search explicitly reports the problem and returns BM25 results; a later search retries automatically. Use `--lexical` to skip embeddings and all model downloads. Help, completion, and ordinary provider commands do not initialize the search model.

Results include registered commands and individual operations from the FamilySearch genealogy catalog. Operation matches identify the existing `familysearch.api call` command, prefill `--operation`, and provide operation-specific inspection and input-template commands. Provider help and `familysearch.api --help` list the available genealogy operation groups.

Use `fam familysearch.api describe --operation memories.search` or `fam familysearch.api call --operation memories.search --help` to inspect an operation's effects, input and output schemas, referenced model fields, examples, and limitations. Add `--json` for complete schemas with local `$defs`; no external document lookup is needed to resolve model references. FamilySearch operation names also complete after `--operation`. Descriptions describe implemented contracts; they do not assert live verification or complete website coverage.

Results include shell syntax, an argument array, required and missing flags, prefilled values, examples, risk, and an inspection command. A template containing `<REQUIRED_VALUE>` needs that value replaced before execution. `ready` indicates that the candidate's required flags are present; provider-specific input constraints and account access still apply. Operation candidates conservatively request an input file whenever the operation accepts parameters, including optional filters; their `requiredInput` lists the actual required wire parameters. Results default to the top ten; `--limit` and `--offset` expose further matches and explicit continuation metadata.

```sh
fam cli.command search --query "download original image" --context 'https://www.familysearch.org/ark:/61903/3:1:EXAMPLE'
fam cli.context resolve --context 'https://www.findagrave.com/memorial/12345/example'
```

Recognized URL shapes prefill provider IDs or URLs without network requests. Unknown shapes and bare ambiguous IDs remain unresolved. This is a deliberately small resolver; it does not inspect browser state or recent command history.

## Documentation

Read the full installed guide directly from provider help's `Documentation:` command:

```sh
fam cli.doc read --provider americanancestors
fam cli.doc read --provider familysearch
fam cli.doc read --provider cli
fam cli.doc read
```

With no selector, `read` opens the main README. A provider selects its README; `cli` selects this command guide. `--doc ID` selects a specific document, such as `setup`, `browser`, `americanancestors/protocol`, or `familysearch/document-research`. These are installed catalog IDs, not arbitrary filesystem paths. List documents and their section IDs with:

```sh
fam cli.doc list
fam cli.doc list --provider americanancestors
fam cli.doc list --doc americanancestors
fam cli.doc read --doc americanancestors --section family-members-and-collection-specific-fields
```

A section includes its subsections. `--section` accepts the listed ID or a unique exact heading, with case-insensitive heading matching. Repeated headings have distinct IDs. Shell completion supplies document IDs and section IDs for the selected document or provider.

Text output retains examples and converts links to other installed Markdown guides into runnable `fam cli.doc read` commands. `--format markdown` returns the original Markdown, while `--json` returns document metadata, sections, Markdown, and readable text. Use `--out FILE` with any format. Reading and listing require no account, browser, model, or network connection.

```sh
fam cli.doc read --provider americanancestors --format markdown --out americanancestors.md
fam cli.doc read --doc setup --json
fam cli.doc search --query "collection-specific fields"
fam cli.doc search --provider americanancestors --query "search by spouse" --lexical
fam cli.doc search --doc browser --query "remote server" --limit 5
```

Documentation search returns matching sections with excerpts, provider and source information, and commands to read them. Long sections can have several indexed passages; only the best matching passage is shown for each section. `--provider` and `--doc` restrict results and embedding work, `--limit` and `--offset` paginate them, and `--json` returns structured results. It uses local BM25 and Arctic passage embeddings, then Ettin reranking of up to 100 section matches. Unlike command search, it can retrieve guide passages with no shared query words. Its first unfiltered search embeds all guide passages and can take longer; a provider or document filter limits that initial work. `--lexical` skips model loading/downloads; `--no-rerank` skips Ettin. Model failures report the fallback. Command and documentation searches share their model files and reusable cached vectors.

The main README and all Markdown guides under `docs/` are bundled with each build, including npm installations. Installed commands use their build's documentation snapshot. Edits to a guide enter the next build; documentation search computes new vectors only for changed passage text. Guide edits do not invalidate the command vector index. There is no separate maintained documentation copy.

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

Use the CLI to browse history without writing `jq` queries:

```sh
fam cli.history list
fam cli.history list --limit 0
fam cli.history.failures list --since 24h
fam cli.history.failures list --provider ancestry --outcome soft_failure
fam cli.history.failures list --code AUTH_RETRY
fam cli.history list --query "Expected JSON" --since 7d
fam cli.history list --outcome incomplete
fam cli.history.failures summary --since 7d --group-by code
fam cli.history summary --group-by provider
fam cli.history stats --since 7d
fam cli.history get --id <ID_FROM_LIST>
```

`cli.history.failures` is a nested object with `list` and `summary` actions. It restricts results to recorded soft and hard failures. `cli.history` provides `list`, `summary`, `stats`, `get`, and `archive` for all outcomes; run `fam cli.history` or `fam cli.history.failures` to browse their help. The list, summary, stats, and get views read the active local profile without contacting any provider, running a credential helper, or rewriting historical records. History commands are still logged unless `FAM_HISTORY=0`.

Lists show the newest **start times** first, merging each invocation's start and finish into one entry. Each entry prints the full `fam` command with every argument, quoted for bash/zsh so spaces, quotes, empty strings, and shell metacharacters retain their meaning. Commands are never clipped or reformatted to fit the terminal; the terminal wraps them naturally. Control characters are represented with reversible shell escapes. The default is 20 matches. `--limit 0` returns all matching entries; positive limits have no fixed cap. `--offset` skips matching entries before applying the limit, including when the limit is zero. The printed `More` command preserves your filters. `get --id` accepts a full invocation UUID or a unique prefix of at least eight characters; ambiguous prefixes ask for a longer ID. Details include the full command, working directory, captured input paths, error and cause stacks, recovery diagnostics, runtime/build information, and the original filename and line numbers. JSON entries include both the exact `argv` array and a copyable `commandLine`. An unfinished invocation means no finish was recorded, not proof of a crash. Lists and summaries hide archived entries by default; add `--include-archived` to include them. `get --id` always opens the requested entry, including archived entries. JSON entries include `archived`, `archivedAt`, and `archiveId`; human output labels archived entries.

Filter lists, summaries, and statistics with:

| Flag | Meaning |
| --- | --- |
| `--provider NAME` | Exact provider; repeat to include several. |
| `--command TEXT` | Case-insensitive substring of the command name. |
| `--outcome VALUE` | `success`, `soft_failure`, `hard_failure`, or `incomplete`; repeat to include several. Failure views accept only the two failure outcomes. |
| `--code CODE` | Exact diagnostic/error code, case-insensitive; includes codes in nested causes and HTTP status codes such as `HTTP_503`. |
| `--query TEXT` | Case-insensitive substring of recorded entry data, including messages, stack traces, arguments, input metadata, and build revision. |
| `--since TIME`, `--until TIME` | Inclusive range of invocation start times. Accept `today`, durations such as `30m`, `24h`, `7d`, `2w`, UTC dates, or ISO timestamps with a timezone. An `--until` date includes the entire UTC day. |

Different filters combine with AND; repeated provider/outcome values combine with OR. By default, successful history queries and shell completion lookups are hidden to keep routine checks readable. Use `--include-utility` or an explicit `--command` filter to include them; their failures are always eligible. The query currently running is excluded from its own results. Add `--json` for the standard structured envelope, or `--out FILE` to export the current view using private file permissions.

Summaries count matching invocations and show the ten leading groups by default. `--group-by command` is the default; `provider` and `code` are also available. Groups with the most failures appear first. One invocation can have multiple diagnostic codes, but is counted once per code, so code-group totals may exceed the invocation total. `--limit` and `--offset` also paginate summary groups; `--limit 0` returns every matching group.

Use `stats` to explore trends in a terminal graph, numeric table, or JSON:

```sh
fam cli.history stats --since 7d
fam cli.history stats --since 30d --interval day --group-by provider --metric failure-rate
fam cli.history stats --provider ancestry --since 7d --interval hour --metric p95-duration
fam cli.history stats --since 7d --group-by code --metric failures
fam cli.history stats --since 7d --group-by build --format table
fam cli.history stats --since 7d --interval day --json --out history-stats.json
```

`stats` includes **every matching invocation, group, and time bucket**, without pagination or a result cap. It honors all filters above, `--include-utility`, and `--include-archived`. Use `--outcome soft_failure --outcome hard_failure` to select both failure outcomes, or `--metric failures` to graph failures while retaining successful calls in the statistics.

| Flag | Meaning |
| --- | --- |
| `--interval SIZE` | `auto` (default), `minute`, `hour`, `day`, `week`, or `month`. Buckets use UTC; weeks start Monday and months follow calendar boundaries. |
| `--group-by DIMENSION` | `none` (default), `provider`, `command`, `outcome`, `code`, or `build`. Each group gets a time series, ordered by total calls. Build groups use the full revision and distinguish dirty builds. |
| `--metric NAME` | Graph `calls` (default), `failures`, `failure-rate`, `avg-duration`, `p50-duration`, or `p95-duration`. Graphs share a scale across groups and print the value beside each bar. |
| `--format FORMAT` | `graph` (default), `table`, or `json`. `--json` also selects JSON. Tables show counts, failure rates, and mean/p50/p95 durations; JSON includes every statistic. The graph metric does not affect these formats. `--out FILE` exports the selected format. |

Buckets count calls by **start time**. Missing buckets inside the range contain zero counts and null rates/durations. Without time filters, the range spans the earliest through latest matching call. `--since` extends the range through now when `--until` is omitted (or through the latest match if its timestamp is later). An explicit `--until` is inclusive; JSON bucket `end` is exclusive. The first and last buckets may cover only part of their calendar interval. Automatic intervals are minute for spans up to one hour, hour up to two days, day up to 90 days, week up to 732 days, and month thereafter. Explicit intervals are never enlarged to reduce the number of buckets.

Failure rate is `(soft failures + hard failures) / completed calls × 100` **within the filtered data**. Unfinished calls are counted separately and excluded from the denominator. Filtering to failures therefore yields 100% wherever completed calls remain; graph `--metric failure-rate` without an outcome/code filter to compare against all matching completed calls. Duration statistics use finite, nonnegative recorded durations from completed calls, including failures; zero is a valid sample. Overall means and percentiles use individual calls, not averages of buckets. p50/p95 use nearest rank. JSON exposes raw milliseconds, sample counts, mean, p50, p95, minimum, and maximum; missing samples/rates are `null` (shown as `—` in the terminal). Code groups may overlap, but each invocation counts once per code and once in the overall total.

Use **one archive command** to hide reviewed history while retaining the original evidence:

```sh
# Archive all existing history, including successful history and completion calls.
fam cli.history archive --all

# Preview matching failures, then archive them with the same filters.
fam cli.history archive --failures --provider ancestry --code AUTH_RETRY --until 7d --dry-run
fam cli.history archive --failures --provider ancestry --code AUTH_RETRY --until 7d

# Archive all soft and hard failures, or just one outcome.
fam cli.history archive --failures
fam cli.history archive --outcome hard_failure --query "Expected JSON"

# Retrieve archived evidence.
fam cli.history list --include-archived
fam cli.history.failures summary --include-archived --group-by code
fam cli.history get --id <ID_FROM_LIST>
```

`archive` uses the same provider, command, outcome, code, text, and time filters as the views. `--failures` is shorthand for both failure outcomes and can be narrowed with `--outcome`. Use `--all` without selection filters to archive everything, or supply a filter/`--failures` to select a subset. There is no `cli.history.failures archive` action. Archiving applies to every matching visible invocation, without the list's pagination limit; `--limit` and `--offset` are not archive flags. `--dry-run` reads the history and reports matching counts by outcome without writing an archive marker. `--json` provides the same counts and selection in structured form. No matching entries means no new marker.

Each archive appends a marker to `<profile>/history/archive.jsonl`. It saves the selection with relative dates resolved to absolute times, a cutoff timestamp, and the last scanned record position in each daily file. Existing JSONL records and input snapshots stay byte-for-byte unchanged. New calls and later events from in-progress calls remain visible, even when they share a timestamp with the archive. The archive invocation itself is recorded normally. Repeated archives combine; normal queries skip matching entries covered by any marker. `--include-archived` bypasses that visibility filter, and `--include-utility` also includes successful history/completion calls when needed. Archive markers are read from a fixed snapshot too; damaged markers produce notices and do not silently hide evidence.

Archiving changes visibility and does not reclaim disk space. Include `archive.jsonl`, daily logs, and input snapshots when backing up history; raw JSONL tools such as `jq` still see archived calls.

Reads take a size snapshot of each daily file, process one day at a time, and leave the source files untouched. Malformed JSON, unsupported schemas, oversized lines, and unfinished final lines are skipped with filename/line notices. Unreadable files produce notices too. A query with such notices records `HISTORY_READ_INCOMPLETE`; merely viewing an old failure does not create another failure. Notices cover files actually scanned; use narrower date filters for large archives. Concurrent calls can shift offset-based pages; fixed time boundaries help keep a review consistent.

Every invocation writes a `start` record and, on normal process exit, a `finish` record to `<profile>/history/YYYY-MM-DD.jsonl`. The default is `~/.config/fam/history/`; `FAM_CONFIG_DIR`, XDG configuration, and platform defaults follow the [profile rules](setup.md#storage-and-profiles). Dates are UTC. Both records use the starting date's file, even if the command crosses midnight. Help, completion, discovery, invalid invocations, and dry runs are included. This starts with the installed logging version; earlier calls cannot be reconstructed.

The schema has `schemaVersion: 1`, a shared invocation `id`, timestamps, `command`, `provider`, verbatim `argv`, `argvCapture: "verbatim"`, `cwd`, CLI `version`, `build.revision` / `build.dirty`, and Node/platform information. The start record has the attempted argv; the canonical command becomes available after lookup. Finish records include `durationMs`, the actual `exitCode`, `settled`, `error`, `inputs`, and up to 32 `diagnostics` with codes, messages, result paths and selected error details. Error details include HTTP status, stack frames and bounded causes, when available. `build` is null when running TypeScript source directly; installed builds retain the Git revision from build time (or null when built without Git metadata).

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

History is local to each host and profile; it is not uploaded or synchronized with credentials. Direct library calls do not create history. Files use mode `0600` and directories `0700`; concurrent CLI processes append individual JSON records. Daily files and input snapshots remain on disk after `fam cli.history archive`; archive markers only hide entries from normal views. Logging failures emit one warning per invocation and preserve the command's behavior. Disk failure or abrupt termination can still leave missing records or an incomplete final line.

History does not redact arguments, URLs, email addresses, tokens, passwords, or diagnostic text. Argument count and message length are not truncated. Earlier records with discarded argument values remain unchanged and are labeled as legacy records; their original values cannot be recovered.

When a command consumes stdin or reads a CLI input file, it saves the bytes before parsing or transformation to `<profile>/history/inputs/<ID>/<NUMBER>.bin`. This includes JSON inputs, GraphQL documents, upload bodies, HARs, callback/token files, and credential stdin. Each snapshot uses mode `0600`; an `input` JSONL event and the finish record include its path, original file path, byte count, SHA-256, and whether the read completed. Inline JSON is already preserved in `argv`. Reads that exceed the command's existing stdin limit save the consumed prefix and mark it incomplete. A snapshot write failure is reported without breaking the command. `get` shows the snapshot paths and a replay command for captured stdin; to replay captured files, substitute the snapshots for the original input paths. These commands are displayed, never automatically executed.

History records the arguments received by `fam` after shell expansion; the shell's original quoting, aliases, pipes and redirects are not available to the process. Captured stdin preserves the consumed data from a pipe or redirect. Environment dumps, interactive terminal transcripts, saved session files, and full stdout/stderr or response bodies are not captured. Reproduction uses the recorded build and working directory together with any required environment/session state. `droppedDiagnostics` counts additional emitted findings omitted after the 32-entry limit. When archiving a daily log, include the input directories for its invocation IDs.

Set `FAM_HISTORY=0` to disable recording for a process, including help and dry runs:

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
