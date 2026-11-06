import test from 'node:test';
import assert from 'node:assert/strict';
import {CookieJar} from 'tough-cookie';
import {MyHeritageBrowser} from '../src/myheritage/browser.js';
import type {MyHeritageSession} from '../src/myheritage/auth.js';
import type {ApiRequest,ApiResponse} from '../src/familysearch/transport-types.js';

const page=Object.entries({isLoggedIn:true,currentUserAccountID:'1',siteID:'SITE',familyTreeID:'2',
  mediaUploaderData:{fgToken:'fixture-token'},mhXsrfToken:'fixture-csrf',treeSelectionMenuEntries:[]})
  .map(([k,v])=>`var ${k} = ${JSON.stringify(v)};`).join('\n');
function fixture(pending:number|undefined, fail=false) {
  const jar=new CookieJar();
  const session:MyHeritageSession={accessToken:'fixture',deviceId:'fixture',savedAt:'',cookies:jar.serializeSync(),mode:'browser',browser:{pageUrl:'https://www.myheritage.com/family-trees/fixture/SITE'}};
  return new MyHeritageBrowser(session,{jar,exchange:async<T>(url:string|URL,_request:ApiRequest={}):Promise<ApiResponse<T>>=>{
    let data:unknown=page;
    if(String(url).includes('get-adhoc-matches'))data={success:true,matchCounts:{'3':0},recordMatchCounts:{'3':5}};
    if(String(url).includes('get-extended-card')) {
      if(fail)throw new Error('Fixture card unavailable');
      data={success:true,matches:{pendingSmartsAmount:pending,pendingRecordsAmount:5}};
    }
    return {status:200,headers:{},data:data as T};
  }},async()=>{});
}
test('browser match counts expose both endpoint semantics and warn on disagreement',async()=>{
  const r=await fixture(10).matches('individual-SITE-3');
  assert.equal(r.matchCounts['3'],0);
  assert.deepEqual(r.extendedCardCounts,{pendingSmartsAmount:10,pendingRecordsAmount:5});
  assert.match(r.countNote,/ad.hoc.*extended.card/i);
  assert.match(r.warnings.join(' '),/disagree/i);
  assert.equal((await fixture(0).matches('3')).warnings.length,0);
});
test('missing or failed extended-card counts are unknown, never zero',async()=>{
  for(const c of [fixture(undefined),fixture(undefined,true)]) {
    const r=await c.matches('3');
    assert.equal(r.extendedCardCounts.pendingSmartsAmount,null);
    assert.ok(r.warnings.length);
  }
});
