export interface RecordField {
  Name: string;
  Assertion?: string;
  Value?: string | number | bigint;
  NormalizedValue?: string | number | bigint;
  Relationship?: string;
  Source?: string;
  [key: string]: unknown;
}
export interface HouseholdMember {
  collectionId: string;
  recordId: string;
  relationship: string;
  givenName: string | null;
  surname: string | null;
  fields: RecordField[];
}
export interface RecordHousehold {
  status: 'available' | 'not-supplied' | 'unavailable';
  householdId: string | null;
  source: 'records.fields';
  complete: null;
  members: HouseholdMember[];
  note: string;
}

/** Related PIDs delimit repeated relationship/name groups in the fields response. */
export function recordHousehold(data: unknown, collectionId: string, recordId: string): RecordHousehold {
  const response = data as {Status?: string; DocumentFields?: Array<{CollectionId: unknown; RecordId: unknown; Fields?: RecordField[]}>};
  if (response?.Status !== 'Successful' || !Array.isArray(response.DocumentFields)) throw new Error('Unexpected record fields response.');
  const doc = response.DocumentFields.find(doc => doc && String(doc.CollectionId) === collectionId && String(doc.RecordId) === recordId);
  if (!Array.isArray(doc?.Fields) || doc.Fields.some(field => !field || typeof field.Name !== 'string')) throw new Error('Record fields did not identify the requested record.');
  const value = (field?: RecordField) => field?.Value == null ? null : String(field.Value);
  const householdId = value(doc.Fields.find(field => field.Name === 'HouseholdId'));
  const base: RecordHousehold = {status: householdId ? 'available' : 'not-supplied', householdId, source: 'records.fields', complete: null, members: [],
    note: 'Indexed household context, not an original-image transcription. Relationships and names retain provider Source labels, including historic_inferred. Completeness is unknown; unlinked household residents may be absent.'};
  if (!householdId) return {...base, note: 'The provider supplied no HouseholdId. This does not establish that no household existed.'};
  const member = (id: string, relationship: string, fields: RecordField[]): HouseholdMember => ({collectionId, recordId: id, relationship,
    givenName: value(fields.find(field => field.Assertion === 'GivenName')), surname: value(fields.find(field => field.Assertion === 'Surname')), fields});
  base.members.push(member(recordId, 'Self', doc.Fields.filter(field => field.Relationship === 'Self')));
  const pending = new Map<string, RecordField[]>();
  const seen = new Set([recordId]);
  for (const field of doc.Fields) {
    const relationship = field.Relationship;
    if (!relationship || relationship === 'Self' || !['GivenName', 'Surname', 'Pid'].includes(field.Assertion ?? '')) continue;
    const group = pending.get(relationship) ?? [];
    group.push(field);
    if (field.Assertion !== 'Pid') {pending.set(relationship, group); continue;}
    const id = value(field) ?? (field.NormalizedValue == null ? null : String(field.NormalizedValue));
    if (id && !seen.has(id)) {base.members.push(member(id, relationship, group)); seen.add(id);}
    pending.delete(relationship);
  }
  return base;
}
