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

The examples for creating people, facts, names, notes, relationships, and source attachments contain editable payloads. A create-person example includes a Death fact explicitly; set living/deceased status from evidence. Names use `value.nameForms`; place IDs are strings from `authorities.places`. Use actual conclusion IDs from the person, fresh note UUIDs, and operation-specific reason fields. `sources.attach` takes a source description ID and tag objects such as `{"resource":"http://gedcomx.org/Name"}`.

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
