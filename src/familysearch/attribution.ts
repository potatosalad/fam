import type {FamilySearchClient} from './client.js';

export function attributionTimestamp(value: unknown): string | null {
  if (value == null) return null;
  const text=String(value), milliseconds=/^\d+$/.test(text)?Number(text):Date.parse(text);
  return Number.isFinite(milliseconds)&&Number.isFinite(new Date(milliseconds).getTime()) ? new Date(milliseconds).toISOString() : text;
}

/** Resolve names only, with a per-call cache and bounded requests; never follow contributor URLs. */
export async function contributorNames(client: FamilySearchClient, ids: string[], names = new Map<string, string>()) {
  const missing=[...new Set(ids)].filter(id=>!names.has(id));
  for(let i=0;i<Math.min(missing.length,100);i+=4) await Promise.all(missing.slice(i,Math.min(i+4,100)).map(async id=>{
    try {
      const data=(await client.operation('contributors.get',{contributorOrCisId:id})).contributor;
      const name=data.contactName??data.profileName??data.fullName;
      if(typeof name==='string'&&name)names.set(id,name);
    } catch { /* Unavailable names remain null; raw attribution is retained separately. */ }
  }));
  return {names,warnings:missing.length>100?['Contributor lookup limited to 100 distinct IDs; unresolved names remain null.']:[]};
}
