import {
  JavaThrown,
  Jvm,
  type JavaThrownDetails,
  type JObject,
  type JvmValue,
} from '../jvm';
import { courseData } from '../course-data';
import { applicationFromCsv, courseRecordByAppId } from './evidence';
import { memberRefs, type MemberRef } from './asm-lab';
import { csvAppIds, parseClasses } from './common';
import { modernOutcome } from './fuzz';
import { transformFromParsed } from './transform';

const executeDescriptor = '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V';
const runnerDescriptor = '(Llegacy/model/LoanApplication;)Llegacy/model/Decision;';

export interface GetterRecord {
  readonly rule: string;
  readonly orderedGetters: readonly MemberRef[];
  readonly staticGetters: readonly MemberRef[];
  readonly staticOnly: readonly MemberRef[];
  readonly dynamicOnly: readonly MemberRef[];
}

export interface RecordedApplicant {
  readonly appId: string;
  readonly codes: readonly string[];
  readonly referrals: readonly string[];
  readonly legacyThrown: JavaThrownDetails | null;
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
    const dynamic = new Map<string, MemberRef>();
    let collecting = false;
    for (const appId of ids) {
      const jvm = new Jvm(classes, {
        onInvoke: (event) => {
          if (collecting && event.owner.startsWith('legacy/model/') && isGetter(event.name)) {
            const reference = { owner: event.owner, name: event.name, descriptor: event.descriptor };
            dynamic.set(memberRefKey(reference), reference);
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
    const staticGetters = uniqueMemberRefs(staticRefs.flatMap(({ refs }) =>
      refs.filter(({ owner, name }) => owner.startsWith('legacy/model/') && isGetter(name))
        .map(({ owner, name, descriptor }) => ({ owner, name, descriptor })),
    ));
    const orderedGetters = [...dynamic.values()];
    const dynamicKeys = new Set(dynamic.keys());
    const staticKeys = new Set(staticGetters.map(memberRefKey));
    const staticOnly = staticGetters.filter((value) => !dynamicKeys.has(memberRefKey(value)));
    const dynamicOnly = orderedGetters.filter((value) => !staticKeys.has(memberRefKey(value)));
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
  const captured = new Map<string, {
    readonly codes: readonly string[];
    readonly referrals: readonly string[];
    readonly thrown: JavaThrownDetails | null;
  }>();
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
        if (event.thrown !== undefined) {
          captured.set(resolvedId, { codes: [], referrals: [], thrown: event.thrown });
          return;
        }
        const decision = event.result;
        captured.set(resolvedId, {
          codes: readStringList(jvm, jvm.invokeMethod('legacy/model/Decision', 'getCodes', '()Ljava/util/List;', decision, [])),
          referrals: readStringList(jvm, jvm.invokeMethod('legacy/model/Decision', 'getReferrals', '()Ljava/util/List;', decision, [])),
          thrown: null,
        });
      },
    });
    const application = applicationFromCsv(jvm, courseRecordByAppId(courseData.csv, appId));
    try {
      jvm.invokeMethod('legacy/engine/RuleRunner', 'run', runnerDescriptor, null, [application]);
    } catch (error) {
      if (!(error instanceof JavaThrown) || !captured.has(appId)) throw error;
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
      legacyThrown: legacy.thrown,
      modernCodes: modern.codes,
      modernError: modern.error,
      agree: legacy.thrown !== null
        ? modern.error.replaceAll('.', '/') === legacy.thrown.cls
        : modern.error === '' && equalStrings(legacy.codes, modern.codes),
    };
  });
  const agreeCount = applicants.filter((applicant) => applicant.agree).length;
  return { applicants, agreeCount, disagreeCount: applicants.length - agreeCount };
}

function isGetter(name: string): boolean {
  return name.startsWith('get') || name.startsWith('is');
}

function appIds(): readonly string[] {
  return csvAppIds(courseData.csv).map(({ appId }) => appId);
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

function memberRefKey(reference: MemberRef): string {
  return `${reference.owner}.${reference.name}${reference.descriptor}`;
}

function uniqueMemberRefs(values: readonly MemberRef[]): MemberRef[] {
  const unique = new Map<string, MemberRef>();
  for (const value of values) unique.set(memberRefKey(value), value);
  return [...unique.values()];
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
