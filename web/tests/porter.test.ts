import { describe, expect, it } from 'vitest';
import {
  courseData,
  courseGoldens,
  decodeCourseClasses,
} from '../src/course-data';
import { Jvm, parseClassFile, type JObject } from '../src/jvm';
import { dataflow, evidence, facts, fuzz, getterFlows, inert, JavaRandom, transform } from '../src/porter';

function parsedCourseClasses() {
  const classes = new Map<string, ReturnType<typeof parseClassFile>>();
  for (const [name, bytes] of decodeCourseClasses()) classes.set(name, parseClassFile(bytes));
  return classes;
}

describe('browser porter parity with Java command goldens', () => {
  it('matches facts, dataflow, and bytecode-derived transform output', () => {
    const factResult = facts();
    const dataflowResult = dataflow();
    const transformResult = transform();

    expect(factResult.data).toEqual(courseGoldens.facts);
    expect(dataflowResult.data).toEqual(courseGoldens.dataflow);
    expect(dataflowResult.trace.length).toBe(dataflowResult.data.length);
    expect(dataflowResult.trace.every((entry) => entry.instructionOffsets.length > 0)).toBe(true);
    expect(transformResult.data).toEqual(courseGoldens.rules);
    expect(new Set(transformResult.rules.map((rule) => rule.legacyRule)).size).toBe(10);
    expect(transformResult.rules).toHaveLength(12);
    expect(transformResult.findings).toEqual([
      {
        legacyRule: 'R11_NotifyCosigners',
        kind: 'MISFIT',
        reason: 'unsupported call java/util/List.iterator()Ljava/util/Iterator;',
      },
    ]);
    expect(transformResult.trace).toHaveLength(12);
    expect(transformResult.trace.every((path) => path.instructionOffsets.length > 0)).toBe(true);
    expect(transformResult.trace.every((path) => path.branches.length > 0)).toBe(true);
  });

  it('exposes structured getter instruction and field provenance', () => {
    const flows = getterFlows();
    const income = flows.find((flow) => flow.owner === 'legacy.model.Applicant' && flow.method === 'getIncome');
    expect(income).toBeDefined();
    expect(income?.fieldsRead).toEqual(['annualIncome']);
    expect(income?.labels).toEqual(expect.arrayContaining(['BIPUSH', 'IDIV']));
    expect(income?.instructions.find((instruction) => instruction.mnemonic === 'bipush')?.operand).toBe('12');
    const incomeTrace = dataflow().trace.find((entry) =>
      entry.line.startsWith(`getter ${income?.owner}.${income?.method}${income?.descriptor} returns [`),
    );
    expect(income?.sourceOffsets).toEqual(incomeTrace?.instructionOffsets);

    const creditScore = flows.find((flow) => flow.owner === 'legacy.model.Applicant' && flow.method === 'getCredScr');
    expect(creditScore?.fieldsRead).toEqual(['creditScore']);
  });

  it('matches both evidence goldens and traces every CSV record', () => {
    const correct = evidence(courseData.bindings.correct);
    const mistake = evidence(courseData.bindings.mistake);
    expect(correct.data).toEqual(courseGoldens.evidenceCorrect);
    expect(mistake.data).toEqual(courseGoldens.evidenceMistake);
    expect(correct.data).toHaveLength(9);
    expect(correct.data.every((row) => row.status === 'CONFIRMED')).toBe(true);
    expect(mistake.data.filter((row) => row.status === 'CONFIRMED')).toHaveLength(8);
    expect(mistake.data.find((row) => row.status === 'REJECTED')).toMatchObject({
      legacyField: 'legacy.model.Applicant#empStat',
      firstRecordId: 'A-1003',
    });
    expect(correct.trace).toHaveLength(108);
    expect(mistake.trace).toHaveLength(108);
  });

  it('matches both deterministic fuzz goldens including all disagreements', () => {
    const correct = fuzz(courseData.bindings.correct);
    const mistake = fuzz(courseData.bindings.mistake);
    expect(correct.data).toEqual(courseGoldens.fuzzCorrect);
    expect(mistake.data).toEqual(courseGoldens.fuzzMistake);
    expect(correct.data.cases).toBe(791);
    expect(correct.data.disagreements).toHaveLength(0);
    expect(mistake.data.cases).toBe(791);
    expect(mistake.data.disagreements).toHaveLength(35);
    expect(mistake.data.disagreements.map(({ rule }) => rule)).toEqual(
      expect.arrayContaining(['R06_FastTrack', 'R08_SelfEmployedScore']),
    );
    expect(correct.trace).toHaveLength(791);
    expect(mistake.trace).toHaveLength(791);
  }, 60_000);

  it('reports the lazy metric-reader proxy comparison', () => {
    const result = inert();
    expect(result.data.approach).toBe('TypeScript Proxy over the metric reader');
    expect(result.data.lazy.status).toBe('PASS');
    expect(result.data.prefetch).toEqual({
      status: 'FAIL',
      message: 'inert: scoreFor called',
    });
    expect(result.trace).toContain('Engine (lazy): PASS — metrics read only when reached');
    expect(result.trace).toContain('NaiveEngine (prefetch): FAIL — touched scoreFor on an inert proxy');
  });

  it('decodes generated course classes through browser atob-compatible bytes', () => {
    const classes = parsedCourseClasses();
    expect(classes.size).toBeGreaterThan(0);
    expect(classes.has('legacy/rules/R01_MinimumScore')).toBe(true);
  });
});

describe('Java-compatible seeded random', () => {
  it('matches the Java Random(42).nextInt(100) sequence', () => {
    const random = new JavaRandom(42);
    expect(Array.from({ length: 10 }, () => random.nextInt(100))).toEqual([
      30, 63, 48, 84, 70, 25, 5, 18, 19, 93,
    ]);
  });

  it('models Set.of as a null-hostile ImmutableCollections SetN', () => {
    const jvm = new Jvm(parsedCourseClasses());
    const set = jvm.invokeMethod(
      'java/util/Set',
      'of',
      '()Ljava/util/Set;',
      null,
      [],
    );
    expect(set).toMatchObject({ cls: 'java/util/ImmutableCollections$SetN' });
    let thrown: unknown;
    try {
      jvm.invokeMethod('java/util/Set', 'contains', '(Ljava/lang/Object;)Z', set, [null]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      object: { cls: 'java/lang/NullPointerException' },
    });
  });

  it('models List.of as a null-hostile ImmutableCollections ListN', () => {
    const jvm = new Jvm(parsedCourseClasses());
    const list = jvm.invokeMethod(
      'java/util/List',
      'of',
      '()Ljava/util/List;',
      null,
      [],
    );
    expect(list).toMatchObject({ cls: 'java/util/ImmutableCollections$ListN' });
    let thrown: unknown;
    try {
      jvm.invokeMethod('java/util/List', 'contains', '(Ljava/lang/Object;)Z', list, [null]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      object: { cls: 'java/lang/NullPointerException' },
    });
  });

  it('delegates Collections.unmodifiableSet contains to the wrapped set', () => {
    const jvm = new Jvm(parsedCourseClasses());
    const delegate: JObject = {
      kind: 'object',
      cls: 'java/util/HashSet',
      fields: new Map(),
    };
    expect(jvm.invokeMethod('java/util/Set', 'add', '(Ljava/lang/Object;)Z', delegate, [null])).toBe(1);
    const wrapped = jvm.invokeMethod(
      'java/util/Collections',
      'unmodifiableSet',
      '(Ljava/util/Set;)Ljava/util/Set;',
      null,
      [delegate],
    );
    expect(wrapped).toMatchObject({ cls: 'java/util/Collections$UnmodifiableSet' });
    expect(jvm.invokeMethod('java/util/Set', 'contains', '(Ljava/lang/Object;)Z', wrapped, [null])).toBe(1);

    let thrown: unknown;
    try {
      jvm.invokeMethod('java/util/Set', 'add', '(Ljava/lang/Object;)Z', wrapped, [null]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      object: { cls: 'java/lang/UnsupportedOperationException' },
    });
  });
});
