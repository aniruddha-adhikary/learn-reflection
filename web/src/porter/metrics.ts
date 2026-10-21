import type { CourseEvent } from '../course-data';

export const metricIds = [
  'credit.score',
  'income.annual',
  'debt.monthly',
  'employment',
  'residence.country',
  'loan.principal',
  'loan.term',
  'loan.secured',
  'guarantors.count',
] as const;

export type MetricReader = (metricId: string) => unknown;

export function createMetricReader(
  event: CourseEvent,
  scoreFor: (applicantId: string) => number,
): MetricReader {
  return (metricId) => {
    switch (metricId) {
      case 'credit.score': return scoreFor(event.applicant.applicantId);
      case 'income.annual': return Math.trunc(event.applicant.income.annual);
      case 'debt.monthly': return event.applicant.debts.monthlyTotal;
      case 'employment': return event.applicant.employment;
      case 'residence.country': return event.applicant.residence.countryCode;
      case 'loan.principal': return event.request.principal;
      case 'loan.term': return event.request.termMonths;
      case 'loan.secured': return event.request.secured;
      case 'guarantors.count': return event.guarantors.length;
      default: throw new Error(`Unknown metric ${metricId}`);
    }
  };
}
