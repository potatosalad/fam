import type { FamilySearchClient, PersonDetailsDto, FactDto, NoteDto, SourceDescriptionDto } from '../src/index.js';

// Compiled, never executed: ensure the public API keeps meaningful request/response types.
async function contracts(client: FamilySearchClient) {
  const person: PersonDetailsDto = await client.genealogy.persons.get({ pid: 'ABCD-123', query: { oneHops: 'summaries' } });
  const fact: FactDto = await client.genealogy.persons.addFact({ pid: person.id, body: { conclusionType: 'Birth', value: { date: { original: '1900' } } } });
  const note: NoteDto = await client.operation('persons.addNote', { pid: person.id, body: { noteId: '', value: { title: 'Note', text: 'Research' }, attribution: { changeMessage: 'Research' } } });
  const source: SourceDescriptionDto = await client.genealogy.sources.create({ body: { title: 'Register', citation: 'Page 1' } });
  await client.genealogy.memories.upload({ body: new FormData() });
  await client.genealogy.memories.replaceFile({ artifactId: 123, body: 'A story' });
  await client.genealogy.groups.list();
  // @ts-expect-error person IDs are required
  await client.genealogy.persons.get({});
  // @ts-expect-error oneHops is a string selector, not a boolean flag
  await client.genealogy.persons.get({ pid: 'ABCD-123', query: { oneHops: true } });
  // @ts-expect-error fact values are required nested objects
  await client.genealogy.persons.addFact({ pid: 'ABCD-123', body: { conclusionType: 'Birth' } });
  // @ts-expect-error unknown wire fields must not silently pass
  await client.genealogy.persons.addFact({ pid: 'ABCD-123', body: { conclusionType: 'Birth', value: {}, accidentalField: true } });
  // @ts-expect-error operation names are closed
  await client.operation('persons.nonexistent', {});
  // @ts-expect-error note text must be a string
  const invalid: NoteDto = { noteId: '', value: { title: '', text: 123 }, attribution: {} };
  // @ts-expect-error story replacement accepts plain text, not JSON
  await client.genealogy.memories.replaceFile({ artifactId: 123, body: { text: 'story' } });
  return { person, fact, note, source, invalid };
}
void contracts;

async function ancestryTypes(client: import('../src/ancestry/client.js').AncestryClient) {
  const list = await client.trees();
  const id: string | undefined = list.trees.treeConnection.nodes[0]?.treeId;
  await client.graphql('GetTree', {treeId: '123'});
  await client.graphql('PersonAlbumListConnection', {treeId: '123', personId: '456'});
  // @ts-expect-error required GraphQL variable
  await client.graphql('GetTree', {});
  // @ts-expect-error GraphQL ID is a string
  await client.graphql('GetTree', {treeId: 123});
  // @ts-expect-error GraphQL Int is a number
  await client.graphql('GetTreeList', {limit: '20'});
  // @ts-expect-error operation names are closed
  await client.graphql('ImaginaryOperation', {});
  return id;
}
void ancestryTypes;
