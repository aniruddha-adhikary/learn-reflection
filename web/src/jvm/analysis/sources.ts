import { parseFieldDescriptor, parseMethodDescriptor } from '../classfile/descriptor';
import type { ClassFile, MemberInfo } from '../classfile/types';
import { decode, type Instruction, type ResolvedConstant } from '../bytecode/decode';

export type Source =
  | { readonly kind: 'insn'; readonly index: number }
  | { readonly kind: 'param'; readonly local: number }
  | { readonly kind: 'this' }
  | { readonly kind: 'uninitialized' }
  | { readonly kind: 'caughtException'; readonly handlerIndex: number };

export interface SourceValue {
  readonly size: 1 | 2;
  readonly sources: ReadonlySet<Source>;
}

export interface Frame {
  readonly locals: readonly SourceValue[];
  readonly stack: readonly SourceValue[];
}

export interface AnalyzeOptions {
  readonly stockAsmCopySemantics?: boolean;
}

export class UnsupportedAnalysisInstruction extends Error {
  public constructor(mnemonic: string, offset: number) {
    super(`Source analysis does not support ${mnemonic} at bytecode offset ${offset}`);
    this.name = 'UnsupportedAnalysisInstruction';
  }
}

export function analyzeSources(
  owner: ClassFile,
  method: MemberInfo,
  opts: AnalyzeOptions = {},
): (Frame | null)[] {
  const codeAttribute = method.attributes.find((attribute) => attribute.kind === 'code');
  if (!codeAttribute) {
    throw new Error(`Method ${method.name}${method.descriptor} has no Code attribute`);
  }
  const instructions = decode(codeAttribute.code, owner.constantPool);
  if (instructions.length === 0) return [];
  const offsetToIndex = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  const frames: (Frame | null)[] = Array.from({ length: instructions.length }, () => null);
  frames[0] = initialFrame(owner, method, codeAttribute.maxLocals);
  const pending = [0];

  while (pending.length > 0) {
    const index = pending.shift();
    if (index === undefined) continue;
    const instruction = instructions[index];
    if (!instruction) throw new Error(`Missing instruction at index ${index}`);
    const input = frames[index];
    if (!input) continue;
    const output = execute(index, instruction, input, opts.stockAsmCopySemantics === true);
    for (const successor of successors(index, instruction, instructions, offsetToIndex)) {
      mergeAt(successor, output, frames, pending);
    }
    for (let handlerIndex = 0; handlerIndex < codeAttribute.exceptionTable.length; handlerIndex += 1) {
      const handler = codeAttribute.exceptionTable[handlerIndex];
      if (!handler) continue;
      if (instruction.offset < handler.startPc || instruction.offset >= handler.endPc) continue;
      const target = offsetToIndex.get(handler.handlerPc);
      if (target === undefined) {
        throw new Error(`Exception handler target ${handler.handlerPc} is not an instruction`);
      }
      mergeAt(
        target,
        {
          locals: input.locals,
          stack: [value(1, { kind: 'caughtException', handlerIndex })],
        },
        frames,
        pending,
      );
    }
  }
  return frames;
}

export function producersOf(
  frames: readonly (Frame | null)[],
  insnIndex: number,
  stackDepthFromTop: number,
): ReadonlySet<Source> {
  const frame = frames[insnIndex];
  if (!frame) throw new RangeError(`Instruction ${insnIndex} is unreachable`);
  if (!Number.isInteger(stackDepthFromTop) || stackDepthFromTop < 0) {
    throw new RangeError(`Invalid stack depth ${stackDepthFromTop}`);
  }
  const index = frame.stack.length - 1 - stackDepthFromTop;
  const result = frame.stack[index];
  if (!result) throw new RangeError(`Stack depth ${stackDepthFromTop} is out of range`);
  return result.sources;
}

export function findCalls(
  instructions: readonly Instruction[],
  predicate: (call: { owner: string; name: string; descriptor: string }) => boolean,
): Instruction[] {
  return instructions.filter((instruction) => {
    if (!['invokevirtual', 'invokespecial', 'invokestatic', 'invokeinterface'].includes(instruction.mnemonic)) {
      return false;
    }
    const constant = instruction.operands.find((operand) => operand.kind === 'constant');
    if (constant?.constant.kind !== 'methodRef') {
      throw new Error(`Malformed ${instruction.mnemonic} at bytecode offset ${instruction.offset}`);
    }
    const { owner, name, descriptor } = constant.constant;
    return predicate({ owner, name, descriptor });
  });
}

function initialFrame(owner: ClassFile, method: MemberInfo, maxLocals: number): Frame {
  const locals = Array.from({ length: maxLocals }, () => value(1, { kind: 'uninitialized' }));
  let local = 0;
  if ((method.accessFlags & 0x0008) === 0) {
    if (local >= maxLocals) throw new Error('Method has no local slot for this');
    locals[local++] = value(1, { kind: 'this' });
  }
  for (const parameter of parseMethodDescriptor(method.descriptor).parameters) {
    if (local >= maxLocals) {
      throw new Error(`Method ${owner.thisClass}.${method.name} parameters exceed maxLocals`);
    }
    const size = typeSize(parameter);
    locals[local] = value(size, { kind: 'param', local });
    local += size;
  }
  return { locals, stack: [] };
}

function execute(
  index: number,
  instruction: Instruction,
  frame: Frame,
  stockCopies: boolean,
): Frame {
  const locals = [...frame.locals];
  const stack = [...frame.stack];
  const op = instruction.opcode;
  const src = (): Source => ({ kind: 'insn', index });
  const copy = (original: SourceValue): SourceValue =>
    stockCopies ? value(original.size, src()) : original;
  const pushProduced = (size: 1 | 2): void => {
    stack.push(value(size, src()));
  };
  const pop = (): SourceValue => {
    const result = stack.pop();
    if (!result) throw new Error(`Operand stack underflow at ${instruction.mnemonic} ${instruction.offset}`);
    return result;
  };
  const popMany = (count: number): SourceValue[] => {
    const result: SourceValue[] = [];
    for (let countIndex = 0; countIndex < count; countIndex += 1) result.push(pop());
    return result;
  };
  const localIndex = (): number => {
    const operand = instruction.operands.find((item) => item.kind === 'local');
    if (operand?.kind === 'local') return operand.index;
    const suffix = Number(instruction.mnemonic.at(-1));
    return Number.isNaN(suffix) ? -1 : suffix;
  };
  const load = (slot: number): void => {
    const source = locals[slot];
    if (!source) throw new Error(`Invalid local ${slot} at ${instruction.offset}`);
    stack.push(copy(source));
  };
  const store = (slot: number): void => {
    const original = pop();
    if (slot < 0 || slot >= locals.length) {
      throw new Error(`Invalid local ${slot} at ${instruction.offset}`);
    }
    const stored = copy(original);
    locals[slot] = stored;
    if (stored.size === 2 && slot + 1 < locals.length) locals[slot + 1] = stored;
  };

  if (op === 0x00) {
    return { locals, stack };
  }
  if (op === 0x01 || (op >= 0x02 && op <= 0x08) || (op >= 0x0b && op <= 0x0d)) {
    pushProduced(1);
  } else if (op === 0x09 || op === 0x0a || op === 0x0e || op === 0x0f) {
    pushProduced(2);
  } else if (op === 0x10 || op === 0x11) {
    pushProduced(1);
  } else if (op >= 0x12 && op <= 0x14) {
    const constant = constantOperand(instruction);
    pushProduced(
      constant.kind === 'long' || constant.kind === 'double'
        ? 2
        : constant.kind === 'dynamic'
          ? typeSize(parseFieldDescriptor(constant.descriptor))
          : 1,
    );
  } else if (op >= 0x15 && op <= 0x19) {
    load(localIndex());
  } else if (op >= 0x1a && op <= 0x2d) {
    const group = Math.floor((op - 0x1a) / 4);
    load((op - 0x1a) % 4);
    if (group > 4) throw new UnsupportedAnalysisInstruction(instruction.mnemonic, instruction.offset);
  } else if (op >= 0x2e && op <= 0x35) {
    popMany(2);
    pushProduced(op === 0x2f || op === 0x31 ? 2 : 1);
  } else if (op >= 0x36 && op <= 0x3a) {
    store(localIndex());
  } else if (op >= 0x3b && op <= 0x4e) {
    store((op - 0x3b) % 4);
  } else if (op >= 0x4f && op <= 0x56) {
    popMany(3);
  } else if (op >= 0x57 && op <= 0x5f) {
    executeStackOperation(op, stack, src, stockCopies);
  } else if (op >= 0x60 && op <= 0x73) {
    const typeIndex = (op - 0x60) % 4;
    popMany(2);
    pushProduced(typeIndex === 1 || typeIndex === 3 ? 2 : 1);
  } else if (op >= 0x74 && op <= 0x77) {
    const operand = pop();
    stack.push(value(operand.size, src()));
  } else if (op >= 0x78 && op <= 0x7d) {
    const operands = popMany(2);
    const operand = operands[1];
    if (!operand) throw new Error(`Missing shift operand at ${instruction.offset}`);
    stack.push(value(operand.size, src()));
  } else if (op >= 0x7e && op <= 0x83) {
    const typeIndex = (op - 0x7e) % 2;
    popMany(2);
    pushProduced(typeIndex === 1 ? 2 : 1);
  } else if (op === 0x84) {
    const slot = incrementOperand(instruction).index;
    if (slot < 0 || slot >= locals.length) throw new Error(`Invalid local ${slot}`);
    locals[slot] = value(1, src());
  } else if (op >= 0x85 && op <= 0x93) {
    pop();
    pushProduced(conversionSize(op));
  } else if (op >= 0x94 && op <= 0x98) {
    popMany(2);
    pushProduced(1);
  } else if (op >= 0x99 && op <= 0x9e) {
    pop();
  } else if (op >= 0x9f && op <= 0xa6) {
    popMany(2);
  } else if (op === 0xa7 || op === 0xc8) {
    // Unconditional branch.
  } else if (op === 0xa8 || op === 0xa9 || op === 0xc9) {
    throw new UnsupportedAnalysisInstruction(instruction.mnemonic, instruction.offset);
  } else if (op === 0xaa || op === 0xab) {
    pop();
  } else if (op >= 0xac && op <= 0xb0) {
    pop();
  } else if (op === 0xb1) {
    // Void return.
  } else if (op >= 0xb2 && op <= 0xb5) {
    executeFieldOperation(op, instruction, pop, pushProduced);
  } else if (op >= 0xb6 && op <= 0xba) {
    executeCall(op, instruction, pop, pushProduced);
  } else if (op === 0xbb) {
    pushProduced(1);
  } else if (op === 0xbc || op === 0xbd) {
    pop();
    pushProduced(1);
  } else if (op === 0xbe) {
    pop();
    pushProduced(1);
  } else if (op === 0xbf) {
    pop();
  } else if (op === 0xc0) {
    const original = pop();
    stack.push(value(original.size, src()));
  } else if (op === 0xc1) {
    pop();
    pushProduced(1);
  } else if (op === 0xc2 || op === 0xc3) {
    pop();
  } else if (op === 0xc4) {
    const wide = instruction.operands.find((operand) => operand.kind === 'wideOpcode');
    const mnemonic = wide?.kind === 'wideOpcode' ? wide.mnemonic : '';
    const slot = localIndex();
    if (mnemonic.endsWith('load')) load(slot);
    else if (mnemonic.endsWith('store')) store(slot);
    else if (mnemonic === 'ret') throw new UnsupportedAnalysisInstruction('wide ret', instruction.offset);
    else if (mnemonic === 'iinc') locals[incrementOperand(instruction).index] = value(1, src());
    else throw new UnsupportedAnalysisInstruction('wide', instruction.offset);
  } else if (op === 0xc5) {
    const dimensions = instruction.operands.find((operand) => operand.kind === 'dimensions');
    popMany(dimensions?.kind === 'dimensions' ? dimensions.count : 0);
    pushProduced(1);
  } else if (op === 0xc6 || op === 0xc7) {
    pop();
  } else {
    throw new UnsupportedAnalysisInstruction(instruction.mnemonic, instruction.offset);
  }
  return { locals, stack };
}

function executeStackOperation(
  opcode: number,
  stack: SourceValue[],
  source: () => Source,
  stockCopies: boolean,
): void {
  const pop = (): SourceValue => {
    const result = stack.pop();
    if (!result) throw new Error('Operand stack underflow in stack operation');
    return result;
  };
  const copy = (value_: SourceValue): SourceValue =>
    stockCopies ? value(value_.size, source()) : value_;
  const top = pop();
  if (opcode === 0x57) {
    if (top.size !== 1) throw new Error('pop requires a category-1 value');
    return;
  }
  if (opcode === 0x58) {
    if (top.size === 1 && pop().size !== 1) throw new Error('Invalid pop2 form');
    return;
  }
  if (opcode === 0x59) {
    if (top.size !== 1) throw new Error('dup requires a category-1 value');
    stack.push(copy(top), copy(top));
    return;
  }
  if (opcode === 0x5a) {
    const below = pop();
    if (top.size !== 1 || below.size !== 1) throw new Error('Invalid dup_x1 form');
    stack.push(copy(top), copy(below), copy(top));
    return;
  }
  if (opcode === 0x5b) {
    if (top.size !== 1) throw new Error('Invalid dup_x2 form');
    const below = pop();
    if (below.size === 2) stack.push(copy(top), copy(below), copy(top));
    else {
      const third = pop();
      if (third.size !== 1) throw new Error('Invalid dup_x2 form');
      stack.push(copy(top), copy(third), copy(below), copy(top));
    }
    return;
  }
  if (opcode === 0x5c) {
    if (top.size === 2) stack.push(copy(top), copy(top));
    else {
      const below = pop();
      if (below.size !== 1) throw new Error('Invalid dup2 form');
      stack.push(copy(below), copy(top), copy(below), copy(top));
    }
    return;
  }
  if (opcode === 0x5d) {
    if (top.size === 2) {
      const below = pop();
      if (below.size !== 1) throw new Error('Invalid dup2_x1 form');
      stack.push(copy(top), copy(below), copy(top));
    } else {
      const below = pop();
      const third = pop();
      if (below.size !== 1 || third.size !== 1) throw new Error('Invalid dup2_x1 form');
      stack.push(copy(below), copy(top), copy(third), copy(below), copy(top));
    }
    return;
  }
  if (opcode === 0x5e) {
    if (top.size === 2) {
      const below = pop();
      if (below.size === 2) stack.push(copy(top), copy(below), copy(top));
      else {
        const third = pop();
        if (third.size !== 1) throw new Error('Invalid dup2_x2 form');
        stack.push(copy(top), copy(third), copy(below), copy(top));
      }
    } else {
      const below = pop();
      if (below.size !== 1) throw new Error('Invalid dup2_x2 form');
      const third = pop();
      if (third.size === 2) {
        stack.push(copy(below), copy(top), copy(third), copy(below), copy(top));
      } else {
        const fourth = pop();
        if (fourth.size !== 1) throw new Error('Invalid dup2_x2 form');
        stack.push(copy(below), copy(top), copy(fourth), copy(third), copy(below), copy(top));
      }
    }
    return;
  }
  if (opcode === 0x5f) {
    const below = pop();
    if (top.size !== 1 || below.size !== 1) throw new Error('swap requires category-1 values');
    stack.push(copy(top), copy(below));
  }
}

function executeFieldOperation(
  opcode: number,
  instruction: Instruction,
  pop: () => SourceValue,
  pushProduced: (size: 1 | 2) => void,
): void {
  const field = constantOperand(instruction);
  if (field.kind !== 'fieldRef') throw new Error(`${instruction.mnemonic} requires a field reference`);
  const size = descriptorSize(field.descriptor);
  if (opcode === 0xb2) pushProduced(size);
  else if (opcode === 0xb3) pop();
  else if (opcode === 0xb4) {
    pop();
    pushProduced(size);
  } else {
    pop();
    pop();
  }
}

function executeCall(
  opcode: number,
  instruction: Instruction,
  pop: () => SourceValue,
  pushProduced: (size: 1 | 2) => void,
): void {
  const call = constantOperand(instruction);
  if (call.kind !== 'methodRef' && call.kind !== 'dynamic') {
    throw new Error(`${instruction.mnemonic} requires a method reference`);
  }
  const descriptor = parseMethodDescriptor(call.descriptor);
  for (let index = descriptor.parameters.length - 1; index >= 0; index -= 1) pop();
  if (opcode !== 0xb8 && opcode !== 0xba) pop();
  if (descriptor.returnType.kind !== 'void') {
    pushProduced(typeSize(descriptor.returnType));
  }
}

function successors(
  index: number,
  instruction: Instruction,
  instructions: readonly Instruction[],
  offsetToIndex: ReadonlyMap<number, number>,
): number[] {
  const op = instruction.opcode;
  if ((op >= 0xac && op <= 0xb1) || op === 0xbf || op === 0xa9 || op === 0xa8 || op === 0xc9) {
    return [];
  }
  const targets: number[] = [];
  const branch = instruction.operands.find((operand) => operand.kind === 'branchTarget');
  if (branch?.kind === 'branchTarget') {
    const target = offsetToIndex.get(branch.target);
    if (target === undefined) throw new Error(`Branch target ${branch.target} is not an instruction`);
    targets.push(target);
    if (op === 0xa7 || op === 0xc8) return targets;
  }
  const switchOperand = instruction.operands.find((operand) => operand.kind === 'switch');
  if (switchOperand?.kind === 'switch') {
    for (const offset of [
      switchOperand.defaultTarget,
      ...switchOperand.cases.map(({ target }) => target),
    ]) {
      const target = offsetToIndex.get(offset);
      if (target === undefined) throw new Error(`Switch target ${offset} is not an instruction`);
      if (!targets.includes(target)) targets.push(target);
    }
    return targets;
  }
  if (index + 1 < instructions.length) targets.push(index + 1);
  return [...new Set(targets)];
}

function mergeAt(
  index: number,
  incoming: Frame,
  frames: (Frame | null)[],
  pending: number[],
): void {
  const existing = frames[index];
  if (!existing) {
    frames[index] = cloneFrame(incoming);
    pending.push(index);
    return;
  }
  if (existing.locals.length !== incoming.locals.length || existing.stack.length !== incoming.stack.length) {
    throw new Error(`Incompatible frame dimensions at instruction ${index}`);
  }
  const locals = existing.locals.map((local, slot) => {
    const incomingLocal = incoming.locals[slot];
    if (!incomingLocal) throw new Error(`Missing local ${slot} at instruction ${index}`);
    return mergeValue(local, incomingLocal, index);
  });
  const stack = existing.stack.map((value_, slot) => {
    const incomingValue = incoming.stack[slot];
    if (!incomingValue) throw new Error(`Missing stack value ${slot} at instruction ${index}`);
    return mergeValue(value_, incomingValue, index);
  });
  const mergedFrame = { locals, stack };
  if (!sameFrame(existing, mergedFrame)) {
    frames[index] = mergedFrame;
    pending.push(index);
  }
}

function sameFrame(left: Frame, right: Frame): boolean {
  return (
    left.locals.length === right.locals.length &&
    left.stack.length === right.stack.length &&
    left.locals.every((value_, index) => {
      const other = right.locals[index];
      return other !== undefined && sameValue(value_, other);
    }) &&
    left.stack.every((value_, index) => {
      const other = right.stack[index];
      return other !== undefined && sameValue(value_, other);
    })
  );
}

function mergeValue(left: SourceValue, right: SourceValue, index: number): SourceValue {
  if (left.size !== right.size) throw new Error(`Incompatible value sizes at instruction ${index}`);
  const sources = new Set(left.sources);
  for (const source of right.sources) {
    if (![...sources].some((existing) => sourceEqual(existing, source))) sources.add(source);
  }
  return { size: left.size, sources };
}

function sameValue(left: SourceValue, right: SourceValue): boolean {
  if (left.size !== right.size || left.sources.size !== right.sources.size) return false;
  for (const source of left.sources) {
    if (![...right.sources].some((candidate) => sourceEqual(source, candidate))) return false;
  }
  return true;
}

function sourceEqual(left: Source, right: Source): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'insn':
      return right.kind === 'insn' && left.index === right.index;
    case 'param':
      return right.kind === 'param' && left.local === right.local;
    case 'caughtException':
      return right.kind === 'caughtException' && left.handlerIndex === right.handlerIndex;
    case 'this':
    case 'uninitialized':
      return true;
    default:
      return false;
  }
}

function cloneFrame(frame: Frame): Frame {
  return {
    locals: frame.locals.map((value_) => ({ size: value_.size, sources: new Set(value_.sources) })),
    stack: frame.stack.map((value_) => ({ size: value_.size, sources: new Set(value_.sources) })),
  };
}

function value(size: 1 | 2, source: Source): SourceValue {
  return { size, sources: new Set([source]) };
}

function typeSize(type: { readonly kind: string; readonly name?: string }): 1 | 2 {
  return type.kind === 'primitive' && (type.name === 'long' || type.name === 'double') ? 2 : 1;
}

function descriptorSize(descriptor: string): 1 | 2 {
  return descriptor === 'J' || descriptor === 'D' ? 2 : 1;
}

function conversionSize(opcode: number): 1 | 2 {
  if ([0x85, 0x87, 0x8c, 0x8f].includes(opcode)) return 2;
  return 1;
}

function constantOperand(instruction: Instruction): ResolvedConstant {
  const operand = instruction.operands.find((item) => item.kind === 'constant');
  if (operand?.kind !== 'constant') {
    throw new Error(`${instruction.mnemonic} is missing its constant operand`);
  }
  return operand.constant;
}

function incrementOperand(instruction: Instruction): Extract<Instruction['operands'][number], { kind: 'increment' }> {
  const operand = instruction.operands.find((item) => item.kind === 'increment');
  if (operand?.kind !== 'increment') throw new Error('Missing iinc operand');
  return operand;
}
