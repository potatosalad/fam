# Genealogy operation reference

Generated from APK 5.4.4 contracts. Use `client.genealogy.<group>.<method>(input)` or `client.operation(name, input)`.

Path values and `body` are top-level input properties. Optional query/header values go inside `query` / `headers`. Their omission is supported by Retrofit; server requirements may be stricter. All path values are accepted unescaped and encoded once by this client.

A model’s required fields reflect the APK decoder. Optional non-null fields can be absent because the app has a default. Server-side create/update requirements can differ. Unknown response fields are preserved. See [contracts.json](contracts.json) for every nested field, nullability, and source provenance, and [generated types](../src/generated/models.ts) for TypeScript.

Use `client.operationDetailed()` for status, headers, and binary downloads. Response bodies for `void` operations are drained and discarded. `JsonValue` means the APK itself declares an unstructured acknowledgement.

## associations

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `associations.create` | POST `/service/mobile/api/v1/tf/association` | body: body AssociationPairingDto; query: returnAssociationData boolean | AssociationRelationshipDto |
| `associations.delete` | DELETE `/service/mobile/api/v1/tf/association/{associationId}` | header: X-Reason string; path: associationId string | void |
| `associations.deleteConclusion` | DELETE `/service/mobile/api/v1/tf/association/{associationId}/conclusion/{conclusionId}` | path: associationId string; path: conclusionId string; header: X-Reason string | void |
| `associations.deleteNote` | DELETE `/service/mobile/api/v1/tf/association/{associationId}/notes/{noteId}` | path: associationId string; path: noteId string; header: X-Reason string | void |
| `associations.reorder` | PUT `/service/mobile/api/v1/tf/association/{associationId}/persons/order` | path: associationId string; body: body AssociationRelationshipSummaryDto | void |
| `associations.addFact` | POST `/service/mobile/api/v1/tf/association/{associationRelationshipId}/conclusion/fact` | path: associationRelationshipId string; body: body FactDto | FactDto |
| `associations.updateFact` | PUT `/service/mobile/api/v1/tf/association/{associationRelationshipId}/conclusion/fact/{conclusionId}` | path: associationRelationshipId string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `associations.addNote` | POST `/service/mobile/api/v1/tf/association/{associationRelationshipId}/notes/` | path: associationRelationshipId string; body: body NoteDto | NoteDto |
| `associations.updateNote` | PUT `/service/mobile/api/v1/tf/association/{associationRelationshipId}/notes/{noteId}` | path: associationRelationshipId string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `associations.get` | GET `/service/mobile/api/v1/tf/association/{relationshipId}` | path: relationshipId string | AssociationRelationshipDto |
| `associations.notes` | GET `/service/mobile/api/v1/tf/association/{relationshipId}/notes` | path: relationshipId string | NoteListDto |
| `associations.note` | GET `/service/mobile/api/v1/tf/association/{relationshipId}/notes/{noteId}` | path: relationshipId string; path: noteId string | NoteDto |

## authorities

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `authorities.dates` | GET `/service/mobile/api/v1/authorities/dates` | query: text string; query: includeNoneAboveRow boolean | Array<AuthoritiesDateSuggestionDto> |
| `authorities.compliantName` | POST `/service/mobile/api/v1/authorities/name-forms/compliant` | body: body Array<NameFormValidationDto> | Array<NameFormComplianceDto> |
| `authorities.places` | GET `/service/mobile/api/v1/authorities/places` | query: name string; query: includeNoneAboveRow boolean | Array<AuthoritiesPlaceSuggestionDto> |
| `authorities.transliterate` | POST `/service/mobile/api/v1/authorities/transliteration` | body: body TransliterationRequestDto | TransliterationDto |
| `authorities.countries` | GET `/service/mobile/api/v1/places/countries` | — | CountriesDto |
| `authorities.states` | GET `/service/mobile/api/v1/places/countries/{countryId}/states-provinces` | path: countryId number | StatesDto |
| `authorities.locations` | GET `/service/mobile/api/v1/places/locations` | query: placeIds string | Array<PlaceLocationDto> |

## contributors

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `contributors.get` | GET `/service/mobile/api/v1/contributor/{contributorOrCisId}?includePathForCloseRelatives=true` | path: contributorOrCisId string | ContributorDto |
| `contributors.relationship` | GET `/service/mobile/api/v1/user-relationship/ft/contributor/relationship` | query: contributorId string; query: showPortraits boolean | RelationshipPathDto |
| `contributors.friendRelationship` | GET `/service/mobile/api/v1/user/friends/{cisId}/relationship` | path: cisId string | RelationshipPathDto |
| `contributors.relativeRelationship` | GET `/service/mobile/api/v1/user/relationship/relative/{relative_id}` | path: relative_id string; query: showApexCoParent boolean | RelationshipPathDto |

## couples

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `couples.notes` | GET `/service/mobile/api/v1/tf/couple/{id}/notes` | path: id string | NoteListDto |
| `couples.addNote` | POST `/service/mobile/api/v1/tf/couple/{id}/notes` | path: id string; body: body NoteDto | NoteDto |
| `couples.deleteNote` | DELETE `/service/mobile/api/v1/tf/couple/{id}/notes/{noteId}` | path: id string; path: noteId string; header: X-Reason string | void |
| `couples.note` | GET `/service/mobile/api/v1/tf/couple/{id}/notes/{noteId}` | path: id string; path: noteId string | NoteDto |
| `couples.updateNote` | PUT `/service/mobile/api/v1/tf/couple/{id}/notes/{noteId}` | path: id string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `couples.delete` | DELETE `/service/mobile/api/v1/tf/couple/{relationshipId}` | path: relationshipId string; header: X-Reason string | void |
| `couples.get` | GET `/service/mobile/api/v1/tf/couple/{relationshipId}` | path: relationshipId string | CoupleRelationshipDto |
| `couples.addFact` | POST `/service/mobile/api/v1/tf/couple/{relationshipId}/conclusion/fact` | path: relationshipId string; body: body FactDto | FactDto |
| `couples.updateFact` | PUT `/service/mobile/api/v1/tf/couple/{relationshipId}/conclusion/fact/{conclusionId}` | path: relationshipId string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `couples.deleteConclusion` | DELETE `/service/mobile/api/v1/tf/couple/{relationshipId}/conclusion/{conclusionId}` | path: relationshipId string; path: conclusionId string; header: X-Reason string | void |
| `couples.reorder` | PUT `/service/mobile/api/v1/tf/couple/{relationshipId}/spouses/order` | path: relationshipId string; body: body SwitchCoupleOrderDto | void |

## following

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `following.unfollow` | DELETE `/service/mobile/api/v1/watch/followers/CURRENT/watches` | query: personId string | void |
| `following.follow` | POST `/service/mobile/api/v1/watch/followers/CURRENT/watches` | body: body FollowDto | void |
| `following.status` | GET `/service/mobile/api/v1/watch/followers/CURRENT/watches/{personId}/status` | path: personId string | WatchDto |

## groups

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `groups.create` | POST `/service/mobile/api/v1/group-management/groups` | body: body GroupBodyDto | void |
| `groups.limits` | GET `/service/mobile/api/v1/group-management/groups/limits` | — | GroupLimitsDto |
| `groups.get` | GET `/service/mobile/api/v1/group-management/groups/{groupId}` | path: groupId string | GroupDto |
| `groups.update` | POST `/service/mobile/api/v1/group-management/groups/{groupId}` | path: groupId string; body: body GroupBodyDto | void |
| `groups.deleteImage` | DELETE `/service/mobile/api/v1/group-management/groups/{groupId}/image` | path: groupId string | void |
| `groups.uploadImage` | POST `/service/mobile/api/v1/group-management/groups/{groupId}/image` | path: groupId string; body: body UploadBody | void |
| `groups.invite` | POST `/service/mobile/api/v1/group-management/groups/{groupId}/invites` | path: groupId string | GroupInviteDto |
| `groups.getInvite` | GET `/service/mobile/api/v1/group-management/groups/{groupId}/invites/{inviteId}` | path: groupId string; path: inviteId string | GroupInviteDetailsDto |
| `groups.respondToInvite` | POST `/service/mobile/api/v1/group-management/groups/{groupId}/invites/{inviteId}` | path: groupId string; path: inviteId string | void |
| `groups.members` | GET `/service/mobile/api/v1/group-management/groups/{groupId}/members` | path: groupId string | GroupMembersDto |
| `groups.leave` | DELETE `/service/mobile/api/v1/group-management/groups/{groupId}/members/CURRENT` | path: groupId string | void |
| `groups.removeMember` | DELETE `/service/mobile/api/v1/group-management/groups/{groupId}/members/{memberCisId}` | path: groupId string; path: memberCisId string | void |
| `groups.updateMember` | POST `/service/mobile/api/v1/group-management/groups/{groupId}/members/{memberCisId}` | path: groupId string; path: memberCisId string; body: body GroupMemberUpdateDto | void |
| `groups.list` | GET `/service/mobile/api/v1/group-management/users/CURRENT/groups` | — | UserGroupSummariesDto |
| `groups.membership` | GET `/service/mobile/api/v1/group-management/users/CURRENT/groups/{groupId}` | path: groupId string; query: includeMemberCount boolean | UserGroupSummaryDto |

## helpers

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `helpers.helpees` | GET `/service/mobile/api/v1/help/permit/helpees` | — | Array<HelpUserDto> |
| `helpers.removeHelpee` | DELETE `/service/mobile/api/v1/help/permit/helpees/{cisId}` | path: cisId string | void |
| `helpers.addHelpee` | POST `/service/mobile/api/v1/help/permit/helpees/{cisId}` | path: cisId string | void |
| `helpers.offers` | GET `/service/mobile/api/v1/help/permit/offers/helpees` | — | Array<OfferDto> |
| `helpers.offer` | POST `/service/mobile/api/v1/help/permit/offers/helpees` | body: body OfferBodyDto | OfferDto |
| `helpers.deleteOffer` | DELETE `/service/mobile/api/v1/help/permit/offers/helpees/{offerId}` | path: offerId string | void |
| `helpers.request` | POST `/service/mobile/api/v1/help/permit/requests` | query: queueName string | void |
| `helpers.statistics` | GET `/service/mobile/api/v1/help/permit/requests/statistics` | query: queueName string | HelperConnectQueueInfoDto |
| `helpers.finish` | POST `/service/mobile/api/v1/ident/finishedHelping` | — | void |

## hints

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `hints.updateRecordMatch` | POST `/service/mobile/api/v1/platform/tree/persons/{personId}/matches?collection=https://familysearch.org/platform/collections/records` | path: personId string; body: body RecordHintAttributionDto; query: status string; header: Content-Type string | void |
| `hints.notAMatch` | POST `/service/mobile/api/v1/platform/tree/persons/{personId}/not-a-match` | path: personId string; body: body NotAMatchDto; header: X-Reason string | void |
| `hints.opportunities` | GET `/service/mobile/api/v1/pop/users/{cisId}/opportunities/summaries` | path: cisId string | DiscoveryHintsListDto |
| `hints.activities` | GET `/service/mobile/api/v1/taz/users/{cisId}/activities` | path: cisId string; query: limit number; query: type string; query: ancestralGens number; query: descendantGens number | DiscoveryArtifactEventListDto |
| `hints.matchByExample` | POST `/service/mobile/api/v2/tree/person/match-by-example` | body: body ExampleDto; query: unconnected boolean | MatchResultsDto |
| `hints.matchById` | GET `/service/mobile/api/v2/tree/person/match-by-id/{personId}` | path: personId string | SearchPersonDto |
| `hints.potentialPersons` | POST `/service/mobile/api/v2/tree/person/{childId}/potential-persons` | path: childId string; body: body PotentialParentsDataDto | PotentialParentsResponseDto |
| `hints.duplicate` | GET `/service/mobile/api/v2/tree/person/{personId}/match/{duplicateId}` | path: personId string; path: duplicateId string | PossibleMatchesDto |
| `hints.duplicates` | GET `/service/mobile/api/v2/tree/person/{personId}/matches?unmergeableMatches=true` | path: personId string | PossibleMatchesDto |
| `hints.recordMatches` | GET `/service/mobile/api/v2/tree/person/{pid}/record/matches` | path: pid string | RecordHintsDto \| undefined (HTTP 204) |

## history

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `history.list` | GET `/service/mobile/api/v1/platform/users/{cisId}/history` | path: cisId string; query: tid string | RecentsDto |
| `history.add` | POST `/service/mobile/api/v1/platform/users/{cisId}/history` | path: cisId string; query: tid string; body: body EntriesDto | void |
| `history.remove` | DELETE `/service/mobile/api/v1/platform/users/{cisId}/history/{personId}` | path: cisId string; path: personId string | void |
| `history.restoreChange` | PUT `/service/mobile/api/v1/tf/person/{pid}/changes/{changeId}/restore` | path: pid string; path: changeId string | void |
| `history.undoMerge` | PUT `/service/mobile/api/v1/tf/person/{pid}/changes/{changeId}/undomerge` | path: pid string; path: changeId string; body: body AttributionDto | void |
| `history.changes` | GET `/service/mobile/api/v2/tree/person/{pid}/changes` | path: pid string; query: from string | ChangeHistoryDto |

## memories

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `memories.contributor` | GET `/service/mobile/api/v1/artifact/contributor/{artifactPatronId}?includePathForCloseRelatives=true` | path: artifactPatronId number \| bigint | ContributorDto |
| `memories.upload` | POST `/service/mobile/api/v1/artifactmanager/artifacts/multipart` | body: body UploadBody | ArtifactResponseDto |
| `memories.delete` | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}` | path: artifactId number \| bigint | void |
| `memories.get` | GET `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}` | path: artifactId number \| bigint; query: includeAssociatedArtifacts boolean; query: includeDatesPlaces boolean | ArtifactDto |
| `memories.update` | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}` | path: artifactId number \| bigint; body: body ArtifactDto | ArtifactDto |
| `memories.unlink` | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/artifacts` | path: artifactId number \| bigint; query: otherArtifactId number \| bigint | void |
| `memories.link` | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/artifacts` | path: artifactId number \| bigint; query: otherArtifactId number \| bigint; query: setAsIcon boolean | void |
| `memories.comments` | GET `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/comments` | path: artifactId number \| bigint; query: includeContactNames boolean | CommentListDto |
| `memories.addComment` | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/comments` | path: artifactId number \| bigint; body: body CommentDto | CommentDto |
| `memories.deleteComment` | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/comments/{commentId}` | path: artifactId number \| bigint; path: commentId string | void |
| `memories.setDatePlace` | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/datesplaces` | path: artifactId number \| bigint; body: body DatePlaceDto | DatePlaceDto |
| `memories.replaceFile` | PUT `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/files` | path: artifactId number \| bigint; body: body string (raw story text) | ArtifactResponseDto |
| `memories.tagPerson` | POST `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/tags` | path: artifactId number \| bigint; query: treePersonId string; body: body ArtifactTagDto | ArtifactTagDto |
| `memories.untagPerson` | DELETE `/service/mobile/api/v1/artifactmanager/artifacts/{artifactId}/tags/{tagId}` | path: artifactId number \| bigint; path: tagId number | void |
| `memories.trash` | GET `/service/mobile/api/v1/artifactmanager/patrons/{cisId}/tombstones` | path: cisId string | TombstoneListDto |
| `memories.forUser` | GET `/service/mobile/api/v1/artifactmanager/patrons/{cisUserId}/artifacts` | path: cisUserId string; query: maxRecords number | ArtifactListDto |
| `memories.forPerson` | GET `/service/mobile/api/v1/artifactmanager/persons/personsByTreePersonId/{pid}/artifacts` | path: pid string; query: artifactCategory string; query: community boolean; query: includeAssociatedArtifacts boolean; query: includeDatesPlaces boolean | ArtifactListDto |
| `memories.updateTag` | POST `/service/mobile/api/v1/artifactmanager/photoTags/{tagId}` | path: tagId number; body: body ArtifactTagDto | ArtifactTagDto |
| `memories.purge` | DELETE `/service/mobile/api/v1/artifactmanager/tombstones/{tombstoneId}` | path: tombstoneId number \| bigint | void |
| `memories.restore` | POST `/service/mobile/api/v1/artifactmanager/tombstones/{tombstoneId}/restore` | path: tombstoneId number \| bigint | void |
| `memories.transform` | POST `/service/mobile/api/v1/memories/artifacts/{artifactId}/transform` | path: artifactId number \| bigint; query: relativeRotation number | void |
| `memories.topics` | GET `/service/mobile/api/v1/memories/memtts/topictags/{artifactId}/topics` | path: artifactId number \| bigint | TopicTagsListDto |
| `memories.suggestTopics` | POST `/service/mobile/api/v1/memories/memtts/topictags/{prefix}/getPrefix` | path: prefix string | TopicTagsListDto |
| `memories.addTopic` | POST `/service/mobile/api/v1/memories/memtts/topictags/{topic}` | path: topic string; body: body ArtifactIdsDto | ArtifactTopicTagResponseDto |
| `memories.deleteTopic` | DELETE `/service/mobile/api/v1/memories/memtts/topictags/{topic}/{artifactId}` | path: artifactId number \| bigint; path: topic string | void |
| `memories.groups` | GET `/service/mobile/api/v1/memories/mgm/groups/artifacts/{artifactId}` | path: artifactId number \| bigint | ArtifactFamilyGroupIdsDto |
| `memories.removeFromGroup` | DELETE `/service/mobile/api/v1/memories/mgm/groups/{groupId}/artifacts/{artifactId}` | path: groupId string; path: artifactId number \| bigint | void |
| `memories.addToGroup` | POST `/service/mobile/api/v1/memories/mgm/groups/{groupId}/artifacts/{artifactId}` | path: groupId string; path: artifactId number \| bigint | void |
| `memories.search` | GET `/service/mobile/api/v1/memories/search/artifacts` | query: searchTerms string; query: start number; query: pageSize number; query: searchFilter string | FindArtifactsDto |
| `memories.byTopic` | GET `/service/mobile/api/v1/memories/topictags/artifacts` | query: topics string; query: start number; query: pageSize number; query: searchFilter string | FindArtifactsDto |
| `memories.tags` | GET `/service/mobile/api/v2/memories/artifacts/{artifactId}/tags` | path: artifactId number \| bigint | ArtifactTagListDto |
| `memories.taggedPersons` | GET `/service/mobile/api/v2/memories/patrons/{cisId}/taggedPersons` | path: cisId string | ArtifactPersonaListDto |

## ordinances

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `ordinances.familyCardsV1` | POST `/service/mobile/api/v1/temple/cards/family` | body: body FamilyCardsRequestDto; query: timezoneOffsetMinutes number | TempleCardsResponseDtoV1 |
| `ordinances.transfer` | POST `/service/mobile/api/v1/transfer-a-name/batches?noEmailSender=MOBILE` | body: body ReservationTransferRequestDto | ReservationTransferResponseDto |
| `ordinances.builderRequest` | POST `/service/mobile/api/v1/tree/builder/persons/family-ordinance-request` | body: body TreeBuilderReservationDto | TempleCardsResponseDto |
| `ordinances.builderShare` | POST `/service/mobile/api/v1/tree/builder/persons/share-with-temple` | body: body TreeBuilderReservationDto | TreeBuilderSharedPersonsDto |
| `ordinances.ready` | POST `/service/mobile/api/v2/reservations/ordinances-ready` | body: body OrdinancesReadyRequestDto | OrdinancesReadyResponseDto |
| `ordinances.deleteReady` | DELETE `/service/mobile/api/v2/reservations/ordinances-ready/{token}` | path: token string | void |
| `ordinances.readyStatus` | GET `/service/mobile/api/v2/reservations/ordinances-ready/{token}` | path: token string; query: ordinanceTypeSpec string; query: sex string; query: stopProcessing boolean | OrdinancesReadyResponseDto |
| `ordinances.updateCards` | POST `/service/mobile/api/v2/reservations/owner/{ownerId}/cards` | path: ownerId string; query: cardAction string; query: reserveOrigin string; query: groupId string; body: body CardListDto | Uint8Array |
| `ordinances.completedCards` | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/completed` | path: ownerId string; query: limit number; query: sortOrder string | CompletedCardListDto |
| `ordinances.groupCards` | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/groups` | path: ownerId string; query: limit number; query: sortOrder string | CardListDto |
| `ordinances.personalCards` | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/personal` | path: ownerId string; query: limit number; query: sortOrder string | CardListDto |
| `ordinances.templeCards` | GET `/service/mobile/api/v2/reservations/owner/{ownerId}/cards/temple` | path: ownerId string; query: limit number; query: sortOrder string | CardListDto |
| `ordinances.personCards` | GET `/service/mobile/api/v2/reservations/person/{personId}/cards` | path: personId string | CardListDto |
| `ordinances.permissionExists` | GET `/service/mobile/api/v2/support/issue/ordinance-permission/exists/{personId}` | path: personId string; query: ordinances string; query: spouseId string; query: parent1Id string; query: parent2Id string | OrdinancePermissionSupportIssueDto |
| `ordinances.requestPermission` | POST `/service/mobile/api/v2/support/issue/ordinance-permissions` | body: body OrdinancePermissionDto | OrdinancePermissionResponseDto |
| `ordinances.permissionsExist` | GET `/service/mobile/api/v2/support/issue/ordinance-permissions/exist/{personId}` | path: personId string | OrdinancePermissionSupportIssuesDto |
| `ordinances.familyCards` | POST `/service/mobile/api/v2/temple/cards/family-ordinance-request` | body: body CardListDto | TempleCardsResponseDto |
| `ordinances.forPerson` | GET `/service/mobile/api/v2/tree/person/{personId}/ordinances` | path: personId string | OrdinanceListDto |

## parentChildren

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `parentChildren.create` | POST `/service/mobile/api/v1/tf/parentchild` | body: body AddParentChildRelationshipDto | void |
| `parentChildren.notes` | GET `/service/mobile/api/v1/tf/parentchild/{id}/notes` | path: id string | NoteListDto |
| `parentChildren.addNote` | POST `/service/mobile/api/v1/tf/parentchild/{id}/notes` | path: id string; body: body NoteDto | NoteDto |
| `parentChildren.deleteNote` | DELETE `/service/mobile/api/v1/tf/parentchild/{id}/notes/{noteId}` | path: id string; path: noteId string; header: X-Reason string | void |
| `parentChildren.note` | GET `/service/mobile/api/v1/tf/parentchild/{id}/notes/{noteId}` | path: id string; path: noteId string | NoteDto |
| `parentChildren.updateNote` | PUT `/service/mobile/api/v1/tf/parentchild/{id}/notes/{noteId}` | path: id string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `parentChildren.delete` | DELETE `/service/mobile/api/v1/tf/parentchild/{relationshipId}` | path: relationshipId string; header: X-Reason string | void |
| `parentChildren.get` | GET `/service/mobile/api/v1/tf/parentchild/{relationshipId}` | path: relationshipId string | ParentChildRelationshipDto |
| `parentChildren.addFact` | POST `/service/mobile/api/v1/tf/parentchild/{relationshipId}/conclusion/fact` | path: relationshipId string; body: body FactDto | FactDto |
| `parentChildren.updateFact` | PUT `/service/mobile/api/v1/tf/parentchild/{relationshipId}/conclusion/fact/{conclusionId}` | path: relationshipId string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `parentChildren.deleteConclusion` | DELETE `/service/mobile/api/v1/tf/parentchild/{relationshipId}/conclusion/{conclusionId}` | path: relationshipId string; path: conclusionId string; header: X-Reason string | void |
| `parentChildren.reorder` | PUT `/service/mobile/api/v1/tf/parentchild/{relationshipId}/parents/order` | path: relationshipId string; body: body SwitchParentOrderDto | void |

## pedigree

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `pedigree.ancestorCount` | GET `/service/mobile/api/v1/guided/tree/persons/{personId}/ancestorCount` | path: personId string; query: generations number | AncestorCountsDto |
| `pedigree.preferredParents` | GET `/service/mobile/api/v1/platform/tree/users/{userId}/preferred-parent-relationships/{pid}` | path: userId string; path: pid string | PreferredRelationshipDto |
| `pedigree.preferredSpouse` | GET `/service/mobile/api/v1/platform/tree/users/{userId}/preferred-spouse-relationships/{pid}` | path: userId string; path: pid string | PreferredRelationshipDto |
| `pedigree.setPreferences` | PUT `/service/mobile/api/v1/tf/user/preferences/pedigree/{pid}` | path: pid string; query: preferredCouple string; query: preferredParentChild string; query: preferredCoparentParentChild string | void |
| `pedigree.downloadTree` | GET `/service/mobile/api/v1/tree-graph/soiTreeDownload` | query: id string; query: destBoundary number; query: includeCounts boolean; query: srcBoundary number | SoiTreeDto |
| `pedigree.builderSearch` | POST `/service/mobile/api/v1/tree/builder/one-search` | body: body GuidedTreeBuilderOneSearchInfoDto | GuidedTreeBuilderOneSearchResultsDto |
| `pedigree.builderPersons` | GET `/service/mobile/api/v1/tree/builder/pedigree/persons/{ids}` | path: ids string | Record<string, GuidedTreeBuilderResultsPersonStatusDto> |
| `pedigree.builderPedigree` | GET `/service/mobile/api/v1/tree/builder/pedigree/{personId}` | path: personId string; query: numGenerations number | GuidedTreeBuilderPedigreeDto |
| `pedigree.builderDelete` | DELETE `/service/mobile/api/v1/tree/builder/pedigree/{personId}/position/{position}` | path: personId string; path: position string | void |
| `pedigree.builderAdd` | POST `/service/mobile/api/v1/tree/builder/pedigree/{personId}/position/{position}` | path: personId string; path: position string; body: body GuidedTreeBuilderNewPedigreePositionDto | GuidedTreeBuilderPedigreePersonDto |
| `pedigree.builderUpdate` | PUT `/service/mobile/api/v1/tree/builder/pedigree/{personId}/position/{position}` | path: personId string; path: position string; body: body GuidedTreeBuilderUpdatePedigreePositionDto | GuidedTreeBuilderPedigreePersonDto |
| `pedigree.builderSearchPersons` | GET `/service/mobile/api/v1/tree/builder/search/persons/{ids}` | path: ids string | Record<string, GuidedTreeBuilderSearchResultsPersonStatusDto> |
| `pedigree.expandPortrait` | GET `/service/mobile/api/v2/pedigree/ancestry/portrait/expand` | query: parent1Id string; query: parent2Id string; query: includeGoldenHints boolean; header: X-FS-Feature-Tag string | PedigreeExpansionDto |
| `pedigree.expandAncestors` | GET `/service/mobile/api/v2/pedigree/ancestry/sibling/expand/ancestors/{personId}` | path: personId string; query: numGenerations number; query: includeGoldenHints boolean | PedigreeAncestorDto |
| `pedigree.expandDescendants` | GET `/service/mobile/api/v2/pedigree/ancestry/sibling/expand/descendants/{personId}` | path: personId string; query: spouseId string | PedigreeDescendantDto |
| `pedigree.expandSiblings` | GET `/service/mobile/api/v2/pedigree/ancestry/sibling/expand/siblings/{personId}` | path: personId string | PedigreeSiblingDto |
| `pedigree.siblings` | GET `/service/mobile/api/v2/pedigree/ancestry/{personId}/sibling` | path: personId string; query: numGenerations number; query: includeGoldenHints boolean | PedigreeRootDto |
| `pedigree.portrait` | GET `/service/mobile/api/v2/pedigree/ancestry/{person_id}/portrait` | path: person_id string; query: numGenerations number; query: includeGoldenHints boolean; header: X-FS-Feature-Tag string | PedigreeDto |

## persons

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `persons.reportDeceasedAsLiving` | POST `/service/mobile/api/v1/support/issue/dead-to-living/person/{person_id}` | path: person_id string; body: body SupportIssueDto | SupportAnswerDto |
| `persons.delete` | DELETE `/service/mobile/api/v1/tf/person/{personId}` | path: personId string; header: X-Reason string | void |
| `persons.deleteConstraints` | GET `/service/mobile/api/v1/tf/person/{person_id}/delete-constraint` | path: person_id string | DeleteConstraintResponseDto |
| `persons.deleteConclusion` | DELETE `/service/mobile/api/v1/tf/person/{pid}/conclusion/{conclusionId}` | path: pid string; path: conclusionId string; header: X-Reason string | void |
| `persons.notes` | GET `/service/mobile/api/v1/tf/person/{pid}/notes` | path: pid string | NoteListDto |
| `persons.addNote` | POST `/service/mobile/api/v1/tf/person/{pid}/notes` | path: pid string; body: body NoteDto | NoteDto |
| `persons.deleteNote` | DELETE `/service/mobile/api/v1/tf/person/{pid}/notes/{noteId}` | path: pid string; path: noteId string; header: X-Reason string | void |
| `persons.note` | GET `/service/mobile/api/v1/tf/person/{pid}/notes/{noteId}` | path: pid string; path: noteId string | NoteDto |
| `persons.updateNote` | PUT `/service/mobile/api/v1/tf/person/{pid}/notes/{noteId}` | path: pid string; path: noteId string; body: body NoteDto; header: X-Reason string | NoteDto |
| `persons.addRelationship` | POST `/service/mobile/api/v1/tf/person/{pid}/relationship` | path: pid string; query: addMissingFamilyRelationships boolean; body: body AddCoupleRelationshipDto | void |
| `persons.updateAssociation` | PUT `/service/mobile/api/v1/tf/person/{pid}/relationship/{associationId}` | path: pid string; path: associationId string; body: body RelationshipPersonDto | void |
| `persons.updateRelationship` | PUT `/service/mobile/api/v1/tf/person/{pid}/relationship/{relationshipId}` | path: pid string; path: relationshipId string; body: body UpdateRelationshipDto; header: X-Reason string | void |
| `persons.merge` | PUT `/service/mobile/api/v1/tf/person/{survivorId}/merge/{duplicateId}` | path: survivorId string; path: duplicateId string; body: body MergeSpecificationDto; header: Product string | void |
| `persons.stats` | GET `/service/mobile/api/v1/tf/user/CURRENT/stats` | — | UserContributionStatsDto |
| `persons.create` | POST `/service/mobile/api/v2/tree/person` | body: body AddPersonWithRelationshipsDto; header: Product string | AddedPersonDto |
| `persons.get` | GET `/service/mobile/api/v2/tree/person/{pid}` | path: pid string; query: oneHops string | PersonDetailsDto |
| `persons.addFact` | POST `/service/mobile/api/v2/tree/person/{pid}/conclusion/fact` | path: pid string; body: body FactDto | FactDto |
| `persons.updateFact` | PUT `/service/mobile/api/v2/tree/person/{pid}/conclusion/fact/{conclusionId}` | path: pid string; path: conclusionId string; body: body FactDto; header: X-Reason string | FactDto |
| `persons.updateGender` | PUT `/service/mobile/api/v2/tree/person/{pid}/conclusion/gender/{conclusionId}` | path: pid string; path: conclusionId string; body: body FactDto | FactDto |
| `persons.addName` | POST `/service/mobile/api/v2/tree/person/{pid}/conclusion/name/` | path: pid string; body: body FactDto; header: X-Reason string | FactDto |
| `persons.updateName` | PUT `/service/mobile/api/v2/tree/person/{pid}/conclusion/name/{nameId}` | path: pid string; path: nameId string; body: body FactDto; header: X-Reason string | FactDto |
| `persons.mergeAnalysis` | GET `/service/mobile/api/v2/tree/person/{survivorId}/merge/{duplicateId}/analysis` | path: survivorId string; path: duplicateId string | MergeAnalysisDto |
| `persons.privatePersons` | GET `/service/mobile/api/v2/tree/private-space/persons` | query: nameFilter string | PrivatePersonsDto |
| `persons.contributions` | GET `/service/mobile/api/v2/tree/user/contributions?pageSize=300&includeOtherRelationships=true` | query: nameFilter string | UserContributionsDto |

## portraits

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `portraits.lastPublicEvent` | GET `/service/mobile/api/v1/tps/persons/{pid}/lastPublicEvent` | path: pid string | LastPublicEventDto |
| `portraits.delete` | DELETE `/service/mobile/api/v1/tps/persons/{pid}/portrait` | path: pid string | void |
| `portraits.get` | GET `/service/mobile/api/v1/tps/persons/{pid}/portrait` | path: pid string | PortraitDto |
| `portraits.set` | POST `/service/mobile/api/v1/tps/persons/{pid}/portrait` | path: pid string; body: body SetPortraitDto | PortraitDto |

## search

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `search.locationMap` | GET `/service/mobile/api/v1/search/location-map` | — | SearchLocationListDto |
| `search.categories` | POST `/service/mobile/api/v2/one-search/categories` | body: body OneSearchRequestDto | OneSearchFiltersDto |
| `search.countries` | GET `/service/mobile/api/v2/one-search/locations/countries` | — | OneSearchCountriesDto |
| `search.subcountries` | GET `/service/mobile/api/v2/one-search/locations/subcountries/{countryName}` | path: countryName string | OneSearchSubcountriesDto |
| `search.results` | POST `/service/mobile/api/v2/one-search/results` | body: body OneSearchRequestDto; query: from number; query: size number | OneSearchResultsDto |

## sources

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `sources.detach` | DELETE `/service/mobile/api/v1/platform/tree/persons/{personId}/source-references/{sourceReferenceId}` | path: personId string; path: sourceReferenceId string; header: X-Reason string; header: Content-Type string | void |
| `sources.updateLinks` | PUT `/service/mobile/api/v1/source-links/source/{descriptionId}` | path: descriptionId string; body: body DismissUADto | void |
| `sources.recordDetailsV1` | GET `/service/mobile/api/v1/source/record/details` | query: sourceUrl string | RecordDetailDto |
| `sources.attachRelationships` | POST `/service/mobile/api/v1/sourcelinker/attached/person/{personId}/relationships` | path: personId string; body: body MissingLinkerRelationshipTemplatesDto | void |
| `sources.updateEntityReference` | PUT `/service/mobile/api/v1/tf/person/{personId}/entityref/{entityRefId}` | path: personId string; path: entityRefId string; body: body SourceEntityRef | void |
| `sources.recordDetails` | GET `/service/mobile/api/v2/record/details` | query: recordUrl string; query: hideSectionFields boolean; query: includeFocusPersonSummary boolean | RecordDetailsDto |
| `sources.treeMatches` | GET `/service/mobile/api/v2/record/persona/{personaId}/tree/matches` | path: personaId string; query: includePersona boolean | PossibleMatchesDto |
| `sources.create` | POST `/service/mobile/api/v2/source` | body: body SourceDescriptionDto | SourceDescriptionDto |
| `sources.update` | PUT `/service/mobile/api/v2/source/{sourceId}` | path: sourceId string; body: body SourceDescriptionDto | SourceDescriptionDto |
| `sources.attachRecord` | POST `/service/mobile/api/v2/sourcelinker/attach` | body: body SourceLinkerAttachDto | JsonValue |
| `sources.linkerMatch` | GET `/service/mobile/api/v2/sourcelinker/match` | query: recordUrl string; query: personId string; query: matchOverrides string | SourceLinkerMatchDto |
| `sources.attach` | POST `/service/mobile/api/v2/tree/person/{pid}/source-reference` | path: pid string; body: body SourceReferenceDto | SourceReferenceResponseDto |
| `sources.updateReference` | PUT `/service/mobile/api/v2/tree/person/{pid}/source-reference/{sourceReferenceId}` | path: pid string; path: sourceReferenceId string; body: body SourceReferenceDto | void |
| `sources.forPerson` | GET `/service/mobile/api/v2/tree/person/{pid}/sources` | path: pid string | SourcesDto |

## tasks

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `tasks.descendants` | GET `/service/mobile/api/v2/tree/person/{pid}/descendant/tasks` | path: pid string; query: gens number; query: filter string; query: includeNeedsPermission boolean | Array<TaskDto> |
| `tasks.dismiss` | DELETE `/service/mobile/api/v2/tree/person/{pid}/tasks` | path: pid string; query: types string | DismissTasksDto |
| `tasks.list` | GET `/service/mobile/api/v2/user/tasks` | query: filter string; query: includeNeedsPermission boolean | Array<TaskDto> |

## trees

| Operation | HTTP path | Inputs | Response |
| --- | --- | --- | --- |
| `trees.setMePerson` | PUT `/service/mobile/api/v1/tf/user/CURRENT/tree/{treeId}/person/{mePersonId}` | path: treeId string; path: mePersonId string | void |
| `trees.matchPreference` | GET `/service/mobile/api/v1/user-preferences/users/{cis_user_id}/preferences/match.service` | path: cis_user_id string | MatchServicePreferenceDto |
| `trees.setMatchPreference` | PUT `/service/mobile/api/v1/user-preferences/users/{cis_user_id}/preferences/match.service` | path: cis_user_id string; body: body MatchServicePreferenceDto | void |
| `trees.status` | GET `/service/mobile/api/v1/user/tree/status` | — | TreeStatusDto |
| `trees.matchMe` | POST `/service/mobile/api/v1/user/tree/{treeId}/match-me-persons` | path: treeId string | MePersonMatchesDto |
