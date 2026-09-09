import {UsageError, type Values} from './command-runtime.js';
import type {HistoryEntry, HistoryOutcome} from './history-query.js';

export const statsIntervals = ['auto', 'minute', 'hour', 'day', 'week', 'month'] as const;
export const statsGroups = ['none', 'provider', 'command', 'outcome', 'code', 'build'] as const;
export const statsMetrics = ['calls', 'failures', 'failure-rate', 'avg-duration', 'p50-duration', 'p95-duration'] as const;
export type StatsInterval = Exclude<typeof statsIntervals[number], 'auto'>;
export type StatsMetric = typeof statsMetrics[number];
export interface HistoryMeasures {
  calls: number; completed: number; failures: number;
  success: number; soft_failure: number; hard_failure: number; incomplete: number;
  failureRatePct: number | null;
  duration: {samples: number; meanMs: number | null; p50Ms: number | null; p95Ms: number | null; minMs: number | null; maxMs: number | null};
}
export interface StatsBucket extends HistoryMeasures {start: string; end: string}
export interface StatsSeries {key: string; totals: HistoryMeasures; buckets: StatsBucket[]}
export interface HistoryStatsData {
  view: 'stats'; interval: StatsInterval; groupBy: typeof statsGroups[number]; metric: StatsMetric; format: 'graph' | 'table' | 'json';
  since: string | null; until: string | null; totals: HistoryMeasures; series: StatsSeries[];
}
interface Accumulator {calls: number; success: number; soft_failure: number; hard_failure: number; incomplete: number; durations: number[]}
interface Sample {time: number; outcome: HistoryOutcome; duration: number | null; keys: string[]}
const accumulator = (): Accumulator => ({calls: 0, success: 0, soft_failure: 0, hard_failure: 0, incomplete: 0, durations: []});
function add(target: Accumulator, sample: Sample): void {
  target.calls++; target[sample.outcome]++;
  if (sample.outcome !== 'incomplete' && sample.duration !== null && sample.duration >= 0 && Number.isFinite(sample.duration)) target.durations.push(sample.duration);
}
function measures(source: Accumulator): HistoryMeasures {
  const {durations, ...counts} = source, sorted = durations.sort((a, b) => a - b), n = sorted.length;
  const completed = source.calls - source.incomplete, failures = source.soft_failure + source.hard_failure;
  return {...counts, completed, failures, failureRatePct: completed ? failures / completed * 100 : null,
    duration: {samples: n, meanMs: n ? sorted.reduce((sum, value) => sum + value / n, 0) : null,
      p50Ms: n ? sorted[Math.ceil(n * 0.5) - 1] : null, p95Ms: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
      minMs: n ? sorted[0] : null, maxMs: n ? sorted[n - 1] : null}};
}
export function statsBucketStart(time: number, interval: StatsInterval): number {
  const date = new Date(time); date.setUTCMilliseconds(0); date.setUTCSeconds(0);
  if (interval === 'minute') return date.getTime();
  date.setUTCMinutes(0);
  if (interval === 'hour') return date.getTime();
  date.setUTCHours(0);
  if (interval === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  if (interval === 'month') date.setUTCDate(1);
  return date.getTime();
}
function nextBucket(time: number, interval: StatsInterval): number {
  if (interval === 'month') {const date = new Date(time); date.setUTCMonth(date.getUTCMonth() + 1); return date.getTime();}
  return time + {minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000}[interval];
}
function automaticInterval(span: number): StatsInterval {
  return span <= 3_600_000 ? 'minute' : span <= 2 * 86_400_000 ? 'hour' : span <= 90 * 86_400_000 ? 'day'
    : span <= 2 * 366 * 86_400_000 ? 'week' : 'month';
}
export function statsValue(value: HistoryMeasures, metric: StatsMetric): number | null {
  if (metric === 'calls') return value.calls;
  if (metric === 'failures') return value.failures;
  if (metric === 'failure-rate') return value.failureRatePct;
  return value.duration[metric === 'avg-duration' ? 'meanMs' : metric === 'p50-duration' ? 'p50Ms' : 'p95Ms'];
}

/** Aggregate every matching invocation; only compact statistical samples are retained. */
export async function historyStatistics(rows: AsyncIterable<HistoryEntry>, values: Values, range: {since: number; until: number; now: number}): Promise<HistoryStatsData> {
  const intervalArg = String(values.interval ?? 'auto'), groupBy = String(values['group-by'] ?? 'none') as HistoryStatsData['groupBy'];
  const metric = String(values.metric ?? 'calls') as StatsMetric, format = String(values.format ?? 'graph') as HistoryStatsData['format'];
  if (!statsIntervals.includes(intervalArg as never) || !statsGroups.includes(groupBy) || !statsMetrics.includes(metric) || !['graph', 'table', 'json'].includes(format))
    throw new UsageError('Invalid statistics interval, grouping, metric, or format.', 'fam cli.history stats --help');
  const samples: Sample[] = [], total = accumulator();
  let first = Infinity, last = -Infinity;
  for await (const row of rows) {
    const keys = groupBy === 'none' ? ['All calls'] : groupBy === 'provider' ? [row.provider ?? '(unknown)']
      : groupBy === 'command' ? [row.command] : groupBy === 'outcome' ? [row.outcome]
      : groupBy === 'code' ? [...new Set(row.codes.length ? row.codes : ['SUCCESS'])]
      : [row.build?.revision ? row.build.revision + (row.build.dirty ? ' (dirty)' : '') : '(unknown build)'];
    const sample = {time: Date.parse(row.startedAt), outcome: row.outcome, duration: row.durationMs, keys};
    first = Math.min(first, sample.time); last = Math.max(last, sample.time); add(total, sample); samples.push(sample);
  }
  const since = Number.isFinite(range.since) ? range.since : first;
  const until = Number.isFinite(range.until) ? range.until : Number.isFinite(range.since) ? Math.max(range.now, last) : last;
  const bounded = Number.isFinite(since) && Number.isFinite(until) && since <= until;
  const interval = intervalArg === 'auto' ? automaticInterval(bounded ? until - since : 0) : intervalArg as StatsInterval;
  const groups = new Map<string, {total: Accumulator; buckets: Map<number, Accumulator>}>();
  if (groupBy === 'none') groups.set('All calls', {total: accumulator(), buckets: new Map()});
  for (const sample of samples) for (const key of sample.keys) {
    const group = groups.get(key) ?? {total: accumulator(), buckets: new Map()};
    const time = statsBucketStart(sample.time, interval), bucket = group.buckets.get(time) ?? accumulator();
    add(group.total, sample); add(bucket, sample); group.buckets.set(time, bucket); groups.set(key, group);
  }
  const series: StatsSeries[] = [...groups].map(([key, group]) => {
    const buckets: StatsBucket[] = [];
    if (bounded) for (let start = statsBucketStart(since, interval); start <= until;) {
      const end = nextBucket(start, interval);
      if (!Number.isFinite(end) || end <= start) throw new UsageError('Statistics time range exceeds the supported date range.');
      buckets.push({start: new Date(start).toISOString(), end: new Date(end).toISOString(), ...measures(group.buckets.get(start) ?? accumulator())});
      start = end;
    }
    return {key, totals: measures(group.total), buckets};
  }).sort((a, b) => b.totals.calls - a.totals.calls || a.key.localeCompare(b.key));
  return {view: 'stats', interval, groupBy, metric, format, since: bounded ? new Date(since).toISOString() : null,
    until: bounded ? new Date(until).toISOString() : null, totals: measures(total), series};
}
