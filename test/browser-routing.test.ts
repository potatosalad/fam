import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {browserRouting} from '../src/shared/browser-routing.js';
import {saveBrowserConfig, setBrowserOverrides, useBrowser, rememberBrowser, type BrowserConfig} from '../src/shared/browser-config.js';
import {CREDENTIAL_DIR} from '../src/shared/storage.js';
import {providerNames} from '../src/shared/command-registry.js';
import {complete, completionCatalog} from '../src/shared/completion.js';

const run = promisify(execFile);
const config: BrowserConfig = {version:1,mode:'remote',remote:{url:'https://browser.example.test',vncUrl:'https://viewer.example.test',apiKey:'synthetic-api-secret'},
  local:{url:'http://127.0.0.1:9377',vncUrl:'http://127.0.0.1:6080',apiKey:'synthetic-local-secret'},timeout:0,transport:'auto',session:'test',open:false};
const website='https://www.example.test', image='https://images.example.test';
const invoke = (...args: string[]) => run(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('../src/cli.ts', import.meta.url)), ...args],
  {cwd:CREDENTIAL_DIR,env:{...process.env,FAM_CREDENTIALS_COMMAND:'["helper-must-not-run"]'},timeout:10000});

test('transport inspection uses the same decisions as requests without contacting the browser or changing profile data',async t=>{
  const originalFetch=globalThis.fetch, environment=process.env.FAM_TRANSPORT;
  globalThis.fetch=async()=>{throw new Error('Inspection must not use the network');};
  delete process.env.FAM_TRANSPORT;
  t.after(()=>{globalThis.fetch=originalFetch;setBrowserOverrides({});if(environment===undefined)delete process.env.FAM_TRANSPORT;else process.env.FAM_TRANSPORT=environment;});
  await t.test('an unconfigured profile lists HTTP defaults for all providers without creating files',async()=>{
    const before=await readdir(CREDENTIAL_DIR);
    const result=await browserRouting(providerNames);
    assert.equal(result.configured,false);assert.equal(result.policy,'auto');assert.equal(result.source,'default');
    assert.equal(result.routes.length,providerNames.length);
    assert.ok(result.routes.every(row=>row.origin===null && row.transport==='http' && row.rememberedBrowser===null));
    assert.deepEqual(await readdir(CREDENTIAL_DIR),before);
    process.env.FAM_TRANSPORT='browser';
    assert.equal((await browserRouting(['familysearch'],website)).source,'environment');
    assert.equal((await browserRouting(['familysearch'],website)).routes[0].transport,'browser');
    delete process.env.FAM_TRANSPORT;
  });
  await saveBrowserConfig(config);
  await rememberBrowser('familysearch',website);
  await rememberBrowser('familysearch',image,false);
  await rememberBrowser('myheritage',website);
  // Session files are deliberately unreadable JSON: inspection must ignore them.
  await writeFile(join(CREDENTIAL_DIR,'session.json'),'{do not read private sessions');
  const snapshot = async()=>{
    const files=await readdir(CREDENTIAL_DIR,{recursive:true,withFileTypes:true});
    return Promise.all(files.filter(entry=>entry.isFile()).map(async entry=>[join(entry.parentPath,entry.name),(await readFile(join(entry.parentPath,entry.name))).toString('base64')]));
  };
  const before=await snapshot();
  await t.test('listing shows separate origin choices and a fallback for every provider',async()=>{
    const result=await browserRouting(providerNames);
    assert.equal(result.mode,'remote');assert.equal(result.session,'test');assert.equal(result.source,'configuration');
    assert.equal(result.routes.length,providerNames.length+3);
    const family=result.routes.filter(row=>row.provider==='familysearch');
    assert.deepEqual(family.map(row=>[row.origin,row.transport,row.rememberedBrowser]),[[image,'http',false],[website,'browser',true],[null,'http',null]]);
    assert.doesNotMatch(JSON.stringify(result),/synthetic-api-secret|synthetic-local-secret|browser\.example\.test|do not read/);
    for(const row of result.routes) if(row.origin) assert.equal(row.transport==='browser',await useBrowser(row.provider,row.origin));
  });
  await t.test('command overrides and configured policy take precedence exactly as actual requests do',async()=>{
    process.env.FAM_TRANSPORT='http';
    assert.equal((await browserRouting(['familysearch'],website)).routes[0].transport,'browser');
    for(const transport of ['http','browser','auto'] as const){
      setBrowserOverrides({transport});
      const result=await browserRouting(['familysearch'],website);
      assert.equal(result.policy,transport);assert.equal(result.source,'command');
      assert.equal(result.routes[0].transport==='browser',await useBrowser('familysearch',website));
      assert.equal(result.routes[0].rememberedBrowser,true);
    }
    setBrowserOverrides({});delete process.env.FAM_TRANSPORT;
    assert.equal((await browserRouting(['familysearch'],'https://unused.example.test')).routes[0].transport,'http');
  });
  await t.test('inspection is scoped to the selected browser mode and session name',async()=>{
    for(const selected of [{...config,mode:'local' as const},{...config,session:'another'}]){
      await saveBrowserConfig(selected);
      const result=await browserRouting(['familysearch'],website);
      assert.equal(result.routes[0].transport,'http');assert.equal(await useBrowser('familysearch',website),false);
    }
    await saveBrowserConfig(config);
    assert.equal((await browserRouting(['familysearch'],website)).routes[0].transport,'browser');
  });
  await t.test('origins cannot smuggle credentials, signed queries or paths into output',async()=>{
    for(const value of ['https://user:secret@example.test','https://example.test/path','https://example.test?token=secret','https://example.test#secret','file:///tmp/secret'])
      await assert.rejects(browserRouting(['familysearch'],value),error=>!String(error).includes('secret'));
    assert.equal((await browserRouting(['familysearch'],`${website}/`)).routes[0].origin,website);
  });
  assert.deepEqual(await snapshot(),before);
  await t.test('installed command spelling works outside the checkout, with readable and JSON output',async()=>{
    const args=['cli.browser.transport','get','--provider','familysearch','--origin',website,'--transport','auto'];
    const json=JSON.parse((await invoke(...args,'--json')).stdout);
    assert.equal(json.ok,true);assert.equal(json.command,'cli.browser.transport get');
    assert.equal(json.data.routes[0].transport,'browser');
    const text=(await invoke(...args)).stdout;
    assert.match(text,/Transport policy: auto \(command\)/);assert.match(text,/browser — Remembered browser route/);
    assert.doesNotMatch(text,/synthetic-api-secret|"schemaVersion"/);
    const list=JSON.parse((await invoke('cli.browser.transport','list','--provider','familysearch','--json')).stdout);
    assert.equal(list.data.routes.length,3);
    await assert.rejects(invoke('cli.browser.transport','get','--provider','familysearch'),(error:any)=>error.code===2);
    await assert.rejects(invoke('cli.browser.transport','get','--provider','invalid','--origin',website),(error:any)=>error.code===2);
    assert.ok(complete(completionCatalog(),['browser.transport','']).candidates.includes('get'));
    assert.ok(complete(completionCatalog(),['cli.browser.transport','list','--provider','']).candidates.includes('familysearch'));
  });
});
