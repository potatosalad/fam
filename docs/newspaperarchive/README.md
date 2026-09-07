# NewspaperArchive

`fam newspaperarchive` searches NewspaperArchive's historical newspapers through its dedicated endpoints on the Storied API. It supports genealogy searches, publication and location lookup, issue calendars, and OCR. Use the [shared setup guide](../setup.md) to install fam.

## Authentication

NewspaperArchive shares **`STORIED_USERNAME` and `STORIED_PASSWORD`**, the credential helper's `storied` entry, saved `storied/login.json`, and the existing renewable `storied/session.json`. If you already signed in with Storied, start researching immediately. There is no separate NewspaperArchive password or session to maintain.

```sh
fam newspaperarchive.credential set
fam newspaperarchive.session login
fam newspaperarchive.session verify
fam newspaperarchive.session get
fam cli.health check --provider newspaperarchive
```

Login uses [Storied's existing browser/PKCE flow](../storied/README.md#sign-in). For account verification or social login, use `fam newspaperarchive.session login --interactive`. `--browser-channel chrome` selects installed Chrome. Session refresh and credential sync also operate on the shared Storied session. Signing in or changing saved login credentials affects both providers. The default profile is `~/.config/fam`; `FAM_CONFIG_DIR` selects another profile.

## Search for ancestors

```sh
fam newspaperarchive.newspaper search --first-name Abraham --last-name Lincoln --limit 10
fam newspaperarchive.newspaper search --last-name Lincoln --keyword obituary --from 1865-01-01 --to 1865-12-31
fam newspaperarchive.newspaper search --phrase 'Mary Smith' --any-words 'married wedding' --exclude-words 'advertisement'
fam newspaperarchive.newspaper search --last-name Smith --country-id 7 --state-id 37 --page 2 --limit 20 --json
```

Names, all words (`--keyword`), exact phrases, any words, and excluded words can be combined. Location and publication IDs narrow the search. Both `--from` and `--to` are required for an inclusive publication date range; use `YYYY-MM-DD`. Pages start at 1; `--limit` is 1–100, default 20. Each invocation fetches one page, with `nextPage` and the provider's result count.

Results preserve publication title, date, location, page number, image ID, article ID, OCR snippets, thumbnail URL, and `isMasked`. A `sourceUrl` is derived from a recognized provider thumbnail path and page number; otherwise it is null. Use it with `page transcript` to read and cite the matching page. **Masked results remain masked**; successful search or login does not establish access to every scan. Obituaries, births and marriage announcements can be found with names and keywords; this initial provider does not pretend to offer an independently indexed obituary collection.

## Find newspapers and available issues

```sh
fam newspaperarchive.publication search --name Chicago --limit 20
fam newspaperarchive.location list
fam newspaperarchive.location list --country-id 7
fam newspaperarchive.location list --state-id 37
fam newspaperarchive.location list --state-id 37 --city-id 5196
fam newspaperarchive.publication dates --publication-id PUBLICATION_ID
fam newspaperarchive.publication dates --publication-id PUBLICATION_ID --year 1900
fam newspaperarchive.publication dates --publication-id PUBLICATION_ID --year 1900 --month 4
```

Publication search returns both places and titles. Its `ids` field lists IDs from narrowest to broadest: publication (when present), city, state, country. A scoped location list returns countries, states, cities, or publication titles with their IDs. Use a title's ID with `--publication-id` in newspaper search. Publication search returns one provider page without asserting a complete result count. Calendar endpoints can return no data for some titles.

## Read page text and cite sources

```sh
fam newspaperarchive.page get --url 'https://newspaperarchive.com/new-york-times-apr-15-1865-p-1/' --anonymous
fam newspaperarchive.page transcript --url 'https://newspaperarchive.com/new-york-times-apr-15-1865-p-1/' --anonymous --out page.json
fam newspaperarchive.page ocr --image-id IMAGE_ID --article-id ARTICLE_ID
```

`page get` and `page transcript` read the public newspaper page's available OCR, bibliographic metadata, and source citation. They do not download the full scan. The website can require browser verification; fam reports this and does not retry. `page ocr` uses the API's image/article ID route, which may fail even when the public page has OCR. Provider OCR errors are surfaced rather than returned as successful empty transcripts. OCR can misread names and dates; check the original scan at the source URL.

`--anonymous` omits the Storied session; server access restrictions still apply. `--out FILE` writes private JSON atomically. Default terminal output is readable text; use `--json` for the shared structured envelope.

## Read-only API catalog and TypeScript

```sh
fam newspaperarchive.api list
fam newspaperarchive.api describe --operation search
fam newspaperarchive.api call --operation countries
fam newspaperarchive.api call --operation publication --input '{"path":{"pubTitleUrl":"new-york-times"}}'
```

The small catalog contains selected newspaper reads from the existing [Storied contracts](../storied/contracts.json). It excludes cache reloads, image-view registration, account changes, and clipping writes. `api call` accepts `{path,query,body}` using inline JSON, a JSON file, or `-` for stdin. Existing Storied schema validation, origin restrictions, exact integer handling, and bounded token renewal apply. API responses retain their native envelope; convenience commands unwrap it where useful.

```ts
import {NewspaperArchiveClient} from '@potatosalad/fam/newspaperarchive';
const client = await NewspaperArchiveClient.open();
const results = await client.search({lastName: 'Lincoln', from: '1865-04-14', to: '1865-04-16', limit: 10});
```

See [protocol.md](protocol.md) for source and verification scope.
