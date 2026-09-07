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

## Shell completion

`fam --completions bash` and `fam --completions zsh` print shell scripts. Enable completion in the current shell with `eval "$(fam --completions bash)"` (use `zsh` in zsh), or run `fam cli.completion install` to enable it in future shells. `fam cli.completion script --shell bash` remains available.

## Effects

There are no confirmation prompts or confirmation flags. Selecting an operation executes it, including writes. Generic API entries declare operation-dependent effects: an HTTP GET or GraphQL query can have side effects, and Findmypast's cataloged GetTranscriptById can confirm a credit purchase. Inspect the provider operation with `fam PROVIDER.api describe --operation NAME` when needed.

`--dry-run` checks command flags and returns a plan without provider requests, credential lookup, or file writes. It does not simulate the service or validate arbitrary operation bodies. Provider response schemas are advisory during normal execution too.

## Migration

The old provider/command grammar is removed. See the [complete command mapping](cli-migration.md). Authentication, provider transports, credential helpers, origin checks, token redaction, and session storage keep their existing behavior. Reinstall completion with `fam cli.completion install` to replace the marked startup hook.
