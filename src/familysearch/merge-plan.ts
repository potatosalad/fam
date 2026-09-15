import type {FamilySearchClient} from './client.js';
import {InputError} from '../shared/input-error.js';
import {prepareOperation} from './operations.js';
import {notMatches} from './not-matches.js';

export interface MergePlanOptions {reason: string; includeVitals?: boolean; includeRelationships?: boolean}

export function buildMergePlan(survivorId: string, duplicateId: string, analysis: any, options: MergePlanOptions) {
  if (survivorId === duplicateId) throw new InputError('A merge requires two different person IDs.');
  if (analysis.survivorPersonSummary?.id !== survivorId || analysis.duplicatePersonSummary?.id !== duplicateId)
    throw new Error('Merge analysis does not identify the requested survivor and duplicate.');
  if (!options.reason?.trim()) throw new InputError('Supply --reason describing the evidence for this merge.');
  const warnings: string[] = [];
  function ids(items: any[], field: string, group: string): string[] {
    return [...new Set(items.flatMap(item => {
      if (typeof item?.[field] === 'string' && item[field]) return [item[field]];
      warnings.push(`${group} contains an item without ${field}; inspect the analysis before merging.`); return [];
    }))];
  }
  const facts = [...(analysis.uniqueNonVitalConclusionsFromDuplicate ?? []), ...(options.includeVitals ? analysis.uniqueVitalConclusionsFromDuplicate ?? [] : [])];
  const sources = analysis.duplicateSources ?? [];
  const spouses = options.includeRelationships ? analysis.duplicateSpousesAndChildren ?? [] : [];
  const parents = options.includeRelationships ? analysis.uniqueParentChildRelationshipsAsChildFromDuplicate ?? [] : [];
  const associations = options.includeRelationships ? analysis.uniqueAssociationRelationshipsFromDuplicate ?? [] : [];
  const body = {idsOfConclusionsToCopy: ids(facts,'conclusionId','Facts'), idsOfConclusionsToDelete: [],
    idsOfSourceReferencesToCopy: ids(sources,'entityRefId','Sources'), idsOfSourceReferencesToDelete: [],
    idsOfCoupleRelationshipsToCopy: ids(spouses.filter((spouse: any) => spouse.coupleRelationshipId),'coupleRelationshipId','Couples'), idsOfCoupleRelationshipsToDelete: [],
    idsOfParentChildRelationshipsToCopy: [...new Set([...ids(parents,'id','Parents'),...ids(spouses.flatMap((spouse: any) => spouse.children ?? []),'relationshipId','Children')])], idsOfParentChildRelationshipsToDelete: [],
    idsOfAssociationRelationshipsToCopy: ids(associations,'id','Associations'), idsOfAssociationRelationshipsToDelete: [],
    attribution: {changeMessage: options.reason}};
  const constraint = analysis.personMergeConstraint ?? null;
  const providerWarnings = Object.entries(analysis).filter(([key,value]) => /Warnings?$/.test(key) && value != null && (!Array.isArray(value) || value.length > 0)).map(([field,detail]) => ({field,detail}));
  if (!['CAN_MERGE_ANY_ORDER','CAN_MERGE_IN_THIS_ORDER'].includes(constraint)) warnings.push(`Review the provider merge constraint: ${constraint ?? 'not supplied'}.`);
  const input = prepareOperation('persons.merge',{survivorId,duplicateId,body}).input;
  return {operation:'persons.merge', input, ready: warnings.length === 0 && providerWarnings.length === 0, constraint, warnings, providerWarnings,
    copy: {facts,sources,couples:spouses,parentChildRelationships:parents,associations},
    preserve: {survivor:analysis.survivorPersonSummary, vitals:!options.includeVitals, relationships:!options.includeRelationships, deleteIds:[]},
    analysis, note:'Read-only merge plan. No merge was performed. Rebuild immediately before execution; server data and constraints can change.'};
}

export async function planMerge(client: FamilySearchClient, survivorId: string, duplicateId: string, options: MergePlanOptions) {
  prepareOperation('persons.mergeAnalysis',{survivorId,duplicateId});
  if (survivorId === duplicateId || !options.reason?.trim()) throw new InputError('Supply different person IDs and a nonempty --reason.');
  const analysis = await client.operation('persons.mergeAnalysis',{survivorId,duplicateId});
  const plan = buildMergePlan(survivorId,duplicateId,analysis,options);
  const declarations = await notMatches(client,survivorId);
  const declaration = declarations.items.find((item: any) => item.personId === duplicateId) ?? null;
  if (declaration) {plan.ready = false;plan.warnings.push('This pair has a not-a-match declaration. Review its reason before taking further action.');}
  return {...plan,notAMatch:declaration};
}
