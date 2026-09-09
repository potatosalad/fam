import {statsValue, type HistoryMeasures, type HistoryStatsData, type StatsMetric} from './history-stats.js';

const safe = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
const number = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
const milliseconds = (value: number | null) => value === null ? '—' : value < 1000 ? `${number(value)}ms` : value < 60_000 ? `${number(value / 1000)}s` : `${number(value / 60_000)}m`;
const percentage = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;
const names: Record<StatsMetric, string> = {calls: 'Calls', failures: 'Failures (soft + hard)', 'failure-rate': 'Failure rate',
  'avg-duration': 'Mean duration', 'p50-duration': 'p50 duration', 'p95-duration': 'p95 duration'};
const metricText = (value: number | null, metric: StatsMetric) => metric === 'failure-rate' ? percentage(value)
  : metric.endsWith('duration') ? milliseconds(value) : value === null ? '—' : String(value);
function wrap(text: string, width: number): string[] {
  let value = safe(text);
  const lines: string[] = [];
  while (value.length > width) {
    const space = value.lastIndexOf(' ', width), end = space > 0 ? space : width;
    lines.push(value.slice(0, end)); value = value.slice(end).trimStart();
  }
  if (value) lines.push(value);
  return lines;
}
function tableNumbers(value: HistoryMeasures): string {
  return `${String(value.calls).padStart(7)} ${String(value.hard_failure).padStart(6)} ${String(value.soft_failure).padStart(6)} ${String(value.incomplete).padStart(6)} ${percentage(value.failureRatePct).padStart(7)} ${milliseconds(value.duration.meanMs).padStart(9)} ${milliseconds(value.duration.p50Ms).padStart(9)} ${milliseconds(value.duration.p95Ms).padStart(9)}`;
}
export function historyStatsOutput(data: HistoryStatsData, width: number): string[] {
  const lines = ['Command history statistics',
    ...wrap(`${data.totals.calls} calls · ${data.totals.success} OK · ${data.totals.soft_failure} soft · ${data.totals.hard_failure} hard · ${data.totals.incomplete} unfinished`, width),
    ...wrap(`Failure rate ${percentage(data.totals.failureRatePct)} · Mean ${milliseconds(data.totals.duration.meanMs)} · p50 ${milliseconds(data.totals.duration.p50Ms)} · p95 ${milliseconds(data.totals.duration.p95Ms)}`, width)];
  if (data.since && data.until) lines.push(...wrap(`${data.since} → ${data.until}`, width));
  lines.push(`UTC · ${data.interval} buckets · grouped by ${data.groupBy}`);
  if (!data.totals.calls) lines.push('', 'No matching calls.');
  const label = (start: string) => start.slice(0, data.interval === 'month' ? 7 : ['minute', 'hour'].includes(data.interval) ? 16 : 10).replace('T', ' ');
  let maximum = 0, valueWidth = 1;
  for (const series of data.series) for (const bucket of series.buckets) {
    const value = statsValue(bucket, data.metric);
    maximum = Math.max(maximum, value ?? 0);
    valueWidth = Math.max(valueWidth, metricText(value, data.metric).length);
  }
  if (data.format !== 'table') lines.push('', `${names[data.metric]} · shared scale across series`);
  for (const series of data.series) {
    lines.push('', ...wrap(`${series.key} · ${series.totals.calls} calls · ${percentage(series.totals.failureRatePct)} failures`, width));
    if (data.format === 'table') {
      lines.push(`${'TIME (UTC)'.padEnd(17)} ${'CALLS'.padStart(7)} ${'HARD'.padStart(6)} ${'SOFT'.padStart(6)} ${'UNFIN'.padStart(6)} ${'FAIL%'.padStart(7)} ${'AVG'.padStart(9)} ${'P50'.padStart(9)} ${'P95'.padStart(9)}`);
      for (const bucket of series.buckets) lines.push(`${label(bucket.start).padEnd(17)} ${tableNumbers(bucket)}`);
    } else {
      const labelWidth = ['minute', 'hour'].includes(data.interval) ? 16 : data.interval === 'month' ? 7 : 10;
      const barWidth = Math.max(1, width - labelWidth - valueWidth - 5);
      for (const bucket of series.buckets) {
        const value = statsValue(bucket, data.metric), fraction = maximum && value !== null ? value / maximum * barWidth : 0;
        const full = Math.floor(fraction), remainder = Math.round((fraction - full) * 8);
        const bar = '█'.repeat(full) + (remainder ? '▏▎▍▌▋▊▉█'[remainder - 1] : '');
        lines.push(`${label(bucket.start)} │ ${bar.padEnd(barWidth)} ${metricText(value, data.metric).padStart(valueWidth)}`);
      }
    }
  }
  lines.push('', ...wrap('Failure rate = (soft + hard failures) / completed calls in the selected data; unfinished calls are excluded.', width),
    ...wrap('Durations use recorded completed calls only. p50/p95 use nearest rank; — means no samples.', width));
  if (data.groupBy === 'code') lines.push(...wrap('A call can appear in several code series; overall totals count it once.', width));
  return lines;
}
