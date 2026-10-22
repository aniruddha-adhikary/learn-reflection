import { decode, Jvm, type ClassFile, type Instruction, type JObject, type JvmValue, type StepEvent } from '../jvm';
import { courseData } from '../course-data';
import { parseClasses, type ClassBytes } from './common';
import { applicationFromCsv, courseRecordByAppId } from './evidence';
import { instructionOperand } from './instruction-format';

const executeDescriptor = '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V';

export interface RuleStep {
  readonly depth: number;
  readonly owner: string;
  readonly method: string;
  readonly offset: number;
  readonly mnemonic: string;
  readonly operand: string;
  readonly stack: readonly string[];
  readonly locals: readonly string[];
}

export interface RuleRun {
  readonly rule: string;
  readonly appId: string;
  readonly steps: readonly RuleStep[];
  readonly codes: readonly string[];
  readonly referrals: readonly string[];
}

export function ruleSteps(
  rule: string,
  appId: string,
  bytes?: ClassBytes,
  data: typeof courseData = courseData,
): RuleRun {
  const classes = parseClasses(bytes);
  const ruleClassName = `legacy/rules/${rule}`;
  const ruleClass = classes.get(ruleClassName);
  if (!ruleClass) throw new Error(`Unknown rule ${rule}`);

  const record = courseRecordByAppId(data.csv, appId);
  const events: StepEvent[] = [];
  let collecting = false;
  const jvm = new Jvm(classes, {
    onStep: (event) => {
      if (collecting) events.push(event);
    },
  });

  const application = applicationFromCsv(jvm, record);
  const ruleObject = construct(jvm, ruleClassName);
  const decision = construct(jvm, 'legacy/model/Decision');
  try {
    collecting = true;
    jvm.invokeMethod(ruleClassName, 'execute', executeDescriptor, ruleObject, [application, decision]);
  } catch (error) {
    throw new Error(`Rule ${rule} threw: ${errorMessage(error)}`);
  } finally {
    collecting = false;
  }

  const instructionsByMethod = new Map<string, ReadonlyMap<number, Instruction>>();
  const steps = events.map((event) => {
    const instruction = instructionAt(classes, instructionsByMethod, event);
    return {
      depth: event.depth,
      owner: event.className.replaceAll('/', '.'),
      method: event.methodName,
      offset: event.pc,
      mnemonic: instruction.mnemonic,
      operand: instructionOperand(instruction.operands),
      stack: event.stack.map(renderValue),
      locals: event.locals.map((value) => value === undefined ? '' : renderValue(value)),
    };
  });

  const codes = readStringList(
    jvm,
    jvm.invokeMethod('legacy/model/Decision', 'getCodes', '()Ljava/util/List;', decision, []),
  );
  const referrals = readStringList(
    jvm,
    jvm.invokeMethod('legacy/model/Decision', 'getReferrals', '()Ljava/util/List;', decision, []),
  );
  return { rule, appId, steps, codes, referrals };
}

function instructionAt(
  classes: ReadonlyMap<string, ClassFile>,
  instructionsByMethod: Map<string, ReadonlyMap<number, Instruction>>,
  event: StepEvent,
): Instruction {
  const key = `${event.className}.${event.methodName}${event.descriptor}`;
  let byOffset = instructionsByMethod.get(key);
  if (!byOffset) {
    const owner = classes.get(event.className);
    if (!owner) throw new Error(`Missing class ${event.className} for step at ${event.pc}`);
    const method = owner.methods.find(
      (candidate) => candidate.name === event.methodName && candidate.descriptor === event.descriptor,
    );
    if (!method) throw new Error(`Missing method ${key}`);
    const code = method.attributes.find((attribute) => attribute.kind === 'code');
    if (!code) throw new Error(`Missing Code attribute for ${key}`);
    byOffset = new Map(decode(code.code, owner.constantPool).map((instruction) => [instruction.offset, instruction]));
    instructionsByMethod.set(key, byOffset);
  }
  const instruction = byOffset.get(event.pc);
  if (!instruction) throw new Error(`No decoded instruction for ${key} at ${event.pc}`);
  return instruction;
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
    const item = jvm.invokeMethod('java/util/Iterator', 'next', '()Ljava/lang/Object;', iterator, []);
    result.push(item && typeof item === 'object' && item.kind === 'string' ? item.value : renderValue(item));
  }
  return result;
}

function renderValue(value: JvmValue): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return `${value}L`;
  if (value.kind === 'string') return JSON.stringify(value.value);
  if (value.kind === 'array') return `array[${value.values.length}]`;
  return simpleClassName(value.cls);
}

function simpleClassName(internalName: string): string {
  const name = internalName.slice(internalName.lastIndexOf('/') + 1);
  if (name.startsWith('ImmutableCollections$List')) return 'List';
  if (name.startsWith('ImmutableCollections$Set')) return 'Set';
  return name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
