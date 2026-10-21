import aiBindingsText from './data/bindings.ai.json?raw';
import mistakenBindingsText from './data/bindings.ai-mistake.json?raw';
import bureauScoresText from './data/bureau/scores.json?raw';
import csvText from './data/sftp/inbox/applications_20041015.csv?raw';
import dataflowGoldenText from './java-goldens/dataflow.golden.json?raw';
import evidenceAiGoldenText from './java-goldens/evidence.ai.golden.json?raw';
import evidenceMistakeGoldenText from './java-goldens/evidence.mistake.golden.json?raw';
import factsGoldenText from './java-goldens/facts.golden.json?raw';
import fuzzAiGoldenText from './java-goldens/fuzz.ai.golden.json?raw';
import fuzzMistakeGoldenText from './java-goldens/fuzz.mistake.golden.json?raw';
import rulesGoldenText from './java-goldens/rules.golden.json?raw';
import { courseClasses } from './classes.generated';

export interface CourseBinding {
  readonly legacy: string;
  readonly modern: string;
  readonly via?: string;
  readonly values?: Readonly<Record<string, string>>;
}

export interface CourseBindings {
  readonly proposedBy: string;
  readonly bindings: readonly CourseBinding[];
}

export interface CourseEvent {
  readonly id: string;
  readonly applicant: {
    readonly applicantId: string;
    readonly fullName: string;
    readonly income: { readonly annual: number; readonly currency: string };
    readonly employment: string | null;
    readonly debts: { readonly monthlyTotal: number };
    readonly residence: { readonly countryCode: string | null };
  };
  readonly request: {
    readonly principal: number;
    readonly termMonths: number;
    readonly secured: boolean;
  };
  readonly guarantors: readonly { readonly name: string }[];
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

const eventFiles = import.meta.glob<string>('./data/s3/events/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
});

export const courseBindings = {
  correct: parseJson(aiBindingsText) as CourseBindings,
  mistake: parseJson(mistakenBindingsText) as CourseBindings,
} as const;

export const courseEvents: readonly CourseEvent[] = Object.entries(eventFiles)
  .sort(([left], [right]) => left.localeCompare(right, 'en'))
  .map(([, text]) => parseJson(text) as CourseEvent);

export const courseData = {
  csv: csvText,
  bureauScores: parseJson(bureauScoresText) as Readonly<Record<string, number>>,
  bindings: courseBindings,
  events: courseEvents,
} as const;

export const courseGoldens = {
  facts: parseJson(factsGoldenText),
  dataflow: parseJson(dataflowGoldenText),
  rules: parseJson(rulesGoldenText),
  evidenceCorrect: parseJson(evidenceAiGoldenText),
  evidenceMistake: parseJson(evidenceMistakeGoldenText),
  fuzzCorrect: parseJson(fuzzAiGoldenText),
  fuzzMistake: parseJson(fuzzMistakeGoldenText),
} as const;

export function decodeCourseClasses(
  encoded: Readonly<Record<string, string>> = courseClasses,
): Map<string, Uint8Array> {
  const decoded = new Map<string, Uint8Array>();
  for (const internalName of Object.keys(encoded).sort((left, right) => left.localeCompare(right, 'en'))) {
    const base64 = encoded[internalName];
    if (base64 === undefined) throw new Error(`Missing class bytes for ${internalName}`);
    const binary = atob(base64);
    decoded.set(internalName, Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  }
  return decoded;
}
