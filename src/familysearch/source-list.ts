import type {FamilySearchClient} from './client.js';
import {InputError} from '../shared/input-error.js';
import {prepareOperation} from './operations.js';

function timestamp(value: unknown): string | null {
  if (value == null) return null;
  const text=String(value), milliseconds=/^\d+$/.test(text)?Number(text):Date.parse(text);
  return Number.isFinite(milliseconds)&&Number.isFinite(new Date(milliseconds).getTime()) ? new Date(milliseconds).toISOString() : text;
}

/** Join only exact source-reference IDs; dates on a reference mean modification, not attachment. */
export async function listPersonSources(client: FamilySearchClient, pid: string, maxPages = 10) {
  prepareOperation('sources.forPerson', {pid});
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new InputError('--max-pages requires 1–100.');
  const source = await client.operation('sources.forPerson', {pid});
  if (source.person.id !== pid) throw new Error('Source response does not identify the requested person.');
  const descriptions = new Map(source.sourceDescriptions.map(item => [item.id, item]));
  const names = new Map<string, string>(), attached = new Map<string, any>(), warnings: string[] = [];
  const seen = new Set<string>(); let from: string | undefined, historyComplete = false;
  for (let page = 0; page < maxPages; page++) {
    let history: any;
    try {history = await client.operation('history.changes', {pid, query: from ? {from} : {}});}
    catch (error) {warnings.push(`Attachment history unavailable: ${error instanceof Error ? error.message : 'request failed'}`); break;}
    for (const [id, name] of Object.entries(history.contactNames ?? {})) if (typeof name === 'string') names.set(id, name);
    for (const change of history.changes ?? []) {
      const root = change.journalEvent;
      const event = root?.entityRefAdded ?? (root?.op === 'ENTITY_REF_ADDED' ? root : undefined);
      const reference = event?.entityRef;
      if (typeof reference?.entityRefId === 'string' && !attached.has(reference.entityRefId))
        attached.set(reference.entityRefId, {changeId: change.changeId, attribution: reference.attribution ?? change.attribution ?? {}});
    }
    if (history.lastPage === true) {historyComplete = true; break;}
    if (typeof history.nextPageToken !== 'string' || !history.nextPageToken || seen.has(history.nextPageToken)) {
      warnings.push('History continuation is missing or repeated; attachment attribution may be incomplete.'); break;
    }
    from = history.nextPageToken; seen.add(from!);
  }
  if (!historyComplete) warnings.push(`History is incomplete within the ${maxPages}-page bound; unknown attachment details remain null.`);
  const ids = [...new Set((source.person.sources ?? []).flatMap(ref => [ref.modifiedBy, attached.get(ref.id ?? '')?.attribution?.contributor?.id]).filter((id): id is string => typeof id === 'string'))].filter(id => !names.has(id));
  for (let i = 0; i < Math.min(ids.length, 100); i += 4) await Promise.all(ids.slice(i, Math.min(i+4,100)).map(async id => {
    try {
      const data = (await client.operation('contributors.get', {contributorOrCisId: id})).contributor;
      const name = data.contactName ?? data.profileName ?? data.fullName;
      if (name) names.set(id, name);
    } catch { /* Keep the exact ID and a null name when resolution is unavailable. */ }
  }));
  if (ids.length > 100) warnings.push('Contributor lookup limited to 100 distinct IDs; unresolved names remain null.');
  const contributor = (id: string | null | undefined) => id ? {id, name: names.get(id) ?? null} : null;
  const items = (source.person.sources ?? []).map(reference => {
    const description = descriptions.get(reference.descriptionId), attachment = attached.get(reference.id ?? '');
    return {referenceId: reference.id, descriptionId: reference.descriptionId, title: description?.title ?? null,
      ark: description?.recordUrl ?? null, citation: description?.citation ?? null, tags: reference.tags ?? [],
      attachedBy: contributor(attachment?.attribution?.contributor?.id), attachedAt: timestamp(attachment?.attribution?.modified),
      attachmentReason: attachment?.attribution?.changeMessage ?? null, attachmentChangeId: attachment?.changeId ?? null,
      modifiedBy: contributor(reference.modifiedBy), modifiedAt: timestamp(reference.modifiedTime), attachmentAttribution:attachment?.attribution ?? null,
      reference, description: description ?? null};
  });
  return {personId: source.person.id, items, historyComplete, warnings};
}
