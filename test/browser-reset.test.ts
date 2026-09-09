import test from 'node:test';
import {providerNames} from '../src/shared/command-registry.js';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {browserCommand} from '../src/shared/browser-cli.js';
import {resetBrowserSession} from '../src/shared/browser-runtime.js';
import {endpointId, saveBrowserConfig, type BrowserConfig} from '../src/shared/browser-config.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {complete, completionCatalog} from '../src/shared/completion.js';

test('browser reset requires an explicit scope and transport reset has separate discovery',async()=>{
  assert.throws(()=>parseInvocation(['cli.browser','reset']),/Choose exactly one.*transport reset/);
  assert.throws(()=>parseInvocation(['cli.browser','reset','--provider','myheritage','--all']),/Choose exactly one/);
  assert.throws(()=>parseInvocation(['cli.browser','reset','--provider','invalid']),/must be one of/);
  assert.equal(parseInvocation(['cli.browser','reset','--all']).values.all,true);
  assert.equal(parseInvocation(['cli.browser.transport','reset']).command.object,'browser.transport');
  assert.ok(complete(completionCatalog(),['cli.browser','reset','--']).candidates.includes('--all'));
  assert.ok(complete(completionCatalog(),['browser.transport','']).candidates.includes('reset'));
  assert.ok(complete(completionCatalog(),['cli.browser','reset','--provider','my']).candidates.includes('myheritage'));
  for (const args of [['browser','reset','--all'],['cli.browser','reset','--provider','myheritage'],['browser.transport','reset']]) {
    const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts',...args,'--dry-run','--json']);
    assert.equal(JSON.parse(stdout).data.dryRun,true);
  }
});

test('browser reset archives selected snapshots, preserves credentials and never visits a provider',async t=>{
  const requests:{path:string|undefined;body:any}[]=[];
  let supportsReset=true;
  const server=createServer(async(req,res)=>{
    let text='';for await (const chunk of req) text+=chunk;
    const body=text?JSON.parse(text):{};requests.push({path:req.url,body});
    const ids=body.userIds??[];
    const result=req.url==='/health'?{}:req.url==='/fam/capabilities'?{version:1,reset:supportsReset}
      :req.url==='/fam/reset'?{sessions:[...ids,...(body.all?['fam-other-session-myheritage']:[])].map(userId=>({userId,closedTabs:1,backupDirectory:'/synthetic/private-backup'}))}
      :req.url==='/tabs'?{tabId:'clean-tab'}:req.url?.endsWith('/evaluate')?{result:true}:{};
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,...result}));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const endpoint={url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,vncUrl:'https://viewer.example.test/custom?path=socket'};
  const config:BrowserConfig={version:1,mode:'remote',remote:endpoint,local:{...endpoint,container:'do-not-touch'},session:'default',open:false,timeout:0,transport:'auto'};
  const id=endpointId(config),localId=endpointId({...config,mode:'local'}),otherId=endpointId({...config,session:'other-session'});
  const path=(scope:string,provider:string)=>`browser/${scope}/${provider}/session.json`;
  const route=(scope:string)=>`browser/${scope}/routing/decision.json`;
  await saveBrowserConfig(config);
  await writePrivateJson('myheritage/login.json',{username:'synthetic',password:'synthetic'});
  await writePrivateJson('myheritage/browser-login-block.json',{blockedUntil:'2099-01-01T00:00:00Z'});
  await writePrivateJson('myheritage/session.json',{mode:'native',token:'synthetic'});
  const preserved=['myheritage/login.json','myheritage/browser-login-block.json','myheritage/session.json','browser/config.json'];
  const before=await Promise.all(preserved.map(name=>readPrivateJson(name)));
  await t.test('provider reset clears only that context and snapshot, and leaves a blank tab',async()=>{
    await writePrivateJson(path(id,'myheritage'),{cookie:'old'});
    await writePrivateJson(path(id,'findmypast'),{cookie:'keep'});
    await writePrivateJson(path(localId,'myheritage'),{cookie:'local'});
    await writePrivateJson(route(id),{enabled:true});
    const result=await browserCommand('reset',{provider:'myheritage','no-open':true}) as any;
    assert.equal(result.vncUrl,endpoint.vncUrl);assert.equal(result.opened,false);assert.equal(result.browserStopped,false);
    assert.equal(result.loginCooldownPreserved,true);assert.equal(result.transportDecisionsPreserved,true);
    assert.equal(await readPrivateJson(path(id,'myheritage')),undefined);
    assert.deepEqual(await readPrivateJson(path(id,'findmypast')),{cookie:'keep'});
    assert.deepEqual(await readPrivateJson(path(localId,'myheritage')),{cookie:'local'});
    assert.deepEqual(await readPrivateJson(route(id)),{enabled:true});
    assert.deepEqual(JSON.parse(await readFile(join(result.backupDirectory,id,'myheritage/session.json'),'utf8')),{cookie:'old'});
    assert.deepEqual(requests.find(r=>r.path==='/fam/reset')!.body,{all:false,userIds:['fam-default-myheritage']});
    const tabs=requests.filter(r=>r.path==='/tabs');assert.equal(tabs.length,1);assert.equal(tabs[0].body.url,undefined);
    assert.ok(requests.every(r=>['/health','/fam/capabilities','/fam/reset','/tabs','/tabs/clean-tab/evaluate'].includes(r.path!)));
    assert.deepEqual(await Promise.all(preserved.map(name=>readPrivateJson(name))),before);
  });
  await t.test('linked Storied and NewspaperArchive contexts reset together',async()=>{
    requests.length=0;
    await writePrivateJson(path(id,'storied'),{cookie:'old'});await writePrivateJson(path(id,'newspaperarchive'),{cookie:'old'});
    await browserCommand('reset',{provider:'newspaperarchive'});
    assert.deepEqual(requests.find(r=>r.path==='/fam/reset')!.body.userIds,['fam-default-storied','fam-default-newspaperarchive']);
    assert.equal(requests.find(r=>r.path==='/tabs')!.body.userId,'fam-default-storied');
    assert.equal(await readPrivateJson(path(id,'storied')),undefined);assert.equal(await readPrivateJson(path(id,'newspaperarchive')),undefined);
  });
  await t.test('--all resets all fam names on the selected instance and clears their routing',async()=>{
    requests.length=0;
    await writePrivateJson(path(otherId,'myheritage'),{cookie:'other-fam-name'});
    await writePrivateJson(path(otherId,'findmypast'),{cookie:'dormant-cli-snapshot'});
    await writePrivateJson(route(otherId),{enabled:true});await writePrivateJson(route(localId),{enabled:true});
    const result=await browserCommand('reset',{all:true}) as any;
    assert.equal(result.all,true);assert.equal(result.transportDecisionsPreserved,false);
    const sent=requests.find(r=>r.path==='/fam/reset')!.body;
    assert.equal(sent.all,true);assert.equal(sent.userIds.length,providerNames.length);
    assert.equal(await readPrivateJson(path(id,'findmypast')),undefined);
    assert.equal(await readPrivateJson(path(otherId,'myheritage')),undefined);
    assert.equal(await readPrivateJson(path(otherId,'findmypast')),undefined);
    assert.equal(await readPrivateJson(route(id)),undefined);assert.equal(await readPrivateJson(route(otherId)),undefined);
    assert.deepEqual(await readPrivateJson(path(localId,'myheritage')),{cookie:'local'});
    assert.deepEqual(await readPrivateJson(route(localId)),{enabled:true});
    assert.equal(requests.some(r=>r.path==='/tabs'||r.path==='/stop'),false);
    assert.deepEqual(await Promise.all(preserved.map(name=>readPrivateJson(name))),before);
  });
  await t.test('transport reset works offline and preserves session snapshots',async()=>{
    requests.length=0;
    await writePrivateJson(path(id,'myheritage'),{cookie:'keep'});await writePrivateJson(route(id),{enabled:true});
    const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx','src/cli.ts','browser.transport','reset','--json']);
    assert.equal(JSON.parse(stdout).data.reset,'transport');assert.equal(requests.length,0);
    assert.equal(await readPrivateJson(route(id)),undefined);assert.deepEqual(await readPrivateJson(path(id,'myheritage')),{cookie:'keep'});
  });
  await t.test('unsupported plugins and invalid scope fail before changing stored sessions',async()=>{
    supportsReset=false;requests.length=0;
    await assert.rejects(resetBrowserSession(config,{provider:'myheritage'}),(e:any)=>e.code==='BROWSER_PLUGIN_REQUIRED');
    assert.equal(requests.some(r=>r.path==='/fam/reset'),false);
    assert.deepEqual(await readPrivateJson(path(id,'myheritage')),{cookie:'keep'});
    requests.length=0;
    await assert.rejects(resetBrowserSession(config,{all:true,provider:'myheritage'}),/Choose/);
    assert.equal(requests.length,0);
  });
});
