import type { ClassFile, ConstantPoolEntry } from './types';

export function writeClassFile(classFile: ClassFile): Uint8Array {
  const originalPool = classFile.raw.originalConstantPool;
  if (classFile.constantPool.length < originalPool.length) {
    throw new Error('Cannot write a class file after removing constant-pool entries');
  }
  for (let index = 0; index < originalPool.length; index += 1) {
    if (classFile.constantPool[index] !== originalPool[index]) {
      throw new Error(`Cannot rewrite original constant-pool entry ${index}`);
    }
  }
  if (classFile.constantPool.length > 0xffff) {
    throw new Error(`Constant pool is too large: ${classFile.constantPool.length}`);
  }

  const appended = new ByteWriter();
  for (let index = originalPool.length; index < classFile.constantPool.length; index += 1) {
    const entry = classFile.constantPool[index];
    if (entry) writeConstant(appended, entry);
  }
  const extraPoolBytes = appended.bytes();
  const original = classFile.raw.originalBytes;
  const output = new Uint8Array(original.length + extraPoolBytes.length);
  output.set(original.slice(0, classFile.raw.constantPoolEnd));
  output.set(extraPoolBytes, classFile.raw.constantPoolEnd);
  output.set(original.slice(classFile.raw.constantPoolEnd), classFile.raw.constantPoolEnd + extraPoolBytes.length);
  output[8] = (classFile.constantPool.length >>> 8) & 0xff;
  output[9] = classFile.constantPool.length & 0xff;

  for (const method of classFile.methods) {
    for (const attribute of method.attributes) {
      if (attribute.kind !== 'code') continue;
      const originalCode = original.slice(attribute.codeOffset, attribute.codeOffset + attribute.originalCodeLength);
      if (originalCode.length !== attribute.originalCodeLength || attribute.code.length !== attribute.originalCodeLength) {
        throw new Error(`Cannot change Code length for ${method.name}${method.descriptor}`);
      }
      output.set(attribute.code, attribute.codeOffset + extraPoolBytes.length);
    }
  }
  return output;
}

class ByteWriter {
  private readonly values: number[] = [];

  public u1(value: number): void {
    this.values.push(value & 0xff);
  }

  public u2(value: number): void {
    this.u1(value >>> 8);
    this.u1(value);
  }

  public u4(value: number): void {
    this.u1(value >>> 24);
    this.u1(value >>> 16);
    this.u1(value >>> 8);
    this.u1(value);
  }

  public u8(value: bigint): void {
    this.u4(Number((value >> 32n) & 0xffff_ffffn));
    this.u4(Number(value & 0xffff_ffffn));
  }

  public raw(bytes: Uint8Array): void {
    for (const byte of bytes) this.values.push(byte);
  }

  public bytes(): Uint8Array {
    return Uint8Array.from(this.values);
  }
}

function writeConstant(writer: ByteWriter, entry: ConstantPoolEntry): void {
  writer.u1(entry.tag);
  switch (entry.kind) {
    case 'utf8': {
      const bytes = modifiedUtf8(entry.value);
      writer.u2(bytes.length);
      writer.raw(bytes);
      return;
    }
    case 'integer':
      writer.u4(entry.value);
      return;
    case 'float': {
      const bytes = new ArrayBuffer(4);
      new DataView(bytes).setFloat32(0, entry.value);
      writer.raw(new Uint8Array(bytes));
      return;
    }
    case 'long':
      writer.u8(entry.value);
      return;
    case 'double': {
      const bytes = new ArrayBuffer(8);
      new DataView(bytes).setFloat64(0, entry.value);
      writer.raw(new Uint8Array(bytes));
      return;
    }
    case 'class':
    case 'module':
    case 'package':
      writer.u2(entry.nameIndex);
      return;
    case 'string':
      writer.u2(entry.stringIndex);
      return;
    case 'fieldRef':
    case 'methodRef':
    case 'interfaceMethodRef':
      writer.u2(entry.classIndex);
      writer.u2(entry.nameAndTypeIndex);
      return;
    case 'nameAndType':
      writer.u2(entry.nameIndex);
      writer.u2(entry.descriptorIndex);
      return;
    case 'methodHandle':
      writer.u1(entry.referenceKind);
      writer.u2(entry.referenceIndex);
      return;
    case 'methodType':
      writer.u2(entry.descriptorIndex);
      return;
    case 'dynamic':
    case 'invokeDynamic':
      writer.u2(entry.bootstrapMethodIndex);
      writer.u2(entry.nameAndTypeIndex);
      return;
    default:
      assertNever(entry);
  }
}

function modifiedUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit !== 0 && unit <= 0x7f) bytes.push(unit);
    else if (unit <= 0x7ff) bytes.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
    else bytes.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
  }
  return Uint8Array.from(bytes);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported constant-pool entry ${JSON.stringify(value)}`);
}
