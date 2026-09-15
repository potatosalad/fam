import type {FamilySearchClient} from './client.js';
import {prepareOperation} from './operations.js';

/** Documented GEDCOM X read: https://developers.familysearch.org/main/docs/read-person-not-a-match-declarations */
export async function notMatches(client: FamilySearchClient, personId: string) {
  const {input} = prepareOperation('hints.duplicates', {personId});
  const result = await client.requestDetailed<any>(`/platform/tree/persons/${encodeURIComponent(String(input.personId))}/not-a-match`,
    {method:'GET', headers:{Accept:'application/x-gedcomx-v1+json'}, response:'json'});
  if (result.status === 204) return {personId, items: []};
  if (!Array.isArray(result.data?.persons)) throw new Error('FamilySearch returned an unfamiliar not-a-match declaration response.');
  return {personId, items: result.data.persons.map((person: any) => {
    if (typeof person.id !== 'string') throw new Error('Not-a-match declaration is missing its person ID.');
    return {personId: person.id, reason: person.attribution?.changeMessage ?? null, contributor: person.attribution?.contributor ?? null,
      modified: person.attribution?.modified ?? null, links: person.links ?? {}, attribution: person.attribution ?? null};
  })};
}

export async function duplicateDetails(client: FamilySearchClient, personId: string, duplicateId: string) {
  const match = await client.operation('hints.duplicate', {personId, duplicateId});
  const declarations = await notMatches(client, personId);
  return {personId, duplicateId, match, notAMatch: declarations.items.find((item: any) => item.personId === duplicateId) ?? null};
}
