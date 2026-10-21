export type ConstantPoolEntry =
  | { readonly tag: 1; readonly kind: 'utf8'; readonly value: string }
  | { readonly tag: 3; readonly kind: 'integer'; readonly value: number }
  | { readonly tag: 4; readonly kind: 'float'; readonly value: number }
  | { readonly tag: 5; readonly kind: 'long'; readonly value: bigint }
  | { readonly tag: 6; readonly kind: 'double'; readonly value: number }
  | { readonly tag: 7; readonly kind: 'class'; readonly nameIndex: number }
  | {
      readonly tag: 8;
      readonly kind: 'string';
      readonly stringIndex: number;
    }
  | {
      readonly tag: 9 | 10 | 11;
      readonly kind: 'fieldRef' | 'methodRef' | 'interfaceMethodRef';
      readonly classIndex: number;
      readonly nameAndTypeIndex: number;
    }
  | {
      readonly tag: 12;
      readonly kind: 'nameAndType';
      readonly nameIndex: number;
      readonly descriptorIndex: number;
    }
  | {
      readonly tag: 15;
      readonly kind: 'methodHandle';
      readonly referenceKind: number;
      readonly referenceIndex: number;
    }
  | {
      readonly tag: 16;
      readonly kind: 'methodType';
      readonly descriptorIndex: number;
    }
  | {
      readonly tag: 17 | 18;
      readonly kind: 'dynamic' | 'invokeDynamic';
      readonly bootstrapMethodIndex: number;
      readonly nameAndTypeIndex: number;
    }
  | { readonly tag: 19 | 20; readonly kind: 'module' | 'package'; readonly nameIndex: number };

export interface ExceptionHandler {
  readonly startPc: number;
  readonly endPc: number;
  readonly handlerPc: number;
  readonly catchType: string | null;
}

export interface Annotation {
  readonly typeDescriptor: string;
  readonly elements: readonly { readonly name: string; readonly value: ElementValue }[];
}

export type ElementValue =
  | { readonly kind: 'const'; readonly tag: string; readonly constantIndex: number }
  | {
      readonly kind: 'enum';
      readonly typeName: string;
      readonly constName: string;
    }
  | { readonly kind: 'class'; readonly descriptor: string }
  | { readonly kind: 'annotation'; readonly annotation: Annotation }
  | { readonly kind: 'array'; readonly values: readonly ElementValue[] };

export type AttributeInfo =
  | { readonly kind: 'code'; readonly maxStack: number; readonly maxLocals: number; readonly code: Uint8Array; readonly exceptionTable: readonly ExceptionHandler[]; readonly attributes: readonly AttributeInfo[] }
  | { readonly kind: 'lineNumberTable'; readonly entries: readonly { readonly startPc: number; readonly lineNumber: number }[] }
  | { readonly kind: 'localVariableTable' | 'localVariableTypeTable'; readonly entries: readonly { readonly startPc: number; readonly length: number; readonly name: string; readonly descriptor: string; readonly index: number }[] }
  | { readonly kind: 'signature'; readonly signature: string }
  | { readonly kind: 'sourceFile'; readonly sourceFile: string }
  | { readonly kind: 'constantValue'; readonly constantIndex: number }
  | { readonly kind: 'exceptions'; readonly exceptions: readonly string[] }
  | { readonly kind: 'annotations'; readonly visible: boolean; readonly annotations: readonly Annotation[] }
  | { readonly kind: 'parameterAnnotations'; readonly visible: boolean; readonly parameters: readonly (readonly Annotation[])[] }
  | { readonly kind: 'bootstrapMethods'; readonly methods: readonly { readonly methodRef: number; readonly arguments: readonly number[] }[] }
  | { readonly kind: 'innerClasses'; readonly classes: readonly { readonly innerClass: string; readonly outerClass: string | null; readonly innerName: string | null; readonly accessFlags: number }[] }
  | { readonly kind: 'nestHost'; readonly host: string }
  | { readonly kind: 'nestMembers'; readonly members: readonly string[] }
  | { readonly kind: 'record'; readonly components: readonly { readonly name: string; readonly descriptor: string; readonly attributes: readonly AttributeInfo[] }[] }
  | { readonly kind: 'permittedSubclasses'; readonly subclasses: readonly string[] }
  | { readonly kind: 'stackMapTable'; readonly bytes: Uint8Array }
  | { readonly kind: 'unknown'; readonly name: string; readonly bytes: Uint8Array };

export interface MemberInfo {
  readonly accessFlags: number;
  readonly name: string;
  readonly descriptor: string;
  readonly attributes: readonly AttributeInfo[];
}

export interface ClassFile {
  readonly minorVersion: number;
  readonly majorVersion: number;
  readonly constantPool: readonly (ConstantPoolEntry | null)[];
  readonly accessFlags: number;
  readonly thisClass: string;
  readonly superClass: string | null;
  readonly interfaces: readonly string[];
  readonly fields: readonly MemberInfo[];
  readonly methods: readonly MemberInfo[];
  readonly attributes: readonly AttributeInfo[];
}
