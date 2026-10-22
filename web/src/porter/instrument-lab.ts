import { JavaThrown, Jvm, type JObject, type JvmValue } from '../jvm';
import { courseData } from '../course-data';
import { applicationFromCsv, courseRecordByAppId } from './evidence';
import { memberRefs } from './asm-lab';
import { parseClasses } from './common';
import { modernOutcome } from './fuzz';
import { transformFromParsed } from './transform';

const executeDescriptor = '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V';
const runnerDescriptor = '(Llegacy/model/LoanApplication;)Llegacy/model/Decision;';

export interface GetterRecord {
  readonly rule: string;
  readonly orderedGetters: readonly string[];
  readonly staticGetters: readonly string[];
  readonly staticOnly: readonly string[];
  readonly dynamicOnly: readonly string[];
}

export interface RecordedApplicant {
  readonly appId: string;
  readonly codes: readonly string[];
  readonly referrals: readonly string[];
  readonly legacyError: string;
  readonly modernCodes: readonly string[];
  readonly modernError: string;
  readonly agree: boolean;
}

export interface RecordReplayResult {
  readonly applicants: readonly RecordedApplicant[];
  readonly agreeCount: number;
  readonly disagreeCount: number;
}

export function getterRecorder(): readonly GetterRecord[] {
  const classes = parseClasses();
  const ruleNames = [...classes.keys()]
    .filter((name) => name.startsWith('legacy/rules/') && !name.includes('$'))
    .sort();
  const ids = appIds();
  return ruleNames.map((className) => {
    const dynamic = new Set<string>();
    let collecting = false;
    for (const appId of ids) {
      const jvm = new Jvm(classes, {
        onInvoke: (event) => {
          if (collecting && event.owner.startsWith('legacy/model/') && isGetter(event.name)) {
            dynamic.add(`${event.owner}.${event.name}${event.descriptor}`);
          }
        },
      });
      const application = applicationFromCsv(jvm, courseRecordByAppId(courseData.csv, appId));
      const rule = construct(jvm, className);
      const decision = construct(jvm, 'legacy/model/Decision');
      try {
        collecting = true;
        try {
          jvm.invokeMethod(className, 'execute', executeDescriptor, rule, [application, decision]);
        } catch (error) {
          if (!(error instanceof JavaThrown)) throw error;
        }
      } finally {
        collecting = false;
      }
    }
    const staticRefs = memberRefs(className);
    const staticGetters = unique(staticRefs.flatMap(({ refs }) =>
      refs.map(getterReference).filter((value): value is string => value !== null),
    ));
    const orderedGetters = [...dynamic];
    const staticOnly = staticGetters.filter((value) => !dynamic.has(value));
    const dynamicOnly = orderedGetters.filter((value) => !staticGetters.includes(value));
    return {
      rule: className.slice(className.lastIndexOf('/') + 1),
      orderedGetters,
      staticGetters,
      staticOnly,
      dynamicOnly,
    };
  });
}

export function recordReplay(): RecordReplayResult {
  const classes = parseClasses();
  const transformed = transformFromParsed(classes);
  const scores = new Map(Object.entries(courseData.bureauScores));
  const captured = new Map<string, { codes: readonly string[]; referrals: readonly string[]; error: string }>();
  for (const appId of appIds()) {
    const invoked = new Set<string>();
    const jvm = new Jvm(classes, {
      onInvoke: (event) => {
        if (event.owner !== 'legacy/engine/RuleRunner' || event.name !== 'run') return;
        const app = required(event.args[0], `RuleRunner.run omitted its application for ${appId}`);
        const resolvedId = stringValue(jvm.invokeMethod('legacy/model/LoanApplication', 'getAppId', '()Ljava/lang/String;', app, []));
        invoked.add(resolvedId);
      },
      onReturn: (event) => {
        if (event.owner !== 'legacy/engine/RuleRunner' || event.name !== 'run') return;
        const app = required(event.args[0], `RuleRunner.run omitted its application for ${appId}`);
        const resolvedId = stringValue(jvm.invokeMethod('legacy/model/LoanApplication', 'getAppId', '()Ljava/lang/String;', app, []));
        if ('thrown' in event) {
          captured.set(resolvedId, { codes: [], referrals: [], error: event.thrown });
          return;
        }
        const decision = event.result;
        captured.set(resolvedId, {
          codes: readStringList(jvm, jvm.invokeMethod('legacy/model/Decision', 'getCodes', '()Ljava/util/List;', decision, [])),
          referrals: readStringList(jvm, jvm.invokeMethod('legacy/model/Decision', 'getReferrals', '()Ljava/util/List;', decision, [])),
          error: '',
        });
      },
    });
    const application = applicationFromCsv(jvm, courseRecordByAppId(courseData.csv, appId));
    try {
      jvm.invokeMethod('legacy/engine/RuleRunner', 'run', runnerDescriptor, null, [application]);
    } catch {
      if (!captured.has(appId)) throw new Error(`RuleRunner failed without a return event for ${appId}`);
    }
    if (!invoked.has(appId)) throw new Error(`RuleRunner.run was not observed for ${appId}`);
  }

  const applicants = appIds().map((appId): RecordedApplicant => {
    const legacy = captured.get(appId);
    if (!legacy) throw new Error(`RuleRunner did not produce a record for ${appId}`);
    const event = courseData.events.find((candidate) => candidate.id === appId);
    if (!event) throw new Error(`Missing event for ${appId}`);
    const modern = modernOutcome(transformed.rules, event, scores);
    return {
      appId,
      codes: legacy.codes,
      referrals: legacy.referrals,
      legacyError: legacy.error,
      modernCodes: modern.codes,
      modernError: modern.error,
      agree: legacy.error.length > 0
        ? modern.error.length > 0 && errorType(legacy.error) === errorType(modern.error)
        : modern.error === '' && equalStrings(legacy.codes, modern.codes),
    };
  });
  const agreeCount = applicants.filter((applicant) => applicant.agree).length;
  return { applicants, agreeCount, disagreeCount: applicants.length - agreeCount };
}

function isGetter(name: string): boolean {
  return name.startsWith('get') || name.startsWith('is');
}

function getterReference(reference: string): string | null {
  const match = /^(?:INVOKEVIRTUAL|INVOKEINTERFACE|INVOKESPECIAL|INVOKESTATIC) (.+)\.([^\s.(]+)\s+(\(.*)$/.exec(reference);
  if (!match || !match[1]?.startsWith('legacy/model/') || !isGetter(match[2] ?? '')) return null;
  return `${match[1]}.${match[2]}${match[3]}`;
}

function appIds(): readonly string[] {
  const rows = courseData.csv.split(/\r?\n/).filter((line) => line.length > 0);
  const header = rows[0]?.split(',');
  if (!header) throw new Error('Course CSV has no header');
  const index = header.indexOf('APP_ID');
  if (index < 0) throw new Error('Course CSV has no APP_ID column');
  return rows.slice(1).map((row) => {
    const value = row.split(',')[index];
    if (!value) throw new Error(`Missing APP_ID in row ${row}`);
    return value;
  });
}

function construct(jvm: Jvm, className: string): JObject {
  const object = jvm.newObject(className);
  jvm.invokeMethod(className, '<init>', '()V', object, []);
  return object;
}

function readStringList(jvm: Jvm, value: JvmValue): string[] {
  const iterator = jvm.invokeMethod('java/util/List', 'iterator', '()Ljava/util/Iterator;', value, []);
  const result: string[] = [];
  while (jvm.invokeMethod('java/util/Iterator', 'hasNext', '()Z', iterator, []) !== 0) {
    result.push(stringValue(jvm.invokeMethod('java/util/Iterator', 'next', '()Ljava/lang/Object;', iterator, [])));
  }
  return result;
}

function stringValue(value: JvmValue): string {
  if (value && typeof value === 'object' && value.kind === 'string') return value.value;
  const actual = value === null
    ? 'null'
    : typeof value === 'number' || typeof value === 'bigint'
      ? `${value}`
      : value.kind === 'array'
        ? `array[${value.values.length}]`
        : value.cls;
  throw new Error(`Expected Java string, got ${actual}`);
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function errorType(error: string): string {
  const boundary = error.indexOf(':');
  const name = boundary < 0 ? error : error.slice(0, boundary);
  return name.slice(name.lastIndexOf('/') + 1);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
