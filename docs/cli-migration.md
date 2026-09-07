# CLI grammar migration

The provider/command syntax is removed. All values now use named flags; optional flags and examples are available from `fam cli.command describe --command "PROVIDER.OBJECT ACTION"`. Ancestry record search uses `--first-name` and `--last-name` instead of `--given` and `--surname`.

| Previous command | Current syntax |
| --- | --- |
| `fam familysearch credentials` | `fam familysearch.credential set` |
| `fam familysearch sync` | `fam familysearch.credential sync` |
| `fam familysearch auth` | `fam familysearch.session login` |
| `fam familysearch status` | `fam familysearch.session get` |
| `fam familysearch refresh` | `fam familysearch.session refresh` |
| `fam familysearch verify` | `fam familysearch.session verify` |
| `fam familysearch whoami` | `fam familysearch.account get` |
| `fam familysearch ops` | `fam familysearch.api list` |
| `fam familysearch schema` | `fam familysearch.api describe --operation VALUE` |
| `fam familysearch call` | `fam familysearch.api call --operation VALUE` |
| `fam familysearch get` | `fam familysearch.api get --path VALUE` |
| `fam ancestry credentials` | `fam ancestry.credential set` |
| `fam ancestry sync` | `fam ancestry.credential sync` |
| `fam ancestry auth` | `fam ancestry.session login` |
| `fam ancestry status` | `fam ancestry.session get` |
| `fam ancestry refresh` | `fam ancestry.session refresh` |
| `fam ancestry ops` | `fam ancestry.api list` |
| `fam ancestry schema` | `fam ancestry.api describe --operation VALUE` |
| `fam ancestry gql` | `fam ancestry.api.gql query --operation VALUE` |
| `fam ancestry call` | `fam ancestry.api call --operation VALUE` |
| `fam ancestry get` | `fam ancestry.api get --path VALUE` |
| `fam myheritage credentials` | `fam myheritage.credential set` |
| `fam myheritage sync` | `fam myheritage.credential sync` |
| `fam myheritage auth` | `fam myheritage.session login` |
| `fam myheritage status` | `fam myheritage.session get` |
| `fam myheritage refresh` | `fam myheritage.session refresh` |
| `fam myheritage me` | `fam myheritage.account get` |
| `fam myheritage ops` | `fam myheritage.api list` |
| `fam myheritage schema` | `fam myheritage.api describe --operation VALUE` |
| `fam myheritage gql` | `fam myheritage.api.gql query --operation VALUE` |
| `fam myheritage query` | `fam myheritage.api.gql execute --document VALUE` |
| `fam myheritage call` | `fam myheritage.api call --operation VALUE` |
| `fam myheritage get` | `fam myheritage.api get --path VALUE` |
| `fam myheritage models` | `fam myheritage.api.model list` |
| `fam findmypast credentials` | `fam findmypast.credential set` |
| `fam findmypast sync` | `fam findmypast.credential sync` |
| `fam findmypast auth` | `fam findmypast.session login` |
| `fam findmypast status` | `fam findmypast.session get` |
| `fam findmypast refresh` | `fam findmypast.session refresh` |
| `fam findmypast me` | `fam findmypast.account get` |
| `fam findmypast ops` | `fam findmypast.api list` |
| `fam findmypast schema` | `fam findmypast.api describe --operation VALUE` |
| `fam findmypast gql` | `fam findmypast.api.gql query --operation VALUE` |
| `fam findmypast query` | `fam findmypast.api.gql execute --document VALUE` |
| `fam findmypast call` | `fam findmypast.api call --operation VALUE` |
| `fam findmypast get` | `fam findmypast.api get --path VALUE` |
| `fam findmypast models` | `fam findmypast.api.model list` |
| `fam findagrave credentials` | `fam findagrave.credential set` |
| `fam findagrave sync` | `fam findagrave.credential sync` |
| `fam findagrave auth` | `fam findagrave.session login` |
| `fam findagrave status` | `fam findagrave.session get` |
| `fam findagrave verify` | `fam findagrave.session verify` |
| `fam findagrave me` | `fam findagrave.account get` |
| `fam findagrave ops` | `fam findagrave.api list` |
| `fam findagrave schema` | `fam findagrave.api describe --operation VALUE` |
| `fam findagrave gql` | `fam findagrave.api.gql query --operation VALUE` |
| `fam findagrave query` | `fam findagrave.api.gql execute --document VALUE` |
| `fam findagrave call` | `fam findagrave.api call --operation VALUE` |
| `fam findagrave models` | `fam findagrave.api.model list` |
| `fam geneanet credentials` | `fam geneanet.credential set` |
| `fam geneanet sync` | `fam geneanet.credential sync` |
| `fam geneanet auth` | `fam geneanet.session login` |
| `fam geneanet status` | `fam geneanet.session get` |
| `fam geneanet verify` | `fam geneanet.session verify` |
| `fam geneanet me` | `fam geneanet.account get` |
| `fam geneanet ops` | `fam geneanet.api list` |
| `fam geneanet schema` | `fam geneanet.api describe --operation VALUE` |
| `fam storied credentials` | `fam storied.credential set` |
| `fam storied sync` | `fam storied.credential sync` |
| `fam storied auth` | `fam storied.session login` |
| `fam storied status` | `fam storied.session get` |
| `fam storied refresh` | `fam storied.session refresh` |
| `fam storied verify` | `fam storied.session verify` |
| `fam storied me` | `fam storied.account get` |
| `fam storied ops` | `fam storied.api list` |
| `fam storied schema` | `fam storied.api describe --operation VALUE` |
| `fam storied call` | `fam storied.api call --operation VALUE` |
| `fam storied models` | `fam storied.api.model list` |
| `fam familysearch metadata` | `fam familysearch.session.metadata get` |
| `fam familysearch tree-status` | `fam familysearch.tree status` |
| `fam familysearch person` | `fam familysearch.person get --person-id VALUE` |
| `fam familysearch ancestry` | `fam familysearch.person ancestry --person-id VALUE` |
| `fam familysearch mobile-person` | `fam familysearch.person.mobile get --person-id VALUE` |
| `fam familysearch mobile-pedigree` | `fam familysearch.person.mobile pedigree --person-id VALUE` |
| `fam familysearch image info` | `fam familysearch.image get --ark VALUE` |
| `fam familysearch image download` | `fam familysearch.image download --ark VALUE --out VALUE` |
| `fam familysearch image transcript` | `fam familysearch.image transcript --ark VALUE` |
| `fam familysearch collection browse` | `fam familysearch.collection browse --collection VALUE` |
| `fam familysearch film images` | `fam familysearch.film images --dgs VALUE` |
| `fam familysearch film image` | `fam familysearch.film image --dgs VALUE --image VALUE` |
| `fam familysearch fulltext available` | `fam familysearch.fulltext available --dgs VALUE` |
| `fam familysearch fulltext search` | `fam familysearch.fulltext search` |
| `fam familysearch record details` | `fam familysearch.record get --ark VALUE` |
| `fam ancestry trees` | `fam ancestry.tree list` |
| `fam ancestry tree` | `fam ancestry.tree get --tree-id VALUE` |
| `fam ancestry persons` | `fam ancestry.person list --tree-id VALUE` |
| `fam ancestry person` | `fam ancestry.person get --tree-id VALUE --person-id VALUE` |
| `fam ancestry relatives` | `fam ancestry.person relatives --tree-id VALUE --person-id VALUE` |
| `fam ancestry research` | `fam ancestry.person research --tree-id VALUE --person-id VALUE` |
| `fam ancestry story` | `fam ancestry.person story --tree-id VALUE --person-id VALUE` |
| `fam ancestry hints` | `fam ancestry.person hints --tree-id VALUE --person-id VALUE` |
| `fam ancestry media` | `fam ancestry.person media --tree-id VALUE --person-id VALUE` |
| `fam ancestry citations` | `fam ancestry.tree citations --tree-id VALUE` |
| `fam ancestry sources` | `fam ancestry.tree sources --tree-id VALUE` |
| `fam ancestry record` | `fam ancestry.record get --collection-id VALUE --record-id VALUE` |
| `fam ancestry search` | `fam ancestry.record search` |
| `fam ancestry places` | `fam ancestry.place search --prefix VALUE` |
| `fam myheritage sites` | `fam myheritage.site list` |
| `fam myheritage trees` | `fam myheritage.tree list --site-id VALUE` |
| `fam myheritage tree` | `fam myheritage.tree get --tree-id VALUE` |
| `fam myheritage people` | `fam myheritage.person list --tree-id VALUE` |
| `fam myheritage find` | `fam myheritage.person search --tree-id VALUE --name VALUE` |
| `fam myheritage person` | `fam myheritage.person get --person-id VALUE` |
| `fam myheritage insights` | `fam myheritage.person insights --person-id VALUE` |
| `fam myheritage events` | `fam myheritage.person events --person-id VALUE` |
| `fam myheritage timeline` | `fam myheritage.person timeline --person-id VALUE` |
| `fam myheritage facts` | `fam myheritage.person facts --person-id VALUE` |
| `fam myheritage matches` | `fam myheritage.person matches --person-id VALUE` |
| `fam myheritage records` | `fam myheritage.person records --person-id VALUE` |
| `fam myheritage family` | `fam myheritage.family get --family-id VALUE` |
| `fam myheritage media` | `fam myheritage.media list --parent-id VALUE` |
| `fam myheritage albums` | `fam myheritage.album list --site-id VALUE` |
| `fam myheritage consistency` | `fam myheritage.tree consistency --tree-id VALUE` |
| `fam myheritage search` | `fam myheritage.record search` |
| `fam myheritage record` | `fam myheritage.record get --url VALUE` |
| `fam myheritage catalog` | `fam myheritage.collection list` |
| `fam myheritage collections` | `fam myheritage.collection search --name VALUE` |
| `fam myheritage collection` | `fam myheritage.collection get --collection-id VALUE` |
| `fam myheritage search-fields` | `fam myheritage.collection fields --collection-id VALUE` |
| `fam myheritage document` | `fam myheritage.document get --url VALUE` |
| `fam myheritage download-document` | `fam myheritage.document download --url VALUE --out VALUE` |
| `fam findmypast subscription` | `fam findmypast.subscription get` |
| `fam findmypast trees` | `fam findmypast.tree list` |
| `fam findmypast tree` | `fam findmypast.tree get --tree-id VALUE` |
| `fam findmypast people` | `fam findmypast.person list --tree-id VALUE` |
| `fam findmypast person` | `fam findmypast.person get --tree-id VALUE --person-id VALUE` |
| `fam findmypast relatives` | `fam findmypast.person relatives --tree-id VALUE --person-id VALUE` |
| `fam findmypast hints` | `fam findmypast.person hints --tree-id VALUE --person-id VALUE` |
| `fam findmypast facts` | `fam findmypast.person facts --person-id VALUE` |
| `fam findmypast media` | `fam findmypast.person media --person-id VALUE` |
| `fam findmypast search` | `fam findmypast.record search` |
| `fam findmypast collections` | `fam findmypast.collection search` |
| `fam findmypast collection` | `fam findmypast.collection get --collection-id VALUE` |
| `fam findmypast entitlement` | `fam findmypast.record entitlement --record-id VALUE` |
| `fam findmypast record` | `fam findmypast.record get --record-id VALUE` |
| `fam findmypast image` | `fam findmypast.image get --record-id VALUE` |
| `fam findmypast download` | `fam findmypast.image download --record-id VALUE --out VALUE` |
| `fam findmypast newspapers` | `fam findmypast.newspaper search` |
| `fam findmypast newspaper-manifest` | `fam findmypast.newspaper manifest --newspaper-id VALUE` |
| `fam findagrave search` | `fam findagrave.memorial search` |
| `fam findagrave memorial` | `fam findagrave.memorial get --memorial-id VALUE` |
| `fam findagrave relatives` | `fam findagrave.memorial relatives --memorial-id VALUE` |
| `fam findagrave photos` | `fam findagrave.memorial photos --memorial-id VALUE` |
| `fam findagrave download` | `fam findagrave.photo download --memorial-id VALUE --photo-id VALUE --out VALUE` |
| `fam findagrave cemeteries` | `fam findagrave.cemetery search` |
| `fam findagrave cemetery` | `fam findagrave.cemetery get --cemetery-id VALUE` |
| `fam findagrave locations` | `fam findagrave.location search --name VALUE` |
| `fam findagrave contributor` | `fam findagrave.contributor get --contributor-id VALUE` |
| `fam findagrave my-cemeteries` | `fam findagrave.cemetery saved` |
| `fam findagrave virtual-cemeteries` | `fam findagrave.cemetery.virtual list` |
| `fam findagrave virtual-cemetery` | `fam findagrave.cemetery.virtual get --cemetery-id VALUE` |
| `fam findagrave volunteer-cemeteries` | `fam findagrave.cemetery volunteer` |
| `fam findagrave tags` | `fam findagrave.tag list` |
| `fam findagrave requests` | `fam findagrave.photo.request list` |
| `fam findagrave enums` | `fam findagrave.api.enum list` |
| `fam findagrave http-sites` | `fam findagrave.api.http-site list` |
| `fam geneanet search` | `fam geneanet.record search` |
| `fam geneanet photos` | `fam geneanet.photo search` |
| `fam geneanet library` | `fam geneanet.library search` |
| `fam geneanet collections` | `fam geneanet.collection list` |
| `fam geneanet record` | `fam geneanet.record get --url VALUE` |
| `fam geneanet person` | `fam geneanet.person get --tree-id VALUE` |
| `fam geneanet tree-media` | `fam geneanet.person media --tree-id VALUE --person-index VALUE` |
| `fam geneanet media` | `fam geneanet.media get --deposit-id VALUE` |
| `fam geneanet media-references` | `fam geneanet.media references --deposit-id VALUE --view-id VALUE` |
| `fam geneanet images` | `fam geneanet.register images --register-id VALUE` |
| `fam geneanet download` | `fam geneanet.record download --url VALUE --out VALUE` |
| `fam geneanet download-media` | `fam geneanet.media download --deposit-id VALUE --view-id VALUE --out VALUE` |
| `fam geneanet routes` | `fam geneanet.api.route list` |
| `fam storied trees` | `fam storied.tree list` |
| `fam storied tree` | `fam storied.tree get --tree-id VALUE` |
| `fam storied people` | `fam storied.person list --tree-id VALUE` |
| `fam storied find-people` | `fam storied.person search --name VALUE` |
| `fam storied person` | `fam storied.person get --person-id VALUE` |
| `fam storied pedigree` | `fam storied.person pedigree --tree-id VALUE --person-id VALUE` |
| `fam storied family` | `fam storied.person family --tree-id VALUE --person-id VALUE` |
| `fam storied events` | `fam storied.person events --tree-id VALUE --person-id VALUE` |
| `fam storied hints` | `fam storied.person hints --person-id VALUE` |
| `fam storied records` | `fam storied.person records --person-id VALUE` |
| `fam storied stories` | `fam storied.story list` |
| `fam storied person-stories` | `fam storied.person stories --person-id VALUE` |
| `fam storied story` | `fam storied.story get --story-id VALUE` |
| `fam storied comments` | `fam storied.story comments --story-id VALUE` |
| `fam storied feed` | `fam storied.feed get` |
| `fam storied media` | `fam storied.media list` |
| `fam storied media-item` | `fam storied.media get --media-id VALUE` |
| `fam storied groups` | `fam storied.group list` |
| `fam storied notifications` | `fam storied.notification list` |
| `fam storied subscription` | `fam storied.subscription get` |
| `fam storied recent-people` | `fam storied.person recent` |
| `fam storied home-hints` | `fam storied.hint list` |
| `fam storied mobile-version` | `fam storied.mobile.version get` |
| `fam storied search` | `fam storied.record search` |
| `fam storied model` | `fam storied.api.model get --name VALUE` |

Tool commands: `fam cli.command list`, `fam cli.command search --query TEXT`, `fam cli.command describe --command COMMAND`, `fam cli.health check`, `fam cli.completion install`, and `fam cli.version get`.

Existing shell startup hooks are updated by `fam cli.completion install`.
