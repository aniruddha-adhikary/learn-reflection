import { ClassFormatError } from './errors';
import { Reader } from './reader';
import type {
  Annotation,
  AttributeInfo,
  ClassFile,
  ConstantPoolEntry,
  ElementValue,
  MemberInfo,
} from './types';

export function parseClassFile(bytes: Uint8Array): ClassFile {
  const reader = new Reader(bytes);
  if (reader.u4() !== 0xcafebabe) {
    throw new ClassFormatError('Invalid class-file magic', 0);
  }
  const minorVersion = reader.u2();
  const majorVersion = reader.u2();
  const constantPool = readConstantPool(reader);
  const constantPoolEnd = reader.offset;
  const cp = createPoolAccess(constantPool, reader);

  const accessFlags = reader.u2();
  const thisClass = cp.className(reader.u2());
  const superIndex = reader.u2();
  const superClass = superIndex === 0 ? null : cp.className(superIndex);
  const interfaces = readArray(reader, () => cp.className(reader.u2()));
  const fields = readArray(reader, () => readMember(reader, cp));
  const methods = readArray(reader, () => readMember(reader, cp));
  const attributes = readAttributes(reader, cp);
  reader.expectEnd('Class file');

  return {
    minorVersion,
    majorVersion,
    constantPool,
    raw: {
      originalBytes: bytes.slice(),
      constantPoolEnd,
      originalConstantPool: constantPool,
    },
    accessFlags,
    thisClass,
    superClass,
    interfaces,
    fields,
    methods,
    attributes,
  };
}

function readConstantPool(reader: Reader): (ConstantPoolEntry | null)[] {
  const count = reader.u2();
  if (count === 0) {
    reader.fail('Constant-pool count must be nonzero');
  }
  const entries: (ConstantPoolEntry | null)[] = [null];
  for (let index = 1; index < count; index += 1) {
    const tagOffset = reader.offset;
    const tag = reader.u1();
    switch (tag) {
      case 1: {
        const length = reader.u2();
        entries.push({ tag, kind: 'utf8', value: decodeModifiedUtf8(reader.take(length), tagOffset) });
        break;
      }
      case 3:
        entries.push({ tag, kind: 'integer', value: reader.s4() });
        break;
      case 4: {
        const raw = reader.u4();
        const view = new DataView(new ArrayBuffer(4));
        view.setUint32(0, raw);
        entries.push({ tag, kind: 'float', value: view.getFloat32(0) });
        break;
      }
      case 5:
        entries.push({ tag, kind: 'long', value: BigInt.asIntN(64, reader.u8()) });
        entries.push(null);
        index += 1;
        break;
      case 6: {
        const view = new DataView(new ArrayBuffer(8));
        view.setBigUint64(0, reader.u8());
        entries.push({ tag, kind: 'double', value: view.getFloat64(0) });
        entries.push(null);
        index += 1;
        break;
      }
      case 7:
        entries.push({ tag, kind: 'class', nameIndex: reader.u2() });
        break;
      case 8:
        entries.push({ tag, kind: 'string', stringIndex: reader.u2() });
        break;
      case 9:
      case 10:
      case 11:
        entries.push({
          tag,
          kind: tag === 9 ? 'fieldRef' : tag === 10 ? 'methodRef' : 'interfaceMethodRef',
          classIndex: reader.u2(),
          nameAndTypeIndex: reader.u2(),
        });
        break;
      case 12:
        entries.push({
          tag,
          kind: 'nameAndType',
          nameIndex: reader.u2(),
          descriptorIndex: reader.u2(),
        });
        break;
      case 15:
        entries.push({
          tag,
          kind: 'methodHandle',
          referenceKind: reader.u1(),
          referenceIndex: reader.u2(),
        });
        break;
      case 16:
        entries.push({ tag, kind: 'methodType', descriptorIndex: reader.u2() });
        break;
      case 17:
      case 18:
        entries.push({
          tag,
          kind: tag === 17 ? 'dynamic' : 'invokeDynamic',
          bootstrapMethodIndex: reader.u2(),
          nameAndTypeIndex: reader.u2(),
        });
        break;
      case 19:
      case 20:
        entries.push({
          tag,
          kind: tag === 19 ? 'module' : 'package',
          nameIndex: reader.u2(),
        });
        break;
      default:
        throw new ClassFormatError(`Unknown constant-pool tag ${tag}`, tagOffset);
    }
  }
  if (entries.length !== count) {
    reader.fail('Long or double constant occupies a missing constant-pool slot');
  }
  return entries;
}

interface PoolAccess {
  utf8(index: number): string;
  className(index: number): string;
  optionalClassName(index: number): string | null;
  entry(index: number): ConstantPoolEntry;
}

function createPoolAccess(
  constantPool: readonly (ConstantPoolEntry | null)[],
  reader: Reader,
): PoolAccess {
  const entry = (index: number): ConstantPoolEntry => {
    if (!Number.isInteger(index) || index <= 0) {
      throw new ClassFormatError(`Invalid constant-pool index ${index}`, reader.offset);
    }
    const value = constantPool[index];
    if (value === undefined || value === null) {
      throw new ClassFormatError(`Invalid constant-pool index ${index}`, reader.offset);
    }
    return value;
  };
  const expect = <T extends ConstantPoolEntry['kind']>(
    index: number,
    kind: T,
  ): Extract<ConstantPoolEntry, { kind: T }> => {
    const value = entry(index);
    if (value.kind !== kind) {
      throw new ClassFormatError(
        `Constant-pool index ${index} has tag ${value.tag}; expected ${kind}`,
        reader.offset,
      );
    }
    return value as Extract<ConstantPoolEntry, { kind: T }>;
  };
  const utf8 = (index: number): string => expect(index, 'utf8').value;
  const className = (index: number): string =>
    utf8(expect(index, 'class').nameIndex);

  for (let index = 1; index < constantPool.length; index += 1) {
    const value = constantPool[index];
    if (!value) continue;
    switch (value.kind) {
      case 'class':
      case 'module':
      case 'package':
        utf8(value.nameIndex);
        break;
      case 'string':
        utf8(value.stringIndex);
        break;
      case 'fieldRef':
      case 'methodRef':
      case 'interfaceMethodRef':
        className(value.classIndex);
        expect(value.nameAndTypeIndex, 'nameAndType');
        break;
      case 'nameAndType':
        utf8(value.nameIndex);
        utf8(value.descriptorIndex);
        break;
      case 'methodType':
        utf8(value.descriptorIndex);
        break;
      case 'methodHandle': {
        if (value.referenceKind < 1 || value.referenceKind > 9) {
          throw new ClassFormatError(`Invalid method-handle kind ${value.referenceKind}`, reader.offset);
        }
        const target = entry(value.referenceIndex);
        const validTags: readonly number[] =
          value.referenceKind <= 4
            ? [9]
            : value.referenceKind === 9
              ? [11]
              : value.referenceKind === 6 || value.referenceKind === 7
                ? [10, 11]
                : [10];
        if (!validTags.includes(target.tag)) {
          throw new ClassFormatError(
            `Method-handle kind ${value.referenceKind} cannot reference constant-pool tag ${target.tag}`,
            reader.offset,
          );
        }
        break;
      }
      case 'dynamic':
      case 'invokeDynamic':
        expect(value.nameAndTypeIndex, 'nameAndType');
        break;
      case 'utf8':
      case 'integer':
      case 'float':
      case 'long':
      case 'double':
        break;
      default:
        assertNever(value);
    }
  }

  return {
    utf8,
    className,
    optionalClassName: (index) => (index === 0 ? null : className(index)),
    entry,
  };
}

function readMember(reader: Reader, cp: PoolAccess): MemberInfo {
  return {
    accessFlags: reader.u2(),
    name: cp.utf8(reader.u2()),
    descriptor: cp.utf8(reader.u2()),
    attributes: readAttributes(reader, cp),
  };
}

function readAttributes(reader: Reader, cp: PoolAccess): AttributeInfo[] {
  return readArray(reader, () => {
    const name = cp.utf8(reader.u2());
    const body = reader.subReader(reader.u4());
    const attribute = readAttribute(name, body, cp);
    body.expectEnd(`Attribute ${name}`);
    return attribute;
  });
}

function readAttribute(name: string, reader: Reader, cp: PoolAccess): AttributeInfo {
  switch (name) {
    case 'Code': {
      const maxStack = reader.u2();
      const maxLocals = reader.u2();
      const codeLength = reader.u4();
      const codeOffset = reader.offset;
      const code = reader.take(codeLength);
      const exceptionTable = readArray(reader, () => ({
        startPc: reader.u2(),
        endPc: reader.u2(),
        handlerPc: reader.u2(),
        catchType: cp.optionalClassName(reader.u2()),
      }));
      const attributes = readAttributes(reader, cp);
      return {
        kind: 'code',
        maxStack,
        maxLocals,
        code,
        codeOffset,
        originalCodeLength: codeLength,
        exceptionTable,
        attributes,
      };
    }
    case 'LineNumberTable':
      return {
        kind: 'lineNumberTable',
        entries: readArray(reader, () => ({
          startPc: reader.u2(),
          lineNumber: reader.u2(),
        })),
      };
    case 'LocalVariableTable':
    case 'LocalVariableTypeTable':
      return {
        kind: name === 'LocalVariableTable' ? 'localVariableTable' : 'localVariableTypeTable',
        entries: readArray(reader, () => ({
          startPc: reader.u2(),
          length: reader.u2(),
          name: cp.utf8(reader.u2()),
          descriptor: cp.utf8(reader.u2()),
          index: reader.u2(),
        })),
      };
    case 'Signature':
      return { kind: 'signature', signature: cp.utf8(reader.u2()) };
    case 'SourceFile':
      return { kind: 'sourceFile', sourceFile: cp.utf8(reader.u2()) };
    case 'ConstantValue':
      return {
        kind: 'constantValue',
        constantIndex: expectConstantValueIndex(reader.u2(), cp, reader.offset - 2),
      };
    case 'Exceptions':
      return { kind: 'exceptions', exceptions: readArray(reader, () => cp.className(reader.u2())) };
    case 'RuntimeVisibleAnnotations':
    case 'RuntimeInvisibleAnnotations':
      return {
        kind: 'annotations',
        visible: name === 'RuntimeVisibleAnnotations',
        annotations: readArray(reader, () => readAnnotation(reader, cp)),
      };
    case 'RuntimeVisibleParameterAnnotations':
    case 'RuntimeInvisibleParameterAnnotations': {
      const parameterCount = reader.u1();
      const parameters: Annotation[][] = [];
      for (let index = 0; index < parameterCount; index += 1) {
        parameters.push(readArray(reader, () => readAnnotation(reader, cp)));
      }
      return {
        kind: 'parameterAnnotations',
        visible: name === 'RuntimeVisibleParameterAnnotations',
        parameters,
      };
    }
    case 'BootstrapMethods':
      return {
        kind: 'bootstrapMethods',
        methods: readArray(reader, () => {
          const methodRef = reader.u2();
          if (cp.entry(methodRef).kind !== 'methodHandle') {
            throw new ClassFormatError('Bootstrap method reference is not a method handle', reader.offset - 2);
          }
          return {
            methodRef,
            arguments: readArray(reader, () => {
              const index = reader.u2();
              cp.entry(index);
              return index;
            }),
          };
        }),
      };
    case 'InnerClasses':
      return {
        kind: 'innerClasses',
        classes: readArray(reader, () => ({
          innerClass: cp.className(reader.u2()),
          outerClass: cp.optionalClassName(reader.u2()),
          innerName: optionalUtf8(reader.u2(), cp),
          accessFlags: reader.u2(),
        })),
      };
    case 'NestHost':
      return { kind: 'nestHost', host: cp.className(reader.u2()) };
    case 'NestMembers':
      return { kind: 'nestMembers', members: readArray(reader, () => cp.className(reader.u2())) };
    case 'Record':
      return {
        kind: 'record',
        components: readArray(reader, () => ({
          name: cp.utf8(reader.u2()),
          descriptor: cp.utf8(reader.u2()),
          attributes: readAttributes(reader, cp),
        })),
      };
    case 'PermittedSubclasses':
      return {
        kind: 'permittedSubclasses',
        subclasses: readArray(reader, () => cp.className(reader.u2())),
      };
    case 'StackMapTable':
      return { kind: 'stackMapTable', bytes: reader.take(reader.remaining) };
    default:
      return { kind: 'unknown', name, bytes: reader.take(reader.remaining) };
  }
}

function optionalUtf8(index: number, cp: PoolAccess): string | null {
  return index === 0 ? null : cp.utf8(index);
}

function readAnnotation(reader: Reader, cp: PoolAccess): Annotation {
  const typeDescriptor = cp.utf8(reader.u2());
  const elements = readArray(reader, () => ({
    name: cp.utf8(reader.u2()),
    value: readElementValue(reader, cp),
  }));
  return { typeDescriptor, elements };
}

function readElementValue(reader: Reader, cp: PoolAccess): ElementValue {
  const tag = String.fromCharCode(reader.u1());
  switch (tag) {
    case 'B':
    case 'C':
    case 'D':
    case 'F':
    case 'I':
    case 'J':
    case 'S':
    case 'Z':
    case 's':
      return {
        kind: 'const',
        tag,
        constantIndex: expectAnnotationConstant(reader.u2(), tag, cp, reader.offset - 2),
      };
    case 'e':
      return {
        kind: 'enum',
        typeName: cp.utf8(reader.u2()),
        constName: cp.utf8(reader.u2()),
      };
    case 'c':
      return { kind: 'class', descriptor: cp.utf8(reader.u2()) };
    case '@':
      return { kind: 'annotation', annotation: readAnnotation(reader, cp) };
    case '[':
      return { kind: 'array', values: readArray(reader, () => readElementValue(reader, cp)) };
    default:
      reader.fail(`Unknown annotation element_value tag ${JSON.stringify(tag)}`);
  }
}

function readArray<T>(reader: Reader, read: () => T): T[] {
  const length = reader.u2();
  const values: T[] = [];
  for (let index = 0; index < length; index += 1) values.push(read());
  return values;
}

function expectConstantValueIndex(index: number, cp: PoolAccess, offset: number): number {
  const entry = cp.entry(index);
  if (!['integer', 'float', 'long', 'double', 'string'].includes(entry.kind)) {
    throw new ClassFormatError(`ConstantValue refers to invalid constant ${entry.kind}`, offset);
  }
  return index;
}

function expectAnnotationConstant(
  index: number,
  tag: string,
  cp: PoolAccess,
  offset: number,
): number {
  const entry = cp.entry(index);
  const expected =
    tag === 's'
      ? 'utf8'
      : tag === 'D'
        ? 'double'
        : tag === 'F'
          ? 'float'
          : tag === 'J'
            ? 'long'
            : 'integer';
  if (entry.kind !== expected) {
    throw new ClassFormatError(
      `Annotation value tag ${tag} refers to ${entry.kind}, expected ${expected}`,
      offset,
    );
  }
  return index;
}

function decodeModifiedUtf8(bytes: Uint8Array, offset: number): string {
  const characters: number[] = [];
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    if (first === undefined) throw new ClassFormatError('Truncated modified UTF-8', offset + index);
    if (first >= 1 && first <= 0x7f) {
      characters.push(first);
      index += 1;
      continue;
    }
    if ((first & 0xe0) === 0xc0) {
      const second = bytes[index + 1];
      if (second === undefined || (second & 0xc0) !== 0x80) {
        throw new ClassFormatError('Malformed modified UTF-8 sequence', offset + index);
      }
      const value = ((first & 0x1f) << 6) | (second & 0x3f);
      if (value === 0 && first === 0xc0 && second === 0x80) {
        characters.push(0);
      } else if (value >= 0x80) {
        characters.push(value);
      } else {
        throw new ClassFormatError('Overlong modified UTF-8 sequence', offset + index);
      }
      index += 2;
      continue;
    }
    if ((first & 0xf0) === 0xe0) {
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      if (
        second === undefined ||
        third === undefined ||
        (second & 0xc0) !== 0x80 ||
        (third & 0xc0) !== 0x80
      ) {
        throw new ClassFormatError('Malformed modified UTF-8 sequence', offset + index);
      }
      const value = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (value < 0x800) {
        throw new ClassFormatError('Overlong modified UTF-8 sequence', offset + index);
      }
      characters.push(value);
      index += 3;
      continue;
    }
    throw new ClassFormatError('Invalid modified UTF-8 leading byte', offset + index);
  }
  let result = '';
  for (let index = 0; index < characters.length; index += 8192) {
    result += String.fromCharCode(...characters.slice(index, index + 8192));
  }
  return result;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled constant-pool entry ${String(value)}`);
}
