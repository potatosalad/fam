# Genealogy coverage

212 of 213 selected genealogy operations have callable TypeScript methods, request/response models, input validation, and mocked transport tests. These correspond to 211 distinct HTTP method/path templates (placeholder names normalized).

The denominator is the documented genealogy scope in [operation-selection.json](operation-selection.json), selected from all 319 captured declarations. It includes research data, memories, source linking, relationship changes, history, family groups, helper permissions, and ordinance research. Messaging, event discovery, account administration, app infrastructure, location support, and appointment scheduling are excluded. This is not a claim to cover every FamilySearch backend or website service.

297 recovered models describe 1502 wire fields. Requiredness and field nullability come from the APK’s Moshi serializers. Request bodies are validated recursively; server business rules are enforced by FamilySearch. Response fields are retained and numeric/string conversions match the app’s reader. Java long values beyond the safe JavaScript range use bigint.

| Area | Implemented / selected operations |
| --- | --- |
| associations | 12 / 12 |
| authorities | 7 / 7 |
| contributors | 4 / 4 |
| couples | 11 / 11 |
| following | 3 / 3 |
| groups | 15 / 15 |
| helpers | 9 / 9 |
| hints | 10 / 10 |
| history | 6 / 6 |
| memories | 32 / 32 |
| ordinances | 18 / 18 |
| parentChildren | 12 / 12 |
| pedigree | 18 / 18 |
| persons | 24 / 24 |
| portraits | 4 / 4 |
| search | 5 / 5 |
| sources | 14 / 14 |
| tasks | 3 / 3 |
| trees | 5 / 6 |

## Evidence and limits

- Every implemented operation is exercised through the real authenticated transport with mocked responses; routes, verbs, path/query/header/body placement, and response handling are checked against the separate APK inventory.
- Compile-time tests check required fields, invalid names and query types, nested bodies, and inferred outputs. Transport tests cover bounded 401 refresh, no retries of ambiguous writes, multipart uploads, raw stories, binary downloads, 204 responses, exact 64-bit numbers, and pagination.
- Live verification is opt-in and account-dependent (`npm run verify:genealogy`). Reports are saved privately, never used as generator inputs. Offline coverage does not imply live service availability.
- `trees.switch` is the one selected gap: its obfuscated SelectedGroupTreeDto has no recovered wire serializer. Its endpoint is inventoried, but the SDK does not guess its field names.
- `sources.attachRecord` has a fully mapped request but an unstructured acknowledgement (`java.lang.Object` in the APK); its output is JsonValue.
- Some permissions and server prerequisites vary by account and tree. 202 is exposed as pending HTTP status by operationDetailed; iterators do not promise a stable snapshot. Returned content links do not grant authorization to send bearer credentials to other hosts.
- The inventory includes two common-service event preference declarations previously omitted. Bundled third-party chat APIs and dynamically constructed URLs are outside this genealogy surface. The APK itself was not executed.

## Reproduction

```sh
python3 scripts/extract-endpoints.py  # requires ignored smali
python3 scripts/extract-contracts.py  # requires ignored partial Java serializers
npm run generate                   # requires only checked-in contracts
npm run check:generated
npm run typecheck
npm run test:types
npm test
npm run build
npm run verify:genealogy            # optional authenticated read-only checks
```

The full method/path list and exclusions are machine-readable in [coverage.json](coverage.json). See [operations.md](operations.md) for each callable method and [contracts.json](contracts.json) for nested field schemas and source hashes.
