import { courseData, type CourseEvent } from '../course-data';
import { evaluateCondition } from './fuzz';
import { createMetricReader, metricIds } from './metrics';
import { transformFromParsed } from './transform';
import { parseClasses } from './common';

export interface InertResult {
  readonly data: {
    readonly approach: 'TypeScript Proxy over the metric reader';
    readonly lazy: { readonly status: 'PASS' | 'FAIL'; readonly codes: readonly string[] };
    readonly prefetch: { readonly status: 'PASS' | 'FAIL'; readonly message: string };
  };
  readonly trace: readonly string[];
}

export function inert(event: CourseEvent = defaultEvent()): InertResult {
  const transformed = transformFromParsed(parseClasses());
  const lazyRules = transformed.rules.filter((rule) => !containsMetric(rule.when, 'credit.score'));
  const reads: string[] = [];
  const metrics = createMetricReader(event, () => {
    throw new Error('inert: scoreFor called');
  });
  const proxiedMetrics = new Proxy(metrics, {
    apply(target, thisArgument, args: [string]) {
      const metric = args[0];
      reads.push(metric);
      return Reflect.apply(target, thisArgument, args);
    },
  });
  const codes: string[] = [];
  for (const rule of lazyRules) {
    if (evaluateCondition(rule.when, proxiedMetrics) === true) codes.push(rule.emit);
  }
  const lazyReads = [...reads];
  const lazyPassed = !lazyReads.includes('credit.score');
  if (!lazyPassed) throw new Error('Engine unexpectedly touched scoreFor on an inert proxy');

  let message = '';
  let naiveFailed = false;
  try {
    for (const metric of metricIds) proxiedMetrics(metric);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('inert:')) throw error;
    naiveFailed = true;
  }
  if (!naiveFailed) throw new Error('NaiveEngine unexpectedly avoided credit.score');
  const lazyStatus = resultStatus(lazyPassed);
  const prefetchStatus = resultStatus(!naiveFailed);
  const result: InertResult = {
    data: {
      approach: 'TypeScript Proxy over the metric reader',
      lazy: { status: lazyStatus, codes },
      prefetch: { status: prefetchStatus, message },
    },
    trace: [
      `Engine (lazy): ${lazyStatus} — metrics read only when reached`,
      `lazy metric reads: ${lazyReads.join(', ')}`,
      `NaiveEngine (prefetch): ${prefetchStatus} — touched scoreFor on an inert proxy`,
      message,
      'proxy: TypeScript Proxy over the metric reader',
    ],
  };
  return result;
}

function defaultEvent(): CourseEvent {
  const event = courseData.events.find((candidate) => candidate.id === 'A-1001') ?? courseData.events[0];
  if (!event) throw new Error('No course event is available for inert comparison');
  return event;
}

function containsMetric(value: unknown, metric: string): boolean {
  if (Array.isArray(value)) return value.some((item) => containsMetric(item, metric));
  if (value === null || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'read' && child === metric) return true;
    if (containsMetric(child, metric)) return true;
  }
  return false;
}

function resultStatus(passed: boolean): 'PASS' | 'FAIL' {
  return passed ? 'PASS' : 'FAIL';
}
