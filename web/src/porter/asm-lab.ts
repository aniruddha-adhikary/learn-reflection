import { decode, Jvm, parseClassFile, type ClassFile, type Instruction, type JvmValue } from '../jvm';
import {
  NoMatchingPairError,
  StackEffectMismatchError,
  redirectPair,
  type RedirectPairSpec,
} from '../jvm/bytecode/rewrite';
import { courseData } from '../course-data';
import { applicationFromCsv, courseRecordByAppId } from './evidence';
import { csvAppIds, parseClasses, type ClassBytes } from './common';

const defaultSpec: RedirectPairSpec = {
  from: [
    { owner: 'legacy/model/LoanApplication', name: 'getApplicant', descriptor: '()Llegacy/model/Applicant;' },
    { owner: 'legacy/model/Applicant', name: 'getCredScr', descriptor: '()I' },
  ],
  to: {
    owner: 'lab/bridge/CreditScores',
    name: 'creditScore',
    descriptor: '(Llegacy/model/LoanApplication;)I',
  },
};
const executeDescriptor = '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V';

export type VisitEvent =
  | { readonly type: 'visit'; readonly version: number; readonly access: number; readonly name: string; readonly signature: string | null; readonly superName: string | null; readonly interfaces: readonly string[] }
  | { readonly type: 'visitSource'; readonly source: string }
  | { readonly type: 'visitField'; readonly access: number; readonly name: string; readonly descriptor: string; readonly signature: string | null }
  | { readonly type: 'visitMethod'; readonly access: number; readonly name: string; readonly descriptor: string; readonly signature: string | null; readonly exceptions: readonly string[] }
  | { readonly type: 'visitCode' }
  | { readonly type: InstructionEventName; readonly instruction: Instruction }
  | { readonly type: 'visitMaxs'; readonly maxStack: number; readonly maxLocals: number }
  | { readonly type: 'visitEnd' };

export interface MethodMemberRefs {
  readonly method: string;
  readonly refs: readonly MemberInstructionRef[];
}

export interface MemberRef {
  readonly owner: string;
  readonly name: string;
  readonly descriptor: string;
}

export interface MemberInstructionRef extends MemberRef {
  readonly opcode: string;
  readonly text: string;
}

export interface BridgeCall {
  readonly appId: string;
  readonly applicantId: string;
  readonly score: number;
}

export interface RewriteApplicantResult {
  readonly appId: string;
  readonly originalCodes: readonly string[];
  readonly rewrittenCodes: readonly string[];
  readonly agree: boolean;
  readonly bridgeCalls: readonly BridgeCall[];
}

export interface RewrittenRule {
  readonly rule: string;
  readonly patches: readonly { readonly method: string; readonly pc: number; readonly before: readonly string[]; readonly after: readonly string[] }[];
  readonly applicants: readonly RewriteApplicantResult[];
}

export interface RewriteLabResult {
  readonly rewritten: readonly RewrittenRule[];
  readonly untouched: readonly string[];
}

export function visitEvents(className: string, bytes?: ClassBytes): readonly VisitEvent[] {
  const classes = parseClasses(bytes);
  const classFile = requireClass(classes, className);
  const signature = classFile.attributes.find((attribute) => attribute.kind === 'signature');
  const source = classFile.attributes.find((attribute) => attribute.kind === 'sourceFile');
  const events: VisitEvent[] = [{
    type: 'visit',
    version: (classFile.minorVersion << 16) | classFile.majorVersion,
    access: classFile.accessFlags,
    name: classFile.thisClass,
    signature: signature?.kind === 'signature' ? signature.signature : null,
    superName: classFile.superClass,
    interfaces: classFile.interfaces,
  }];
  if (source?.kind === 'sourceFile') events.push({ type: 'visitSource', source: source.sourceFile });
  for (const field of classFile.fields) {
    const fieldSignature = field.attributes.find((attribute) => attribute.kind === 'signature');
    events.push({
      type: 'visitField',
      access: field.accessFlags,
      name: field.name,
      descriptor: field.descriptor,
      signature: fieldSignature?.kind === 'signature' ? fieldSignature.signature : null,
    });
  }
  for (const method of classFile.methods) {
    const methodSignature = method.attributes.find((attribute) => attribute.kind === 'signature');
    const exceptions = method.attributes.find((attribute) => attribute.kind === 'exceptions');
    events.push({
      type: 'visitMethod',
      access: method.accessFlags,
      name: method.name,
      descriptor: method.descriptor,
      signature: methodSignature?.kind === 'signature' ? methodSignature.signature : null,
      exceptions: exceptions?.kind === 'exceptions' ? exceptions.exceptions : [],
    });
    const code = method.attributes.find((attribute) => attribute.kind === 'code');
    if (code?.kind === 'code') {
      events.push({ type: 'visitCode' });
      for (const instruction of decode(code.code, classFile.constantPool)) {
        events.push({ type: eventName(instruction), instruction });
      }
      events.push({ type: 'visitMaxs', maxStack: code.maxStack, maxLocals: code.maxLocals });
    }
    events.push({ type: 'visitEnd' });
  }
  events.push({ type: 'visitEnd' });
  return events;
}

export function memberRefs(className: string, bytes?: ClassBytes): readonly MethodMemberRefs[] {
  const classes = parseClasses(bytes);
  const classFile = requireClass(classes, className);
  return classFile.methods.map((method) => {
    const code = method.attributes.find((attribute) => attribute.kind === 'code');
    if (code?.kind !== 'code') return { method: `${method.name}${method.descriptor}`, refs: [] };
    const refs = decode(code.code, classFile.constantPool).flatMap((instruction): MemberInstructionRef[] => {
      const constant = instruction.operands.find((operand) => operand.kind === 'constant');
      if (constant?.kind !== 'constant') return [];
      if (constant.constant.kind !== 'fieldRef' && constant.constant.kind !== 'methodRef') return [];
      const opcode = instruction.mnemonic.toUpperCase();
      const { owner, name, descriptor } = constant.constant;
      return [{
        opcode,
        owner,
        name,
        descriptor,
        text: `${opcode} ${owner}.${name} ${descriptor}`,
      }];
    });
    return { method: `${method.name}${method.descriptor}`, refs };
  });
}

export function rewriteLab(
  target: RedirectPairSpec = defaultSpec,
  bytes?: ClassBytes,
  data: typeof courseData = courseData,
): RewriteLabResult {
  const original = parseClasses(bytes);
  const rewritten: RewrittenRule[] = [];
  const untouched: string[] = [];
  const ruleNames = [...original.keys()]
    .filter((name) => name.startsWith('legacy/rules/') && !name.includes('$'))
    .sort();
  for (const className of ruleNames) {
    const classFile = required(original.get(className), `Missing class ${className}`);
    let result: ReturnType<typeof redirectPair>;
    try {
      result = redirectPair(classFile, target);
    } catch (error) {
      if (error instanceof NoMatchingPairError) {
        untouched.push(simpleName(className));
        continue;
      }
      throw error;
    }
    const parsedRewritten = parseClassFile(result.bytes);
    const modified = new Map(original);
    modified.set(className, parsedRewritten);
    const applicants: RewriteApplicantResult[] = [];
    for (const { appId } of csvAppIds(data.csv)) {
      const originalCodes = executeRule(original, className, appId, data);
      const bridgeCalls: BridgeCall[] = [];
      const rewrittenCodes = executeRule(modified, className, appId, data, (jvm) => {
        jvm.defineNative(target.to.owner, target.to.name, target.to.descriptor, (_receiver, args) => {
          const application = required(args[0], `Missing bridge application for ${appId}`);
          const appIdValue = jvm.invokeMethod(
            'legacy/model/LoanApplication',
            'getAppId',
            '()Ljava/lang/String;',
            application,
            [],
          );
          const resolvedAppId = stringValue(appIdValue);
          const event = data.events.find((candidate) => candidate.id === resolvedAppId);
          if (!event) throw new Error(`Missing course event for ${resolvedAppId}`);
          const score = data.bureauScores[event.applicant.applicantId];
          if (score === undefined) throw new Error(`Missing bureau score for ${event.applicant.applicantId}`);
          bridgeCalls.push({ appId: resolvedAppId, applicantId: event.applicant.applicantId, score });
          return score;
        });
      });
      applicants.push({
        appId,
        originalCodes,
        rewrittenCodes,
        agree: equalStrings(originalCodes, rewrittenCodes),
        bridgeCalls,
      });
    }
    rewritten.push({ rule: simpleName(className), patches: result.patches, applicants });
  }
  return { rewritten, untouched };
}

export function badTargetDescriptorMessage(): string {
  try {
    rewriteLab({
      ...defaultSpec,
      to: { ...defaultSpec.to, descriptor: '(Llegacy/model/LoanApplication;)J' },
    });
  } catch (error) {
    if (error instanceof StackEffectMismatchError) return error.message;
    throw error;
  }
  throw new Error('Expected long-returning bridge descriptor to be rejected');
}

export function defaultRewriteTarget(): RedirectPairSpec {
  return defaultSpec;
}

function executeRule(
  classes: ReadonlyMap<string, ClassFile>,
  className: string,
  appId: string,
  data: typeof courseData,
  configure?: (jvm: Jvm) => void,
): readonly string[] {
  const jvm = new Jvm(classes);
  configure?.(jvm);
  const application = applicationFromCsv(jvm, courseRecordByAppId(data.csv, appId));
  const rule = jvm.newObject(className);
  jvm.invokeMethod(className, '<init>', '()V', rule, []);
  const decision = jvm.newObject('legacy/model/Decision');
  jvm.invokeMethod('legacy/model/Decision', '<init>', '()V', decision, []);
  jvm.invokeMethod(className, 'execute', executeDescriptor, rule, [application, decision]);
  return readStringList(jvm, jvm.invokeMethod('legacy/model/Decision', 'getCodes', '()Ljava/util/List;', decision, []));
}

function eventName(instruction: Instruction): InstructionEventName {
  const opcode = instruction.opcode;
  if (opcode === 0xb4 || opcode === 0xb5 || opcode === 0xb2 || opcode === 0xb3) return 'visitFieldInsn';
  if (opcode >= 0xb6 && opcode <= 0xb9) return 'visitMethodInsn';
  if (opcode === 0x10 || opcode === 0x11 || opcode === 0xbc) return 'visitIntInsn';
  if (
    (opcode >= 0x15 && opcode <= 0x19) ||
    (opcode >= 0x1a && opcode <= 0x2d) ||
    (opcode >= 0x36 && opcode <= 0x3a) ||
    (opcode >= 0x3b && opcode <= 0x4e) ||
    opcode === 0xa9
  ) return 'visitVarInsn';
  if ((opcode >= 0x99 && opcode <= 0xa8) || opcode === 0xc6 || opcode === 0xc7 || opcode === 0xc8 || opcode === 0xc9) return 'visitJumpInsn';
  if (opcode === 0x12 || opcode === 0x13 || opcode === 0x14) return 'visitLdcInsn';
  if (opcode === 0xaa) return 'visitTableSwitchInsn';
  if (opcode === 0xab) return 'visitLookupSwitchInsn';
  if (opcode === 0x84) return 'visitIincInsn';
  if ([0xbb, 0xbd, 0xc0, 0xc1].includes(opcode)) return 'visitTypeInsn';
  if (opcode === 0xc5) return 'visitMultiANewArrayInsn';
  if (opcode === 0xba) return 'visitInvokeDynamicInsn';
  return 'visitInsn';
}

function requireClass(classes: ReadonlyMap<string, ClassFile>, name: string): ClassFile {
  return required(classes.get(name.replaceAll('.', '/')), `Unknown class ${name}`);
}

function simpleName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
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

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

type InstructionEventName =
  | 'visitFieldInsn'
  | 'visitMethodInsn'
  | 'visitIntInsn'
  | 'visitVarInsn'
  | 'visitJumpInsn'
  | 'visitLdcInsn'
  | 'visitTableSwitchInsn'
  | 'visitLookupSwitchInsn'
  | 'visitIincInsn'
  | 'visitTypeInsn'
  | 'visitMultiANewArrayInsn'
  | 'visitInvokeDynamicInsn'
  | 'visitInsn';
