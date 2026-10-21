import {
  decode,
  parseMethodDescriptor,
  type ClassFile,
  type Instruction,
  type MemberInfo,
} from '../jvm';
import { courseBindings } from '../course-data';
import type { ClassBytes, ParsedClasses } from './common';
import { methodOf, parseClasses } from './common';

type Expr = Readonly<Record<string, unknown>>;
type SymbolicValue =
  | { readonly kind: 'expr'; readonly expr: Expr }
  | { readonly kind: 'ref'; readonly name: string }
  | { readonly kind: 'set'; readonly members: readonly string[] };

interface BranchTrace {
  readonly offset: number;
  readonly target: number;
  readonly taken: boolean;
}

interface PathTrace {
  readonly rule: string;
  readonly emit: string;
  readonly instructionOffsets: readonly number[];
  readonly branches: readonly BranchTrace[];
}

interface Finding {
  readonly legacyRule: string;
  readonly kind: 'MISFIT';
  readonly reason: string;
}

interface Emission {
  readonly offset: number;
  readonly code: string;
  readonly conditions: readonly Expr[];
  readonly instructionOffsets: readonly number[];
  readonly branches: readonly BranchTrace[];
}

interface State {
  readonly pc: number;
  readonly stack: readonly SymbolicValue[];
  readonly locals: ReadonlyMap<number, SymbolicValue>;
  readonly conditions: readonly Expr[];
  readonly offsets: readonly number[];
  readonly branches: readonly BranchTrace[];
}

export interface RuleRecord {
  readonly ruleId: string;
  readonly legacyRule: string;
  readonly family: string;
  readonly emit: string;
  readonly when: Expr;
}

export interface TransformResult {
  readonly data: readonly RuleRecord[];
  readonly rules: readonly RuleRecord[];
  readonly findings: readonly Finding[];
  readonly trace: readonly PathTrace[];
}

export function transform(bytes?: ClassBytes): TransformResult {
  return transformFromParsed(parseClasses(bytes));
}

export function transformFromParsed(classes: ParsedClasses): TransformResult {
  const bindings = new Map(courseBindings.correct.bindings.map((binding) => [binding.legacy, binding]));
  const staticSets = new Map<string, readonly string[]>();
  const rules: RuleRecord[] = [];
  const findings: Finding[] = [];
  const traces: PathTrace[] = [];
  const ruleClasses = [...classes.keys()]
    .filter((name) => name.startsWith('legacy/rules/') && !name.includes('$'))
    .sort();

  for (const internalName of ruleClasses) {
    const owner = requireClass(classes, internalName);
    resolveStaticSets(owner, staticSets);
    const method = methodOf(owner, 'execute');
    const result = execute(owner, method, classes, bindings, staticSets);
    if (result.reason) {
      findings.push({ legacyRule: simpleName(internalName), kind: 'MISFIT', reason: result.reason });
      continue;
    }
    const emissions = [...result.emissions].sort((left, right) => left.offset - right.offset);
    for (const [index, emission] of emissions.entries()) {
      const condition = conjunction(emission.conditions);
      const ruleName = simpleName(internalName);
      const ruleId = emissions.length === 1 ? ruleName : `${ruleName}#${index + 1}`;
      rules.push({
        ruleId,
        legacyRule: ruleName,
        family: family(condition),
        emit: emission.code,
        when: condition,
      });
      traces.push({
        rule: ruleId,
        emit: emission.code,
        instructionOffsets: emission.instructionOffsets,
        branches: emission.branches,
      });
    }
  }
  return { data: rules, rules, findings, trace: traces };
}

function execute(
  owner: ClassFile,
  method: MemberInfo,
  classes: ParsedClasses,
  bindings: ReadonlyMap<string, (typeof courseBindings.correct.bindings)[number]>,
  staticSets: ReadonlyMap<string, readonly string[]>,
): { readonly emissions: readonly Emission[]; readonly reason: string | null } {
  const code = codeOf(method);
  if (!code) return { emissions: [], reason: 'execute method has no Code attribute' };
  const instructions = decode(code.code, owner.constantPool);
  const indexByOffset = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  const initialLocals = new Map<number, SymbolicValue>([
    [0, { kind: 'ref', name: 'rule' }],
    [1, { kind: 'ref', name: 'legacy.model.LoanApplication' }],
    [2, { kind: 'ref', name: 'legacy.model.Decision' }],
  ]);
  const pending: State[] = [
    { pc: 0, stack: [], locals: initialLocals, conditions: [], offsets: [], branches: [] },
  ];
  const emissions: Emission[] = [];
  let explored = 0;

  while (pending.length > 0) {
    const state = pending.shift();
    if (!state) continue;
    const stack = [...state.stack];
    const locals = new Map(state.locals);
    const conditions = [...state.conditions];
    const offsets = [...state.offsets];
    const branches = [...state.branches];

    for (let pc = state.pc; pc < instructions.length; pc += 1) {
      if (++explored > 10_000) return { emissions, reason: 'symbolic execution exceeded 10000 instruction states' };
      const instruction = instructions[pc];
      if (!instruction) continue;
      if (instruction.opcode < 0) continue;
      offsets.push(instruction.offset);
      const opcode = instruction.opcode;

      const local = localIndex(instruction);
      if (opcode >= 0x15 && opcode <= 0x19) {
        stack.push(locals.get(local) ?? { kind: 'ref', name: `uninitialized local ${local}` });
        continue;
      }
      if (opcode >= 0x1a && opcode <= 0x2d) {
        stack.push(locals.get(local) ?? { kind: 'ref', name: `uninitialized local ${local}` });
        continue;
      }
      if (opcode >= 0x36 && opcode <= 0x3a) {
        const value = pop(stack);
        if (!value) return { emissions, reason: `stack underflow at ${instruction.mnemonic}` };
        locals.set(local, value);
        continue;
      }
      if (opcode >= 0x3b && opcode <= 0x4e) {
        const value = pop(stack);
        if (!value) return { emissions, reason: `stack underflow at ${instruction.mnemonic}` };
        locals.set(local, value);
        continue;
      }
      if (opcode >= 0x02 && opcode <= 0x08) {
        stack.push(expression({ int: opcode - 0x03 }));
        continue;
      }
      if (opcode === 0x10 || opcode === 0x11) {
        const operand = instruction.operands.find((item) => item.kind === 'immediate');
        stack.push(expression({ int: operand?.kind === 'immediate' ? operand.value : 0 }));
        continue;
      }
      if (opcode >= 0x12 && opcode <= 0x14) {
        const operand = instruction.operands.find((item) => item.kind === 'constant');
        if (operand?.kind !== 'constant') return { emissions, reason: 'LDC instruction has no constant' };
        if (operand.constant.kind === 'integer') stack.push(expression({ int: operand.constant.value }));
        else if (operand.constant.kind === 'string') stack.push(expression({ str: operand.constant.value }));
        else return { emissions, reason: `unsupported LDC constant ${operand.constant.kind}` };
        continue;
      }
      if (opcode === 0x01) {
        stack.push(expression({ str: null }));
        continue;
      }
      if (opcode >= 0x60 && opcode <= 0x73 && [0x60, 0x64, 0x68, 0x6c].includes(opcode)) {
        const right = asExpression(pop(stack), instruction);
        const left = asExpression(pop(stack), instruction);
        const operator = new Map<number, string>([[0x60, '+'], [0x64, '-'], [0x68, '*'], [0x6c, '/']]).get(opcode);
        stack.push(expression({ arith: operator, l: left, r: right }));
        continue;
      }
      if (opcode === 0xb2 || opcode === 0xb4) {
        const reference = fieldReference(instruction);
        if (!reference) return { emissions, reason: 'unresolved field reference' };
        if (opcode === 0xb2) {
          const values = staticSets.get(`${reference.owner}#${reference.name}`);
          if (!values) return { emissions, reason: `unresolved static field ${reference.owner}#${reference.name}` };
          stack.push({ kind: 'set', members: values });
        } else {
          pop(stack);
          const key = `${reference.owner.replaceAll('/', '.')}#${reference.name}`;
          const binding = bindings.get(key);
          if (binding) {
            stack.push(binding.via ? { kind: 'ref', name: `binding:${binding.modern}` } : expression({ read: binding.modern }));
          } else if (reference.descriptor.startsWith('L')) {
            stack.push({ kind: 'ref', name: reference.descriptor.slice(1, -1).replaceAll('/', '.') });
          } else {
            return { emissions, reason: `unbound field read ${key}` };
          }
        }
        continue;
      }
      if (opcode === 0x60 || opcode === 0x64 || opcode === 0x68 || opcode === 0x6c) {
        const right = asExpression(pop(stack), instruction);
        const left = asExpression(pop(stack), instruction);
        stack.push(expression({ arith: opcode === 0x60 ? '+' : opcode === 0x64 ? '-' : opcode === 0x68 ? '*' : '/', l: left, r: right }));
        continue;
      }
      if (opcode >= 0xb6 && opcode <= 0xb9) {
        const call = methodReference(instruction);
        if (!call) return { emissions, reason: `unresolved call at ${instruction.offset}` };
        const descriptor = parseMethodDescriptor(call.descriptor);
        const args: SymbolicValue[] = [];
        for (let index = descriptor.parameters.length - 1; index >= 0; index -= 1) {
          const value = pop(stack);
          if (!value) return { emissions, reason: `stack underflow at ${instruction.mnemonic}` };
          args.unshift(value);
        }
        const receiverValue = opcode === 0xb8 ? null : pop(stack);
        if (opcode !== 0xb8 && !receiverValue) return { emissions, reason: `stack underflow at ${instruction.mnemonic}` };
        const receiver = receiverValue ?? null;
        const callResult = invokeSymbolic(call, receiver, args, classes, bindings);
        if (callResult.emission) {
          const codeValue = asExpression(args[0], instruction);
          const emit = stringConstant(codeValue);
          if (emit === null) return { emissions, reason: 'Decision.addCode argument is not a string constant' };
          emissions.push({
            offset: instruction.offset,
            code: emit,
            conditions,
            instructionOffsets: [...offsets],
            branches: [...branches],
          });
        } else if (callResult.reason) {
          return { emissions, reason: callResult.reason };
        } else if (callResult.value && descriptor.returnType.kind !== 'void') {
          stack.push(callResult.value);
        }
        continue;
      }
      if (opcode === 0xc0) continue;
      if (opcode === 0xa7 || opcode === 0xc8) {
        const target = branchTarget(instruction);
        const targetIndex = target === undefined ? undefined : indexByOffset.get(target);
        if (targetIndex === undefined) return { emissions, reason: `unresolved GOTO target at ${instruction.offset}` };
        if (targetIndex <= pc) return { emissions, reason: 'back-edge GOTO opcode indicates a loop' };
        pending.push({ pc: targetIndex, stack: [...stack], locals: new Map(locals), conditions, offsets, branches });
        break;
      }
      if (isConditionalBranch(opcode)) {
        const target = branchTarget(instruction);
        const targetIndex = target === undefined ? undefined : indexByOffset.get(target);
        if (target === undefined || targetIndex === undefined) {
          return { emissions, reason: `unresolved branch target at ${instruction.offset}` };
        }
        if (targetIndex <= pc) return { emissions, reason: `back-edge ${instruction.mnemonic.toUpperCase()} opcode indicates a loop` };
        const condition = branchExpression(opcode, stack, instruction);
        if (!condition) return { emissions, reason: `unsupported branch opcode ${instruction.mnemonic.toUpperCase()}` };
        const branchWhenTrue = opcode === 0x9a || opcode === 0xa0 || isIntegerCompare(opcode) || isReferenceCompare(opcode);
        const takenCondition = branchWhenTrue ? condition : negate(condition);
        const fallthroughCondition = branchWhenTrue ? negate(condition) : condition;
        const takenTrace = [...branches, { offset: instruction.offset, target, taken: true }];
        const fallthroughTrace = [...branches, { offset: instruction.offset, target, taken: false }];
        pending.push({
          pc: targetIndex,
          stack: [...stack],
          locals: new Map(locals),
          conditions: [...conditions, takenCondition],
          offsets: [...offsets],
          branches: takenTrace,
        });
        pending.push({
          pc: pc + 1,
          stack: [...stack],
          locals: new Map(locals),
          conditions: [...conditions, fallthroughCondition],
          offsets: [...offsets],
          branches: fallthroughTrace,
        });
        break;
      }
      if (opcode === 0xb1 || opcode === 0xac || opcode === 0xad || opcode === 0xae || opcode === 0xaf || opcode === 0xb0) break;
      if (opcode === 0x00) continue;
      return { emissions, reason: `unsupported instruction opcode ${instruction.mnemonic.toUpperCase()}` };
    }
  }
  return { emissions, reason: null };
}

function resolveStaticSets(owner: ClassFile, staticSets: Map<string, readonly string[]>): void {
  const initializer = owner.methods.find((method) => method.name === '<clinit>');
  if (!initializer) return;
  const code = codeOf(initializer);
  if (!code) return;
  const instructions = decode(code.code, owner.constantPool);
  const stack: SymbolicValue[] = [];
  for (const instruction of instructions) {
    const opcode = instruction.opcode;
    if (opcode >= 0x02 && opcode <= 0x08) stack.push(expression({ int: opcode - 0x03 }));
    else if (opcode === 0x10 || opcode === 0x11) {
      const immediate = instruction.operands.find((operand) => operand.kind === 'immediate');
      stack.push(expression({ int: immediate?.kind === 'immediate' ? immediate.value : 0 }));
    } else if (opcode >= 0x12 && opcode <= 0x14) {
      const constant = instruction.operands.find((operand) => operand.kind === 'constant');
      if (constant?.kind === 'constant' && constant.constant.kind === 'string') {
        stack.push(expression({ str: constant.constant.value }));
      }
    } else if (opcode >= 0xb8 && opcode <= 0xb8) {
      const call = methodReference(instruction);
      if (call?.owner === 'java/util/Set' && call.name === 'of') {
        const count = parseMethodDescriptor(call.descriptor).parameters.length;
        const members = stack.splice(Math.max(0, stack.length - count), count).map(stringValue).filter((value): value is string => value !== null);
        stack.push({ kind: 'set', members });
      }
    } else if (opcode === 0xb3) {
      const field = fieldReference(instruction);
      const value = pop(stack);
      if (field && value?.kind === 'set') staticSets.set(`${field.owner}#${field.name}`, value.members);
    } else if (opcode === 0x57) {
      pop(stack);
    }
  }
}

function invokeSymbolic(
  call: { readonly owner: string; readonly name: string; readonly descriptor: string },
  receiver: SymbolicValue | null,
  args: readonly SymbolicValue[],
  classes: ParsedClasses,
  bindings: ReadonlyMap<string, (typeof courseBindings.correct.bindings)[number]>,
): { readonly value?: SymbolicValue; readonly reason?: string; readonly emission?: true } {
  if (call.owner === 'legacy/model/Decision' && call.name === 'addCode') return { emission: true };
  if (call.owner.startsWith('legacy/model/') && (call.name.startsWith('get') || call.name.startsWith('is'))) {
    const value = inlineGetter(call.owner, call.name, call.descriptor, classes, bindings);
    const returnType = parseMethodDescriptor(call.descriptor).returnType;
    if (returnType.kind === 'primitive' && returnType.name === 'boolean' && value.kind === 'expr') {
      return { value: expression({ isTrue: value.expr }) };
    }
    return returnType.kind === 'void' ? {} : { value };
  }
  if (call.owner === 'java/lang/String' && call.name === 'equals') {
    const left = asExpression(args[0], { mnemonic: call.name, offset: 0, opcode: 0, operands: [] });
    let right = receiver ? asExpression(receiver, { mnemonic: call.name, offset: 0, opcode: 0, operands: [] }) : {};
    const employment = bindings.get('legacy.model.Applicant#empStat');
    const literal = stringConstant(right);
    const readMetric = left.read;
    if (literal !== null && readMetric === 'employment') {
      const mapped = employment?.values?.[literal];
      if (!mapped) return { reason: `unresolved employment value ${literal}` };
      right = { enum: mapped };
    }
    return { value: expression({ eq: [left, right] }) };
  }
  if (call.owner === 'java/util/Set' && call.name === 'contains') {
    if (receiver?.kind !== 'set') return { reason: 'Set.contains receiver has no resolved static Set.of values' };
    const value = asExpression(args[0], { mnemonic: call.name, offset: 0, opcode: 0, operands: [] });
    return { value: expression({ in: value, members: receiver.members }) };
  }
  if ((call.owner === 'java/util/List' || call.owner === 'java/util/Collection') && call.name === 'size') {
    if (receiver?.kind !== 'ref' || !receiver.name.startsWith('binding:')) {
      return { reason: 'Collection.size receiver is unresolved' };
    }
    return { value: expression({ read: receiver.name.slice('binding:'.length) }) };
  }
  return { reason: `unsupported call ${call.owner}.${call.name}${call.descriptor}` };
}

function inlineGetter(
  ownerName: string,
  name: string,
  descriptor: string,
  classes: ParsedClasses,
  bindings: ReadonlyMap<string, (typeof courseBindings.correct.bindings)[number]>,
): SymbolicValue {
  const owner = requireClass(classes, ownerName);
  const method = methodOf(owner, name, descriptor);
  const code = codeOf(method);
  if (!code) throw new Error(`Missing Code attribute for ${ownerName}.${name}`);
  const stack: SymbolicValue[] = [];
  const locals = new Map<number, SymbolicValue>([[0, { kind: 'ref', name: ownerName.replaceAll('/', '.') }]]);
  const instructions = decode(code.code, owner.constantPool);
  for (const instruction of instructions) {
    const opcode = instruction.opcode;
    const local = localIndex(instruction);
    if (opcode >= 0x15 && opcode <= 0x19 || opcode >= 0x1a && opcode <= 0x2d) {
      stack.push(locals.get(local) ?? { kind: 'ref', name: 'this' });
    } else if (opcode >= 0x02 && opcode <= 0x08) {
      stack.push(expression({ int: opcode - 0x03 }));
    } else if (opcode === 0x10 || opcode === 0x11) {
      const immediate = instruction.operands.find((operand) => operand.kind === 'immediate');
      stack.push(expression({ int: immediate?.kind === 'immediate' ? immediate.value : 0 }));
    } else if (opcode === 0xb4) {
      const field = fieldReference(instruction);
      pop(stack);
      if (!field) throw new Error(`Unresolved field in ${ownerName}.${name}`);
      const key = `${field.owner.replaceAll('/', '.')}#${field.name}`;
      const binding = bindings.get(key);
      if (binding) {
        stack.push(binding.via ? { kind: 'ref', name: `binding:${binding.modern}` } : expression({ read: binding.modern }));
      } else if (field.descriptor.startsWith('L')) {
        stack.push({ kind: 'ref', name: field.descriptor.slice(1, -1).replaceAll('/', '.') });
      } else {
        throw new Error(`Unbound field in getter: ${key}`);
      }
    } else if (opcode >= 0x12 && opcode <= 0x14) {
      const operand = instruction.operands.find((item) => item.kind === 'constant');
      if (operand?.kind !== 'constant' || operand.constant.kind !== 'string') {
        throw new Error(`Unsupported getter constant at ${instruction.offset}`);
      }
      stack.push(expression({ str: operand.constant.value }));
    } else if (opcode === 0x60 || opcode === 0x64 || opcode === 0x68 || opcode === 0x6c) {
      const right = asExpression(pop(stack), instruction);
      const left = asExpression(pop(stack), instruction);
      stack.push(expression({ arith: opcode === 0x60 ? '+' : opcode === 0x64 ? '-' : opcode === 0x68 ? '*' : '/', l: left, r: right }));
    } else if (opcode === 0xac || opcode === 0xb0) {
      const result = pop(stack);
      if (!result) throw new Error(`Empty getter result: ${ownerName}.${name}`);
      return result;
    } else if (opcode === 0xb1) {
      return { kind: 'ref', name: 'void' };
    } else if (opcode === 0x00) {
      continue;
    } else {
      throw new Error(`Unsupported getter instruction ${instruction.mnemonic.toUpperCase()} in ${ownerName}.${name}`);
    }
  }
  throw new Error(`Getter did not return: ${ownerName}.${name}`);
}

function branchExpression(opcode: number, stack: SymbolicValue[], instruction: Instruction): Expr | null {
  if (opcode >= 0x9f && opcode <= 0xa4) {
    const right = asExpression(pop(stack), instruction);
    const left = asExpression(pop(stack), instruction);
    const operators: Readonly<Record<number, string>> = {
      0x9f: '==',
      0xa0: '!=',
      0xa1: '<',
      0xa2: '>=',
      0xa3: '>',
      0xa4: '<=',
    };
    return { cmp: operators[opcode], l: left, r: right };
  }
  if (opcode >= 0x99 && opcode <= 0x9e) {
    const value = asExpression(pop(stack), instruction);
    if (opcode === 0x99 || opcode === 0x9a) {
      if (isBoolean(value)) return value;
      return { cmp: opcode === 0x99 ? '==' : '!=', l: value, r: { int: 0 } };
    }
    const operators: Readonly<Record<number, string>> = {
      0x9b: '<',
      0x9c: '>=',
      0x9d: '>',
      0x9e: '<=',
    };
    return { cmp: operators[opcode], l: value, r: { int: 0 } };
  }
  return null;
}

function negate(value: Expr): Expr {
  if ('isTrue' in value) return { isFalse: value.isTrue };
  if ('isFalse' in value) return { isTrue: value.isFalse };
  if ('cmp' in value) {
    const complements: Readonly<Record<string, string>> = {
      '<': '>=',
      '<=': '>',
      '>': '<=',
      '>=': '<',
      '==': '!=',
      '!=': '==',
    };
    return { cmp: complements[String(value.cmp)], l: value.l, r: value.r };
  }
  return { not: value };
}

function conjunction(values: readonly Expr[]): Expr {
  if (values.length === 1) return values[0] ?? {};
  return { and: values };
}

function family(value: Expr): string {
  if ('read' in value) return 'read';
  if ('int' in value) return 'int';
  if ('enum' in value) return 'enum';
  if ('str' in value) return 'str';
  if ('arith' in value) return 'arith';
  if ('cmp' in value) return `cmp(${family(value.l as Expr)},${family(value.r as Expr)})`;
  if ('eq' in value) {
    const pair = value.eq as readonly Expr[];
    return `eq(${family(pair[0] ?? {})},${family(pair[1] ?? {})})`;
  }
  if ('in' in value) return `in(${family(value.in as Expr)})`;
  if ('not' in value) return `not(${family(value.not as Expr)})`;
  if ('isFalse' in value) return `not(${family(value.isFalse as Expr)})`;
  if ('isTrue' in value) return family(value.isTrue as Expr);
  if ('and' in value) return `and(${(value.and as readonly Expr[]).map(family).join(',')})`;
  if ('or' in value) return `or(${(value.or as readonly Expr[]).map(family).join(',')})`;
  return 'unknown';
}

function isBoolean(value: Expr): boolean {
  return 'eq' in value || 'cmp' in value || 'in' in value || 'and' in value || 'or' in value || 'isTrue' in value || 'isFalse' in value || 'not' in value;
}

function isConditionalBranch(opcode: number): boolean {
  return (opcode >= 0x99 && opcode <= 0xa6) || opcode === 0xc6 || opcode === 0xc7;
}

function isIntegerCompare(opcode: number): boolean {
  return opcode >= 0x9f && opcode <= 0xa4;
}

function isReferenceCompare(opcode: number): boolean {
  return opcode === 0xa5 || opcode === 0xa6;
}

function localIndex(instruction: Instruction): number {
  const operand = instruction.operands.find((item) => item.kind === 'local');
  if (operand?.kind === 'local') return operand.index;
  const opcode = instruction.opcode;
  for (const [start, end, base] of [
    [0x1a, 0x1d, 0x1a],
    [0x1e, 0x21, 0x1e],
    [0x22, 0x25, 0x22],
    [0x26, 0x29, 0x26],
    [0x2a, 0x2d, 0x2a],
    [0x3b, 0x3e, 0x3b],
    [0x3f, 0x42, 0x3f],
    [0x43, 0x46, 0x43],
    [0x47, 0x4a, 0x47],
    [0x4b, 0x4e, 0x4b],
  ]) {
    if (start === undefined || end === undefined || base === undefined) continue;
    if (opcode >= start && opcode <= end) return opcode - base;
  }
  return -1;
}

function fieldReference(instruction: Instruction) {
  const operand = instruction.operands.find((item) => item.kind === 'constant');
  return operand?.kind === 'constant' && operand.constant.kind === 'fieldRef' ? operand.constant : null;
}

function methodReference(instruction: Instruction) {
  const operand = instruction.operands.find((item) => item.kind === 'constant');
  return operand?.kind === 'constant' && operand.constant.kind === 'methodRef' ? operand.constant : null;
}

function branchTarget(instruction: Instruction): number | undefined {
  const operand = instruction.operands.find((item) => item.kind === 'branchTarget');
  return operand?.kind === 'branchTarget' ? operand.target : undefined;
}

function expression(expr: Expr): SymbolicValue {
  return { kind: 'expr', expr };
}

function asExpression(value: SymbolicValue | undefined, instruction: Instruction): Expr {
  if (value?.kind !== 'expr') throw new Error(`Unsupported ${instruction.mnemonic.toUpperCase()} operand ${value?.kind ?? 'missing'}`);
  return value.expr;
}

function pop(stack: SymbolicValue[]): SymbolicValue | undefined {
  return stack.pop();
}

function stringValue(value: SymbolicValue): string | null {
  if (value.kind !== 'expr') return null;
  return stringConstant(value.expr);
}

function stringConstant(value: Expr): string | null {
  return typeof value.str === 'string' ? value.str : null;
}

function codeOf(method: MemberInfo) {
  return method.attributes.find((attribute) => attribute.kind === 'code');
}

function simpleName(internalName: string): string {
  return internalName.slice(internalName.lastIndexOf('/') + 1);
}

function requireClass(classes: ParsedClasses, internalName: string): ClassFile {
  const result = classes.get(internalName);
  if (!result) throw new Error(`Missing class ${internalName}`);
  return result;
}
