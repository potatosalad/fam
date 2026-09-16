# FamilySearch

Use `fam familysearch.OBJECT ACTION --flags` for FamilySearch trees, genealogy operations, images, and historical-record research. Start with the [installation and sign-in guide](../../README.md#familysearch), or run `fam cli.command list --provider familysearch`.

`fam familysearch.person get --person-id <PERSON_ID>` follows up to five redirects to replacement person IDs on the same FamilySearch person API. When a person moves, the result includes `requestedPersonId` and `resolvedPersonId` alongside the GEDCOM X data. Other API routes and writes retain their existing redirect behavior; authentication is never forwarded to a redirect outside the person API.

The CLI describes its genealogy operations locally, without credentials or provider requests. Provider help lists the capability groups; command search includes the individual API operations as well as dedicated commands:

```sh
fam familysearch --help
fam cli.command search --provider familysearch --query "find memories"
fam cli.command search --provider familysearch --query "merge duplicate people"
fam familysearch.api list --filter memories
fam familysearch.api describe --operation memories.search
fam familysearch.api call --operation persons.merge --help
```

Operation descriptions include effects, correctly nested input schemas, response fields and referenced models, limitations, and an example. Add `--json` for machine-readable schemas. Save an editable input template with `fam familysearch.api describe --operation memories.search --example --out input.json`, edit its placeholders, then run `fam familysearch.api call --operation memories.search --input input.json`. Memory files can be uploaded with `fam familysearch.memory upload`; group-image uploads use the TypeScript helper.

## Search indexed records

```sh
fam familysearch.record search --first-name Alex --last-name Example --birth-year 1850 --birth-year-range 3 --json
fam familysearch.record search --residence-year 1850 --residence-place "Example County" --limit 20 --offset 0 --json
fam familysearch.record collections --last-name Example --json
fam familysearch.record search --last-name Example --collection-id 1234567 --collection-type 0 --json
```

Replace example names and collection IDs with your research criteria. Search supports birth, death, marriage, and residence years/places, plus father, mother, and spouse first/last names. `--exact` requests exact name/place matching; the server still controls matching. Event year ranges default to 0. Results are in `data.items[]`, with record fields, relationships, attachment information, and the search result ID. `data.total` is null if omitted by the server. Repeat the same criteria with `data.nextOffset` until `data.complete` is true; one command reads one page.

`record collections` returns the collections associated with the supplied criteria, including `collectionId` and `collectionType`. Supply both to narrow search to a collection. Type **0 is valid**. The server ignores an unpaired collection ID, so both the convenience command and generic API input reject it. Generic `recordType` values are provider matching criteria and are not a substitute for a collection restriction.

## Prepare writes locally

```sh
fam familysearch.api describe --operation persons.addFact --example --out fact.json
fam familysearch.api call --operation persons.addFact --input fact.json --dry-run --json
fam familysearch.api call --operation persons.addFact --input fact.json --json
```

Edit the input before executing it. `--input` accepts a file, an inline JSON object, or `-` for stdin. Dry-run reads that input and validates its fields, types, paths, and query/header nesting without loading credentials or contacting FamilySearch. Its `data.validation.input` shows the prepared input. Validation does not establish server permissions or verify genealogical conclusions. Command history records consumed input unless disabled with `FAM_HISTORY=0`.

Numeric IDs and record-search `year.value` inputs are converted to strings when the wire schema requires strings. Exact JSON integers are preserved, including values larger than JavaScript's safe integer range. Existing strings retain leading zeros. Names, free text, and other fields keep their documented types. Dry-run shows the normalized input.

For `persons.create`, dry-run also reports `data.validation.creation.status` and warns when no Death fact is supplied: an old birth date alone does not declare a person deceased. Add `--deceased` to that API call to insert a dateless Death conclusion if absent, based on evidence of death. Existing Death facts are preserved. The option works identically in dry-run and execution and is rejected on other operations.

Readable API dry runs display the prepared input as JSON, including normalized string IDs, plus creation status and Living warnings.

`familysearch.record collections` sorts by descending match count by default. Use `--sort count-asc` or `--sort title` to change the order; missing counts sort last.

The examples for creating people, facts, names, notes, relationships, and source attachments contain editable payloads. A create-person example includes a Death fact explicitly; set living/deceased status from evidence. Names use `value.nameForms`; place IDs are strings from `authorities.places`. Use actual conclusion IDs from the person, fresh note UUIDs, and the [reason fields below](#change-reasons). `sources.attach` takes a source description ID and tag objects such as `{"resource":"http://gedcomx.org/Name"}`.

### Change reasons

Every FamilySearch API operation accepts `"headers": {"X-Reason": "Describe the supporting evidence."}`. Supply plain text: fam URL-encodes the header once, including spaces and Unicode. This also works in dry-run and the TypeScript client. Operation help lists it under `inputSchema.properties.headers`. The header remains optional.

The header is forwarded to FamilySearch. Whether an endpoint records it is controlled by the server; support across all endpoints has not been verified. Body reason fields are preserved independently and are not filled or overwritten from the header. Use the documented body field when the operation has one:

| Operation | Reason location |
| --- | --- |
| `persons.addFact` | `body.attribution.changeMessage`; `headers.X-Reason` is also accepted. |
| `parentChildren.create` | `headers.X-Reason` is forwarded. The recovered body schema has no reason field; server persistence of this header is unverified. |
| `sources.detach`, `persons.deleteConclusion` | `headers.X-Reason`. |
| `persons.updateFact` | `headers.X-Reason` and `body.attribution.changeMessage` are both supported by the recovered contract. |
| `persons.create` | `body.changeMessage`; individual conclusions can also contain attribution. |
| `persons.addRelationship` | `body.attribution.changeMessage`. |
| `sources.attachRecord` | `body.attachmentReason`. |

For other operations, inspect `fam familysearch.api describe --operation <OPERATION> --json` for nested body fields. The CLI's global `--reasoning` flag records agent intent in local command history; it does not send a FamilySearch change reason.

## Sources, attachment plans, and merge plans

```sh
fam familysearch.source list --person-id XXXX-XXX --max-pages 10 --json
fam familysearch.record.attach plan --person-id XXXX-XXX --ark 1:1:EXAMPLE --reason "Evidence connecting this record to the person" --copy-fact Residence --out attach.json --json
fam familysearch.api call --operation sources.attachRecord --input attach.json --dry-run --json
fam familysearch.api call --operation sources.attachRecord --input attach.json --json
fam familysearch.merge plan --survivor-id AAAA-AAA --duplicate-id BBBB-BBB --reason "Evidence identifying the same person" --out merge.json --json
```

`source list` joins references to source descriptions and exact attachment-history events. Each item includes title, ARK, tags, original `attachedBy`/`attachedAt`, and separate `modifiedBy`/`modifiedAt`. Timestamps are ISO dates when parseable; raw reference and attachment data are retained. Contributor names are cached during the call, and history/contributor lookups are bounded. Missing attribution remains null, with `historyComplete` and warnings explaining the limit; a modification date is never presented as an attachment date.

`record.attach plan` reads native source-linker facts. `--copy-fact` accepts a conclusion ID or type, such as `Residence`; a type selects **all** matching facts, including multiple residences. Repeat the option to select other facts, or omit it to inspect candidates without selecting any. Plans preserve native dates, original places, and IDs. The live linker’s `place.standardPlaceId` is copied into the write model’s `place.id` when absent. Response-only fields such as `primary` are omitted from the write and listed in each selected fact’s `omittedFields`; the original fact remains in `candidates`. The preview checks the source linker’s attachments for this exact indexed person. `alreadyAttached`, `attachmentStatus`, existing source references, and warnings are shown; an existing attachment, attachment to another person, or missing attachment status makes `ready` false. `recordFactsToCopy` contains `ConclusionValueDto` values directly, without a `conclusionType`/`value` wrapper. The resulting `sources.attachRecord` request attaches the record and copies the selected facts together.

`merge plan` reads analysis and not-a-match declarations. Its default proposal copies unique non-vital conclusions and duplicate source references, preserves survivor vitals and relationships, and leaves every deletion array empty. Add `--include-vitals` and/or `--include-relationships` to include those categories. The preview shows selected facts/sources, all ten ID arrays, provider warnings, constraints, and `ready`. Source-copy IDs come from `duplicateSources[].entityRefId`, never the source-description `id`. `--include-analysis` includes the full response. A missing ID, provider warning, or not-a-match declaration makes the plan not ready.

Both planning commands are read-only. Run them normally to fetch a preview; `--dry-run` checks their local flags without fetching provider data. `--out` creates a new private file containing **only the prepared API input**, so it can be passed directly to `familysearch.api call`. Review the printed preview before execution and regenerate merge plans immediately before use. A plan is not a transaction lock; the server may change or reject the final write. Execute a reviewed merge input with `fam familysearch.api call --operation persons.merge --input merge.json`.

## Not-a-match declarations

```sh
fam familysearch.hint.not-match list --person-id XXXX-XXX --json
fam familysearch.hint get --person-id AAAA-AAA --duplicate-id BBBB-BBB --json
```

These reads expose declared nonmatches, reasons, contributors with resolved names, and ISO modification dates. Name lookups are cached and bounded; unavailable names remain null. The original contributor reference and timestamp remain in `attribution`. `hint get` combines `hints.duplicate` with the pair's declaration. They use FamilySearch's [documented not-a-match endpoint](https://developers.familysearch.org/main/docs/read-person-not-a-match-declarations); HTTP 204 means no declarations. They do not remove a declaration or perform a merge.

## Missing transcripts and household rows

An image can have indexed records without OCR. JSON transcript output reports `available: false` and `unavailableReason: "indexed-records-only"`; both default readable output and `--format text` explain the absence and exit 1. `--json` or `--format json` retains the structured unavailable status with exit 0. This is not a schema failure. `record get` explicitly requests section fields and reports `recordSections.available` and `rowCount`. If the service supplies no rows, it reports `not-supplied-by-provider`; it does not manufacture household members from names on the page or imply the household was empty.

## Upload memories

```sh
fam familysearch.memory upload --file portrait.jpg --title "Family portrait" --visibility private --dry-run --json
fam familysearch.memory upload --file portrait.jpg --title "Family portrait" --description "Describe the source and people shown." --visibility private --out portrait-receipt.json --json
```

Choose `--visibility private` or `--visibility public` explicitly. MIME types are inferred for common image, PDF, audio, and text extensions; use `--media-type` for another extension. `--max-bytes` sets the local file-size cap (16 MiB by default, up to 256 MiB); FamilySearch's own file restrictions still apply. Dry-run validates and hashes the file without uploading it.

The result retains the provider's artifact metadata, including the exact `data.artifact.id`, plus `data.upload` with the filename, MIME type, visibility, bytes, and SHA-256. Optional `--out` saves a private JSON receipt and refuses an existing destination. If receipt publication fails after the upload, the CLI returns the completed upload result and a recovery-file warning so you can retain the artifact ID. File bytes are captured by command history under the existing private-history policy. Use the returned artifact ID with `memories.link`, `memories.tagPerson`, or `memories.setDatePlace` as needed.

The catalog describes implemented operations, not complete website parity or live verification of every operation. Descriptions are maintained in [discovery.json](discovery.json) and generated alongside the wire contracts with `npm run generate`.

- [TypeScript API](typescript.md)
- [Genealogy operation reference](operations.md)
- [Coverage and limitations](coverage.md)
- [Images, films, full-text search, and transcripts](document-research.md)
- [Protocol and authentication notes](api.md)
- [APK provenance](apk.json)
- [Endpoint inventory](endpoints.json), [operation selection](operation-selection.json), and [contracts](contracts.json)

Shared configuration, credential helpers, and profiles are documented in [setup](../setup.md); build and generation commands are in [development](../development.md).
