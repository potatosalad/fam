import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {browserConfig, saveBrowserConfig, type BrowserConfig} from '../src/shared/browser-config.js';
import {configuredBrowser, setupBrowser} from '../src/shared/browser-runtime.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {readPrivateJson, writePrivateJson} from '../src/shared/storage.js';

const endpoint = {engine: 'cloakbrowser' as const, url: 'https://browser.example/api', vncUrl: 'https://browser.example/view'};
const config: BrowserConfig = {version: 1, mode: 'remote', remote: endpoint, timeout: 600, transport: 'auto', session: 'default', open: false};

test('retired engine flags are rejected', () => {
  for (const command of [['cli.browser','setup','--local'], ['cli.browser','use']])
    assert.throws(() => parseInvocation([...command, '--engine', 'camofox']));
  assert.throws(() => parseInvocation(['myheritage.session','login','--browser-channel','camofox']));
});

test('an untagged remote endpoint cannot silently use the retired engine', async t => {
  const server = createServer((_req,res) => {
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({version:1,engine:'camofox'}));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  await assert.rejects(configuredBrowser({...config, remote:{...endpoint,url,engine:undefined}}), /fam cli\.browser setup.*CloakBrowser/);
});

test('legacy Camofox entries are ignored and selected endpoints fall back by location', async () => {
  const removed = {engine: 'camofox', url: 'not a URL', vncUrl: 'not a URL', container: 'unused'};
  const local = {...endpoint, url: 'http://127.0.0.1:9378', container: 'unused-cloakbrowser'};
  await writePrivateJson('browser/config.json', {...config, local: removed, engines: {local: {camofox: removed}, remote: {camofox: removed}}});
  assert.deepEqual(await browserConfig(), {...config, engines: {local: {}, remote: {}}});
  for (const mode of ['local','remote'] as const) {
    await writePrivateJson('browser/config.json', {...config, mode, local: removed, remote: removed,
      engines: {local: {camofox: removed, cloakbrowser: local}, remote: {camofox: removed, cloakbrowser: endpoint}}});
    const actual = (await browserConfig())!;
    assert.deepEqual(actual[mode], mode === 'local' ? local : endpoint);
    assert.deepEqual(actual.engines, {local: {cloakbrowser: local}, remote: {cloakbrowser: endpoint}});
    await saveBrowserConfig(actual);
    assert.equal(JSON.stringify(await readPrivateJson('browser/config.json')).includes('camofox'), false);
  }
  for (const mode of ['local','remote'] as const) {
    await writePrivateJson('browser/config.json', {...config, mode, [mode]: removed});
    await assert.rejects(browserConfig(), /fam cli\.browser setup.*CloakBrowser/);
  }
  // Engine-less local containers from the removed runtime must not be started.
  await writePrivateJson('browser/config.json', {...config, mode: 'local', local: {...removed, engine: undefined, container: 'fam-browser-0123456789'}});
  await assert.rejects(browserConfig(), /fam cli\.browser setup/);
});

test('setup can replace a removed selected engine without contacting it', async t => {
  const server = createServer((req,res) => {
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify(req.url === '/fam/capabilities' ? {version:1,engine:'cloakbrowser'} : {browserRunning:true}));
  });
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await writePrivateJson('browser/config.json', {...config, remote:{engine:'camofox',url:'http://127.0.0.1:1',vncUrl:endpoint.vncUrl}});
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  await setupBrowser({remote:url,open:false});
  assert.equal((await browserConfig())!.remote!.url, url);
  assert.equal(new URL((await browserConfig())!.remote!.vncUrl).port, '6082');
});
