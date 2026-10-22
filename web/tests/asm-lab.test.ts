import { describe, expect, it } from 'vitest';
import { courseData, courseGoldens, decodeCourseClasses } from '../src/course-data';
import {
  decode,
  Jvm,
  parseClassFile,
  writeClassFile,
  type AttributeInfo,
  type ClassFile,
  type JvmValue,
} from '../src/jvm';
import { redirectPair } from '../src/jvm/bytecode/rewrite';
import { applicationFromCsv, courseRecordByAppId } from '../src/porter/evidence';
import { getterRecorder, recordReplay } from '../src/porter/instrument-lab';
import { badTargetDescriptorMessage, defaultRewriteTarget, memberRefs, rewriteLab, visitEvents } from '../src/porter/asm-lab';
import { parseClasses } from '../src/porter/common';

interface AsmLabGolden {
  readonly memberRefs: readonly string[];
  readonly rewrittenCodes: readonly string[];
  readonly getterNames: readonly string[];
  readonly traffic: readonly string[];
}

const asmLabGolden = courseGoldens.asmLab as AsmLabGolden;

describe('browser ASM and instrumentation labs', () => {
  it('writes every course class byte-for-byte after parsing', () => {
    for (const [name, bytes] of decodeCourseClasses()) {
      expect(writeClassFile(parseClassFile(bytes)), name).toEqual(bytes);
    }
  });

  it('emits visitor-order class events and ordered member references', () => {
    const events = visitEvents('legacy/rules/R01_MinimumScore');
    expect(events[0]).toMatchObject({ type: 'visit', name: 'legacy/rules/R01_MinimumScore' });
    expect(events.at(-1)).toEqual({ type: 'visitEnd' });
    expect(events.some((event) => event.type === 'visitCode')).toBe(true);
    expect(events.some((event) => event.type === 'visitMethodInsn')).toBe(true);
    expect(events.some((event) => event.type === 'visitMaxs')).toBe(true);
    const refs = memberRefs('legacy/rules/R01_MinimumScore').flatMap((method) => method.refs);
    expect(refs).toEqual(asmLabGolden.memberRefs);
    expect(refs).toContain(
      'INVOKEVIRTUAL legacy/model/LoanApplication.getApplicant ()Llegacy/model/Applicant;',
    );
    expect(refs).toContain('INVOKEVIRTUAL legacy/model/Applicant.getCredScr ()I');
  });

  it('rewrites every matching rule and compares all course applicants', () => {
    const result = rewriteLab();
    expect(result.rewritten.map(({ rule }) => rule)).toEqual([
      'R01_MinimumScore',
      'R10_ScoreBand',
    ]);
    expect(result.untouched).toEqual([
      'R02_DebtToIncome',
      'R03_Unemployed',
      'R04_LargeLoanCosigner',
      'R05_RestrictedCountry',
      'R06_FastTrack',
      'R07_MaxTerm',
      'R08_SelfEmployedScore',
      'R09_RetiredTerm',
      'R11_NotifyCosigners',
    ]);
    for (const rule of result.rewritten) {
      expect(rule.patches.length).toBeGreaterThan(0);
      expect(rule.applicants).toHaveLength(12);
      expect(rule.applicants.every((applicant) => applicant.agree)).toBe(true);
      for (const applicant of rule.applicants) {
        for (const call of applicant.bridgeCalls) {
          const event = courseData.events.find(({ id }) => id === call.appId);
          expect(event).toBeDefined();
          expect(call.score).toBe(courseData.bureauScores[event?.applicant.applicantId ?? '']);
        }
      }
    }
    expect(result.rewritten.reduce(
      (total, rule) => total + rule.applicants.filter(({ agree }) => agree).length,
      0,
    )).toBe(24);
    expect(result.rewritten.map(({ rule, applicants }) => [
      rule,
      applicants.reduce((total, applicant) => total + applicant.bridgeCalls.length, 0),
    ])).toEqual([
      ['R01_MinimumScore', 12],
      ['R10_ScoreBand', 12],
    ]);
    const r01 = result.rewritten.find(({ rule }) => rule === 'R01_MinimumScore');
    const a1002 = r01?.applicants.find(({ appId }) => appId === 'A-1002');
    expect(a1002?.rewrittenCodes).toEqual(asmLabGolden.rewrittenCodes);
    expect(result.rewritten[0]?.applicants.every(({ bridgeCalls }) => bridgeCalls.length === 1)).toBe(true);
    expect(badTargetDescriptorMessage()).toBe(
      'Stack-effect mismatch: target (Llegacy/model/LoanApplication;)J must consume (Llegacy/model/LoanApplication;) and return I',
    );
  });

  it('rejects branch and exception-handler boundaries at the second invocation', () => {
    const classes = parseClasses();
    const original = classes.get('legacy/rules/R01_MinimumScore');
    if (!original) throw new Error('Missing R01 class');
    const target = defaultRewriteTarget();
    const method = original.methods.find((candidate) => candidate.name === 'execute');
    const code = method?.attributes.find((attribute) => attribute.kind === 'code');
    if (!method || code?.kind !== 'code') throw new Error('Missing R01 execute bytecode');
    const instructions = decode(code.code, original.constantPool);
    const pair = instructions.findIndex((instruction, index) =>
      instruction.opcode === 0xb6 &&
      instruction.operands.some((operand) => operand.kind === 'constant' &&
        operand.constant.kind === 'methodRef' && operand.constant.name === target.from[0].name) &&
      instructions[index + 1]?.opcode === 0xb6 &&
      instructions[index + 1]?.operands.some((operand) => operand.kind === 'constant' &&
        operand.constant.kind === 'methodRef' && operand.constant.name === target.from[1].name),
    );
    if (pair < 0) throw new Error('Missing target invocation pair');
    const first = instructions[pair];
    const second = instructions[pair + 1];
    if (!first || !second) throw new Error('Incomplete invocation pair');

    const branch = instructions.find((instruction) =>
      instruction.operands.some((operand) => operand.kind === 'branchTarget'),
    );
    if (!branch) throw new Error('Missing branch instruction');
    const branchCode = code.code.slice();
    const displacement = second.offset - branch.offset;
    branchCode[branch.offset + 1] = (displacement >>> 8) & 0xff;
    branchCode[branch.offset + 2] = displacement & 0xff;
    const withBranch = replaceMethodCode(original, method, { ...code, code: branchCode });
    expect(() => redirectPair(withBranch, target)).toThrow('branch targets second invocation');

    const withHandler = replaceMethodCode(original, method, {
      ...code,
      exceptionTable: [{
        startPc: second.offset,
        endPc: second.offset + 3,
        handlerPc: first.offset,
        catchType: null,
      }],
    });
    expect(() => redirectPair(withHandler, target)).toThrow('exception-handler boundary');
    expect(() => redirectPair(requiredClass(classes, 'legacy/model/Applicant'), target))
      .toThrow('No matching invocation pair in legacy/model/Applicant');
  });

  it('supports native-only invokestatic calls and reports invoke and return hooks', () => {
    const classes = parseClasses();
    const original = classes.get('legacy/rules/R01_MinimumScore');
    if (!original) throw new Error('Missing R01 class');
    const rewritten = redirectPair(original, defaultRewriteTarget());
    const patched = new Map(classes);
    patched.set('legacy/rules/R01_MinimumScore', parseClassFile(rewritten.bytes));
    const invokes: {
      owner: string;
      name: string;
      descriptor: string;
      args: readonly JvmValue[];
      depth: number;
    }[] = [];
    const returns: { owner: string; result?: JvmValue; thrown?: string }[] = [];
    const jvm = new Jvm(patched, {
      onInvoke: (event) => invokes.push(event),
      onReturn: (event) => returns.push(event),
    });
    jvm.defineNative('lab/bridge/CreditScores', 'creditScore', '(Llegacy/model/LoanApplication;)I', () => 575);
    const app = applicationFromCsv(jvm, courseRecordByAppId(courseData.csv, 'A-1002'));
    const rule = jvm.newObject('legacy/rules/R01_MinimumScore');
    jvm.invokeMethod('legacy/rules/R01_MinimumScore', '<init>', '()V', rule, []);
    const decision = jvm.newObject('legacy/model/Decision');
    jvm.invokeMethod('legacy/model/Decision', '<init>', '()V', decision, []);
    jvm.invokeMethod(
      'legacy/rules/R01_MinimumScore',
      'execute',
      '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V',
      rule,
      [app, decision],
    );
    const bridgeInvoke = invokes.find(({ owner, name }) => owner === 'lab/bridge/CreditScores' && name === 'creditScore');
    expect(bridgeInvoke).toMatchObject({
      descriptor: '(Llegacy/model/LoanApplication;)I',
    });
    expect(bridgeInvoke?.args).toHaveLength(1);
    expect(bridgeInvoke?.depth).toBeGreaterThan(0);
    expect(returns.some(({ owner, result }) => owner === 'lab/bridge/CreditScores' && result === 575)).toBe(true);

    jvm.defineNative('lab/native/Only', 'fail', '()V', () => {
      throw new Error('native failure');
    });
    expect(() => jvm.invokeMethod('lab/native/Only', 'fail', '()V', null, [])).toThrow('native failure');
    expect(returns).toContainEqual(expect.objectContaining({
      owner: 'lab/native/Only',
      thrown: 'native failure',
    }));
    expect(() => jvm.invokeMethod('lab/native/Missing', 'run', '()V', null, []))
      .toThrow('Class lab/native/Missing is not available in this JVM');
  });

  it('records actual getter and rule-runner outcomes per course applicant', () => {
    const getters = getterRecorder();
    const r01 = getters.find(({ rule }) => rule === 'R01_MinimumScore');
    expect(r01?.orderedGetters).toContain('legacy/model/Applicant.getCredScr()I');
    expect(r01?.orderedGetters
      .filter((getter) => getter.startsWith('legacy/model/Applicant.'))
      .map((getter) => /\.([^.(]+)\(/.exec(getter)?.[1])).toEqual(asmLabGolden.getterNames);
    expect(r01?.staticOnly).toEqual([]);
    expect(r01?.dynamicOnly).toEqual([]);
    expect(getters.map(({ rule, orderedGetters }) => [
      rule,
      orderedGetters.map((getter) => {
        const methodStart = getter.lastIndexOf('.') + 1;
        return getter.slice(methodStart, getter.indexOf('('));
      }),
    ])).toEqual([
      ['R01_MinimumScore', ['getApplicant', 'getCredScr']],
      ['R02_DebtToIncome', ['getApplicant', 'getDebt', 'getIncome']],
      ['R03_Unemployed', ['getApplicant', 'getEmpStat', 'isCollateral']],
      ['R04_LargeLoanCosigner', ['getAmount', 'getCoSigners']],
      ['R05_RestrictedCountry', ['getApplicant', 'getCountry']],
      ['R06_FastTrack', ['getApplicant', 'getCredScr', 'getAmount', 'getEmpStat']],
      ['R07_MaxTerm', ['getTermMonths']],
      ['R08_SelfEmployedScore', ['getApplicant', 'getEmpStat', 'getCredScr']],
      ['R09_RetiredTerm', ['getApplicant', 'getEmpStat', 'getTermMonths']],
      ['R10_ScoreBand', ['getApplicant', 'getCredScr']],
      ['R11_NotifyCosigners', ['getCoSigners', 'getReferrals']],
    ]);
    expect(getters.every(({ staticOnly, dynamicOnly }) =>
      staticOnly.length === 0 && dynamicOnly.length === 0)).toBe(true);

    const replay = recordReplay();
    expect(replay.applicants).toHaveLength(12);
    const traffic = replay.applicants.map(({ appId, codes, legacyError }) =>
      legacyError.length > 0
        ? `${appId} ERROR ${errorType(legacyError)}`
        : `${appId} [${codes.join(', ')}]`);
    expect(traffic).toEqual(asmLabGolden.traffic.map((line) =>
      line.includes(' ERROR ') ? line.slice(0, line.indexOf(':')) : line));
    expect(replay.agreeCount + replay.disagreeCount).toBe(12);
    expect(replay.agreeCount).toBe(10);
    expect(replay.disagreeCount).toBe(2);
    expect(replay.applicants.filter(({ agree }) => !agree).map(({ appId }) => appId)).toEqual(['A-1007', 'A-1009']);
  }, 60_000);
});

function errorType(error: string): string {
  const boundary = error.indexOf(':');
  const name = boundary < 0 ? error : error.slice(0, boundary);
  return name.slice(name.lastIndexOf('/') + 1);
}

function replaceMethodCode(
  original: ClassFile,
  method: ClassFile['methods'][number],
  replacement: Extract<AttributeInfo, { readonly kind: 'code' }>,
): ClassFile {
  return {
    ...original,
    methods: original.methods.map((candidate) => candidate === method
      ? { ...candidate, attributes: candidate.attributes.map((attribute) => attribute.kind === 'code' ? replacement : attribute) }
      : candidate),
  };
}

function requiredClass(classes: ReadonlyMap<string, ClassFile>, name: string): ClassFile {
  const value = classes.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
