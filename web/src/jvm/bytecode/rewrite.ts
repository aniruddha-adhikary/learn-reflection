import { parseMethodDescriptor, type JavaType } from '../classfile/descriptor';
import { writeClassFile } from '../classfile/write';
import type { AttributeInfo, ClassFile, ConstantPoolEntry } from '../classfile/types';
import { decode, type Instruction } from './decode';

export interface MethodReference {
  readonly owner: string;
  readonly name: string;
  readonly descriptor: string;
}

export interface RedirectPairSpec {
  readonly from: readonly [MethodReference, MethodReference];
  readonly to: MethodReference;
}

export interface BytecodePatch {
  readonly method: string;
  readonly pc: number;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export interface RedirectPairResult {
  readonly bytes: Uint8Array;
  readonly patches: readonly BytecodePatch[];
}

export function redirectPair(classFile: ClassFile, spec: RedirectPairSpec): RedirectPairResult {
  const fromDescriptor = parseMethodDescriptor(spec.from[0].descriptor);
  const secondDescriptor = parseMethodDescriptor(spec.from[1].descriptor);
  const targetDescriptor = parseMethodDescriptor(spec.to.descriptor);
  const expectedParameters = [
    `L${spec.from[0].owner};`,
    ...fromDescriptor.parameters.map(descriptorOf),
  ];
  const expectedResult = descriptorOf(secondDescriptor.returnType);
  if (
    secondDescriptor.parameters.length !== 0 ||
    targetDescriptor.parameters.map(descriptorOf).join(',') !== expectedParameters.join(',') ||
    descriptorOf(targetDescriptor.returnType) !== expectedResult
  ) {
    throw new Error(
      `Stack-effect mismatch: target ${spec.to.descriptor} must consume (${expectedParameters.join('')}) and return ${expectedResult}`,
    );
  }
  if (fromDescriptor.returnType.kind !== 'object' || fromDescriptor.returnType.internalName !== spec.from[1].owner) {
    throw new Error(
      `Stack-effect mismatch: first method returns ${descriptorOf(fromDescriptor.returnType)}, but second receiver is ${spec.from[1].owner}`,
    );
  }

  const pool = new PoolAppender(classFile.constantPool);
  const targetIndex = pool.methodRef(spec.to);
  const patches: BytecodePatch[] = [];
  const methods = classFile.methods.map((method) => {
    const codeAttribute = method.attributes.find((attribute) => attribute.kind === 'code');
    if (!codeAttribute) return method;
    const instructions = decode(codeAttribute.code, classFile.constantPool);
    const code = codeAttribute.code.slice();
    let changed = false;
    for (let index = 0; index + 1 < instructions.length; index += 1) {
      const first = instructions[index];
      const second = instructions[index + 1];
      if (!first || !second || !matches(first, spec.from[0]) || !matches(second, spec.from[1])) continue;
      if (first.opcode !== 0xb6 || second.opcode !== 0xb6 || second.offset !== first.offset + 3) continue;
      rejectControlBoundary(codeAttribute, instructions, second.offset, method);
      code[first.offset] = 0xb8;
      code[first.offset + 1] = (targetIndex >>> 8) & 0xff;
      code[first.offset + 2] = targetIndex & 0xff;
      code[first.offset + 3] = 0;
      code[first.offset + 4] = 0;
      code[first.offset + 5] = 0;
      changed = true;
      patches.push({
        method: `${classFile.thisClass.replaceAll('/', '.')}.${method.name}${method.descriptor}`,
        pc: first.offset,
        before: [formatRef('INVOKEVIRTUAL', spec.from[0]), formatRef('INVOKEVIRTUAL', spec.from[1])],
        after: [formatRef('INVOKESTATIC', spec.to), 'NOP', 'NOP', 'NOP'],
      });
    }
    if (!changed) return method;
    return {
      ...method,
      attributes: method.attributes.map((attribute): AttributeInfo =>
        attribute.kind === 'code' ? { ...attribute, code } : attribute,
      ),
    };
  });
  if (patches.length === 0) throw new Error(`No matching invocation pair in ${classFile.thisClass}`);
  const updated: ClassFile = {
    ...classFile,
    constantPool: pool.entries,
    methods,
  };
  return { bytes: writeClassFile(updated), patches };
}

function matches(instruction: Instruction | undefined, reference: MethodReference): boolean {
  const constant = instruction?.operands.find((operand) => operand.kind === 'constant');
  return (
    constant?.kind === 'constant' &&
    constant.constant.kind === 'methodRef' &&
    constant.constant.owner === reference.owner &&
    constant.constant.name === reference.name &&
    constant.constant.descriptor === reference.descriptor
  );
}

function rejectControlBoundary(
  code: Extract<AttributeInfo, { kind: 'code' }>,
  instructions: readonly Instruction[],
  secondOffset: number,
  method: { readonly name: string; readonly descriptor: string },
): void {
  for (const instruction of instructions) {
    for (const operand of instruction.operands) {
      if (operand.kind === 'branchTarget' && operand.target === secondOffset) {
        throw new Error(`Cannot rewrite ${method.name}${method.descriptor}: branch targets second invocation at pc ${secondOffset}`);
      }
      if (operand.kind === 'switch') {
        const targets = [operand.defaultTarget, ...operand.cases.map((entry) => entry.target)];
        if (targets.includes(secondOffset)) {
          throw new Error(`Cannot rewrite ${method.name}${method.descriptor}: switch targets second invocation at pc ${secondOffset}`);
        }
      }
    }
  }
  for (const handler of code.exceptionTable) {
    if ([handler.startPc, handler.endPc, handler.handlerPc].includes(secondOffset)) {
      throw new Error(
        `Cannot rewrite ${method.name}${method.descriptor}: exception-handler boundary at second invocation pc ${secondOffset}`,
      );
    }
  }
}

function descriptorOf(type: JavaType | { readonly kind: 'void' }): string {
  if (type.kind === 'void') return 'V';
  if (type.kind === 'primitive') return type.descriptor;
  if (type.kind === 'object') return `L${type.internalName};`;
  return `[${descriptorOf(type.component)}`;
}

function formatRef(opcode: string, reference: MethodReference): string {
  return `${opcode} ${reference.owner}.${reference.name} ${reference.descriptor}`;
}

class PoolAppender {
  public readonly entries: (ConstantPoolEntry | null)[];
  private readonly lookups = new Map<string, number>();

  public constructor(original: readonly (ConstantPoolEntry | null)[]) {
    this.entries = [...original];
    for (let index = 1; index < original.length; index += 1) {
      const entry = original[index];
      if (entry) this.lookups.set(keyOf(entry, original), index);
    }
  }

  public methodRef(reference: MethodReference): number {
    const owner = this.intern(
      `class:${reference.owner}`,
      () => ({ tag: 7, kind: 'class', nameIndex: this.utf8(reference.owner) }),
    );
    const nameAndType = this.intern(
      `nameAndType:${reference.name}:${reference.descriptor}`,
      () => ({
        tag: 12,
        kind: 'nameAndType',
        nameIndex: this.utf8(reference.name),
        descriptorIndex: this.utf8(reference.descriptor),
      }),
    );
    return this.intern(`methodRef:${reference.owner}:${reference.name}:${reference.descriptor}`, () => ({
      tag: 10,
      kind: 'methodRef',
      classIndex: owner,
      nameAndTypeIndex: nameAndType,
    }));
  }

  private utf8(value: string): number {
    return this.intern(`utf8:${value}`, () => ({ tag: 1, kind: 'utf8', value }));
  }

  private intern(
    key: string,
    create: () => ConstantPoolEntry,
  ): number {
    const existing = this.lookups.get(key);
    if (existing !== undefined) return existing;
    const entry = create();
    const index = this.entries.length;
    if (index >= 0xffff) throw new Error('Cannot append constant: constant pool limit exceeded');
    this.entries.push(entry);
    if (entry.kind === 'long' || entry.kind === 'double') this.entries.push(null);
    this.lookups.set(key, index);
    return index;
  }
}

function keyOf(entry: ConstantPoolEntry, pool: readonly (ConstantPoolEntry | null)[]): string {
  const entryAt = (index: number): ConstantPoolEntry => {
    const value = pool[index];
    if (!value) throw new Error(`Invalid constant-pool reference ${index}`);
    return value;
  };
  const utf8 = (index: number): string => {
    const value = entryAt(index);
    if (value.kind !== 'utf8') throw new Error(`Expected UTF8 at constant-pool index ${index}`);
    return value.value;
  };
  if (entry.kind === 'utf8') return `utf8:${entry.value}`;
  if (entry.kind === 'class') return `class:${utf8(entry.nameIndex)}`;
  if (entry.kind === 'nameAndType') {
    return `nameAndType:${utf8(entry.nameIndex)}:${utf8(entry.descriptorIndex)}`;
  }
  if (entry.kind === 'methodRef') {
    const ownerEntry = entryAt(entry.classIndex);
    if (ownerEntry.kind !== 'class') throw new Error('Invalid method reference owner');
    const nat = entryAt(entry.nameAndTypeIndex);
    if (nat.kind !== 'nameAndType') throw new Error('Invalid method reference name and type');
    return `methodRef:${utf8(ownerEntry.nameIndex)}:${utf8(nat.nameIndex)}:${utf8(nat.descriptorIndex)}`;
  }
  return `pool:${entry.tag}:${JSON.stringify(entry)}`;
}
