# FamilySearch TypeScript API

First [install fam in your application](../setup.md#typescript-library-use).

Create output folders before using these examples: `mkdir -p research-output/familysearch`. This folder is ignored in the checkout; keep exports outside Git elsewhere.


```ts
import { FamilySearchClient } from '@potatosalad/fam/familysearch';

const client = await FamilySearchClient.open();
const me = await client.currentUser();
if (!me.personId) throw new Error('Account has no tree person');
const person = await client.person(me.personId);
const ancestors = await client.ancestry(me.personId, 3);
const mobilePerson = await client.mobilePerson(me.personId);
```

Install this package in your application and use its ESM exports. Mobile operations expose recovered request and response types; public GEDCOM X envelopes have partial types. Generic `get()` / `request()` stay within FamilySearch API paths.

```ts
const tree = client.genealogy;
const details = await tree.persons.get({
  pid: me.personId!, query: { oneHops: 'summaries' },
});
const sources = await tree.sources.forPerson({ pid: details.id });
const history = await tree.history.changes({ pid: details.id });
const matches = await tree.hints.recordMatches({ pid: details.id }); // undefined for HTTP 204
```

All operations are listed in the [reference](operations.md). Path parameters and `body` are top-level input properties; query/header parameters are nested. Calls validate the input before authentication. The app uses the string selector `oneHops: 'summaries'`, not a boolean.

Use `fam familysearch.api describe --operation OPERATION --example` for correctly nested input. `fam familysearch.api call --operation OPERATION --input -` reads JSON from stdin; repeated `--query key=value` flags use the operation's scalar types. `fam familysearch.record get --ark RECORD_ARK` handles `sources.recordDetails` nesting for you.

The following example **creates a live note when executed**:

```ts
import { notePayload } from '@potatosalad/fam/familysearch';
const note = await tree.persons.addNote({
  pid: details.id,
  body: notePayload('Research log', 'Check the original census image.', 'Research notes'),
});
// Pass plain text in headers: { 'X-Reason': 'Reason for change' }.
// Typed operations apply the APK's UTF-8 form encoding to that header.
```

Use `client.operation('persons.get', input)` to select by name, or `operationDetailed()` for HTTP status, pagination/location headers, and binary responses. The CLI equivalent is `npm run fam -- familysearch.api call --operation persons.get --input research-output/familysearch/input.json --out research-output/familysearch/person.json`, with input `{ "pid": "XXXX-XXX" }`. CLI `call` can also execute mutations; the operation reference identifies the HTTP verb.

`personChanges()` follows change-history cursors and `searchResults()` follows search offsets with bounded page counts and cancellation between requests. `memoryUpload()` and `groupImageUpload()` build the recovered multipart formats; `memories.replaceFile` takes plain story text. These helpers are exported from `@potatosalad/fam/familysearch` and the package root. A memory upload requires an explicit `isPrivate` boolean.

Typed responses convert numeric JSON tokens to strings where the APK's Moshi string reader does so, and numeric strings to numeric model fields. Large Java long values become `bigint` without rounding. Use exported `stringifyJson()` / `parseJson()` to round-trip those values. CLI input/output already uses these helpers. Unknown response fields are retained; `validateOperationResponse()` optionally checks for schema drift. Missing fields with app defaults remain optional rather than inventing server values.

API mutations are retried only after a definitive HTTP 401 and successful renewal, at most once. Network errors, permission failures, rate limits, and 5xx errors propagate without replaying the mutation. `HttpError.retryAfter` preserves the server's retry hint.
