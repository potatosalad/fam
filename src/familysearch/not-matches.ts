import type {FamilySearchClient} from './client.js';
import {prepareOperation} from './operations.js';
import {attributionTimestamp,contributorNames} from './attribution.js';

/** Documented GEDCOM X read: https://developers.familysearch.org/main/docs/read-person-not-a-match-declarations */
export async function notMatches(client: FamilySearchClient, personId: string) {
  const {input} = prepareOperation('hints.duplicates', {personId});
  const result = await client.requestDetailed<any>(`/platform/tree/persons/${encodeURIComponent(String(input.personId))}/not-a-match`,
    {method:'GET', headers:{Accept:'application/x-gedcomx-v1+json'}, response:'json'});
  if (result.status === 204) return {personId, items: [], warnings: []};
  if (!Array.isArray(result.data?.persons)) throw new Error('FamilySearch returned an unfamiliar not-a-match declaration response.');
  const contributorId=(person:any):string|null=>{
    const contributor=person.attribution?.contributor;
    const id=contributor?.resourceId??contributor?.id;
    return typeof id==='string'&&id ? id : null;
  };
  const {names,warnings}=await contributorNames(client,result.data.persons.map(contributorId).filter((id:unknown):id is string=>typeof id==='string'));
  return {personId, warnings, items: result.data.persons.map((person: any) => {
    if (typeof person.id !== 'string') throw new Error('Not-a-match declaration is missing its person ID.');
    const id=contributorId(person), rawContributor=person.attribution?.contributor;
    return {personId: person.id, reason: person.attribution?.changeMessage ?? null,
      contributor: rawContributor ? {...rawContributor,id,name:id?names.get(id)??null:null} : null,
      modified: attributionTimestamp(person.attribution?.modified), links: person.links ?? {}, attribution: person.attribution ?? null};
  })};
}

export async function duplicateDetails(client: FamilySearchClient, personId: string, duplicateId: string) {
  const match = await client.operation('hints.duplicate', {personId, duplicateId});
  const declarations = await notMatches(client, personId);
  return {personId, duplicateId, match, notAMatch: declarations.items.find((item: any) => item.personId === duplicateId) ?? null};
}
