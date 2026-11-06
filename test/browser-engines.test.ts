import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {browserConfig, browserEngine, endpointId, saveBrowserConfig, type BrowserConfig} from '../src/shared/browser-config.js';
import {localBrowserEndpoint, switchBrowserEngine} from '../src/shared/browser-runtime.js';
import {browserCommand} from '../src/shared/browser-cli.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';

const endpoint = {engine: 'cloakbrowser' as const, url: 'https://browser.example/api', vncUrl: 'https://browser.example/view'};
const config: BrowserConfig = {version: 1, mode: 'remote', remote: endpoint, timeout: 600, transport: 'auto', session: 'default', open: false};

test('only CloakBrowser is accepted and its endpoint identities are stable', () => {
  assert.equal(parseInvocation(['cli.browser','use','--engine','cloakbrowser']).values.engine, 'cloakbrowser');
  assert.equal(parseInvocation(['cli.browser','setup','--local','--engine','cloakbrowser']).values.engine, 'cloakbrowser');
  assert.throws(() => parseInvocation(['cli.browser','use']));
  assert.throws(() => parseInvocation(['cli.browser','use','--engine','firefox']));
  assert.equal(browserEngine(config), 'cloakbrowser');
  assert.equal(endpointId(config), endpointId({...config,remote:{...endpoint,engine:undefined}}));
  const local = localBrowserEndpoint('cloakbrowser');
  assert.equal(local.apiPort, 9378); assert.equal(local.vncPort, 6082);
  assert.match(local.container!, /^fam-cloakbrowser-/);
  assert.throws(() => localBrowserEndpoint('cloakbrowser',{apiPort:1,vncPort:1}));
});

test('reselecting CloakBrowser and switching locations never purges sessions', async t => {
  const calls: string[] = [];
  const server = createServer(async (req,res) => {
    calls.push(req.url!);
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url === '/fam/capabilities' ? {version: 1, engine: 'cloakbrowser'} : {browserRunning: true}));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const saved: BrowserConfig = {...config,remote:{...endpoint,url},local:{...endpoint,container:'unused'}};
  await saveBrowserConfig(saved);
  const snapshot = `browser/${endpointId(saved)}/myheritage/session.json`;
  await writePrivateJson(snapshot, {synthetic:'saved'});
  const status = await switchBrowserEngine('cloakbrowser') as Record<string, unknown>;
  assert.equal(status.engine, 'cloakbrowser');
  assert.equal('availableEngines' in status, false);
  assert.equal('upgradePending' in status, false);
  await browserCommand('use',{mode:'local'});
  await browserCommand('use',{mode:'remote',engine:'cloakbrowser'});
  assert.equal((await browserConfig())!.mode, 'remote');
  assert.deepEqual(await readPrivateJson(snapshot), {synthetic:'saved'});
  assert.equal(calls.includes('/fam/reset'), false);
});
