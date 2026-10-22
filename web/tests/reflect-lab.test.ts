import { describe, expect, it } from 'vitest';
import { courseData, decodeCourseClasses } from '../src/course-data';
import {
  Introspector,
  Jvm,
  parseClassFile,
  Reflection,
  type JObject,
  type JvmValue,
} from '../src/jvm';
import {
  APPLICANT_COLUMNS,
  buildFromRow,
  classView,
  courseClassNames,
  implementors,
  invokeLab,
  proxyLab,
} from '../src/porter';
import { applicationFromCsv, courseRecordByAppId } from '../src/porter/evidence';

function parsedCourseClasses() {
  const classes = new Map<string, ReturnType<typeof parseClassFile>>();
  for (const [name, bytes] of decodeCourseClasses()) classes.set(name, parseClassFile(bytes));
  return classes;
}

function applicantFor(jvm: Jvm, appId: string): JObject {
  const application = applicationFromCsv(jvm, courseRecordByAppId(courseData.csv, appId));
  const applicant = application.fields.get('legacy/model/LoanApplication.applicant:Llegacy/model/Applicant;');
  if (!applicant || typeof applicant !== 'object' || applicant.kind !== 'object') {
    throw new Error(`Missing Applicant for ${appId}`);
  }
  return applicant;
}

function plainValue(value: JvmValue): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'bigint') return value;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'array') return value.values.map(plainValue);
  return { object: value.cls.replaceAll('/', '.') };
}

describe('reflection lab porter', () => {
  it('reflects Applicant fields and bean properties from compiled class files', () => {
    const view = classView('legacy.model.Applicant');
    expect(view.kind).toBe('class');
    expect(view.declaredFields).toEqual(expect.arrayContaining([
      { name: 'creditScore', modifiers: ['private'], javaType: 'int' },
      { name: 'annualIncome', modifiers: ['private'], javaType: 'int' },
    ]));
    expect(view.properties).toContainEqual({
      name: 'credScr',
      type: 'int',
      getter: 'getCredScr',
      setter: 'setCredScr',
    });
  });

  it('lists all loaded implementations of the compiled legacy rule interface', () => {
    const names = courseClassNames();
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right, 'en')));
    const rules = implementors('legacy.engine.Rule');
    expect(rules).toHaveLength(11);
    expect(rules[0]).toBe('legacy.rules.R01_MinimumScore');
    expect(rules).toContain('legacy.rules.R11_NotifyCosigners');
    expect(classView('legacy.engine.Rule').kind).toBe('interface');
  });

  it('runs the seven specified reflective calls and catches only Java exceptions', () => {
    const calls = invokeLab('A-1002');
    expect(calls).toHaveLength(7);
    expect(calls[0]?.outcome).toEqual({
      ok: true,
      value: 'class legacy.model.Applicant',
    });
    expect(calls[2]?.outcome).toMatchObject({
      ok: false,
      exception: 'java.lang.IllegalAccessException',
    });
    expect(calls[3]?.outcome).toEqual({ ok: true, value: 575 });
    expect(calls[4]?.outcome).toEqual({ ok: true, value: 640 });
    const monthly = calls[5]?.outcome;
    const annual = calls[6]?.outcome;
    expect(monthly?.ok).toBe(true);
    expect(annual?.ok).toBe(true);
    if (monthly?.ok && annual?.ok) expect(monthly.value).toBe(annual.value as number / 12);
  });

  it('rebuilds each course Applicant through bean setters and reads back every getter', () => {
    const classes = parsedCourseClasses();
    const jvm = new Jvm(classes);
    const reflection = new Reflection(jvm, classes);
    const applicantClass = reflection.forName('legacy.model.Applicant');
    for (const { id } of courseData.events) {
      const applicant = applicantFor(jvm, id);
      const expected = Object.fromEntries(
        Introspector.getBeanInfo(applicantClass)
          .filter((property) => property.readMethod !== null)
          .map((property) => [property.name, plainValue(property.readMethod?.invoke(applicant) ?? null)]),
      );
      expect(buildFromRow(id).readBack).toEqual(expected);
    }
    expect(Object.values(APPLICANT_COLUMNS)).toContain('annualIncome');
  });

  it('rejects a row mapping to a property that does not exist', () => {
    expect(() => buildFromRow('A-1002', { ...APPLICANT_COLUMNS, EXTRA: 'nope' })).toThrow('nope');
  });

  it('routes execute through a proxy and matches the direct decision', () => {
    const result = proxyLab('R01_MinimumScore', 'A-1002');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.method).toBe('execute');
    expect(result.codes).toEqual(['DECLINE_LOW_SCORE']);
    expect(result.directCodes).toEqual(result.codes);
  });

  it('throws for unknown classes, rules, and applications', () => {
    expect(() => classView('missing.Type')).toThrow('missing.Type');
    expect(() => proxyLab('R99_Unknown', 'A-1002')).toThrow('Unknown rule R99_Unknown');
    expect(() => invokeLab('A-9999')).toThrow('Unknown appId A-9999');
  });
});
