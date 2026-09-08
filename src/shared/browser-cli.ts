import type {Values} from './command-runtime.js';
import {browserConfig, browserUrl, BrowserError, saveBrowserConfig, type BrowserMode, type BrowserTransportMode} from './browser-config.js';
import {setupBrowser, startBrowser, stopBrowser, browserStatus, openUrl, resetBrowserRouting} from './browser-runtime.js';

export async function browserCommand(action: string, values: Values): Promise<unknown> {
  if (values.open && values['no-open']) throw new BrowserError('Choose --open or --no-open.');
  if (action === 'setup') return setupBrowser({local: !!values.local, remote: values.remote as string | undefined,
    vncUrl: values['vnc-url'] as string | undefined, apiKeyFile: values['api-key-file'] as string | undefined,
    timeout: values.timeout as number | undefined, install: !!values.install, session: values.session as string | undefined,
    open: values.open ? true : values['no-open'] ? false : undefined, apiPort: values['api-port'] as number | undefined, vncPort: values['vnc-port'] as number | undefined});
  if (action === 'status') return browserStatus();
  const config = await browserConfig();
  if (!config) {if (action === 'start') return setupBrowser({local: true}); throw new BrowserError('Run fam browser setup --local or fam browser setup --remote URL first.');}
  if (action === 'use') {
    const mode = values.mode as BrowserMode;
    if (!mode || !config[mode]) throw new BrowserError('Set up the selected mode first with fam browser setup.');
    config.mode = mode; await saveBrowserConfig(config); return browserStatus(config);
  }
  if (action === 'start') {await startBrowser(config); return browserStatus(config);}
  if (action === 'stop') return stopBrowser(config);
  if (action === 'open') {await startBrowser(config); const vncUrl = config[config.mode]!.vncUrl; return {vncUrl, opened: await openUrl(vncUrl)};}
  if (action === 'reset') return resetBrowserRouting(config);
  if (action === 'configure') {
    if (values.timeout !== undefined) config.timeout = Number(values.timeout);
    if (values.transport !== undefined) config.transport = values.transport as BrowserTransportMode;
    if (values['vnc-url'] !== undefined) config[config.mode]!.vncUrl = browserUrl(String(values['vnc-url']));
    if (values['no-open'] !== undefined) config.open = !values['no-open'];
    if (values.open) config.open = true;
    await saveBrowserConfig(config); return browserStatus(config);
  }
  throw new BrowserError('Unknown browser command.');
}
