import { parseMethodDescriptor, type JavaType } from '../classfile/descriptor';
import {
  parseClassSignature,
  parseFieldSignature,
  parseMethodSignature,
} from '../classfile/signature';
import type {
  AttributeInfo,
  ClassFile,
  ElementValue,
  MemberInfo,
} from '../classfile/types';
import { Jvm, type ProxyHandler } from '../runtime/jvm';
import type { JObject, JvmValue } from '../runtime/types';

export interface GenericTypeInfo {
  readonly kind: 'class' | 'field' | 'method';
  readonly value: ReturnType<typeof parseClassSignature> | ReturnType<typeof parseFieldSignature> | ReturnType<typeof parseMethodSignature>;
}

export interface ReflectedAnnotation {
  readonly typeName: string;
  readonly values: ReadonlyMap<string, unknown>;
  readonly visible: boolean;
}

export class ReflectClass {
  public constructor(
    public readonly classFile: ClassFile,
    private readonly reflection: Reflection,
  ) {}

  public get name(): string {
    return this.classFile.thisClass.replaceAll('/', '.');
  }

  public getDeclaredFields(): ReflectField[] {
    return this.classFile.fields.map((field) => new ReflectField(this, field, this.reflection.jvm));
  }

  public getFields(): ReflectField[] {
    return this.reflection.hierarchy(this.classFile).flatMap((classFile) =>
      classFile.fields
        .filter((field) => (field.accessFlags & 0x0001) !== 0)
        .map((field) => new ReflectField(this.reflection.forName(classFile.thisClass), field, this.reflection.jvm)),
    );
  }

  public getDeclaredMethods(): ReflectMethod[] {
    return this.classFile.methods
      .filter((method) => !method.name.startsWith('<'))
      .map((method) => new ReflectMethod(this, method, this.reflection.jvm));
  }

  public getMethods(): ReflectMethod[] {
    const found = new Map<string, ReflectMethod>();
    for (const classFile of this.reflection.hierarchy(this.classFile)) {
      for (const method of classFile.methods) {
        if (method.name.startsWith('<') || (method.accessFlags & 0x0001) === 0) continue;
        const key = `${method.name}${method.descriptor}`;
        if (!found.has(key)) {
          found.set(
            key,
            new ReflectMethod(this.reflection.forName(classFile.thisClass), method, this.reflection.jvm),
          );
        }
      }
    }
    return [...found.values()];
  }

  public getDeclaredConstructors(): ReflectConstructor[] {
    return this.classFile.methods
      .filter((method) => method.name === '<init>')
      .map((method) => new ReflectConstructor(this, method, this.reflection.jvm));
  }

  public getDeclaredMethod(name: string, ...parameterTypes: readonly string[]): ReflectMethod {
    const descriptor = `(${parameterTypes.map(typeDescriptor).join('')})`;
    const method = this.classFile.methods.find(
      (candidate) =>
        candidate.name === name &&
        parseMethodDescriptor(candidate.descriptor).parameters.length === parameterTypes.length &&
        candidate.descriptor.startsWith(descriptor),
    );
    if (!method) {
      throw new Error(`No declared method ${this.name}.${name}(${parameterTypes.join(', ')})`);
    }
    return new ReflectMethod(this, method, this.reflection.jvm);
  }

  public getAnnotations(): ReflectedAnnotation[] {
    return annotations(this.classFile, this.classFile.attributes);
  }

  public getGenericType(): GenericTypeInfo | null {
    const signature = this.classFile.attributes.find((attribute) => attribute.kind === 'signature');
    return signature?.kind === 'signature'
      ? { kind: 'class', value: parseClassSignature(signature.signature) }
      : null;
  }

  public getSuperclass(): ReflectClass | null {
    return this.classFile.superClass ? this.reflection.forName(this.classFile.superClass) : null;
  }
}

export class ReflectField {
  private accessible = false;

  public constructor(
    public readonly declaringClass: ReflectClass,
    public readonly info: MemberInfo,
    private readonly jvm: Jvm,
  ) {}

  public get name(): string {
    return this.info.name;
  }

  public get typeDescriptor(): string {
    return this.info.descriptor;
  }

  public getGenericType(): GenericTypeInfo | null {
    const signature = this.info.attributes.find((attribute) => attribute.kind === 'signature');
    return signature?.kind === 'signature'
      ? { kind: 'field', value: parseFieldSignature(signature.signature) }
      : null;
  }

  public getAnnotations(): ReflectedAnnotation[] {
    return annotations(this.declaringClass.classFile, this.info.attributes);
  }

  public setAccessible(accessible: boolean): void {
    this.accessible = accessible;
  }

  public get(target: JvmValue): JvmValue {
    this.ensureAccess();
    return this.jvm.getFieldValue(
      target,
      this.declaringClass.classFile.thisClass,
      this.info.name,
      this.info.descriptor,
    );
  }

  public set(target: JvmValue, value: JvmValue): void {
    this.ensureAccess();
    this.jvm.setFieldValue(
      target,
      this.declaringClass.classFile.thisClass,
      this.info.name,
      this.info.descriptor,
      value,
    );
  }

  private ensureAccess(): void {
    if ((this.info.accessFlags & 0x0002) !== 0 && !this.accessible) {
      this.jvm.throwException(
        'java/lang/IllegalAccessException',
        `${this.declaringClass.name}.${this.info.name} is private`,
      );
    }
  }
}

export class ReflectMethod {
  private accessible = false;

  public constructor(
    public readonly declaringClass: ReflectClass,
    public readonly info: MemberInfo,
    private readonly jvm: Jvm,
  ) {}

  public get name(): string {
    return this.info.name;
  }

  public get descriptor(): string {
    return this.info.descriptor;
  }

  public getAnnotations(): ReflectedAnnotation[] {
    return annotations(this.declaringClass.classFile, this.info.attributes);
  }

  public getGenericType(): GenericTypeInfo | null {
    const signature = this.info.attributes.find((attribute) => attribute.kind === 'signature');
    return signature?.kind === 'signature'
      ? { kind: 'method', value: parseMethodSignature(signature.signature) }
      : null;
  }

  public setAccessible(accessible: boolean): void {
    this.accessible = accessible;
  }

  public invoke(target: JvmValue, ...args: readonly JvmValue[]): JvmValue {
    this.ensureAccess();
    return this.jvm.invokeMethod(
      this.declaringClass.classFile.thisClass,
      this.info.name,
      this.info.descriptor,
      target,
      args,
    );
  }

  private ensureAccess(): void {
    if ((this.info.accessFlags & 0x0002) !== 0 && !this.accessible) {
      this.jvm.throwException(
        'java/lang/IllegalAccessException',
        `${this.declaringClass.name}.${this.info.name} is private`,
      );
    }
  }
}

export class ReflectConstructor {
  private accessible = false;

  public constructor(
    public readonly declaringClass: ReflectClass,
    public readonly info: MemberInfo,
    private readonly jvm: Jvm,
  ) {}

  public setAccessible(accessible: boolean): void {
    this.accessible = accessible;
  }

  public newInstance(...args: readonly JvmValue[]): JObject {
    if ((this.info.accessFlags & 0x0002) !== 0 && !this.accessible) {
      this.jvm.throwException('java/lang/IllegalAccessException', `${this.declaringClass.name} constructor is private`);
    }
    const object = this.jvm.newObject(this.declaringClass.classFile.thisClass);
    this.jvm.invokeMethod(
      this.declaringClass.classFile.thisClass,
      '<init>',
      this.info.descriptor,
      object,
      args,
    );
    return object;
  }
}

export interface PropertyDescriptor {
  readonly name: string;
  readonly type: string;
  readonly readMethod: ReflectMethod | null;
  readonly writeMethod: ReflectMethod | null;
}

export const Introspector = {
  getBeanInfo(type: ReflectClass): PropertyDescriptor[] {
    const getters = new Map<string, ReflectMethod>();
    const setters = new Map<string, ReflectMethod>();
    for (const method of type.getMethods()) {
      const descriptor = parseMethodDescriptor(method.descriptor);
      if (descriptor.parameters.length === 0 && descriptor.returnType.kind !== 'void') {
        const isGetter = method.name.startsWith('is') && descriptor.returnType.kind === 'primitive' &&
          descriptor.returnType.name === 'boolean';
        const getGetter = method.name.startsWith('get') && method.name.length > 3;
        if ((isGetter && method.name.length > 2) || getGetter) {
          const suffix = method.name.slice(isGetter ? 2 : 3);
          const name = decapitalize(suffix);
          const existing = getters.get(name);
          if (!existing || isGetter) getters.set(name, method);
        }
      }
      if (
        method.name.startsWith('set') &&
        method.name.length > 3 &&
        descriptor.parameters.length === 1 &&
        descriptor.returnType.kind === 'void'
      ) {
        setters.set(decapitalize(method.name.slice(3)), method);
      }
    }
    const properties = new Set([...getters.keys(), ...setters.keys()]);
    return [...properties].sort().map((name) => {
      const readMethod = getters.get(name) ?? null;
      const writeMethod = setters.get(name) ?? null;
      const readType = readMethod
        ? descriptorType(parseMethodDescriptor(readMethod.descriptor).returnType)
        : null;
      let writeType: string | null = null;
      if (writeMethod) {
        const parameter = parseMethodDescriptor(writeMethod.descriptor).parameters[0];
        if (!parameter) throw new Error(`Setter ${writeMethod.name} has no parameter`);
        writeType = descriptorType(parameter);
      }
      return {
        name,
        type: readType ?? writeType ?? 'java.lang.Object',
        readMethod: readType && writeType && readType !== writeType ? null : readMethod,
        writeMethod: readType && writeType && readType !== writeType ? null : writeMethod,
      };
    });
  },
};

export class Reflection {
  public constructor(
    public readonly jvm: Jvm,
    private readonly classFiles: ReadonlyMap<string, ClassFile>,
  ) {}

  public forName(binaryName: string): ReflectClass {
    const internalName = binaryName.replaceAll('.', '/');
    const classFile = this.classFiles.get(internalName);
    if (!classFile) throw new Error(`Class ${binaryName} is not loaded`);
    return new ReflectClass(classFile, this);
  }

  public hierarchy(classFile: ClassFile): ClassFile[] {
    const found: ClassFile[] = [];
    const visited = new Set<string>();
    const visit = (current: ClassFile): void => {
      if (visited.has(current.thisClass)) return;
      visited.add(current.thisClass);
      found.push(current);
      for (const interfaceName of current.interfaces) {
        const interfaceFile = this.classFiles.get(interfaceName);
        if (interfaceFile) visit(interfaceFile);
      }
      if (current.superClass) {
        const superFile = this.classFiles.get(current.superClass);
        if (superFile) visit(superFile);
      }
    };
    visit(classFile);
    return found;
  }

  public proxyNewProxyInstance(
    interfaces: readonly ReflectClass[],
    handler: ProxyHandler,
  ): JObject {
    if (interfaces.length === 0) throw new Error('A proxy requires at least one interface');
    for (const type of interfaces) {
      if ((type.classFile.accessFlags & 0x0200) === 0) {
        throw new Error(`${type.name} is not an interface`);
      }
    }
    const firstInterface = interfaces[0];
    if (!firstInterface) throw new Error('A proxy requires at least one interface');
    const proxy = this.jvm.newObject(firstInterface.classFile.thisClass);
    this.jvm.registerProxy(proxy, handler);
    return proxy;
  }

  public newProxyInstance(
    interfaces: readonly ReflectClass[],
    handler: ProxyHandler,
  ): JObject {
    return this.proxyNewProxyInstance(interfaces, handler);
  }

  public objenesisInstantiate(type: ReflectClass): JObject {
    return this.jvm.newObject(type.classFile.thisClass);
  }
}

export function decapitalize(name: string): string {
  if (name.length === 0) return name;
  const first = name.charAt(0);
  const second = name.charAt(1);
  if (
    name.length > 1 &&
    first === first.toUpperCase() &&
    second === second.toUpperCase()
  ) {
    return name;
  }
  return first.toLowerCase() + name.slice(1);
}

export const Proxy = {
  newProxyInstance(
    reflection: Reflection,
    interfaces: readonly ReflectClass[],
    handler: ProxyHandler,
  ): JObject {
    return reflection.newProxyInstance(interfaces, handler);
  },
};

function typeDescriptor(type: string): string {
  const primitive: Readonly<Record<string, string>> = {
    byte: 'B',
    char: 'C',
    double: 'D',
    float: 'F',
    int: 'I',
    long: 'J',
    short: 'S',
    boolean: 'Z',
    void: 'V',
  };
  const primitiveType = primitive[type];
  if (primitiveType !== undefined) return primitiveType;
  let baseName = type;
  let dimensions = 0;
  while (baseName.endsWith('[]')) {
    dimensions += 1;
    baseName = baseName.slice(0, -2);
  }
  const component = primitive[baseName] ?? `L${baseName.replaceAll('.', '/')};`;
  return `${'['.repeat(dimensions)}${component}`;
}

function descriptorType(type: JavaType | { readonly kind: 'void' }): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'object':
      return type.internalName.replaceAll('/', '.');
    case 'array':
      return `${descriptorType(type.component)}[]`;
    case 'void':
      return 'void';
  }
}

function annotations(classFile: ClassFile, attributes: readonly AttributeInfo[]): ReflectedAnnotation[] {
  return attributes.flatMap((attribute) => {
    if (attribute.kind !== 'annotations') return [];
    return attribute.annotations.map((annotation) => ({
      typeName: descriptorTypeName(annotation.typeDescriptor),
      values: new Map(annotation.elements.map(({ name, value }) => [name, elementValue(classFile, value)])),
      visible: attribute.visible,
    }));
  });
}

function elementValue(classFile: ClassFile, element: ElementValue): unknown {
  switch (element.kind) {
    case 'const': {
      const constant = classFile.constantPool[element.constantIndex];
      if (element.tag === 's' && constant?.kind === 'utf8') return constant.value;
      if (
        constant?.kind === 'integer' ||
        constant?.kind === 'float' ||
        constant?.kind === 'long' ||
        constant?.kind === 'double'
      ) {
        return constant.value;
      }
      throw new Error(`Invalid annotation constant at pool index ${element.constantIndex}`);
    }
    case 'enum':
      return { typeName: descriptorTypeName(element.typeName), constName: element.constName };
    case 'class':
      return descriptorTypeName(element.descriptor);
    case 'annotation':
      return {
        typeName: descriptorTypeName(element.annotation.typeDescriptor),
        values: new Map(
          element.annotation.elements.map(({ name, value }) => [name, elementValue(classFile, value)]),
        ),
      };
    case 'array':
      return element.values.map((value) => elementValue(classFile, value));
    default:
      return assertNever(element);
  }
}

function descriptorTypeName(descriptor: string): string {
  if (!descriptor.startsWith('L') || !descriptor.endsWith(';')) return descriptor;
  return descriptor.slice(1, -1).replaceAll('/', '.');
}

function assertNever(value: never): never {
  throw new Error(`Unknown annotation value ${String(value)}`);
}
