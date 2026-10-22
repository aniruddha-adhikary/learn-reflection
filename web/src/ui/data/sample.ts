import csvText from '../../../../playground/data/sftp/inbox/applications_20041015.csv?raw';
import scoresJson from '../../../../playground/data/bureau/scores.json';
import { parseCsv } from './csv';

export interface ModernEvent {
  readonly id: string;
  readonly applicant: {
    readonly applicantId: string;
    readonly fullName: string;
    readonly income: { readonly annual: number; readonly currency: string };
    readonly employment: string;
    readonly debts: { readonly monthlyTotal: number };
    readonly residence: { readonly countryCode: string | null };
  };
  readonly request: { readonly principal: number; readonly termMonths: number; readonly secured: boolean };
  readonly guarantors: readonly { readonly name: string }[];
}

export const legacyCsvText: string = csvText;

const table = parseCsv(csvText);
const headerRow = table[0];
if (headerRow === undefined) throw new Error('Legacy CSV has no header');
export const legacyHeader: readonly string[] = headerRow;
export const legacyRows: readonly (readonly string[])[] = table.slice(1);

const eventModules = import.meta.glob<ModernEvent>('../../../../playground/data/s3/events/*.json', {
  eager: true,
  import: 'default',
});
export const modernEvents: readonly ModernEvent[] = Object.keys(eventModules)
  .sort()
  .map((k) => {
    const ev = eventModules[k];
    if (ev === undefined) throw new Error(`Missing event module ${k}`);
    return ev;
  });

export const bureauScores: Readonly<Record<string, number>> = scoresJson;

if (modernEvents.length !== legacyRows.length) {
  throw new Error(
    `Paired data mismatch: ${String(legacyRows.length)} legacy rows vs ${String(modernEvents.length)} modern events`,
  );
}

export function legacyCell(row: readonly string[], column: string): string {
  const i = legacyHeader.indexOf(column);
  const v = row[i];
  if (i < 0 || v === undefined) throw new Error(`Legacy CSV has no column ${column}`);
  return v;
}
