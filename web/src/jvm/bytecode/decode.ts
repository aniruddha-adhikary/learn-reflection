import type { ConstantPoolEntry } from '../classfile/types';

export type ResolvedConstant =
  | { readonly kind: 'integer' | 'float' | 'long' | 'double'; readonly value: number | bigint }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'class'; readonly name: string }
  | { readonly kind: 'fieldRef'; readonly owner: string; readonly name: string; readonly descriptor: string }
  | { readonly kind: 'methodRef'; readonly owner: string; readonly name: string; readonly descriptor: string; readonly isInterface: boolean }
  | { readonly kind: 'methodHandle'; readonly referenceKind: number; readonly reference: ResolvedConstant }
  | { readonly kind: 'methodType'; readonly descriptor: string }
  | { readonly kind: 'dynamic'; readonly name: string; readonly descriptor: string; readonly bootstrapMethodIndex: number; readonly invoke: boolean };

export type InstructionOperand =
  | { readonly kind: 'immediate'; readonly value: number }
  | { readonly kind: 'local'; readonly index: number }
  | { readonly kind: 'increment'; readonly index: number; readonly amount: number }
  | { readonly kind: 'branchTarget'; readonly target: number }
  | { readonly kind: 'constant'; readonly constant: ResolvedConstant }
  | { readonly kind: 'dimensions'; readonly count: number }
  | { readonly kind: 'invokeCount'; readonly count: number }
  | { readonly kind: 'wideOpcode'; readonly opcode: number; readonly mnemonic: string }
  | { readonly kind: 'switch'; readonly defaultTarget: number; readonly cases: readonly { readonly key: number; readonly target: number }[] };

export interface Instruction {
  readonly offset: number;
  readonly opcode: number;
  readonly mnemonic: string;
  readonly operands: readonly InstructionOperand[];
}

export class BytecodeDecodeError extends Error {
  public constructor(message: string, public readonly offset: number) {
    super(`${message} at bytecode offset ${offset}`);
    this.name = 'BytecodeDecodeError';
  }
}

export function decode(
  code: Uint8Array,
  constantPool: readonly (ConstantPoolEntry | null)[],
): Instruction[] {
  const reader = new CodeReader(code);
  const instructions: Instruction[] = [];
  while (!reader.done()) {
    const offset = reader.position;
    const opcode = reader.u1();
    const mnemonic = mnemonicFor(opcode, offset);
    const operands = decodeOperands(opcode, offset, reader, constantPool);
    instructions.push({ offset, opcode, mnemonic, operands });
  }
  const instructionOffsets = new Set(instructions.map(({ offset }) => offset));
  for (const instruction of instructions) {
    for (const operand of instruction.operands) {
      if (operand.kind === 'branchTarget' && !instructionOffsets.has(operand.target)) {
        throw new BytecodeDecodeError(
          `Branch target ${operand.target} is not an instruction boundary`,
          instruction.offset,
        );
      }
      if (operand.kind === 'switch') {
        const targets = [operand.defaultTarget, ...operand.cases.map(({ target }) => target)];
        for (const target of targets) {
          if (!instructionOffsets.has(target)) {
            throw new BytecodeDecodeError(
              `Switch target ${target} is not an instruction boundary`,
              instruction.offset,
            );
          }
        }
      }
    }
  }
  return instructions;
}

class CodeReader {
  public position = 0;

  public constructor(private readonly code: Uint8Array) {}

  public done(): boolean {
    return this.position === this.code.length;
  }

  public get remaining(): number {
    return this.code.length - this.position;
  }

  public u1(): number {
    this.ensure(1);
    const value = this.code[this.position];
    if (value === undefined) this.fail('Truncated instruction');
    this.position += 1;
    return value;
  }

  public s1(): number {
    return (this.u1() << 24) >> 24;
  }

  public u2(): number {
    return (this.u1() << 8) | this.u1();
  }

  public s2(): number {
    return (this.u2() << 16) >> 16;
  }

  public s4(): number {
    return (this.u1() << 24) | (this.u1() << 16) | (this.u1() << 8) | this.u1();
  }

  public fail(message: string, offset = this.position): never {
    throw new BytecodeDecodeError(message, offset);
  }

  private ensure(size: number): void {
    if (this.position + size > this.code.length) {
      this.fail(`Truncated instruction: need ${size} byte(s)`);
    }
  }
}

function decodeOperands(
  opcode: number,
  offset: number,
  reader: CodeReader,
  constantPool: readonly (ConstantPoolEntry | null)[],
): InstructionOperand[] {
  if (opcode >= 0x10 && opcode <= 0x11) {
    return [{ kind: 'immediate', value: opcode === 0x10 ? reader.s1() : reader.s2() }];
  }
  if (opcode === 0x12 || opcode === 0x13 || opcode === 0x14) {
    const index = opcode === 0x12 ? reader.u1() : reader.u2();
    return [{ kind: 'constant', constant: resolveConstant(index, constantPool, offset) }];
  }
  if (opcode >= 0x15 && opcode <= 0x19) {
    return [{ kind: 'local', index: reader.u1() }];
  }
  if (opcode >= 0x36 && opcode <= 0x3a) {
    return [{ kind: 'local', index: reader.u1() }];
  }
  if (opcode === 0x84) {
    return [{ kind: 'increment', index: reader.u1(), amount: reader.s1() }];
  }
  if (opcode >= 0x99 && opcode <= 0xa8) {
    return [{ kind: 'branchTarget', target: offset + reader.s2() }];
  }
  if (opcode === 0xa9) return [{ kind: 'local', index: reader.u1() }];
  if (opcode === 0xaa) return [readTableSwitch(reader, offset)];
  if (opcode === 0xab) return [readLookupSwitch(reader, offset)];
  if (opcode >= 0xb2 && opcode <= 0xb8) {
    return [{ kind: 'constant', constant: resolveConstant(reader.u2(), constantPool, offset) }];
  }
  if (opcode === 0xb9) {
    const constant = resolveConstant(reader.u2(), constantPool, offset);
    if (constant.kind !== 'methodRef' || !constant.isInterface) {
      reader.fail('invokeinterface requires an interface method reference', offset);
    }
    const count = reader.u1();
    if (reader.u1() !== 0) reader.fail('invokeinterface trailing byte must be zero', offset);
    return [{ kind: 'constant', constant }, { kind: 'invokeCount', count }];
  }
  if (opcode === 0xba) {
    const constant = resolveConstant(reader.u2(), constantPool, offset);
    if (constant.kind !== 'dynamic' || !constant.invoke) {
      reader.fail('invokedynamic requires an InvokeDynamic constant', offset);
    }
    if (reader.u2() !== 0) reader.fail('invokedynamic trailing bytes must be zero', offset);
    return [{ kind: 'constant', constant }];
  }
  if (opcode === 0xbb || opcode === 0xbd || opcode === 0xc0 || opcode === 0xc1) {
    return [{ kind: 'constant', constant: resolveConstant(reader.u2(), constantPool, offset) }];
  }
  if (opcode === 0xbc) {
    const atype = reader.u1();
    if (atype < 4 || atype > 11) reader.fail(`Invalid newarray atype ${atype}`, offset);
    return [{ kind: 'immediate', value: atype }];
  }
  if (opcode === 0xc4) return readWide(reader, offset);
  if (opcode === 0xc5) {
    const constant = resolveConstant(reader.u2(), constantPool, offset);
    const dimensions = reader.u1();
    if (constant.kind !== 'class') reader.fail('multianewarray requires a class constant', offset);
    if (dimensions === 0) reader.fail('multianewarray dimensions must be positive', offset);
    return [{ kind: 'constant', constant }, { kind: 'dimensions', count: dimensions }];
  }
  if (opcode === 0xc6 || opcode === 0xc7) {
    return [{ kind: 'branchTarget', target: offset + reader.s2() }];
  }
  if (opcode === 0xc8 || opcode === 0xc9) {
    return [{ kind: 'branchTarget', target: offset + reader.s4() }];
  }
  if (hasNoOperands(opcode)) return [];
  reader.fail(`Unknown or reserved opcode 0x${opcode.toString(16).padStart(2, '0')}`, offset);
}

function readTableSwitch(reader: CodeReader, offset: number): InstructionOperand {
  while (reader.position % 4 !== 0) {
    if (reader.u1() !== 0) reader.fail('tableswitch padding must be zero', offset);
  }
  const defaultTarget = offset + reader.s4();
  const low = reader.s4();
  const high = reader.s4();
  const count = high - low + 1;
  if (count < 0 || count > reader.remaining / 4) {
    reader.fail(`Invalid tableswitch range ${low}..${high}`, offset);
  }
  const cases = Array.from({ length: count }, (_, index) => ({
    key: low + index,
    target: offset + reader.s4(),
  }));
  return { kind: 'switch', defaultTarget, cases };
}

function readLookupSwitch(reader: CodeReader, offset: number): InstructionOperand {
  while (reader.position % 4 !== 0) {
    if (reader.u1() !== 0) reader.fail('lookupswitch padding must be zero', offset);
  }
  const defaultTarget = offset + reader.s4();
  const count = reader.s4();
  if (count < 0 || count > reader.remaining / 8) {
    reader.fail(`Invalid lookupswitch pair count ${count}`, offset);
  }
  const cases: { key: number; target: number }[] = [];
  let previous: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const key = reader.s4();
    if (previous !== null && key <= previous) {
      reader.fail('lookupswitch keys must be strictly increasing', offset);
    }
    cases.push({ key, target: offset + reader.s4() });
    previous = key;
  }
  return { kind: 'switch', defaultTarget, cases };
}

function readWide(reader: CodeReader, offset: number): InstructionOperand[] {
  const modifiedOpcode = reader.u1();
  if (
    (modifiedOpcode >= 0x15 && modifiedOpcode <= 0x19) ||
    (modifiedOpcode >= 0x36 && modifiedOpcode <= 0x3a) ||
    modifiedOpcode === 0xa9
  ) {
    return [
      { kind: 'wideOpcode', opcode: modifiedOpcode, mnemonic: mnemonicFor(modifiedOpcode, offset) },
      { kind: 'local', index: reader.u2() },
    ];
  }
  if (modifiedOpcode === 0x84) {
    return [
      { kind: 'wideOpcode', opcode: modifiedOpcode, mnemonic: 'iinc' },
      { kind: 'increment', index: reader.u2(), amount: reader.s2() },
    ];
  }
  reader.fail(`Invalid wide opcode 0x${modifiedOpcode.toString(16)}`, offset);
}

function resolveConstant(
  index: number,
  constantPool: readonly (ConstantPoolEntry | null)[],
  offset: number,
): ResolvedConstant {
  const entryAt = (poolIndex: number): ConstantPoolEntry => {
    const entry = constantPool[poolIndex];
    if (poolIndex <= 0 || entry === undefined || entry === null) {
      throw new BytecodeDecodeError(`Invalid constant-pool index ${poolIndex}`, offset);
    }
    return entry;
  };
  const utf8 = (poolIndex: number): string => {
    const value = entryAt(poolIndex);
    if (value.kind !== 'utf8') {
      throw new BytecodeDecodeError(`Expected UTF-8 constant at pool index ${poolIndex}`, offset);
    }
    return value.value;
  };
  const className = (poolIndex: number): string => {
    const value = entryAt(poolIndex);
    if (value.kind !== 'class') {
      throw new BytecodeDecodeError(`Expected class constant at pool index ${poolIndex}`, offset);
    }
    return utf8(value.nameIndex);
  };
  const nameAndType = (poolIndex: number): { name: string; descriptor: string } => {
    const value = entryAt(poolIndex);
    if (value.kind !== 'nameAndType') {
      throw new BytecodeDecodeError(`Expected name-and-type constant at pool index ${poolIndex}`, offset);
    }
    return { name: utf8(value.nameIndex), descriptor: utf8(value.descriptorIndex) };
  };
  const entry = entryAt(index);
  switch (entry.kind) {
    case 'integer':
    case 'float':
    case 'long':
    case 'double':
      return { kind: entry.kind, value: entry.value };
    case 'string':
      return { kind: 'string', value: utf8(entry.stringIndex) };
    case 'class':
      return { kind: 'class', name: utf8(entry.nameIndex) };
    case 'fieldRef': {
      const name = nameAndType(entry.nameAndTypeIndex);
      return { kind: 'fieldRef', owner: className(entry.classIndex), ...name };
    }
    case 'methodRef':
    case 'interfaceMethodRef': {
      const name = nameAndType(entry.nameAndTypeIndex);
      return {
        kind: 'methodRef',
        owner: className(entry.classIndex),
        ...name,
        isInterface: entry.kind === 'interfaceMethodRef',
      };
    }
    case 'methodHandle':
      return {
        kind: 'methodHandle',
        referenceKind: entry.referenceKind,
        reference: resolveConstant(entry.referenceIndex, constantPool, offset),
      };
    case 'methodType':
      return { kind: 'methodType', descriptor: utf8(entry.descriptorIndex) };
    case 'dynamic':
    case 'invokeDynamic': {
      const name = nameAndType(entry.nameAndTypeIndex);
      return {
        kind: 'dynamic',
        ...name,
        bootstrapMethodIndex: entry.bootstrapMethodIndex,
        invoke: entry.kind === 'invokeDynamic',
      };
    }
    default:
      throw new BytecodeDecodeError(
        `Constant-pool tag ${entry.tag} is not loadable or referenceable by this opcode`,
        offset,
      );
  }
}

function mnemonicFor(opcode: number, offset: number): string {
  const mnemonic = MNEMONICS[opcode];
  if (mnemonic === undefined) {
    throw new BytecodeDecodeError(
      `Unknown or reserved opcode 0x${opcode.toString(16).padStart(2, '0')}`,
      offset,
    );
  }
  return mnemonic;
}

function hasNoOperands(opcode: number): boolean {
  return (
    (opcode >= 0x00 && opcode <= 0x0f) ||
    (opcode >= 0x1a && opcode <= 0x35) ||
    (opcode >= 0x3b && opcode <= 0x83) ||
    (opcode >= 0x85 && opcode <= 0x98) ||
    (opcode >= 0xac && opcode <= 0xb1) ||
    opcode === 0xbe ||
    opcode === 0xbf ||
    (opcode >= 0xc2 && opcode <= 0xc3)
  );
}

const MNEMONICS: Readonly<Record<number, string>> = {
  0x00: 'nop', 0x01: 'aconst_null', 0x02: 'iconst_m1', 0x03: 'iconst_0', 0x04: 'iconst_1',
  0x05: 'iconst_2', 0x06: 'iconst_3', 0x07: 'iconst_4', 0x08: 'iconst_5', 0x09: 'lconst_0',
  0x0a: 'lconst_1', 0x0b: 'fconst_0', 0x0c: 'fconst_1', 0x0d: 'fconst_2', 0x0e: 'dconst_0',
  0x0f: 'dconst_1', 0x10: 'bipush', 0x11: 'sipush', 0x12: 'ldc', 0x13: 'ldc_w',
  0x14: 'ldc2_w', 0x15: 'iload', 0x16: 'lload', 0x17: 'fload', 0x18: 'dload', 0x19: 'aload',
  0x1a: 'iload_0', 0x1b: 'iload_1', 0x1c: 'iload_2', 0x1d: 'iload_3',
  0x1e: 'lload_0', 0x1f: 'lload_1', 0x20: 'lload_2', 0x21: 'lload_3',
  0x22: 'fload_0', 0x23: 'fload_1', 0x24: 'fload_2', 0x25: 'fload_3',
  0x26: 'dload_0', 0x27: 'dload_1', 0x28: 'dload_2', 0x29: 'dload_3',
  0x2a: 'aload_0', 0x2b: 'aload_1', 0x2c: 'aload_2', 0x2d: 'aload_3',
  0x2e: 'iaload', 0x2f: 'laload', 0x30: 'faload', 0x31: 'daload', 0x32: 'aaload',
  0x33: 'baload', 0x34: 'caload', 0x35: 'saload', 0x36: 'istore', 0x37: 'lstore',
  0x38: 'fstore', 0x39: 'dstore', 0x3a: 'astore', 0x3b: 'istore_0', 0x3c: 'istore_1',
  0x3d: 'istore_2', 0x3e: 'istore_3', 0x3f: 'lstore_0', 0x40: 'lstore_1', 0x41: 'lstore_2',
  0x42: 'lstore_3', 0x43: 'fstore_0', 0x44: 'fstore_1', 0x45: 'fstore_2', 0x46: 'fstore_3',
  0x47: 'dstore_0', 0x48: 'dstore_1', 0x49: 'dstore_2', 0x4a: 'dstore_3',
  0x4b: 'astore_0', 0x4c: 'astore_1', 0x4d: 'astore_2', 0x4e: 'astore_3',
  0x4f: 'iastore', 0x50: 'lastore', 0x51: 'fastore', 0x52: 'dastore', 0x53: 'aastore',
  0x54: 'bastore', 0x55: 'castore', 0x56: 'sastore', 0x57: 'pop', 0x58: 'pop2',
  0x59: 'dup', 0x5a: 'dup_x1', 0x5b: 'dup_x2', 0x5c: 'dup2', 0x5d: 'dup2_x1',
  0x5e: 'dup2_x2', 0x5f: 'swap', 0x60: 'iadd', 0x61: 'ladd', 0x62: 'fadd', 0x63: 'dadd',
  0x64: 'isub', 0x65: 'lsub', 0x66: 'fsub', 0x67: 'dsub', 0x68: 'imul', 0x69: 'lmul',
  0x6a: 'fmul', 0x6b: 'dmul', 0x6c: 'idiv', 0x6d: 'ldiv', 0x6e: 'fdiv', 0x6f: 'ddiv',
  0x70: 'irem', 0x71: 'lrem', 0x72: 'frem', 0x73: 'drem', 0x74: 'ineg', 0x75: 'lneg',
  0x76: 'fneg', 0x77: 'dneg', 0x78: 'ishl', 0x79: 'lshl', 0x7a: 'ishr', 0x7b: 'lshr',
  0x7c: 'iushr', 0x7d: 'lushr', 0x7e: 'iand', 0x7f: 'land', 0x80: 'ior', 0x81: 'lor',
  0x82: 'ixor', 0x83: 'lxor', 0x84: 'iinc', 0x85: 'i2l', 0x86: 'i2f', 0x87: 'i2d',
  0x88: 'l2i', 0x89: 'l2f', 0x8a: 'l2d', 0x8b: 'f2i', 0x8c: 'f2l', 0x8d: 'f2d',
  0x8e: 'd2i', 0x8f: 'd2l', 0x90: 'd2f', 0x91: 'i2b', 0x92: 'i2c', 0x93: 'i2s',
  0x94: 'lcmp', 0x95: 'fcmpl', 0x96: 'fcmpg', 0x97: 'dcmpl', 0x98: 'dcmpg',
  0x99: 'ifeq', 0x9a: 'ifne', 0x9b: 'iflt', 0x9c: 'ifge', 0x9d: 'ifgt', 0x9e: 'ifle',
  0x9f: 'if_icmpeq', 0xa0: 'if_icmpne', 0xa1: 'if_icmplt', 0xa2: 'if_icmpge',
  0xa3: 'if_icmpgt', 0xa4: 'if_icmple', 0xa5: 'if_acmpeq', 0xa6: 'if_acmpne',
  0xa7: 'goto', 0xa8: 'jsr', 0xa9: 'ret', 0xaa: 'tableswitch', 0xab: 'lookupswitch',
  0xac: 'ireturn', 0xad: 'lreturn', 0xae: 'freturn', 0xaf: 'dreturn', 0xb0: 'areturn',
  0xb1: 'return', 0xb2: 'getstatic', 0xb3: 'putstatic', 0xb4: 'getfield', 0xb5: 'putfield',
  0xb6: 'invokevirtual', 0xb7: 'invokespecial', 0xb8: 'invokestatic', 0xb9: 'invokeinterface',
  0xba: 'invokedynamic', 0xbb: 'new', 0xbc: 'newarray', 0xbd: 'anewarray', 0xbe: 'arraylength',
  0xbf: 'athrow', 0xc0: 'checkcast', 0xc1: 'instanceof', 0xc2: 'monitorenter',
  0xc3: 'monitorexit', 0xc4: 'wide', 0xc5: 'multianewarray', 0xc6: 'ifnull',
  0xc7: 'ifnonnull', 0xc8: 'goto_w', 0xc9: 'jsr_w',
};
