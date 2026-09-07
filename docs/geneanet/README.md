# Geneanet

`fam geneanet` signs in through Geneanet's website, searches records and old portraits, reads transcriptions and document metadata, and downloads images or PDF pages. It uses the existing web forms and JSON services; no mobile app is required. Install using the [main README](../../README.md#install).

## Sign in

```sh
fam geneanet.credential set
fam geneanet.session login
fam geneanet.session verify
fam geneanet.account get
```

Use your Geneanet username or email address. Credential setup accepts `GENEANET_USERNAME` / `GENEANET_PASSWORD`, the configured helper, or a hidden prompt. `credentials --stdin` accepts `{ "username": "…", "password": "…" }`. See [credential lookup](../setup.md#credential-lookup). `auth` uses the normal lookup order without saving a helper-returned password; `credentials` explicitly saves it.

The login form supplies a CSRF token. The CLI submits the password once, validates the signed-in account, then saves cookies in `geneanet/session.json` under the shared configuration directory. Passwords use `geneanet/login.json`. Files are atomic and owner-only; `FAM_CONFIG_DIR` selects another profile. Session and password files contain plaintext secrets and must remain private.

`status` displays saved metadata without contacting Geneanet or printing cookies. `verify` checks the same account online. `me` returns a small profile without the API's JWT. Successful reads retain updated cookies; account verification also updates `validatedAt`. Geneanet's remember-me cookie may renew its own website session. There is no OAuth refresh grant or automatic password retry; use `auth` explicitly after expiry. Google/Facebook/Ancestry linking, account creation, and interactive challenges are not implemented.

## Search records and photos

```sh
fam geneanet.record search --last-name Lincoln --first-name Abraham
fam geneanet.record search --last-name Lincoln --first-name Abraham --category archives --page 2
fam geneanet.record search --last-name Martin --place Paris --event birth --from 1800 --to 1850
fam geneanet.record search --last-name Lincoln --spouse-last-name Todd --with-images
fam geneanet.photo search --last-name Lincoln --first-name Abraham
fam geneanet.library search --last-name Lincoln --first-name Abraham
fam geneanet.library search --keywords "family history"
```

Search output includes the exact index ID, source type, destination URL, name/title, source descriptor, summary, dates, places, thumbnail, access marker, total, next page, and available filter URLs. Totals and result IDs remain strings. A search-index ID is not a person index, media deposit ID, image ID, or collection-record ID. Follow the returned URL or metadata to resolve those identifiers.

`--page` is one-based. `--limit` accepts the website's 10, 20, 30, 40, 50, or 100 results per page, default 10. Each command fetches one page. Name spelling and accents are preserved. Event values are `all`, `birth`, `wedding`, and `death`. Date bounds and an event constrain the search; a year in a result may refer to another event. The service controls fuzzy matching, wildcard eligibility, advanced filters, and Premium access. See [Geneanet's search explanation](https://en.geneanet.org/help/search-engine-features-and-options-2).

Categories include `archives`, `arbres` (trees), `ouvrages` (books), and `presse` (newspapers). `photos` uses the dedicated [old-photos search](https://en.geneanet.org/old-photos/), which returns tree persons with portraits. It is distinct from the all-records `--with-images` filter, which also includes scans and other illustrated records.

Additional website fields can be passed as a JSON object, filename, or `-` for stdin. Explicit flags override matching fields:

```sh
fam geneanet.record search --input '{"nom":"Martin","prenom":"Jean","nom_pere":"Martin","prenom_mere":"Marie","with_variantes_nom":1,"place__0__":"Paris","size":20}'
fam geneanet.record search --input '{"nom":"Lincoln","categories_1[archives]":"archives","categories_2[archives#etatcivil]":"archives#etatcivil"}'
```

Parent fields are `nom_pere`, `prenom_pere`, `nom_mere`, `prenom_mere`; spouse fields use `_conjoint`. Name-variant flags use `with_variantes_…`. `prenom_operateur` uses the website's first-name matching mode. Place slots run from `place__0__` through `place__4__`, with corresponding `country__N__`, `region__N__`, `subregion__N__`, and `zonegeo__N__`. These are wire fields, not guaranteed free-account features. Unknown keys and nonscalar values fail locally; server acceptance does not prove every filter changed the result set. Prefer exact filter URLs from a successful search as evidence of current service syntax.

Use `--anonymous` for public reads. Some library-search and tree-profile requests receive an HTTP browser challenge even while ordinary searches, JSON metadata, and downloads work. A challenge is reported as an error, never an empty result or successful login. Open the returned page in a browser. There is no automatic browser-cookie import or challenge solver. Books/newspapers can also be discovered with `search --category ouvrages` or `--category presse`, then read through their returned viewer URLs.

## Collections, records, and family trees

```sh
fam geneanet.collection list
fam geneanet.collection list --zone france
fam geneanet.collection list --zone north_america
fam geneanet.record get --url 'RECORD_OR_COLLECTION_URL'
fam geneanet.person get --tree-id TREE --first-name Jane --last-name Doe
fam geneanet.person get --tree-id TREE --index PERSON_INDEX
fam geneanet.person media --tree-id TREE --person-index PERSON_INDEX
```

Catalog zones are `all`, `north_america`, `australia`, `benelux`, `central_eastern_europe`, `france`, `german`, `britain_island`, `scandinavia`, and `south_europe`. The catalog returns theme and collection links. Pass a returned collection URL to `record` for its description and search links.

`record` accepts supported Geneanet collection, `cercles/view`, archival-register, library, public-media, and tree-person URLs. It returns page text, table fields, source/relative links, and viewer or person metadata where present. It strips navigation and executable scripts. Tree profiles can include parent/spouse/child links, notes, sources, a person index, and linked media. The HTML output is a structured extraction, not a complete normalized genealogy model. Cross-site source links are returned for reference but not followed automatically. No generic GET/POST command exposes tree edits, messages, or other side effects.

An archival index may contain a transcription without an attached scan. Availability also varies by subscription, owner privacy, and external repository. An absent `viewer.downloadUrl` is not an invitation to construct one.

## Photos and documents

```sh
fam geneanet.person media --tree-id TREE --person-index PERSON_INDEX
fam geneanet.media get --deposit-id DEPOSIT_ID
fam geneanet.media references --deposit-id DEPOSIT_ID --view-id VIEW_ID
fam geneanet.media download --deposit-id DEPOSIT_ID --view-id VIEW_ID --out portrait.jpg

fam geneanet.record get --url 'https://en.geneanet.org/archival-registers/view/REGISTER_ID/PAGE'
fam geneanet.register images --register-id REGISTER_ID --from-page 1 --to-page 10
fam geneanet.record download --url 'https://en.geneanet.org/archival-registers/view/REGISTER_ID/PAGE' --out register.jpg

fam geneanet.record get --url 'https://en.geneanet.org/library/viewer/BOOK_ID?page=PAGE'
fam geneanet.record download --url 'https://en.geneanet.org/library/viewer/BOOK_ID?page=PAGE' --out book-page.pdf
```

Replace the uppercase placeholders with IDs from responses. Media metadata lists views and available image variants. The deposit ID (`doc_id`) identifies a document; the view ID (`doc_part_id`) identifies its page/image. The ID embedded in a portrait's thumbnail path is the view ID and can differ from the deposit ID. The downloader validates that the view belongs to the deposit, then uses the website's download route. `tree-media` and `media-references` provide the connection back to the tree person.

The register image API requires both `min_page` and `max_page`; `images` supplies an inclusive range of at most 100 pages. Results include page numbers, image IDs, the viewer link, thumbnail, and Zoomify base URL. The thumbnail/tile is not the full image. The downloader uses the explicit download control from the corresponding viewer.

Library pages use PDF.js. The CLI reads the viewer's `data-pdf-url` only when `data-telechargeable` permits downloading. The returned `singlePage` flag tells you whether the payload represents one page or a full PDF; the tested large book used a single-page PDF. Do not assume one download contains the whole volume. The CLI does not combine pages or reconstruct image tiles.

Downloads validate the image by decoding it, or check the PDF header and EOF marker. A `.json` sidecar records source and download URLs, record/view IDs, page scope, attribution, time, bytes, SHA-256, and image dimensions when applicable. No file is created for an HTML login/challenge response, a denied request, or corrupt image. Existing image/PDF and sidecar files are never overwritten. JSON output with ordinary `--out` is replaced atomically. API reads have 30-second request timeouts and bounded redirects; binary responses are limited to 150 MiB.

## API catalog and TypeScript

```sh
fam geneanet.api list
fam geneanet.api describe --operation images
fam geneanet.api.route list --filter media
fam geneanet.api.route list --filter geneweb_api
```

The catalog includes 16 traced read routes and 228 route declarations from the website's public routing bundle. Inventory entries are not executable contracts: omitted methods do not mean read-only, and query/body requirements are often unknown. See [operations](operations.md), [protocol](protocol.md), and [source provenance](provenance.json). Normal regeneration uses `npm run generate:catalogs`; it requires no credentials, browser, or downloaded app.

After [installing the library](../setup.md#typescript-library-use):

```ts
import { GeneanetClient, downloadMedia, saveDownload } from '@potatosalad/fam/geneanet';

const client = await GeneanetClient.open();
const results = await client.search({nom: 'Lincoln', prenom: 'Abraham', size: 10});
const document = await client.media('DEPOSIT_ID');
const viewId = String(document.views[0].id);
await saveDownload('/absolute/research/portrait.jpg',
  await downloadMedia(client, String(document.id), viewId));
```

`GeneanetClient.open(true)` uses a fresh anonymous cookie jar. Network errors, subscription denials, browser challenges, session rejection, and unexpected response formats are errors, not empty lists. Live verification is opt-in and must not run in CI; automated tests use synthetic records and disposable credential profiles.
