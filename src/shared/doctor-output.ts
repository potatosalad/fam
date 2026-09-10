import {stripVTControlCharacters} from 'node:util';
import type {WriteStream} from 'node:tty';
import type {Values} from './command-runtime.js';
import type {Provider} from './command-registry.js';
import {doctorSummary, formatDoctor, type DoctorEvent, type DoctorReport, type ProviderReport} from './doctor.js';

type Terminal = Pick<WriteStream, 'write' | 'isTTY' | 'columns' | 'rows' | 'hasColors'>;
const paint = (code: number, text: string) => `\x1b[${code}m${text}\x1b[0m`;
const color = (report: ProviderReport) => report.status === 'error' ? 31 : report.status === 'warning' ? 33 : 32;
const symbol = (report: ProviderReport) => report.status === 'error' ? '✗' : report.status === 'warning' ? '!' : '✓';
const clean = (text: string) => stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function usePrettyDoctor(values: Values, output: Terminal = process.stdout,
  env: NodeJS.ProcessEnv = process.env, providerCount = 0): boolean {
  return !values['no-pretty'] && !values.json && values.format !== 'json' && !values.out
    && !!output.isTTY && output.hasColors?.(8) === true && env.TERM !== 'dumb'
    && env.NO_COLOR === undefined && env.NODE_DISABLE_COLORS === undefined
    && (!env.CI || ['0', 'false'].includes(env.CI))
    && (!output.rows || output.rows >= providerCount + 3);
}

function prettyRow(report: ProviderReport, width: number): string {
  const {label, detail} = doctorSummary(report);
  return `${paint(color(report), symbol(report))} ${report.provider.padEnd(width)} ${paint(color(report), label.padEnd(7))} ${clean(detail)}`;
}

export function formatPrettyDoctor(report: DoctorReport, verbose = false): string {
  const lines = formatDoctor(report, verbose).split('\n');
  if (verbose) {
    return lines.map(line => {
      const provider = report.providers.find(provider => line.startsWith(`${provider.provider}: `));
      return provider ? paint(color(provider), `${symbol(provider)} ${clean(line)}`) : clean(line);
    }).join('\n');
  }
  const width = Math.max(13, ...report.providers.map(provider => provider.provider.length));
  return [...report.providers.map(provider => prettyRow(provider, width)), ...lines.slice(report.providers.length).map(clean)].join('\n');
}

/** Own only the temporary rows; leave the final report to the normal CLI output path. */
export function startDoctorDisplay(services: Provider[], live: boolean,
  output: Terminal = process.stdout, diagnostics: Pick<WriteStream, 'write' | 'isTTY'> = process.stderr) {
  const started = Date.now(), width = Math.max(13, ...services.map(service => service.length));
  const rows = new Map(services.map(provider => [provider, {label: 'Starting checks', report: undefined as ProviderReport | undefined}]));
  let frame = 0, drawn = 0, stopped = false, diagnosticLineOpen = false;
  const erase = () => {
    if (drawn) output.write(`\r\x1b[${drawn}A\x1b[0J`);
    drawn = 0;
  };
  const draw = () => {
    if (stopped || diagnosticLineOpen) return;
    erase();
    const complete = [...rows.values()].filter(row => row.report).length;
    const heading = `fam doctor · ${live ? 'live' : 'offline'} checks · ${complete}/${services.length} complete · ${((Date.now() - started) / 1000).toFixed(1)}s`;
    const lines = [paint(1, heading), '', ...services.map(provider => {
      const row = rows.get(provider)!;
      return row.report ? prettyRow(row.report, width)
        : `${paint(36, frames[frame % frames.length])} ${provider.padEnd(width)} ${paint(36, 'CHECK'.padEnd(7))} ${clean(row.label)}`;
    })];
    // Disable wrapping only during the redraw, so a narrow/resized terminal
    // cannot turn a provider row into several lines and break cursor movement.
    output.write(`\x1b[?7l${lines.join('\n')}\n\x1b[?7h`);
    drawn = lines.length;
  };
  const originalWrite = diagnostics.write;
  const diagnosticWrite: WriteStream['write'] = function (chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) {
    erase();
    const result = Reflect.apply(originalWrite, diagnostics, [chunk, encoding, callback]) as boolean;
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    if (text.length) diagnosticLineOpen = !text.endsWith('\n');
    draw();
    return result;
  };
  // Browser verification URLs and sync notices must stay visible above the
  // display, including messages arriving between spinner frames.
  if (diagnostics.isTTY) diagnostics.write = diagnosticWrite;
  const onExit = () => stop(false);
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const handlers = signals.map(signal => () => {stop(false); process.kill(process.pid, signal);});
  function stop(clear = true) {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (clear) erase();
    if (diagnostics.write === diagnosticWrite) diagnostics.write = originalWrite;
    process.removeListener('exit', onExit);
    signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
    output.write('\x1b[0m\x1b[?7h\x1b[?25h');
  }
  const timer = setInterval(() => {frame++; draw();}, 80);
  timer.unref();
  process.once('exit', onExit);
  signals.forEach((signal, index) => process.once(signal, handlers[index]));
  output.write('\x1b[?25l');
  draw();
  return {
    update(event: DoctorEvent) {
      if (stopped) return;
      const row = rows.get(event.provider);
      if (!row) return;
      if (event.type === 'complete') row.report = event.report;
      else row.label = event.label;
      draw();
    },
    stop,
  };
}
