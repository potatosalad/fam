import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const clientUrl=new URL('../src/ancestry/client.ts',import.meta.url).href;
const retryUrl=new URL('../src/shared/read-retry.ts',import.meta.url).href;
const cliUrl=new URL('../src/cli.ts',import.meta.url).href;
const invoke=(script:string)=>run(process.execPath,['--import',import.meta.resolve('tsx'),'--input-type=module','-e',script],{
  env:{...process.env,FAM_HISTORY:'0'},timeout:15000,
}).catch(error=>error);

test('HTTP 400 keeps the error envelope and adds useful examples without exposing the raw response',async()=>{
  for(const json of [true,false]){
    const result=await invoke(`
      const {AncestryClient}=await import(${JSON.stringify(clientUrl)});
      AncestryClient.open=async()=>({search:async()=>{throw Object.assign(new Error('Ancestry HTTP 400 from /search'),{status:400,responseBody:'private-response-token'});}});
      process.argv=['node','fam','ancestry.record','search','--filter','category=trees',...${JSON.stringify(json?['--json']:[])}];
      await import(${JSON.stringify(cliUrl)});
    `);
    assert.equal(result.code,1);assert.equal(result.stdout,'');assert.doesNotMatch(result.stderr,/private-response-token/);
    if(json){const error=JSON.parse(result.stderr);assert.equal(error.ok,false);assert.equal(error.error.status,400);assert.notEqual(error.error.code,'INVALID_ARGUMENT');assert.match(error.error.examples[0],/--last-name Smith/);}
    else {assert.match(result.stderr,/Error: Ancestry HTTP 400/);assert.match(result.stderr,/Examples.*\n.*1\|Category\|SET=HistoricalRecords/);}
  }
});
test('CLI retry progress goes to stderr while stdout remains a single JSON result',async()=>{
  const result=await invoke(`
    const {AncestryClient}=await import(${JSON.stringify(clientUrl)});
    const {retryRead}=await import(${JSON.stringify(retryUrl)});
    let calls=0;
    AncestryClient.open=async()=>({search:async()=>{
      const response=await retryRead('ancestry',async()=>++calls===1?new Response('busy',{status:503,headers:{'retry-after':'0'}}):Response.json({calls}));return response.json();
    }});
    process.argv=['node','fam','ancestry.record','search','--json'];
    await import(${JSON.stringify(cliUrl)});
  `);
  assert.equal(JSON.parse(result.stdout).data.calls,2);assert.match(result.stderr,/ancestry: HTTP 503; retrying.*attempt 2\/3/);
});
