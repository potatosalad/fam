# FamilySearch

Use `fam familysearch.OBJECT ACTION --flags` for FamilySearch trees, genealogy operations, images, and historical-record research. Start with the [installation and sign-in guide](../../README.md#familysearch), or run `fam cli.command list --provider familysearch`.

The CLI describes its genealogy operations locally, without credentials or provider requests. Provider help lists the capability groups; command search includes the individual API operations as well as dedicated commands:

```sh
fam familysearch --help
fam cli.command search --provider familysearch --query "find memories"
fam cli.command search --provider familysearch --query "merge duplicate people"
fam familysearch.api list --filter memories
fam familysearch.api describe --operation memories.search
fam familysearch.api call --operation persons.merge --help
```

Operation descriptions include effects, correctly nested input schemas, response fields and referenced models, limitations, and an example. Add `--json` for machine-readable schemas. Save an editable input template with `fam familysearch.api describe --operation memories.search --example --out input.json`, edit its placeholders, then run `fam familysearch.api call --operation memories.search --input input.json`. Binary memory and group-image uploads require the TypeScript upload helpers.

The catalog describes implemented operations, not complete website parity or live verification of every operation. Descriptions are maintained in [discovery.json](discovery.json) and generated alongside the wire contracts with `npm run generate`.

- [TypeScript API](typescript.md)
- [Genealogy operation reference](operations.md)
- [Coverage and limitations](coverage.md)
- [Images, films, full-text search, and transcripts](document-research.md)
- [Protocol and authentication notes](api.md)
- [APK provenance](apk.json)
- [Endpoint inventory](endpoints.json), [operation selection](operation-selection.json), and [contracts](contracts.json)

Shared configuration, credential helpers, and profiles are documented in [setup](../setup.md); build and generation commands are in [development](../development.md).
