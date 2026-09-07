# Geneanet read operations

These 16 traced routes support the commands in the [provider guide](README.md). API origins, authentication, argument bindings, and known limits are explained in [protocol notes](protocol.md).

| Name | Method and route | Response | Evidence |
| --- | --- | --- | --- |
| search | GET `https://en.geneanet.org/fonds/individus/` | HTML → structured results, filters, next | HTTP verified |
| photos | GET `https://en.geneanet.org/old-photos/search/` | HTML → tree persons with portraits | HTTP verified |
| library | GET `https://en.geneanet.org/fonds/bibliotheque/` | HTML → book/newspaper snippets | browser; HTTP may require verification |
| collections | GET `https://en.geneanet.org/collections/catalog/` | HTML → themes and collection links | HTTP verified |
| record | GET `https://en.geneanet.org/cercles/view/{collection}/{record}` | HTML → transcribed fields, source notes | HTTP verified |
| person | GET `https://gw.geneanet.org/{tree}` | HTML → profile, relations, notes, sources, media | browser; HTTP may require verification |
| tree-media | GET `https://gw.geneanet.org/api/{tree}/media/{personIndex}` | JSON linked documents with distinct deposit/view IDs | HTTP verified |
| media | GET `https://en.geneanet.org/media/api/deposits/{depositId}` | JSON title, owner, type, views, image variants | HTTP verified |
| media-references | GET `https://en.geneanet.org/media/api/deposits/{depositId}/views/{viewId}/references` | JSON named/indexed persons | HTTP verified |
| download-media | GET `https://en.geneanet.org/media/download/{depositId}/{viewId}` | Image or PDF; resolves ownership through media first | HTTP verified |
| register | GET `https://en.geneanet.org/archival-registers/view/{registerId}/{page}` | HTML viewer, description, page count, download URL | HTTP verified |
| images | GET `https://en.geneanet.org/registres/api/images/{registerId}` | JSON pages, image IDs, thumbnail/Zoomify base URLs | HTTP verified |
| download-register | GET `https://en.geneanet.org/archival-registers/download/{registerId}/{page}` | Full image; resolve from register viewer | HTTP verified |
| book | GET `https://en.geneanet.org/library/viewer/{bookId}` | HTML PDF.js metadata, download permission and PDF URL | HTTP verified |
| download-book | GET `https://en.geneanet.org/library/viewer/pdf/{bookId}` | PDF; single-page or full-document mode comes from viewer metadata | HTTP verified |
| me | GET `https://api.geneanet.org/user/current` | JSON account; JWT filtered from output | HTTP verified |

Authentication uses GET `/connexion/`, POST `/connexion/login_check`, then an account read. Only explicit `auth` submits a password.

`fam geneanet routes FILTER` inspects 228 additional website route declarations. Their methods, hosts, paths and defaults come from the public route map. They are inventory only: paths may require undocumented query/body fields, a method omitted by Symfony does not establish read-only behavior, and some GET routes mutate state. The CLI does not execute them. No complete GraphQL or GeneWeb protobuf schema is claimed.

The maintained JSON is [contracts.json](contracts.json). Regenerate it into TypeScript with `npm run generate:catalogs`; check drift with `npm run check:catalogs`. Neither command contacts Geneanet.
