import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {dirname, basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {commands, commandById, providerNames, providerInfo, namespaceNames, syntax, type Provider} from './shared/command-registry.js';
import {parseInvocation, parseNamespaceHelp, unknownCommand, describe, help, UsageError, type Invocation} from './shared/command-runtime.js';
import {searchCommands, contextCommands} from './shared/command-search.js';
import {stringifyJson} from './shared/json.js';
import {humanOutput, wantsJson, namespaceHelp, commandError} from './shared/command-output.js';
import {startCommandHistory} from './shared/command-history.js';

const history = await startCommandHistory(process.argv.slice(2));
const attempted = commandById.get(process.argv.slice(2, 4).join(' '));
if (attempted) history.command(attempted.id, attempted.provider);
process.on('exit', code => history.finish(code));
process.on('uncaughtExceptionMonitor', error => history.fail(error));

const providers = {
  familysearch: () => import('./familysearch/cli.js'), ancestry: () => import('./ancestry/cli.js'),
  myheritage: () => import('./myheritage/cli.js'), findmypast: () => import('./findmypast/cli.js'),
  findagrave: () => import('./findagrave/cli.js'), geneanet: () => import('./geneanet/cli.js'), storied: () => import('./storied/cli.js'),
  americanancestors: () => import('./americanancestors/cli.js'),
  newspaperarchive: () => import('./newspaperarchive/cli.js'),
  newspapers: () => import('./newspapers/cli.js'),
  fold3: () => import('./fold3/cli.js'),
  cyndislist: () => import('./cyndislist/cli.js'),
  internetarchive: () => import('./internetarchive/cli.js'),
  wayback: () => import('./wayback/cli.js'),
};
async function cliCommand(invocation: Invocation): Promise<unknown> {
  const {command, values: v} = invocation;
  if (command.object === 'doc') {
    const docs = await import('./shared/documentation.js');
    const selected = {provider: v.provider as string | undefined, doc: v.doc as string | undefined, section: v.section as string | undefined};
    try {
      if (command.action === 'list') return await docs.listDocumentation(selected);
      if (command.action === 'read') return await docs.readDocumentation(selected);
      return await (await import('./shared/documentation-search.js')).searchDocumentation(String(v.query), {...selected,
        limit: v.limit as number | undefined, offset: v.offset as number | undefined, lexical: v.lexical === true, rerank: v['no-rerank'] !== true,
        progress: wantsJson(v) ? undefined : message => process.stderr.write(`${message}\n`)});
    } catch (error) {
      if (error instanceof docs.DocumentationError) throw new UsageError(error.message, error.suggestion);
      throw error;
    }
  }
  if (command.object === 'history' || command.object === 'history.failures')
    return (await import('./shared/history-query.js')).queryHistory(command.action, v, history.id, {failures: command.object === 'history.failures'});
  if (command.object === 'browser') return (await import('./shared/browser-cli.js')).browserCommand(command.action, v);
  if (command.object === 'browser.transport') return (await import('./shared/browser-cli.js')).browserCommand(`transport-${command.action}`, v);
  switch (command.binding.command[0]) {
    case 'search': return searchCommands(String(v.query), {provider: v.provider as string | undefined, context: v.context as string | undefined,
      limit: v.limit as number | undefined, offset: v.offset as number | undefined, lexical: v.lexical === true, rerank: v['no-rerank'] !== true,
      progress: wantsJson(v) ? undefined : message => process.stderr.write(`${message}\n`)});
    case 'describe': {
      const identity = String(v.command).replace(/^fam\s+/, '').trim();
      const found = commandById.get(identity);
      if (!found) {const [name, ...action] = identity.split(/\s+/); throw unknownCommand(name, action.join(' ') || undefined);}
      return describe(found);
    }
    case 'list': return commands.filter(c => !v.provider || c.provider === v.provider).map(c => ({command: c.id, description: c.description, syntax: syntax(c), risk: c.risk}));
    case 'providers': return namespaceNames.map(provider => ({provider, ...providerInfo[provider]}));
    case 'resolve': return contextCommands(String(v.context), v.provider as string | undefined);
    case 'version': return (await import('./shared/cli-version.js')).cliVersion();
    case 'update-enable':
    case 'update-disable':
      return (await import('./shared/cli-update.js')).setAutoUpdate(command.binding.command[0] === 'update-enable');
    case 'update': {
      // npm may replace dependencies and dist while the updater is running.
      // Load the finalizer before installation so completion needs no new imports.
      await import('./shared/browser-transport.js');
      return (await import('./shared/cli-update.js')).updateCli({dryRun: v['dry-run'] === true});
    }
    case 'doctor': {
      if (v.live && v.offline) throw new UsageError('Use either --live or --offline.', 'fam cli.health check --offline');
      const {runDoctor, formatDoctor} = await import('./shared/doctor.js');
      const {usePrettyDoctor, startDoctorDisplay, formatPrettyDoctor} = await import('./shared/doctor-output.js');
      const selected = v.provider ? Array.isArray(v.provider) ? v.provider : [String(v.provider)] : [...providerNames];
      const services = [...new Set(selected)] as Provider[];
      const pretty = usePrettyDoctor(v, process.stdout, process.env, services.length);
      const display = pretty ? startDoctorDisplay(services, !v.offline) : undefined;
      try {
        const report = await runDoctor(services, !v.offline,
          !pretty && v.verbose && !wantsJson(v) ? label => process.stderr.write(`Checking ${label}…\n`) : undefined,
          display?.update, {repair: v['no-fix'] !== true, force: v.force === true});
        process.exitCode = report.status === 'ok' ? 0 : 1;
        return wantsJson(v) ? report : {report, text: (pretty ? formatPrettyDoctor : formatDoctor)(report, !!v.verbose)};
      } finally {display?.stop();}
    }
    case 'completion-script': {
      const {completionScript} = await import('./shared/completion.js');
      return {shell: v.shell, text: completionScript(String(v.shell))};
    }
    case 'completion-install': {
      const {installCompletion} = await import('./shared/completion.js');
      const shell = String(v.shell ?? basename(process.env.SHELL ?? ''));
      return {shell, files: await installCompletion(shell), next: `eval "$(fam cli.completion script --shell ${shell} --format text)"`};
    }
    case 'completion-query': {
      const {complete, completionCatalog} = await import('./shared/completion.js');
      const words = Array.isArray(v.word) ? v.word : v.word === undefined ? [] : [String(v.word)];
      const documentation = words[0] === 'cli.doc' ? await (await import('./shared/documentation.js')).documentationCatalog() : undefined;
      const result = complete(completionCatalog(documentation), words);
      return {...result, text: `${[result.kind, result.prefix, ...result.candidates].join('\n')}\n`};
    }
  }
  throw new Error('Missing CLI implementation.');
}
let invocation: Invocation | undefined;
let jsonErrors = false;
async function main() {
  const args = process.argv.slice(2);
  jsonErrors = args.includes('--json') || args.includes('--format=json') || args.some((arg, i) => arg === '--format' && args[i + 1] === 'json');
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) {process.stdout.write(help()); return;}
  if (args[0] === '--version') args.splice(0, 1, 'cli.version', 'get');
  if (args[0] === 'doctor') args.splice(0, 1, 'cli.health', 'check', '--live');
  if (args[0] === '--completions' || args[0].startsWith('--completions=')) {
    const shell = args[0] === '--completions' ? args[1] : args[0].slice('--completions='.length);
    if (!['bash', 'zsh'].includes(shell) || args.length !== (args[0] === '--completions' ? 2 : 1))
      throw new UsageError('Use --completions bash or --completions zsh.', 'fam --completions bash');
    args.splice(0, args.length, 'cli.completion', 'script', '--shell', shell);
  }
  if (args[0] === 'browser') {
    args[0] = 'cli.browser';
    if (args[1] === 'use' && ['local','remote'].includes(args[2])) args.splice(2, 1, '--mode', args[2]);
  }
  if (args[0] === 'browser.transport') args[0] = 'cli.browser.transport';
  if (args[0] === 'cli.update' && (!args[1] || args[1].startsWith('-'))) args.splice(1, 0, 'run');
  const namespace = parseNamespaceHelp(args);
  if (namespace) {
    process.stdout.write(namespace.json ? `${stringifyJson({schemaVersion: 1, ok: true, command: null, data: namespace.namespace}, 2)}\n`
      : namespaceHelp(namespace.namespace, process.stdout.columns ?? 100));
    return;
  }
  invocation = parseInvocation(args);
  const {command, values} = invocation;
  history.command(command.id, command.provider, command.risk.level !== 'local' || command.object === 'health');
  if (values.help) {
    if (command.provider === 'familysearch' && command.object === 'api' && ['call', 'describe'].includes(command.action) && values.operation) {
      const {describeOperation} = await import('./familysearch/discovery.js');
      const {operationDescription} = await import('./familysearch/discovery-output.js');
      const operation = describeOperation(String(values.operation));
      process.stdout.write(wantsJson(values) ? `${stringifyJson(operation, 2)}\n` : operationDescription(operation));
    } else process.stdout.write(wantsJson(values) ? `${stringifyJson(describe(command), 2)}\n` : help(command));
    return;
  }
  const {setBrowserOverrides} = await import('./shared/browser-config.js');
  setBrowserOverrides({transport: values.transport as 'auto' | 'http' | 'browser' | undefined, timeout: values['browser-timeout'] as number | undefined});
  let data: unknown;
  const historyArchive = command.id === 'cli.history archive';
  if (values['dry-run'] && !historyArchive && command.id !== 'cli.update run') {
    data = {dryRun: true, invocation: syntax(command), flags: Object.fromEntries(Object.entries(values).map(([name, value]) =>
      [name, command.flags.find(flag => flag.name === name)?.sensitive ? '[REDACTED]' : value])), risk: command.risk,
      note: 'CLI flags validated only. No provider requests, credential lookup, output file writes, or operation simulation. Command history is recorded unless FAM_HISTORY=0.'};
  } else if (command.provider === 'cli') data = await cliCommand(invocation);
  else if (command.binding.command[0] === 'sync' && command.provider !== 'cyndislist') {
    const {syncCredentials} = await import('./shared/credential-sync.js');
    const {CREDENTIAL_DIR} = await import('./shared/storage.js');
    if (!await syncCredentials(command.provider === 'newspaperarchive' ? 'storied' : command.provider, CREDENTIAL_DIR)) throw new Error('No credential sync helper is configured. Set credentialsSyncCommand in config.json.');
    data = {synced: true, provider: command.provider};
  } else data = await (await providers[command.provider]()).runProvider(invocation.args);
  if (!values['dry-run'] && (command.provider !== 'cli' || command.object === 'health')) history.result(data);
  const envelope = {schemaVersion: 1, ok: true, command: command.id, data: data ?? null,
    ...(!values['dry-run'] && command.pagination ? {pagination: command.pagination} : {})};
  const fetchOutput = ['cli.browser fetch', 'wayback.page fetch'].includes(command.id) && !values['dry-run'] && !wantsJson(values)
    ? await import('./shared/browser-fetch.js') : undefined;
  const rendered = () => wantsJson(values) ? `${stringifyJson(envelope, 2)}\n` : fetchOutput
    ? fetchOutput.renderBrowserFetch(data as import('./shared/browser-fetch.js').BrowserFetchResult, (values.format ?? 'text') as import('./shared/browser-fetch.js').FetchFormat)
    : humanOutput(command, data, values, process.stdout.columns ?? 100);
  if (!values['dry-run'] && (command.provider === 'cli' || command.provider === 'wayback' || command.provider === 'internetarchive' && command.action !== 'download' || command.binding.command[0] === 'sync') && values.out) {
    const path = String(values.out), temporary = `${path}.${randomUUID()}.tmp`;
    await mkdir(dirname(path), {recursive: true, mode: 0o700});
    try {await writeFile(temporary, rendered(), {mode: 0o600, flag: 'wx'}); await rename(temporary, path);}
    finally {await rm(temporary, {force: true});}
    process.stdout.write(wantsJson(values) ? `${stringifyJson({...envelope, data: {saved: path}}, 2)}\n` : `Saved ${path}\n`); return;
  }
  if (!values['dry-run'] && !values.out && values.format === 'jsonl') {
    const {items, ...metadata} = data as {items: unknown[]; [key: string]: unknown};
    for (const item of items) process.stdout.write(`${stringifyJson({type: 'item', data: item})}\n`);
    process.stdout.write(`${stringifyJson({type: 'summary', ...envelope, data: metadata})}\n`); return;
  }
  process.stdout.write(rendered());
}
main().finally(async () => {
  const {closeBrowserTransportTabs} = await import('./shared/browser-transport.js');
  await closeBrowserTransportTabs();
}).catch(error => {
  history.fail(error);
  const usage = error instanceof UsageError;
  const message = (error as NodeJS.ErrnoException)?.code === 'EEXIST' ? 'Output or provenance file already exists; choose a new --out path.'
    : error instanceof Error ? error.message : 'fam command failed.';
  const suggestion = usage && error.suggestedInvocation ? error.suggestedInvocation
    : invocation ? `fam cli.command describe --command ${JSON.stringify(invocation.command.id)}` : undefined;
  if (jsonErrors) process.stderr.write(`${stringifyJson({schemaVersion: 1, ok: false, command: invocation?.command.id ?? null,
    error: {code: usage ? error.code : error?.code ?? 'EXECUTION_FAILED', message,
      ...(error?.vncUrl ? {vncUrl: error.vncUrl} : {}),
      ...(usage && error.navigation ? {available: error.navigation.available, suggestions: error.navigation.suggestions, help: error.navigation.help} : {}),
      ...(usage && error.suggestedInvocation ? {suggestedInvocation: error.suggestedInvocation}
        : invocation ? {inspect: `fam cli.command describe --command ${JSON.stringify(invocation.command.id)}`} : {})}}, 2)}\n`);
  else process.stderr.write(usage && error.navigation ? commandError(error.navigation, process.stderr.columns ?? 100)
    : `Error: ${message}\n${suggestion ? `\nTry: ${suggestion}\n` : ''}`);
  process.exitCode = usage ? 2 : 1;
}).finally(() => history.settled());
