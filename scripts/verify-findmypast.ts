/** Account-dependent reads; never attempts password login or confirms purchases. */
import assert from 'node:assert/strict';
import { writePrivateJson } from '../src/storage.js';
import { FindmypastClient, searchFilters } from '../src/findmypast/client.js';
import { FindmypastHttpError } from '../src/findmypast/http.js';
import { downloadRecordImage, recordOrder, searchNewspapers } from '../src/findmypast/research.js';

async function main() {
  const anonymous = process.argv.includes('--anonymous');
  const client = await FindmypastClient.open(anonymous);
  const checks: {operation: string; status: 'passed' | 'failed' | 'skipped'; note?: string}[] = [];
  async function check<T>(operation: string, run: () => Promise<T>, validate: (value: T) => void): Promise<T | undefined> {
    try { const result = await run(); validate(result); checks.push({operation, status: 'passed'}); console.log(`${operation}: passed`); return result; }
    catch (error) {checks.push({operation, status: 'failed', note: error instanceof FindmypastHttpError ? `HTTP ${error.status}` : error instanceof Error ? error.name : 'Error'}); console.log(`${operation}: failed`); return undefined;}
  }
  const object = (r: any) => assert.ok(r && typeof r === 'object');
  await check('GetReplacementMode', () => client.graphql<any>('GetReplacementMode'), r => assert.equal(typeof r.getAndroidReplacementMode, 'string'));
  const collections = await check('collections', () => client.collections('census', 3) as Promise<any>, r => {
    assert.ok(Array.isArray(r.searchDatasetMetadata?.datasets)); assert.ok(r.searchDatasetMetadata.datasets.length > 0);
  });
  const collectionId = collections?.searchDatasetMetadata.datasets[0]?.id;
  if (collectionId) await check('collection', () => client.graphql('recordSetInformation', {recordMetadataId: String(collectionId)}), object);
  if (!anonymous) {
    const me = await check('me', () => client.me() as Promise<any>, r => assert.ok(r.currentUserProfile?.id));
    if (me) {
      await check('subscription', () => client.graphql('GetSubscription'), object);
      const trees = await check('trees', () => client.trees(5) as Promise<any>, r => assert.ok(Array.isArray(r.familyTreesV2?.list)));
      const treeId = trees?.familyTreesV2.list[0]?.id;
      if (treeId) {
        await check('tree', () => client.tree(String(treeId)), object);
        const people = await check('people', () => client.people(String(treeId)) as Promise<any>, r => assert.ok(Array.isArray(r.familyTree?.people)));
        const personId = people?.familyTree.rootPerson?.id ?? people?.familyTree.people[0]?.id;
        if (personId) {
          const tree = String(treeId), person = String(personId);
          await check('person', () => client.person(tree, person), object);
          await check('relatives', () => client.relatives(tree, person), object);
          await check('facts', () => client.facts(person), object);
          await check('hints', () => client.hints(tree, person, 5), object);
          await check('media', () => client.media(person, 5), object);
        }
      } else checks.push({operation:'tree/person/facts/hints/media',status:'skipped',note:'Account has no trees; no tree was created.'});
      const records = await check('search', () => client.search(searchFilters({firstName:'Ada',lastName:'Lovelace',exact:true})) as Promise<any>, r => {
        assert.ok(Array.isArray(r.root?.search?.recordSearch?.records));
      });
      await check('search country/year range/sort', () => client.search(searchFilters({firstName:'Ada',lastName:'Lovelace',birthYear:1815,yearRange:2,country:'England',exact:true}),1,recordOrder('birth',true)) as Promise<any>, r => {
        const records=r.root?.search?.recordSearch?.records;
        assert.ok(records?.length);
        // The service also returns records whose birth year is unknown; retain those for research.
        const years=records.map((record:any)=>record.fields.find((f:any)=>f.fieldId==='YearOfBirth')?.value).filter((year:unknown)=>year!==undefined).map(Number);
        assert.ok(years.length);
        assert.ok(years.every((year:number,i:number)=>year>=1813 && year<=1817 && (i===0 || years[i-1]>=year)));
      });
      await check('newspapers date/country search', () => searchNewspapers(client,{names:['Ada Lovelace'],country:'England',from:'1800-01-01',to:'1900-12-31',sort:'date',limit:3}) as Promise<any>, r => {
        assert.ok(r.articles?.length);
        assert.ok(r.articles.every((a:any)=>a.newspaperPages?.length && a.newspaperIssue.publicationDate>='1800-01-01' && a.newspaperIssue.publicationDate<='1900-12-31'));
      });
      const imageRecord=records?.root.search.recordSearch.records.find((r:any)=>r.image?.creditCost===0 && r.image.mediaSource==='image');
      if (imageRecord) await check('full-resolution JPEG download',()=>downloadRecordImage(client,String(imageRecord.id)),r=>{
        assert.ok(r.bytes.length>0); assert.match(r.metadata.sha256,/^[a-f0-9]{64}$/);
      });
      else checks.push({operation:'full-resolution JPEG download',status:'skipped',note:'No free image in the sample results.'});
      const recordId = records?.root.search.recordSearch.records[0]?.transcript?.id;
      if (recordId) {
        const access = await check('entitlement', () => client.graphql<any>('GetTranscriptEntitlement', {recordId:String(recordId)}), r => assert.ok(r.getTranscriptEntitlement?.decision));
        const action = access?.getTranscriptEntitlement?.fulfillmentAction;
        // Entitlement results that require spending credits are not exercised by this verifier.
        // Entitlement uses numeric FulfillmentAction IDs; fulfillTranscript returns enum names.
        if (access?.getTranscriptEntitlement?.decision === true && (typeof action === 'number' && [11,12,15,16,17,18,19,20,21,22,23].includes(action) ||
          typeof action === 'string' && /^(SUCCESS_(REPEAT_)?USING_(FREE|SUBSCRIPTION|LIBRARY)|NOT_USED_SUCCESS_(FREE|REPEAT))/.test(action))) {
          await check('record', () => client.record(String(recordId)) as Promise<any>, r => assert.ok(r.fulfillTranscript?.transcript?.id));
        } else checks.push({operation:'record',status:'skipped',note:'Sample transcript is not confirmed as free, subscription-covered, or previously fulfilled.'});
      }
      await check('refresh', async () => {await client.refresh(); return client.status();}, r => assert.ok(r.sessionSaved));
      await check('me after refresh', () => client.me() as Promise<any>, r => assert.ok(r.currentUserProfile?.id));
    }
  }
  const report = {date:new Date().toISOString(), apkVersion:'2.59.0', mode:anonymous?'anonymous':'authenticated', checks,
    genealogyWritesExecuted:0, purchasesConfirmed:0, note:'Account-dependent sample; no IDs, names, cookies or tokens included. Skipped operations are not verified.'};
  await writePrivateJson(`findmypast/verification/${anonymous ? 'anonymous' : 'account'}.json`, report);
  if (checks.some(c => c.status === 'failed')) process.exitCode=1;
}
main().catch(error => {console.error(error instanceof Error ? error.message : 'Findmypast verification failed.'); process.exitCode=1;});
