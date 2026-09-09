# Genealogy operation reference

Generated from APK 5.4.4 contracts. Use `client.genealogy.<group>.<method>(input)` or `client.operation(name, input)`.

Path values and `body` are top-level input properties. Optional query/header values go inside `query` / `headers`. Their omission is supported by Retrofit; server requirements may be stricter. All path values are accepted unescaped and encoded once by this client.

A model’s required fields reflect the APK decoder. Optional non-null fields can be absent because the app has a default. Server-side create/update requirements can differ. Unknown response fields are preserved. See [contracts.json](contracts.json) for every nested field, nullability, and source provenance, and [generated types](../../src/familysearch/generated/models.ts) for TypeScript.

Use `client.operationDetailed()` for status, headers, and binary downloads. Response bodies for `void` operations are drained and discarded. `JsonValue` means the APK itself declares an unstructured acknowledgement.

## associations

Other relationships between people, with facts and notes.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `associations.create` | Create an association between people, such as another non-family relationship. | POST `/service/mobile/api/v1/tf/association` | body: body AssociationPairingDto; query: returnAssociationData boolean | AssociationRelationshipDto |
| `associations.delete` | Delete a association relationship. | DELETE `/service/mobile/api/v1/tf/association/{associationId}` | header: X-Reason string; path: associationId string | void |
| `associations.deleteConclusion` | Delete a conclusion from a association relationship. | DELETE `/service/mobile/api/v1/tf/association/{associationId}/conclusion/{conclusionId}` | path: associationId string; path: conclusionId string; header: X-Reason string | void |
| `associations.deleteNote` | Delete a research note from a association relationship. | DELETE `/service/mobile/api/v1/tf/association/{associationId}/notes/{noteId}` | path: associationId string; path: noteId string; header: X-Reason string | void |
| `associations.reorder` | Change the order of people in an association relationship. | PUT `/service/mobile/api/v1/tf/association/{associationId}/persons/order` | path: associationId string; body: body AssociationRelationshipSummaryDto | void |
| `associations.addFact` | Add a fact or event to a association relationship. | POST `/service/mobile/api/v1/tf/association/{associationRelationshipId}/conclusion/fact` | path: associationRelationshipId string; body: body FactDto | FactDto |
| `associations.updateFact` | Edit a fact or event on a association relationship. | PUT `/service/mobile/api/v1/tf/association/{associationRelationshipId}/conclusion/fact/{conclusionId}` | path: associationRelationshipId string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `associations.addNote` | Add a research note to a association relationship. | POST `/service/mobile/api/v1/tf/association/{associationRelationshipId}/notes/` | path: associationRelationshipId string; body: body NoteDto | NoteDto |
| `associations.updateNote` | Edit a research note on a association relationship. | PUT `/service/mobile/api/v1/tf/association/{associationRelationshipId}/notes/{noteId}` | path: associationRelationshipId string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `associations.get` | Read a association relationship and its genealogy details. | GET `/service/mobile/api/v1/tf/association/{relationshipId}` | path: relationshipId string | AssociationRelationshipDto |
| `associations.notes` | List research notes on a association relationship. | GET `/service/mobile/api/v1/tf/association/{relationshipId}/notes` | path: relationshipId string | NoteListDto |
| `associations.note` | Read a research note on a association relationship. | GET `/service/mobile/api/v1/tf/association/{relationshipId}/notes/{noteId}` | path: relationshipId string; path: noteId string | NoteDto |

## authorities

Standardized dates, names, places, and transliteration.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `authorities.dates` | Normalize a date and find standardized date suggestions. | GET `/service/mobile/api/v1/authorities/dates` | query: text string; query: includeNoneAboveRow boolean | Array<AuthoritiesDateSuggestionDto> |
| `authorities.compliantName` | Check whether name forms comply with FamilySearch name rules. | POST `/service/mobile/api/v1/authorities/name-forms/compliant` | body: body Array<NameFormValidationDto> | Array<NameFormComplianceDto> |
| `authorities.places` | Find standardized place names and place suggestions. | GET `/service/mobile/api/v1/authorities/places` | query: name string; query: includeNoneAboveRow boolean | Array<AuthoritiesPlaceSuggestionDto> |
| `authorities.transliterate` | Transliterate names between writing systems. | POST `/service/mobile/api/v1/authorities/transliteration` | body: body TransliterationRequestDto | TransliterationDto |
| `authorities.countries` | List countries from the place authority. | GET `/service/mobile/api/v1/places/countries` | — | CountriesDto |
| `authorities.states` | List states and provinces in a country. | GET `/service/mobile/api/v1/places/countries/{countryId}/states-provinces` | path: countryId number | StatesDto |
| `authorities.locations` | Look up geographic locations for place IDs. | GET `/service/mobile/api/v1/places/locations` | query: placeIds string | Array<PlaceLocationDto> |

## contributors

Contributor profiles and relationship paths.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `contributors.get` | Read a contributor's profile and available relationship information. | GET `/service/mobile/api/v1/contributor/{contributorOrCisId}?includePathForCloseRelatives=true` | path: contributorOrCisId string | ContributorDto |
| `contributors.relationship` | Find your relationship path to another contributor. | GET `/service/mobile/api/v1/user-relationship/ft/contributor/relationship` | query: contributorId string; query: showPortraits boolean | RelationshipPathDto |
| `contributors.friendRelationship` | Find your relationship path to a friend. | GET `/service/mobile/api/v1/user/friends/{cisId}/relationship` | path: cisId string | RelationshipPathDto |
| `contributors.relativeRelationship` | Find your relationship path to a relative. | GET `/service/mobile/api/v1/user/relationship/relative/{relative_id}` | path: relative_id string; query: showApexCoParent boolean | RelationshipPathDto |

## couples

Spouses, couple relationships, facts, and notes.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `couples.notes` | List research notes on a couple relationship. | GET `/service/mobile/api/v1/tf/couple/{id}/notes` | path: id string | NoteListDto |
| `couples.addNote` | Add a research note to a couple relationship. | POST `/service/mobile/api/v1/tf/couple/{id}/notes` | path: id string; body: body NoteDto | NoteDto |
| `couples.deleteNote` | Delete a research note from a couple relationship. | DELETE `/service/mobile/api/v1/tf/couple/{id}/notes/{noteId}` | path: id string; path: noteId string; header: X-Reason string | void |
| `couples.note` | Read a research note on a couple relationship. | GET `/service/mobile/api/v1/tf/couple/{id}/notes/{noteId}` | path: id string; path: noteId string | NoteDto |
| `couples.updateNote` | Edit a research note on a couple relationship. | PUT `/service/mobile/api/v1/tf/couple/{id}/notes/{noteId}` | path: id string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `couples.delete` | Delete a couple relationship. | DELETE `/service/mobile/api/v1/tf/couple/{relationshipId}` | path: relationshipId string; header: X-Reason string | void |
| `couples.get` | Read a couple relationship and its genealogy details. | GET `/service/mobile/api/v1/tf/couple/{relationshipId}` | path: relationshipId string | CoupleRelationshipDto |
| `couples.addFact` | Add a fact or event to a couple relationship. | POST `/service/mobile/api/v1/tf/couple/{relationshipId}/conclusion/fact` | path: relationshipId string; body: body FactDto | FactDto |
| `couples.updateFact` | Edit a fact or event on a couple relationship. | PUT `/service/mobile/api/v1/tf/couple/{relationshipId}/conclusion/fact/{conclusionId}` | path: relationshipId string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `couples.deleteConclusion` | Delete a conclusion from a couple relationship. | DELETE `/service/mobile/api/v1/tf/couple/{relationshipId}/conclusion/{conclusionId}` | path: relationshipId string; path: conclusionId string; header: X-Reason string | void |
| `couples.reorder` | Change the display order of spouses in a couple relationship. | PUT `/service/mobile/api/v1/tf/couple/{relationshipId}/spouses/order` | path: relationshipId string; body: body SwitchCoupleOrderDto | void |

## following

Follow or unfollow changes to people.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `following.unfollow` | Stop following changes to a person. | DELETE `/service/mobile/api/v1/watch/followers/CURRENT/watches` | query: personId string | void |
| `following.follow` | Follow changes to a person. | POST `/service/mobile/api/v1/watch/followers/CURRENT/watches` | body: body FollowDto | void |
| `following.status` | Check whether you follow a person. | GET `/service/mobile/api/v1/watch/followers/CURRENT/watches/{personId}/status` | path: personId string | WatchDto |

## groups

Family groups, membership, images, and invitations.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `groups.create` | Create a family group. | POST `/service/mobile/api/v1/group-management/groups` | body: body GroupBodyDto | void |
| `groups.limits` | Read family group membership limits. | GET `/service/mobile/api/v1/group-management/groups/limits` | — | GroupLimitsDto |
| `groups.get` | Read a family group's details. | GET `/service/mobile/api/v1/group-management/groups/{groupId}` | path: groupId string | GroupDto |
| `groups.update` | Edit a family group's details. | POST `/service/mobile/api/v1/group-management/groups/{groupId}` | path: groupId string; body: body GroupBodyDto | void |
| `groups.deleteImage` | Remove a family group's image. | DELETE `/service/mobile/api/v1/group-management/groups/{groupId}/image` | path: groupId string | void |
| `groups.uploadImage` | Upload a family group image; binary files and multipart forms require the TypeScript client. | POST `/service/mobile/api/v1/group-management/groups/{groupId}/image` | path: groupId string; body: body UploadBody | void |
| `groups.invite` | Create an invitation to a family group. | POST `/service/mobile/api/v1/group-management/groups/{groupId}/invites` | path: groupId string | GroupInviteDto |
| `groups.getInvite` | Read a family group invitation. | GET `/service/mobile/api/v1/group-management/groups/{groupId}/invites/{inviteId}` | path: groupId string; path: inviteId string | GroupInviteDetailsDto |
| `groups.respondToInvite` | Respond to a family group invitation. | POST `/service/mobile/api/v1/group-management/groups/{groupId}/invites/{inviteId}` | path: groupId string; path: inviteId string | void |
| `groups.members` | List the members of a family group. | GET `/service/mobile/api/v1/group-management/groups/{groupId}/members` | path: groupId string | GroupMembersDto |
| `groups.leave` | Leave a family group. | DELETE `/service/mobile/api/v1/group-management/groups/{groupId}/members/CURRENT` | path: groupId string | void |
| `groups.removeMember` | Remove a member from a family group. | DELETE `/service/mobile/api/v1/group-management/groups/{groupId}/members/{memberCisId}` | path: groupId string; path: memberCisId string | void |
| `groups.updateMember` | Update a member's family group settings. | POST `/service/mobile/api/v1/group-management/groups/{groupId}/members/{memberCisId}` | path: groupId string; path: memberCisId string; body: body GroupMemberUpdateDto | void |
| `groups.list` | List your family groups. | GET `/service/mobile/api/v1/group-management/users/CURRENT/groups` | — | UserGroupSummariesDto |
| `groups.membership` | Read your membership in a family group. | GET `/service/mobile/api/v1/group-management/users/CURRENT/groups/{groupId}` | path: groupId string; query: includeMemberCount boolean | UserGroupSummaryDto |

## helpers

Helper access, offers, and people you assist.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `helpers.helpees` | List people you have permission to help. | GET `/service/mobile/api/v1/help/permit/helpees` | — | Array<HelpUserDto> |
| `helpers.removeHelpee` | Remove a person from your helper permissions. | DELETE `/service/mobile/api/v1/help/permit/helpees/{cisId}` | path: cisId string | void |
| `helpers.addHelpee` | Add a person to your helper permissions. | POST `/service/mobile/api/v1/help/permit/helpees/{cisId}` | path: cisId string | void |
| `helpers.offers` | List offers to help with family history. | GET `/service/mobile/api/v1/help/permit/offers/helpees` | — | Array<OfferDto> |
| `helpers.offer` | Read a family history helper offer. | POST `/service/mobile/api/v1/help/permit/offers/helpees` | body: body OfferBodyDto | OfferDto |
| `helpers.deleteOffer` | Delete a family history helper offer. | DELETE `/service/mobile/api/v1/help/permit/offers/helpees/{offerId}` | path: offerId string | void |
| `helpers.request` | Request helper access to another person's family history. | POST `/service/mobile/api/v1/help/permit/requests` | query: queueName string | void |
| `helpers.statistics` | Read family history helper statistics. | GET `/service/mobile/api/v1/help/permit/requests/statistics` | query: queueName string | HelperConnectQueueInfoDto |
| `helpers.finish` | Finish the current helper session. | POST `/service/mobile/api/v1/ident/finishedHelping` | — | void |

## hints

Historical record hints and possible duplicate people.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `hints.updateRecordMatch` | Accept or dismiss a historical record hint for a person. | POST `/service/mobile/api/v1/platform/tree/persons/{personId}/matches?collection=https://familysearch.org/platform/collections/records` | path: personId string; body: body RecordHintAttributionDto; query: status string; header: Content-Type string | void |
| `hints.notAMatch` | Mark a possible duplicate person as not a match. | POST `/service/mobile/api/v1/platform/tree/persons/{personId}/not-a-match` | path: personId string; body: body NotAMatchDto; header: X-Reason string | void |
| `hints.opportunities` | List suggested genealogy research opportunities. | GET `/service/mobile/api/v1/pop/users/{cisId}/opportunities/summaries` | path: cisId string | DiscoveryHintsListDto |
| `hints.activities` | List discovery activities and memory events for a user's relatives. | GET `/service/mobile/api/v1/taz/users/{cisId}/activities` | path: cisId string; query: limit number; query: type string; query: ancestralGens number; query: descendantGens number | DiscoveryArtifactEventListDto |
| `hints.matchByExample` | Find matching tree people using supplied person details. | POST `/service/mobile/api/v2/tree/person/match-by-example` | body: body ExampleDto; query: unconnected boolean | MatchResultsDto |
| `hints.matchById` | Read person information used for matching by person ID. | GET `/service/mobile/api/v2/tree/person/match-by-id/{personId}` | path: personId string | SearchPersonDto |
| `hints.potentialPersons` | Find potential parents for a child using supplied matching details. | POST `/service/mobile/api/v2/tree/person/{childId}/potential-persons` | path: childId string; body: body PotentialParentsDataDto | PotentialParentsResponseDto |
| `hints.duplicate` | Inspect a specific possible duplicate person. | GET `/service/mobile/api/v2/tree/person/{personId}/match/{duplicateId}` | path: personId string; path: duplicateId string | PossibleMatchesDto |
| `hints.duplicates` | Find possible duplicate people to review before merging. | GET `/service/mobile/api/v2/tree/person/{personId}/matches?unmergeableMatches=true` | path: personId string | PossibleMatchesDto |
| `hints.recordMatches` | Find historical record hints for a person. | GET `/service/mobile/api/v2/tree/person/{pid}/record/matches` | path: pid string | RecordHintsDto \| undefined (HTTP 204) |

## history

Recently viewed people, change history, and restoration.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `history.list` | List recently viewed people in FamilySearch history. | GET `/service/mobile/api/v1/platform/users/{cisId}/history` | path: cisId string; query: tid string | RecentsDto |
| `history.add` | Add people to FamilySearch recently viewed history. | POST `/service/mobile/api/v1/platform/users/{cisId}/history` | path: cisId string; query: tid string; body: body EntriesDto | void |
| `history.remove` | Remove a person from FamilySearch recently viewed history. | DELETE `/service/mobile/api/v1/platform/users/{cisId}/history/{personId}` | path: cisId string; path: personId string | void |
| `history.restoreChange` | Restore a previous person conclusion from change history. | PUT `/service/mobile/api/v1/tf/person/{pid}/changes/{changeId}/restore` | path: pid string; path: changeId string | void |
| `history.undoMerge` | Undo a person merge using its change-history entry. | PUT `/service/mobile/api/v1/tf/person/{pid}/changes/{changeId}/undomerge` | path: pid string; path: changeId string; body: body AttributionDto | void |
| `history.changes` | Read a person's change history and contributor attributions. | GET `/service/mobile/api/v2/tree/person/{pid}/changes` | path: pid string; query: from string | ChangeHistoryDto |

## memories

Photos, documents, stories, audio, tags, and comments.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `memories.contributor` | Read the contributor of a memory photo, document, story, or audio recording. | GET `/service/mobile/api/v1/artifact/contributor/{artifactPatronId}?includePathForCloseRelatives=true` | path: artifactPatronId number \| bigint | ContributorDto |
| `memories.upload` | Upload a memory artifact; binary files and multipart forms require the TypeScript client. | POST `/service/mobile/api/v1/artifactmanager/artifacts/multipart` | body: body UploadBody | ArtifactResponseDto |
| `memories.delete` | Move a memory artifact to the trash. | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}` | path: artifactId number \| bigint | void |
| `memories.get` | Read a memory artifact and its photo, document, story, or audio metadata. | GET `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}` | path: artifactId number \| bigint; query: includeAssociatedArtifacts boolean; query: includeDatesPlaces boolean | ArtifactDto |
| `memories.update` | Edit a memory artifact's title, description, and metadata. | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}` | path: artifactId number \| bigint; body: body ArtifactDto | ArtifactDto |
| `memories.unlink` | Remove the link between two associated memory artifacts. | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/artifacts` | path: artifactId number \| bigint; query: otherArtifactId number \| bigint | void |
| `memories.link` | Link associated memory artifacts, such as pages of a document. | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/artifacts` | path: artifactId number \| bigint; query: otherArtifactId number \| bigint; query: setAsIcon boolean | void |
| `memories.comments` | Read comments on a memory artifact. | GET `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/comments` | path: artifactId number \| bigint; query: includeContactNames boolean | CommentListDto |
| `memories.addComment` | Add a comment to a memory artifact. | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/comments` | path: artifactId number \| bigint; body: body CommentDto | CommentDto |
| `memories.deleteComment` | Delete a comment from a memory artifact. | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/comments/{commentId}` | path: artifactId number \| bigint; path: commentId string | void |
| `memories.setDatePlace` | Set the date and place associated with a memory. | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/datesplaces` | path: artifactId number \| bigint; body: body DatePlaceDto | DatePlaceDto |
| `memories.replaceFile` | Replace a memory story's raw text. | PUT `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/files` | path: artifactId number \| bigint; body: body string (raw story text) | ArtifactResponseDto |
| `memories.tagPerson` | Tag a person in a memory photo or document. | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/tags` | path: artifactId number \| bigint; query: treePersonId string; body: body ArtifactTagDto | ArtifactTagDto |
| `memories.untagPerson` | Remove a person's tag from a memory. | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/tags/{tagId}` | path: artifactId number \| bigint; path: tagId number | void |
| `memories.trash` | List a contributor's deleted memories in the trash. | GET `/service/mobile/api/v1/artifactmanager/patrons/{cisId}/tombstones` | path: cisId string | TombstoneListDto |
| `memories.forUser` | List the memories contributed by a user. | GET `/service/mobile/api/v1/artifactmanager/patrons/{cisUserId}/artifacts` | path: cisUserId string; query: maxRecords number | ArtifactListDto |
| `memories.forPerson` | List photos, stories, documents, and audio memories attached to a person. | GET `/service/mobile/api/v1/artifactmanager/persons/personsByTreePersonId/{pid}/artifacts` | path: pid string; query: artifactCategory string; query: community boolean; query: includeAssociatedArtifacts boolean; query: includeDatesPlaces boolean | ArtifactListDto |
| `memories.updateTag` | Edit a person's tag on a memory. | POST `/service/mobile/api/v1/artifactmanager/photoTags/{tagId}` | path: tagId number; body: body ArtifactTagDto | ArtifactTagDto |
| `memories.purge` | Permanently delete a memory from the trash. | DELETE `/service/mobile/api/v1/artifactmanager/tombstones/{tombstoneId}` | path: tombstoneId number \| bigint | void |
| `memories.restore` | Restore a deleted memory from the trash. | POST `/service/mobile/api/v1/artifactmanager/tombstones/{tombstoneId}/restore` | path: tombstoneId number \| bigint | void |
| `memories.transform` | Rotate a memory image. | POST `/service/mobile/api/v1/memories/artifacts/{artifactId}/transform` | path: artifactId number \| bigint; query: relativeRotation number | void |
| `memories.topics` | Read a memory's topic tags. | GET `/service/mobile/api/v1/memories/memtts/topictags/{artifactId}/topics` | path: artifactId number \| bigint | TopicTagsListDto |
| `memories.suggestTopics` | Find suggested memory topic tags by a prefix. | POST `/service/mobile/api/v1/memories/memtts/topictags/{prefix}/getPrefix` | path: prefix string | TopicTagsListDto |
| `memories.addTopic` | Add a topic tag to memories. | POST `/service/mobile/api/v1/memories/memtts/topictags/{topic}` | path: topic string; body: body ArtifactIdsDto | ArtifactTopicTagResponseDto |
| `memories.deleteTopic` | Remove a topic tag from a memory. | DELETE `/service/mobile/api/v1/memories/memtts/topictags/{topic}/{artifactId}` | path: artifactId number \| bigint; path: topic string | void |
| `memories.groups` | List family groups associated with a memory. | GET `/service/mobile/api/v1/memories/mgm/groups/artifacts/{artifactId}` | path: artifactId number \| bigint | ArtifactFamilyGroupIdsDto |
| `memories.removeFromGroup` | Remove a memory from a family group. | DELETE `/service/mobile/api/v1/memories/mgm/groups/{groupId}/artifacts/{artifactId}` | path: groupId string; path: artifactId number \| bigint | void |
| `memories.addToGroup` | Share a memory with a family group. | POST `/service/mobile/api/v1/memories/mgm/groups/{groupId}/artifacts/{artifactId}` | path: groupId string; path: artifactId number \| bigint | void |
| `memories.search` | Find memories by keyword: search photographs, documents, stories, and audio. | GET `/service/mobile/api/v1/memories/search/artifacts` | query: searchTerms string; query: start number; query: pageSize number; query: searchFilter string | FindArtifactsDto |
| `memories.byTopic` | Find memories by topic tags. | GET `/service/mobile/api/v1/memories/topictags/artifacts` | query: topics string; query: start number; query: pageSize number; query: searchFilter string | FindArtifactsDto |
| `memories.tags` | List person tags on a memory artifact. | GET `/service/mobile/api/v2/memories/artifacts/{artifactId}/tags` | path: artifactId number \| bigint | ArtifactTagListDto |
| `memories.taggedPersons` | List people tagged in a contributor's memories. | GET `/service/mobile/api/v2/memories/patrons/{cisId}/taggedPersons` | path: cisId string | ArtifactPersonaListDto |

## ordinances

Ordinance information, reservations, and cards.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `ordinances.familyCardsV1` | Request printable family ordinance cards through the older endpoint. | POST `/service/mobile/api/v1/temple/cards/family` | body: body FamilyCardsRequestDto; query: timezoneOffsetMinutes number | TempleCardsResponseDtoV1 |
| `ordinances.transfer` | Create a batch for transferring ordinance reservations. | POST `/service/mobile/api/v1/transfer-a-name/batches?noEmailSender=MOBILE` | body: body ReservationTransferRequestDto | ReservationTransferResponseDto |
| `ordinances.builderRequest` | Request family ordinances through the guided tree builder. | POST `/service/mobile/api/v1/tree/builder/persons/family-ordinance-request` | body: body TreeBuilderReservationDto | TempleCardsResponseDto |
| `ordinances.builderShare` | Share guided tree builder ordinances with the temple. | POST `/service/mobile/api/v1/tree/builder/persons/share-with-temple` | body: body TreeBuilderReservationDto | TreeBuilderSharedPersonsDto |
| `ordinances.ready` | Start an Ordinances Ready request. | POST `/service/mobile/api/v2/reservations/ordinances-ready` | body: body OrdinancesReadyRequestDto | OrdinancesReadyResponseDto |
| `ordinances.deleteReady` | Delete an Ordinances Ready request. | DELETE `/service/mobile/api/v2/reservations/ordinances-ready/{token}` | path: token string | void |
| `ordinances.readyStatus` | Check the status of an Ordinances Ready request. | GET `/service/mobile/api/v2/reservations/ordinances-ready/{token}` | path: token string; query: ordinanceTypeSpec string; query: sex string; query: stopProcessing boolean | OrdinancesReadyResponseDto |
| `ordinances.updateCards` | Update a reservation owner's ordinance cards. | POST `/service/mobile/api/v2/reservations/owner/{ownerId}/cards` | path: ownerId string; query: cardAction string; query: reserveOrigin string; query: groupId string; body: body CardListDto | Uint8Array |
| `ordinances.completedCards` | Retrieve completed ordinance cards for a reservation owner. | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/completed` | path: ownerId string; query: limit number; query: sortOrder string | CompletedCardListDto |
| `ordinances.groupCards` | Retrieve family group ordinance cards for a reservation owner. | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/groups` | path: ownerId string; query: limit number; query: sortOrder string | CardListDto |
| `ordinances.personalCards` | Retrieve personal ordinance cards for a reservation owner. | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/personal` | path: ownerId string; query: limit number; query: sortOrder string | CardListDto |
| `ordinances.templeCards` | Retrieve temple-shared ordinance cards for a reservation owner. | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/temple` | path: ownerId string; query: limit number; query: sortOrder string | CardListDto |
| `ordinances.personCards` | Retrieve ordinance cards for a person. | GET `/service/mobile/api/v2/reservations/person/{personId}/cards` | path: personId string | CardListDto |
| `ordinances.permissionExists` | Check for an ordinance permission request for a person. | GET `/service/mobile/api/v2/support/issue/ordinance-permission/exists/{personId}` | path: personId string; query: ordinances string; query: spouseId string; query: parent1Id string; query: parent2Id string | OrdinancePermissionSupportIssueDto |
| `ordinances.requestPermission` | Request permission to perform ordinances for a person. | POST `/service/mobile/api/v2/support/issue/ordinance-permissions` | body: body OrdinancePermissionDto | OrdinancePermissionResponseDto |
| `ordinances.permissionsExist` | Check ordinance permissions for a person. | GET `/service/mobile/api/v2/support/issue/ordinance-permissions/exist/{personId}` | path: personId string | OrdinancePermissionSupportIssuesDto |
| `ordinances.familyCards` | Request printable family ordinance cards. | POST `/service/mobile/api/v2/temple/cards/family-ordinance-request` | body: body CardListDto | TempleCardsResponseDto |
| `ordinances.forPerson` | Read ordinance information for a person. | GET `/service/mobile/api/v2/tree/person/{personId}/ordinances` | path: personId string | OrdinanceListDto |

## parentChildren

Parent-child relationships, facts, and notes.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `parentChildren.create` | Create a parent-child relationship. | POST `/service/mobile/api/v1/tf/parentchild` | body: body AddParentChildRelationshipDto | void |
| `parentChildren.notes` | List research notes on a parent-child relationship. | GET `/service/mobile/api/v1/tf/parentchild/{id}/notes` | path: id string | NoteListDto |
| `parentChildren.addNote` | Add a research note to a parent-child relationship. | POST `/service/mobile/api/v1/tf/parentchild/{id}/notes` | path: id string; body: body NoteDto | NoteDto |
| `parentChildren.deleteNote` | Delete a research note from a parent-child relationship. | DELETE `/service/mobile/api/v1/tf/parentchild/{id}/notes/{noteId}` | path: id string; path: noteId string; header: X-Reason string | void |
| `parentChildren.note` | Read a research note on a parent-child relationship. | GET `/service/mobile/api/v1/tf/parentchild/{id}/notes/{noteId}` | path: id string; path: noteId string | NoteDto |
| `parentChildren.updateNote` | Edit a research note on a parent-child relationship. | PUT `/service/mobile/api/v1/tf/parentchild/{id}/notes/{noteId}` | path: id string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `parentChildren.delete` | Delete a parent-child relationship. | DELETE `/service/mobile/api/v1/tf/parentchild/{relationshipId}` | path: relationshipId string; header: X-Reason string | void |
| `parentChildren.get` | Read a parent-child relationship and its genealogy details. | GET `/service/mobile/api/v1/tf/parentchild/{relationshipId}` | path: relationshipId string | ParentChildRelationshipDto |
| `parentChildren.addFact` | Add a fact or event to a parent-child relationship. | POST `/service/mobile/api/v1/tf/parentchild/{relationshipId}/conclusion/fact` | path: relationshipId string; body: body FactDto | FactDto |
| `parentChildren.updateFact` | Edit a fact or event on a parent-child relationship. | PUT `/service/mobile/api/v1/tf/parentchild/{relationshipId}/conclusion/fact/{conclusionId}` | path: relationshipId string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `parentChildren.deleteConclusion` | Delete a conclusion from a parent-child relationship. | DELETE `/service/mobile/api/v1/tf/parentchild/{relationshipId}/conclusion/{conclusionId}` | path: relationshipId string; path: conclusionId string; header: X-Reason string | void |
| `parentChildren.reorder` | Change the display order of parents in a parent-child relationship. | PUT `/service/mobile/api/v1/tf/parentchild/{relationshipId}/parents/order` | path: relationshipId string; body: body SwitchParentOrderDto | void |

## pedigree

Ancestors, descendants, siblings, and guided tree building.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `pedigree.ancestorCount` | Count a person's ancestors by generation. | GET `/service/mobile/api/v1/guided/tree/persons/{personId}/ancestorCount` | path: personId string; query: generations number | AncestorCountsDto |
| `pedigree.preferredParents` | Read a person's preferred parents for pedigree display. | GET `/service/mobile/api/v1/platform/tree/users/{userId}/preferred-parent-relationships/{pid}` | path: userId string; path: pid string | PreferredRelationshipDto |
| `pedigree.preferredSpouse` | Read a person's preferred spouse for pedigree display. | GET `/service/mobile/api/v1/platform/tree/users/{userId}/preferred-spouse-relationships/{pid}` | path: userId string; path: pid string | PreferredRelationshipDto |
| `pedigree.setPreferences` | Set preferred parents, spouse, and coparent relationships for pedigree display. | PUT `/service/mobile/api/v1/tf/user/preferences/pedigree/{pid}` | path: pid string; query: preferredCouple string; query: preferredParentChild string; query: preferredCoparentParentChild string | void |
| `pedigree.downloadTree` | Download a tree graph; this returns structured tree data, not a GEDCOM file. | GET `/service/mobile/api/v1/tree-graph/soiTreeDownload` | query: id string; query: destBoundary number; query: includeCounts boolean; query: srcBoundary number | SoiTreeDto |
| `pedigree.builderSearch` | Search for people using the guided tree builder. | POST `/service/mobile/api/v1/tree/builder/one-search` | body: body GuidedTreeBuilderOneSearchInfoDto | GuidedTreeBuilderOneSearchResultsDto |
| `pedigree.builderPersons` | Read guided tree builder status for a set of people. | GET `/service/mobile/api/v1/tree/builder/pedigree/persons/{ids}` | path: ids string | Record<string, GuidedTreeBuilderResultsPersonStatusDto> |
| `pedigree.builderPedigree` | Read a guided tree builder pedigree. | GET `/service/mobile/api/v1/tree/builder/pedigree/{personId}` | path: personId string; query: numGenerations number | GuidedTreeBuilderPedigreeDto |
| `pedigree.builderDelete` | Remove a person from the guided tree builder. | DELETE `/service/mobile/api/v1/tree/builder/pedigree/{personId}/position/{position}` | path: personId string; path: position string | void |
| `pedigree.builderAdd` | Add a person to the guided tree builder. | POST `/service/mobile/api/v1/tree/builder/pedigree/{personId}/position/{position}` | path: personId string; path: position string; body: body GuidedTreeBuilderNewPedigreePositionDto | GuidedTreeBuilderPedigreePersonDto |
| `pedigree.builderUpdate` | Edit a person in the guided tree builder. | PUT `/service/mobile/api/v1/tree/builder/pedigree/{personId}/position/{position}` | path: personId string; path: position string; body: body GuidedTreeBuilderUpdatePedigreePositionDto | GuidedTreeBuilderPedigreePersonDto |
| `pedigree.builderSearchPersons` | Search tree people using guided tree builder person details. | GET `/service/mobile/api/v1/tree/builder/search/persons/{ids}` | path: ids string | Record<string, GuidedTreeBuilderSearchResultsPersonStatusDto> |
| `pedigree.expandPortrait` | Expand a portrait pedigree around a person. | GET `/service/mobile/api/v2/pedigree/ancestry/portrait/expand` | query: parent1Id string; query: parent2Id string; query: includeGoldenHints boolean; header: X-FS-Feature-Tag string | PedigreeExpansionDto |
| `pedigree.expandAncestors` | Expand a person's ancestors in a pedigree. | GET `/service/mobile/api/v2/pedigree/ancestry/sibling/expand/ancestors/{personId}` | path: personId string; query: numGenerations number; query: includeGoldenHints boolean | PedigreeAncestorDto |
| `pedigree.expandDescendants` | Expand a person's descendants in a pedigree. | GET `/service/mobile/api/v2/pedigree/ancestry/sibling/expand/descendants/{personId}` | path: personId string; query: spouseId string | PedigreeDescendantDto |
| `pedigree.expandSiblings` | Expand a person's siblings in a pedigree. | GET `/service/mobile/api/v2/pedigree/ancestry/sibling/expand/siblings/{personId}` | path: personId string | PedigreeSiblingDto |
| `pedigree.siblings` | Read a person's siblings in a pedigree. | GET `/service/mobile/api/v2/pedigree/ancestry/{personId}/sibling` | path: personId string; query: numGenerations number; query: includeGoldenHints boolean | PedigreeRootDto |
| `pedigree.portrait` | Read a portrait pedigree for a person. | GET `/service/mobile/api/v2/pedigree/ancestry/{person_id}/portrait` | path: person_id string; query: numGenerations number; query: includeGoldenHints boolean; header: X-FS-Feature-Tag string | PedigreeDto |

## persons

People, names, facts, notes, relationships, and merges.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `persons.reportDeceasedAsLiving` | Report a person incorrectly marked deceased as living. | POST `/service/mobile/api/v1/support/issue/dead-to-living/person/{person_id}` | path: person_id string; body: body SupportIssueDto | SupportAnswerDto |
| `persons.delete` | Delete a person. | DELETE `/service/mobile/api/v1/tf/person/{personId}` | path: personId string; header: X-Reason string | void |
| `persons.deleteConstraints` | Check constraints before deleting a person. | GET `/service/mobile/api/v1/tf/person/{person_id}/delete-constraint` | path: person_id string | DeleteConstraintResponseDto |
| `persons.deleteConclusion` | Delete a conclusion from a person. | DELETE `/service/mobile/api/v1/tf/person/{pid}/conclusion/{conclusionId}` | path: pid string; path: conclusionId string; header: X-Reason string | void |
| `persons.notes` | List research notes on a person. | GET `/service/mobile/api/v1/tf/person/{pid}/notes` | path: pid string | NoteListDto |
| `persons.addNote` | Add a research note to a person. | POST `/service/mobile/api/v1/tf/person/{pid}/notes` | path: pid string; body: body NoteDto | NoteDto |
| `persons.deleteNote` | Delete a research note from a person. | DELETE `/service/mobile/api/v1/tf/person/{pid}/notes/{noteId}` | path: pid string; path: noteId string; header: X-Reason string | void |
| `persons.note` | Read a research note on a person. | GET `/service/mobile/api/v1/tf/person/{pid}/notes/{noteId}` | path: pid string; path: noteId string | NoteDto |
| `persons.updateNote` | Edit a research note on a person. | PUT `/service/mobile/api/v1/tf/person/{pid}/notes/{noteId}` | path: pid string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `persons.addRelationship` | Add a relationship to a person. | POST `/service/mobile/api/v1/tf/person/{pid}/relationship` | path: pid string; query: addMissingFamilyRelationships boolean; body: body AddCoupleRelationshipDto | void |
| `persons.updateAssociation` | Edit a person's association relationship. | PUT `/service/mobile/api/v1/tf/person/{pid}/relationship/{associationId}` | path: pid string; path: associationId string; body: body RelationshipPersonDto | void |
| `persons.updateRelationship` | Edit a person's family relationship. | PUT `/service/mobile/api/v1/tf/person/{pid}/relationship/{relationshipId}` | path: pid string; path: relationshipId string; body: body UpdateRelationshipDto; header: X-Reason string | void |
| `persons.merge` | Merge two duplicate people into the specified surviving person. | PUT `/service/mobile/api/v1/tf/person/{survivorId}/merge/{duplicateId}` | path: survivorId string; path: duplicateId string; body: body MergeSpecificationDto; header: Product string | void |
| `persons.stats` | Read your Family Tree contribution statistics. | GET `/service/mobile/api/v1/tf/user/CURRENT/stats` | — | UserContributionStatsDto |
| `persons.create` | Create a person in Family Tree. | POST `/service/mobile/api/v2/tree/person` | body: body AddPersonWithRelationshipsDto; header: Product string | AddedPersonDto |
| `persons.get` | Read a person and its genealogy details. | GET `/service/mobile/api/v2/tree/person/{pid}` | path: pid string; query: oneHops string | PersonDetailsDto |
| `persons.addFact` | Add a fact or event to a person. | POST `/service/mobile/api/v2/tree/person/{pid}/conclusion/fact` | path: pid string; body: body FactDto | FactDto |
| `persons.updateFact` | Edit a fact or event on a person. | PUT `/service/mobile/api/v2/tree/person/{pid}/conclusion/fact/{conclusionId}` | path: pid string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `persons.updateGender` | Edit a person's recorded sex or gender conclusion. | PUT `/service/mobile/api/v2/tree/person/{pid}/conclusion/gender/{conclusionId}` | path: pid string; path: conclusionId string; body: body FactDto | FactDto |
| `persons.addName` | Add a name to a person. | POST `/service/mobile/api/v2/tree/person/{pid}/conclusion/name/` | path: pid string; body: body FactDto; header: X-Reason string | FactDto |
| `persons.updateName` | Edit a person's name. | PUT `/service/mobile/api/v2/tree/person/{pid}/conclusion/name/{nameId}` | path: pid string; path: nameId string; body: body FactDto; header: X-Reason string | FactDto |
| `persons.mergeAnalysis` | Compare duplicate people and inspect conflicts before a merge. | GET `/service/mobile/api/v2/tree/person/{survivorId}/merge/{duplicateId}/analysis` | path: survivorId string; path: duplicateId string | MergeAnalysisDto |
| `persons.privatePersons` | List people in your private tree space. | GET `/service/mobile/api/v2/tree/private-space/persons` | query: nameFilter string | PrivatePersonsDto |
| `persons.contributions` | List your Family Tree contributions. | GET `/service/mobile/api/v2/tree/user/contributions?pageSize=300&includeOtherRelationships=true` | query: nameFilter string | UserContributionsDto |

## portraits

Person portraits and portrait events.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `portraits.lastPublicEvent` | Read a person's most recent public portrait event. | GET `/service/mobile/api/v1/tps/persons/{pid}/lastPublicEvent` | path: pid string | LastPublicEventDto |
| `portraits.delete` | Remove a person's portrait. | DELETE `/service/mobile/api/v1/tps/persons/{pid}/portrait` | path: pid string | void |
| `portraits.get` | Read a person's portrait. | GET `/service/mobile/api/v1/tps/persons/{pid}/portrait` | path: pid string | PortraitDto |
| `portraits.set` | Set a person's portrait. | POST `/service/mobile/api/v1/tps/persons/{pid}/portrait` | path: pid string; body: body SetPortraitDto | PortraitDto |

## search

Mobile unified search for tree people, records, and memories.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `search.locationMap` | Read locations available for mobile search. | GET `/service/mobile/api/v1/search/location-map` | — | SearchLocationListDto |
| `search.categories` | Find available categories and filters for a mobile unified search. | POST `/service/mobile/api/v2/one-search/categories` | body: body OneSearchRequestDto | OneSearchFiltersDto |
| `search.countries` | List countries available for mobile unified search. | GET `/service/mobile/api/v2/one-search/locations/countries` | — | OneSearchCountriesDto |
| `search.subcountries` | List regions within a country for mobile unified search. | GET `/service/mobile/api/v2/one-search/locations/subcountries/{countryName}` | path: countryName string | OneSearchSubcountriesDto |
| `search.results` | Search tree people, indexed historical records, or memories using mobile unified search. | POST `/service/mobile/api/v2/one-search/results` | body: body OneSearchRequestDto; query: from number; query: size number | OneSearchResultsDto |

## sources

Source citations, record details, and source attachment.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `sources.detach` | Detach a source reference from a person. | DELETE `/service/mobile/api/v1/platform/tree/persons/{personId}/source-references/{sourceReferenceId}` | path: personId string; path: sourceReferenceId string; header: X-Reason string; header: Content-Type string | void |
| `sources.updateLinks` | Update source links and their unattached-person information. | PUT `/service/mobile/api/v1/source-links/source/{descriptionId}` | path: descriptionId string; body: body DismissUADto | void |
| `sources.recordDetailsV1` | Read indexed historical record details through the older mobile endpoint. | GET `/service/mobile/api/v1/source/record/details` | query: sourceUrl string | RecordDetailDto |
| `sources.attachRelationships` | Attach missing relationships through the source linker. | POST `/service/mobile/api/v1/sourcelinker/attached/person/{personId}/relationships` | path: personId string; body: body MissingLinkerRelationshipTemplatesDto | void |
| `sources.updateEntityReference` | Update a person's source entity reference. | PUT `/service/mobile/api/v1/tf/person/{personId}/entityref/{entityRefId}` | path: personId string; path: entityRefId string; body: body SourceEntityRef | void |
| `sources.recordDetails` | Read indexed historical record details from a record URL. | GET `/service/mobile/api/v2/record/details` | query: recordUrl string; query: hideSectionFields boolean; query: includeFocusPersonSummary boolean | RecordDetailsDto |
| `sources.treeMatches` | Find tree people matching an indexed record person. | GET `/service/mobile/api/v2/record/persona/{personaId}/tree/matches` | path: personaId string; query: includePersona boolean | PossibleMatchesDto |
| `sources.create` | Create a source with its citation and description. | POST `/service/mobile/api/v2/source` | body: body SourceDescriptionDto | SourceDescriptionDto |
| `sources.update` | Edit a source's citation and description. | PUT `/service/mobile/api/v2/source/{sourceId}` | path: sourceId string; body: body SourceDescriptionDto | SourceDescriptionDto |
| `sources.attachRecord` | Attach an indexed historical record using the source linker. | POST `/service/mobile/api/v2/sourcelinker/attach` | body: body SourceLinkerAttachDto | JsonValue |
| `sources.linkerMatch` | Compare a historical record with a tree person in the source linker. | GET `/service/mobile/api/v2/sourcelinker/match` | query: recordUrl string; query: personId string; query: matchOverrides string | SourceLinkerMatchDto |
| `sources.attach` | Attach a source reference to a person. | POST `/service/mobile/api/v2/tree/person/{pid}/source-reference` | path: pid string; body: body SourceReferenceDto | SourceReferenceResponseDto |
| `sources.updateReference` | Edit a person's source reference and attribution. | PUT `/service/mobile/api/v2/tree/person/{pid}/source-reference/{sourceReferenceId}` | path: pid string; path: sourceReferenceId string; body: body SourceReferenceDto | void |
| `sources.forPerson` | List sources attached to a person. | GET `/service/mobile/api/v2/tree/person/{pid}/sources` | path: pid string | SourcesDto |

## tasks

Genealogy research tasks and descendant opportunities.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `tasks.descendants` | List research tasks for a person's descendants. | GET `/service/mobile/api/v2/tree/person/{pid}/descendant/tasks` | path: pid string; query: gens number; query: filter string; query: includeNeedsPermission boolean | Array<TaskDto> |
| `tasks.dismiss` | Dismiss research tasks for a person. | DELETE `/service/mobile/api/v2/tree/person/{pid}/tasks` | path: pid string; query: types string | DismissTasksDto |
| `tasks.list` | List your genealogy research tasks. | GET `/service/mobile/api/v2/user/tasks` | query: filter string; query: includeNeedsPermission boolean | Array<TaskDto> |

## trees

Tree context, matching preferences, and the person representing you.

| Operation | Description | HTTP path | Inputs | Response |
| --- | --- | --- | --- | --- |
| `trees.setMePerson` | Set the person representing you in a tree. | PUT `/service/mobile/api/v1/tf/user/CURRENT/tree/{treeId}/person/{mePersonId}` | path: treeId string; path: mePersonId string | void |
| `trees.matchPreference` | Read a user's tree-matching preference. | GET `/service/mobile/api/v1/user-preferences/users/{cis_user_id}/preferences/match.service` | path: cis_user_id string | MatchServicePreferenceDto |
| `trees.setMatchPreference` | Change a user's tree-matching preference. | PUT `/service/mobile/api/v1/user-preferences/users/{cis_user_id}/preferences/match.service` | path: cis_user_id string; body: body MatchServicePreferenceDto | void |
| `trees.status` | Read the current tree status and available tree context. | GET `/service/mobile/api/v1/user/tree/status` | — | TreeStatusDto |
| `trees.matchMe` | Find tree people matching the current user. | POST `/service/mobile/api/v1/user/tree/{treeId}/match-me-persons` | path: treeId string | MePersonMatchesDto |
