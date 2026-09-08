import {AmericanAncestorsError} from './http.js';
export const relationships = ['Any','Father','Mother','Spouse'] as const;
export interface FamilyMember {relationship: typeof relationships[number]; firstName?: string; lastName?: string}
export interface SearchField {id: string; name: string; type: 'string' | 'boolean'; kind: 'Attribute'}
export interface SearchOptions {
  firstName?: string; lastName?: string; keywords?: string; location?: string; fromYear?: string; toYear?: string;
  collection?: string; category?: string; project?: string; recordType?: string; volumeId?: string; pageName?: string;
  exact?: boolean; soundex?: boolean; free?: boolean; images?: boolean; page?: number;
  family?: FamilyMember[]; fields?: Record<string,string | boolean>;
}
export function searchFields(value: unknown): SearchField[] {
  if (!Array.isArray(value)) throw new AmericanAncestorsError('api-changed');
  const result = value.map(v => {
    const id = String(v?.AttributeId ?? '');
    if (!/^\d+$/.test(id) || typeof v.Name !== 'string' || !v.Name.trim() || !['string','boolean'].includes(v.Type)) throw new AmericanAncestorsError('api-changed');
    return {id,name:v.Name,type:v.Type as SearchField['type'],kind:'Attribute' as const};
  });
  if (new Set(result.map(f=>f.id)).size !== result.length) throw new AmericanAncestorsError('api-changed');
  return result;
}
export function validateSearch(o: SearchOptions) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('Search options must be an object.');
  const strings = ['firstName','lastName','keywords','location','fromYear','toYear','collection','category','project','recordType','volumeId','pageName'];
  const booleans = ['exact','soundex','free','images'];
  for (const [k,v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (strings.includes(k)) {if (typeof v !== 'string' || v.length > 2000 || /[\0\r\n]/.test(v)) throw new Error(`Invalid ${k} search criterion.`);}
    else if (booleans.includes(k)) {if (typeof v !== 'boolean') throw new Error(`Invalid ${k} search criterion.`);}
    else if (!['page','family','fields'].includes(k)) throw new Error('Unsupported American Ancestors search criterion.');
  }
  if (![o.firstName,o.lastName,o.keywords,o.collection].some(v => v?.trim())) throw new Error('Supply a first name, last name, keywords, or collection title.');
  if (!Number.isSafeInteger(o.page ?? 1) || (o.page ?? 1) < 1 || (o.page ?? 1) > 1_000_000) throw new Error('Page must be an integer between 1 and 1000000.');
  if (o.exact && o.soundex) throw new Error('Choose either exact or soundex matching.');
  for (const y of [o.fromYear,o.toYear]) if (y !== undefined && !/^\d{4}$/.test(y)) throw new Error('Years must have four digits.');
  if (o.fromYear && o.toYear && o.fromYear > o.toYear) throw new Error('From year must be on or before to year.');
  if ((o.volumeId || o.pageName) && !o.collection) throw new Error('Volume and page filters require a collection title.');
  if (o.volumeId && !/^\d+$/.test(o.volumeId)) throw new Error('Volume ID must be a decimal string.');
  if (o.family !== undefined) {
    if (!Array.isArray(o.family) || o.family.length > 3) throw new Error('Specify at most three family members.');
    for (const member of o.family) {
      if (!member || typeof member !== 'object' || Array.isArray(member) || Object.keys(member).some(k=>!['relationship','firstName','lastName'].includes(k)) || !relationships.includes(member.relationship)) throw new Error('Family relationship must be Any, Father, Mother, or Spouse.');
      for (const value of [member.firstName,member.lastName]) if (value !== undefined && (typeof value !== 'string' || value.length > 200 || /[\0\r\n]/.test(value))) throw new Error('Invalid family member name.');
      if (!member.firstName?.trim() && !member.lastName?.trim()) throw new Error('Each family member requires a first or last name.');
    }
  }
  if (o.fields !== undefined) {
    if (!o.fields || typeof o.fields !== 'object' || Array.isArray(o.fields) || Object.keys(o.fields).length > 20) throw new Error('Fields must be an object with at most 20 criteria.');
    if (Object.keys(o.fields).length && !o.collection?.trim()) throw new Error('Collection-specific fields require an exact collection title.');
    for (const [k,v] of Object.entries(o.fields)) if (!k.trim() || !['string','boolean'].includes(typeof v) || typeof v === 'string' && (!v.trim() || v.length > 2000 || /[\0\r\n]/.test(v))) throw new Error('Each field needs a name or ID and a nonempty string or boolean value.');
  }
}
export function searchQuery(o: SearchOptions = {}, schema?: SearchField[]) {
  validateSearch(o);
  const q = new URLSearchParams({searchPage:'Advanced-Search',page:String(o.page ?? 1),exactYear:'true',exactRecordType:'true'});
  for (const [key,value] of Object.entries({firstname:o.firstName,lastname:o.lastName,keywords:o.keywords,location:o.location,fromyear:o.fromYear,toyear:o.toYear,database:o.collection,category:o.category,project:o.project,recordtype:o.recordType,volumeId:o.volumeId,pageName:o.pageName})) if (value?.trim()) q.set(key,value.trim());
  for (const key of ['exact','soundex','free','images'] as const) if (o[key]) q.set(key,'true');
  (o.family ?? []).forEach((f,i)=>{q.set(`fam${i+1}type`,f.relationship);if(f.firstName?.trim())q.set(`fam${i+1}first`,f.firstName.trim());if(f.lastName?.trim())q.set(`fam${i+1}last`,f.lastName.trim());});
  const seen = new Set<string>();
  Object.entries(o.fields ?? {}).forEach(([key,value],i)=>{
    if (!schema) throw new Error('Collection field metadata is required to build this query; use client.search().');
    const matches = schema.filter(f=>f.id===key || f.name.toLowerCase()===key.trim().toLowerCase());
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous collection field: ${key}. Inspect fam americanancestors.collection get.`);
    const f=matches[0];if(seen.has(f.id))throw new Error('The same collection field was supplied more than once.');seen.add(f.id);
    if (f.type==='boolean' && value!==true && value!=='true') throw new Error('Boolean collection fields accept true only; omit the field to disable that restriction.');
    if (f.type==='string' && typeof value!=='string') throw new Error(`Collection field ${f.name} requires text.`);
    q.set(`[${i}].AttType`,f.kind);q.set(`[${i}].Id`,f.id);q.set(`[${i}].Name`,f.name);q.set(`[${i}].Value`,String(value));
  });
  return q;
}
