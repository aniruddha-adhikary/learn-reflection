import { parseMethodDescriptor } from '../classfile/descriptor';
import type { ClassFile, MemberInfo } from '../classfile/types';
import {
  decode,
  type Instruction,
  type InstructionOperand,
  type ResolvedConstant,
} from '../bytecode/decode';
import { StepBudgetExceeded, UnsupportedBytecode, UnsupportedNative } from './errors';
import type {
  JArray,
  JObject,
  JString,
  JvmOptions,
  JvmNative,
  JvmValue,
  RunResult,
  StepEvent,
} from './types';

interface RuntimeSlot {
  readonly value: JvmValue;
  readonly size: 1 | 2;
}

type NativeFunction = JvmNative;
export type ProxyHandler = (
  proxy: JObject,
  method: { readonly owner: string; readonly name: string; readonly descriptor: string },
  args: readonly JvmValue[],
) => JvmValue;

export class JavaThrown extends Error {
  public constructor(public readonly object: JObject, message: string) {
    super(message);
    this.name = 'JavaThrown';
  }
}

export class Jvm {
  private readonly classes: ReadonlyMap<string, ClassFile>;
  private readonly staticFields = new Map<string, JvmValue>();
  private readonly initialized = new Set<string>();
  private readonly natives = new Map<string, NativeFunction>();
  private readonly proxies = new WeakMap<JObject, ProxyHandler>();
  private readonly mapValues = new WeakMap<JObject, Map<JvmValue, JvmValue>>();
  private readonly setValues = new WeakMap<JObject, JvmValue[]>();
  private steps = 0;
  private nextIdentity = 1;

  public constructor(classes: ReadonlyMap<string, ClassFile>, private readonly options: JvmOptions = {}) {
    this.classes = classes;
    this.registerNatives();
  }

  public run(
    className: string,
    methodName: string,
    descriptor: string,
    args: readonly JvmValue[] = [],
  ): RunResult {
    this.steps = 0;
    try {
      return { result: this.invoke(className, methodName, descriptor, args, null, 0, true) };
    } catch (error) {
      if (error instanceof JavaThrown) {
        return {
          threw: error.object.cls.replaceAll('/', '.'),
          message: error.message,
        };
      }
      throw error;
    }
  }

  public loadClass(internalName: string): ClassFile {
    const classFile = this.classes.get(internalName);
    if (!classFile) throw new Error(`Class ${internalName} is not available in this JVM`);
    return classFile;
  }

  public newObject(internalName: string): JObject {
    this.initializeClass(internalName, 0);
    return {
      kind: 'object',
      cls: internalName,
      fields: this.defaultInstanceFields(internalName),
    };
  }

  public invokeMethod(
    owner: string,
    name: string,
    descriptor: string,
    receiver: JvmValue,
    args: readonly JvmValue[],
  ): JvmValue {
    if (isObject(receiver)) {
      const handler = this.proxies.get(receiver);
      if (handler) {
        return this.normalizeInput(handler(receiver, { owner, name, descriptor }, args));
      }
    }
    const receiverClass =
      receiver !== null && typeof receiver === 'object' && receiver.kind === 'object'
        ? this.classes.get(receiver.cls)
        : undefined;
    const declaredClass = this.classes.get(owner);
    if (
      receiverClass &&
      (!declaredClass || !isStaticMethod(declaredClass, name, descriptor))
    ) {
      const resolved = this.resolveMethod(receiverClass, name, descriptor);
      if (resolved) {
        const actualOwner = this.ownerOfMethod(resolved, receiverClass, name, descriptor).thisClass;
        return this.invoke(actualOwner, name, descriptor, args, receiver, 0, false);
      }
    }
    return this.invoke(owner, name, descriptor, args, receiver, 0, false);
  }

  public registerProxy(proxy: JObject, handler: ProxyHandler): void {
    this.proxies.set(proxy, handler);
  }

  public defineNative(owner: string, name: string, descriptor: string, native: JvmNative): void {
    this.register(owner, name, descriptor, native);
  }

  public throwException(className: string, message: string): never {
    this.throwJava(className, message);
  }

  public getFieldValue(
    object: JvmValue,
    owner: string,
    name: string,
    descriptor: string,
  ): JvmValue {
    const key = `${owner}.${name}:${descriptor}`;
    if (isStaticField(this.loadClass(owner), name, descriptor)) {
      return this.staticValue(key, owner, name, descriptor);
    }
    if (object === null) this.throwJava('java/lang/NullPointerException', `get ${name}`);
    const instance = requireObject(object);
    return instance.fields.get(key) ?? defaultValue(descriptor);
  }

  public setFieldValue(
    object: JvmValue,
    owner: string,
    name: string,
    descriptor: string,
    value: JvmValue,
  ): void {
    const key = `${owner}.${name}:${descriptor}`;
    if (isStaticField(this.loadClass(owner), name, descriptor)) {
      this.staticFields.set(key, this.normalizeInput(value));
      return;
    }
    if (object === null) this.throwJava('java/lang/NullPointerException', `set ${name}`);
    requireObject(object).fields.set(key, this.normalizeInput(value));
  }

  public getStaticFieldValue(owner: string, name: string, descriptor: string): JvmValue {
    const key = `${owner}.${name}:${descriptor}`;
    this.initializeClass(owner, 0);
    return this.staticValue(key, owner, name, descriptor);
  }

  public setStaticFieldValue(owner: string, name: string, descriptor: string, value: JvmValue): void {
    this.initializeClass(owner, 0);
    this.staticFields.set(`${owner}.${name}:${descriptor}`, this.normalizeInput(value));
  }

  private invoke(
    owner: string,
    name: string,
    descriptor: string,
    args: readonly JvmValue[],
    receiver: JvmValue,
    depth: number,
    initialize: boolean,
  ): JvmValue {
    const event = {
      owner,
      name,
      descriptor,
      args: args.map((arg) => this.normalizeInput(arg)),
      depth,
    };
    this.options.onInvoke?.(event);
    let result: JvmValue;
    try {
      result = this.invokeImpl(owner, name, descriptor, args, receiver, depth, initialize);
    } catch (error) {
      this.options.onReturn?.({
        ...event,
        thrown: error instanceof JavaThrown
          ? `${error.object.cls}: ${error.message}`
          : error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.options.onReturn?.({ ...event, result });
    return result;
  }

  private invokeImpl(
    owner: string,
    name: string,
    descriptor: string,
    args: readonly JvmValue[],
    receiver: JvmValue,
    depth: number,
    initialize: boolean,
  ): JvmValue {
    if (depth > 256) throw new Error('JVM call depth exceeded');
    const native = this.natives.get(`${owner}.${name}${descriptor}`);
    if (native) {
      return native(receiver, args.map((arg) => this.normalizeInput(arg)));
    }
    if (owner.startsWith('java/') || owner.startsWith('javax/')) {
      throw new UnsupportedNative(owner, name, descriptor);
    }
    const targetClass = this.loadClass(owner);
    if (initialize && name !== '<clinit>') this.initializeClass(owner, depth + 1);
    const method = this.resolveMethod(targetClass, name, descriptor);
    if (!method) throw new Error(`Method ${owner}.${name}${descriptor} was not found`);
    if ((method.accessFlags & 0x0400) !== 0) {
      throw new UnsupportedNative(owner, name, descriptor);
    }
    const codeAttribute = method.attributes.find((attribute) => attribute.kind === 'code');
    if (!codeAttribute) {
      throw new Error(`Method ${owner}.${name}${descriptor} has no Code attribute`);
    }
    const resolvedOwner = this.ownerOfMethod(method, targetClass, name, descriptor);
    const instructions = decode(codeAttribute.code, resolvedOwner.constantPool);
    const offsets = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
    const methodDescriptor = parseMethodDescriptor(descriptor);
    const locals: (RuntimeSlot | undefined)[] = Array.from(
      { length: codeAttribute.maxLocals },
      () => undefined,
    );
    let local = 0;
    if ((method.accessFlags & 0x0008) === 0) {
      if (receiver === null) this.throwJava('java/lang/NullPointerException', 'receiver is null');
      locals[local++] = { value: receiver, size: 1 };
    }
    for (let index = 0; index < methodDescriptor.parameters.length; index += 1) {
      const parameterType = requiredAt(methodDescriptor.parameters, index, `parameter ${index}`);
      const size = typeSize(parameterType);
      const arg = args[index];
      if (arg === undefined) throw new Error(`Missing argument ${index} for ${name}${descriptor}`);
      locals[local] = { value: this.normalizeInput(arg), size };
      local += size;
    }

    const stack: RuntimeSlot[] = [];
    let pcIndex = 0;
    while (pcIndex < instructions.length) {
      const instruction = requiredAt(instructions, pcIndex, `instruction ${pcIndex}`);
      this.step({
        className: resolvedOwner.thisClass,
        methodName: name,
        descriptor,
        pc: instruction.offset,
        insnIndex: pcIndex,
        locals: locals.map((slot) => slot?.value),
        stack: stack.map((slot) => slot.value),
        depth,
      });
      let nextIndex = pcIndex + 1;
      try {
        const result = this.executeInstruction(
          resolvedOwner,
          method,
          instruction,
          instructions,
          offsets,
          locals,
          stack,
          depth,
        );
        if (result.returned) return result.value;
        if (result.nextIndex !== undefined) nextIndex = result.nextIndex;
      } catch (error) {
        if (!(error instanceof JavaThrown)) throw error;
        const handler = codeAttribute.exceptionTable.find(
          (candidate) =>
            instruction.offset >= candidate.startPc &&
            instruction.offset < candidate.endPc &&
            this.isAssignable(error.object.cls, candidate.catchType ?? 'java/lang/Throwable'),
        );
        if (!handler) throw error;
        stack.length = 0;
        stack.push({ value: error.object, size: 1 });
        const target = offsets.get(handler.handlerPc);
        if (target === undefined) throw new Error(`Bad exception handler target ${handler.handlerPc}`);
        nextIndex = target;
      }
      pcIndex = nextIndex;
    }
    return null;
  }

  private executeInstruction(
    owner: ClassFile,
    method: MemberInfo,
    instruction: Instruction,
    instructions: readonly Instruction[],
    offsets: ReadonlyMap<number, number>,
    locals: (RuntimeSlot | undefined)[],
    stack: RuntimeSlot[],
    depth: number,
  ): { returned: boolean; value: JvmValue; nextIndex?: number } {
    const op = instruction.opcode;
    const pop = (): RuntimeSlot => {
      const value = stack.pop();
      if (!value) throw new Error(`Operand stack underflow at ${instruction.mnemonic}`);
      return value;
    };
    const popValue = (): JvmValue => pop().value;
    const push = (value: JvmValue, size: 1 | 2 = 1): void => {
      stack.push({ value, size });
    };
    const localIndex = (): number => {
      const operand = instruction.operands.find((item) => item.kind === 'local');
      if (operand?.kind === 'local') return operand.index;
      return (op >= 0x1a && op <= 0x2d)
        ? (op - 0x1a) % 4
        : (op >= 0x3b && op <= 0x4e)
          ? (op - 0x3b) % 4
          : -1;
    };
    const branch = (condition: boolean): number | undefined => {
      if (!condition) return undefined;
      const operand = instruction.operands.find((item) => item.kind === 'branchTarget');
      if (operand?.kind !== 'branchTarget') throw new Error(`${instruction.mnemonic} has no target`);
      const target = offsets.get(operand.target);
      if (target === undefined) throw new Error(`Invalid branch target ${operand.target}`);
      return target;
    };
    const branchResult = (
      condition: boolean,
    ): { returned: false; value: null; nextIndex?: number } => {
      const nextIndex = branch(condition);
      return nextIndex === undefined
        ? { returned: false, value: null }
        : { returned: false, value: null, nextIndex };
    };

    if (op === 0x00) return { returned: false, value: null };
    if (op === 0x01) push(null);
    else if (op >= 0x02 && op <= 0x08) push(int(op - 3));
    else if (op === 0x09 || op === 0x0a) push(BigInt(op - 0x09), 2);
    else if (op >= 0x0b && op <= 0x0d) push(Math.fround(op - 0x0b));
    else if (op === 0x0e || op === 0x0f) push(op - 0x0e, 2);
    else if (op === 0x10 || op === 0x11) {
      const value = instruction.operands.find((operand) => operand.kind === 'immediate');
      if (value?.kind !== 'immediate') throw new Error('Missing immediate');
      push(int(value.value));
    } else if (op >= 0x12 && op <= 0x14) {
      const constant = constantOperand(instruction);
      const value = this.constantValue(constant);
      push(value, constant.kind === 'long' || constant.kind === 'double' ? 2 : 1);
    } else if (op >= 0x15 && op <= 0x19) {
      push(localValue(locals, localIndex()).value, opcodeValueSize(op));
    } else if (op >= 0x1a && op <= 0x2d) {
      const group = Math.floor((op - 0x1a) / 4);
      push(localValue(locals, localIndex()).value, group === 1 || group === 3 ? 2 : 1);
    } else if (op >= 0x2e && op <= 0x35) {
      const index = intValue(popValue());
      const arrayValue = popValue();
      if (arrayValue === null) this.throwJava('java/lang/NullPointerException', 'array load on null');
      const array = requireArray(arrayValue);
      push(this.arrayGet(array, index), op === 0x2f || op === 0x31 ? 2 : 1);
    } else if (op >= 0x36 && op <= 0x3a) {
      setLocal(locals, localIndex(), pop());
    } else if (op >= 0x3b && op <= 0x4e) {
      setLocal(locals, localIndex(), pop());
    } else if (op >= 0x4f && op <= 0x56) {
      const value = popValue();
      const index = intValue(popValue());
      const arrayValue = popValue();
      if (arrayValue === null) this.throwJava('java/lang/NullPointerException', 'array store on null');
      const array = requireArray(arrayValue);
      this.arraySet(array, index, value);
    } else if (op >= 0x57 && op <= 0x5f) {
      executeStackOpcode(op, stack);
    } else if (op >= 0x60 && op <= 0x83) {
      executeArithmetic(op, popValue, push, (type) =>
        this.throwJava('java/lang/ArithmeticException', type),
      );
    } else if (op === 0x84) {
      const increment = operandOf(instruction, 'increment');
      const previous = localValue(locals, increment.index);
      setLocal(locals, increment.index, { value: int(intValue(previous.value) + increment.amount), size: 1 });
    } else if (op >= 0x85 && op <= 0x93) {
      executeConversion(op, popValue, push);
    } else if (op >= 0x94 && op <= 0x98) {
      const right = popValue();
      const left = popValue();
      push(compare(op, left, right));
    } else if (op >= 0x99 && op <= 0x9e) {
      const value = intValue(popValue());
      const checks = [value === 0, value !== 0, value < 0, value >= 0, value > 0, value <= 0];
      return branchResult(requiredAt(checks, op - 0x99, 'branch condition'));
    } else if (op >= 0x9f && op <= 0xa4) {
      const right = intValue(popValue());
      const left = intValue(popValue());
      const checks = [left === right, left !== right, left < right, left >= right, left > right, left <= right];
      return branchResult(requiredAt(checks, op - 0x9f, 'comparison condition'));
    } else if (op === 0xa5 || op === 0xa6) {
      const right = popValue();
      const left = popValue();
      const equal = referenceEquals(left, right);
      return branchResult(op === 0xa5 ? equal : !equal);
    } else if (op === 0xa7 || op === 0xc8) {
      return branchResult(true);
    } else if (op === 0xa8 || op === 0xa9 || op === 0xc9) {
      throw new UnsupportedBytecode(instruction.mnemonic, owner.thisClass, method.name);
    } else if (op === 0xaa || op === 0xab) {
      const switchInfo = operandOf(instruction, 'switch');
      const key = intValue(popValue());
      const targetOffset = switchInfo.cases.find((entry) => entry.key === key)?.target ?? switchInfo.defaultTarget;
      const target = offsets.get(targetOffset);
      if (target === undefined) throw new Error(`Invalid switch target ${targetOffset}`);
      return { returned: false, value: null, nextIndex: target };
    } else if (op >= 0xac && op <= 0xb0) {
      return { returned: true, value: popValue() };
    } else if (op === 0xb1) {
      return { returned: true, value: null };
    } else if (op >= 0xb2 && op <= 0xb5) {
      this.executeField(op, instruction, popValue, push, depth);
    } else if (op >= 0xb6 && op <= 0xba) {
      this.executeInvoke(owner, op, instruction, popValue, push, depth);
    } else if (op === 0xbb) {
      const type = constantOperand(instruction);
      if (type.kind !== 'class') throw new Error('new requires a class reference');
      push(this.newObject(type.name));
    } else if (op === 0xbc || op === 0xbd) {
      const length = intValue(popValue());
      if (length < 0) this.throwJava('java/lang/NegativeArraySizeException', String(length));
      const descriptor =
        op === 0xbd
          ? `[L${classConstantName(instruction)};`
          : newArrayDescriptor(immediateOperand(instruction));
      push({ kind: 'array', descriptor, values: Array.from({ length }, () => null) } satisfies JArray);
    } else if (op === 0xbe) {
      const value = popValue();
      if (value === null) this.throwJava('java/lang/NullPointerException', 'arraylength on null');
      push(requireArray(value).values.length);
    } else if (op === 0xbf) {
      const thrown = popValue();
      if (thrown === null) this.throwJava('java/lang/NullPointerException', 'throw null');
      if (!isObject(thrown)) throw new Error('athrow operand is not a throwable object');
      throw new JavaThrown(thrown, objectMessage(thrown));
    } else if (op === 0xc0) {
      const value = popValue();
      if (value !== null && !this.isAssignable(referenceClass(value), classConstantName(instruction))) {
        this.throwJava('java/lang/ClassCastException', `${referenceClass(value)} cannot be cast`);
      }
      push(value);
    } else if (op === 0xc1) {
      const value = popValue();
      push(value !== null && this.isAssignable(referenceClass(value), classConstantName(instruction)) ? 1 : 0);
    } else if (op === 0xc2 || op === 0xc3) {
      if (popValue() === null) this.throwJava('java/lang/NullPointerException', 'monitor on null');
    } else if (op === 0xc4) {
      const wide = operandOf(instruction, 'wideOpcode');
      if (wide.mnemonic.endsWith('load')) {
        const local = operandOf(instruction, 'local').index;
        push(localValue(locals, local).value, opcodeValueSize(wide.opcode));
      } else if (wide.mnemonic.endsWith('store')) {
        const local = operandOf(instruction, 'local').index;
        setLocal(locals, local, pop());
      } else if (wide.mnemonic === 'iinc') {
        const increment = operandOf(instruction, 'increment');
        setLocal(locals, increment.index, {
          value: int(intValue(localValue(locals, increment.index).value) + increment.amount),
          size: 1,
        });
      } else {
        throw new UnsupportedBytecode(`wide ${wide.mnemonic}`, owner.thisClass, method.name);
      }
    } else if (op === 0xc5) {
      const dims = operandOf(instruction, 'dimensions').count;
      const dimensions = Array.from({ length: dims }, () => intValue(popValue())).reverse();
      const descriptor = classConstantName(instruction);
      push(this.multiArray(descriptor, dimensions));
    } else if (op === 0xc6 || op === 0xc7) {
      const isNull = popValue() === null;
      return branchResult(op === 0xc6 ? isNull : !isNull);
    } else {
      throw new UnsupportedBytecode(instruction.mnemonic, owner.thisClass, method.name);
    }
    return { returned: false, value: null };
  }

  private executeField(
    opcode: number,
    instruction: Instruction,
    pop: () => JvmValue,
    push: (value: JvmValue, size?: 1 | 2) => void,
    depth: number,
  ): void {
    const field = constantOperand(instruction);
    if (field.kind !== 'fieldRef') throw new Error(`${instruction.mnemonic} requires a field reference`);
    const key = `${field.owner}.${field.name}:${field.descriptor}`;
    const size = field.descriptor === 'J' || field.descriptor === 'D' ? 2 : 1;
    if (opcode === 0xb2) {
      this.initializeClass(field.owner, depth + 1);
      push(this.staticValue(key, field.owner, field.name, field.descriptor), size);
    } else if (opcode === 0xb3) {
      this.initializeClass(field.owner, depth + 1);
      this.staticFields.set(key, pop());
    } else if (opcode === 0xb4) {
      const receiver = pop();
      if (receiver === null) this.throwJava('java/lang/NullPointerException', `getfield ${field.name}`);
      const object = requireObject(receiver);
      push(object.fields.get(key) ?? defaultValue(field.descriptor), size);
    } else {
      const value = pop();
      const receiver = pop();
      if (receiver === null) this.throwJava('java/lang/NullPointerException', `putfield ${field.name}`);
      const object = requireObject(receiver);
      object.fields.set(key, value);
    }
  }

  private executeInvoke(
    caller: ClassFile,
    opcode: number,
    instruction: Instruction,
    pop: () => JvmValue,
    push: (value: JvmValue, size?: 1 | 2) => void,
    depth: number,
  ): void {
    const constant = constantOperand(instruction);
    if (opcode === 0xba) {
      if (constant.kind !== 'dynamic' || !constant.invoke) {
        throw new Error('invokedynamic requires an InvokeDynamic constant');
      }
      throw new UnsupportedBytecode(
        this.bootstrapName(caller, constant),
        caller.thisClass,
        '<invokedynamic>',
      );
    }
    if (constant.kind !== 'methodRef') throw new Error(`${instruction.mnemonic} requires a method reference`);
    const descriptor = parseMethodDescriptor(constant.descriptor);
    const args = Array.from({ length: descriptor.parameters.length }, () => pop()).reverse();
    const receiver =
      opcode === 0xb8
        ? null
        : pop();
    if (opcode !== 0xb8 && receiver === null) {
      this.throwJava('java/lang/NullPointerException', `invoke ${constant.name} on null`);
    }
    if (isObject(receiver)) {
      const handler = this.proxies.get(receiver);
      if (handler) {
        const result = handler(receiver, constant, args);
        if (descriptor.returnType.kind !== 'void') {
          push(this.normalizeInput(result), typeSize(descriptor.returnType));
        }
        return;
      }
    }
    let targetOwner = constant.owner;
    if (opcode === 0xb6 || opcode === 0xb9) {
      if (receiver === null) throw new Error('Missing invocation receiver');
      const receiverClass = referenceClass(receiver);
      if (this.natives.has(`${receiverClass}.${constant.name}${constant.descriptor}`)) {
        targetOwner = receiverClass;
      } else if (this.natives.has(`${constant.owner}.${constant.name}${constant.descriptor}`)) {
        targetOwner = constant.owner;
      } else {
      const receiverFile = this.classes.get(receiverClass);
      if (receiverFile) {
        const target = this.resolveMethod(receiverFile, constant.name, constant.descriptor);
        if (target) targetOwner = this.ownerOfMethod(target, receiverFile, constant.name, constant.descriptor).thisClass;
      }
      }
    }
    const result = this.invoke(targetOwner, constant.name, constant.descriptor, args, receiver, depth + 1, opcode === 0xb8);
    if (descriptor.returnType.kind !== 'void') {
      push(result, typeSize(descriptor.returnType));
    }
  }

  private initializeClass(internalName: string, depth: number): void {
    if (this.initialized.has(internalName) || !this.classes.has(internalName)) return;
    this.initialized.add(internalName);
    const classFile = this.loadClass(internalName);
    if (classFile.superClass) this.initializeClass(classFile.superClass, depth + 1);
    for (const field of classFile.fields) {
      if ((field.accessFlags & 0x0008) === 0) continue;
      const key = `${internalName}.${field.name}:${field.descriptor}`;
      this.staticFields.set(key, defaultValue(field.descriptor));
      const constant = field.attributes.find((attribute) => attribute.kind === 'constantValue');
      if (constant?.kind === 'constantValue') {
        this.staticFields.set(key, this.constantFromPool(classFile, constant.constantIndex));
      }
    }
    const initializer = classFile.methods.find(
      (method) => method.name === '<clinit>' && method.descriptor === '()V',
    );
    if (initializer) this.invoke(internalName, '<clinit>', '()V', [], null, depth + 1, false);
  }

  private resolveMethod(
    start: ClassFile,
    name: string,
    descriptor: string,
  ): MemberInfo | undefined {
    const visited = new Set<string>();
    const visit = (classFile: ClassFile): MemberInfo | undefined => {
      if (visited.has(classFile.thisClass)) return undefined;
      visited.add(classFile.thisClass);
      const method = classFile.methods.find(
        (entry) => entry.name === name && entry.descriptor === descriptor,
      );
      if (method) return method;
      for (const interfaceName of classFile.interfaces) {
        const interfaceFile = this.classes.get(interfaceName);
        if (interfaceFile) {
          const found = visit(interfaceFile);
          if (found) return found;
        }
      }
      if (classFile.superClass) {
        const superFile = this.classes.get(classFile.superClass);
        if (superFile) return visit(superFile);
      }
      return undefined;
    };
    return visit(start);
  }

  private ownerOfMethod(
    method: MemberInfo,
    start: ClassFile,
    name: string,
    descriptor: string,
  ): ClassFile {
    if (start.methods.includes(method)) return start;
    for (const parent of [...start.interfaces, ...(start.superClass ? [start.superClass] : [])]) {
      const parentFile = this.classes.get(parent);
      if (!parentFile) continue;
      const found = this.resolveMethod(parentFile, name, descriptor);
      if (found === method) return this.ownerOfMethod(method, parentFile, name, descriptor);
    }
    return start;
  }

  private defaultInstanceFields(internalName: string): Map<string, JvmValue> {
    const classFile = this.classes.get(internalName);
    if (!classFile) return new Map();
    const fields = classFile.superClass && this.classes.has(classFile.superClass)
      ? this.defaultInstanceFields(classFile.superClass)
      : new Map<string, JvmValue>();
    for (const field of classFile.fields) {
      if ((field.accessFlags & 0x0008) === 0) {
        fields.set(`${internalName}.${field.name}:${field.descriptor}`, defaultValue(field.descriptor));
      }
    }
    return fields;
  }

  private staticValue(
    key: string,
    owner: string,
    name: string,
    descriptor: string,
  ): JvmValue {
    const value = this.staticFields.get(key);
    if (value !== undefined) return value;
    const constants: Readonly<Record<string, JvmValue>> = {
      'java/lang/Integer.MAX_VALUE:I': 0x7fffffff,
      'java/lang/Integer.MIN_VALUE:I': -0x80000000,
      'java/lang/Long.MAX_VALUE:J': 0x7fffffffffffffffn,
      'java/lang/Long.MIN_VALUE:J': -0x8000000000000000n,
      'java/lang/Double.MAX_VALUE:D': Number.MAX_VALUE,
      'java/lang/Double.MIN_VALUE:D': Number.MIN_VALUE,
      'java/lang/Boolean.TRUE:Ljava/lang/Boolean;': { kind: 'object', cls: 'java/lang/Boolean', fields: new Map([['value', 1]]) },
      'java/lang/Boolean.FALSE:Ljava/lang/Boolean;': { kind: 'object', cls: 'java/lang/Boolean', fields: new Map([['value', 0]]) },
    };
    return constants[`${owner}.${name}:${descriptor}`] ?? defaultValue(descriptor);
  }

  private arrayGet(array: JArray, index: number): JvmValue {
    if (index < 0 || index >= array.values.length) {
      this.throwJava('java/lang/ArrayIndexOutOfBoundsException', String(index));
    }
    return array.values[index] ?? null;
  }

  private arraySet(array: JArray, index: number, value: JvmValue): void {
    if (index < 0 || index >= array.values.length) {
      this.throwJava('java/lang/ArrayIndexOutOfBoundsException', String(index));
    }
    array.values[index] = value;
  }

  private constantValue(constant: ResolvedConstant): JvmValue {
    switch (constant.kind) {
      case 'integer':
      case 'float':
      case 'double':
        return constant.value;
      case 'long':
        return constant.value;
      case 'string':
        return this.string(constant.value);
      case 'class':
        return this.newObject('java/lang/Class');
      default:
        throw new Error(`Unsupported ldc constant ${constant.kind}`);
    }
  }

  private constantFromPool(classFile: ClassFile, index: number): JvmValue {
    const entry = classFile.constantPool[index];
    if (!entry) throw new Error(`Invalid constant-pool index ${index}`);
    switch (entry.kind) {
      case 'integer':
      case 'float':
      case 'double':
        return entry.value;
      case 'long':
        return entry.value;
      case 'string': {
        const utf8 = classFile.constantPool[entry.stringIndex];
        if (utf8?.kind !== 'utf8') throw new Error('Invalid string constant');
        return this.string(utf8.value);
      }
      default:
        throw new Error(`Invalid ConstantValue entry ${entry.kind}`);
    }
  }

  private string(value: string): JString {
    return { kind: 'string', cls: 'java/lang/String', value, fields: new Map() };
  }

  private multiArray(descriptor: string, dimensions: readonly number[]): JArray {
    const [length, ...rest] = dimensions;
    if (length === undefined || length < 0) this.throwJava('java/lang/NegativeArraySizeException', 'negative size');
    const childDescriptor = descriptor.slice(1);
    const values = Array.from({ length }, () =>
      rest.length > 0 ? this.multiArray(childDescriptor, rest) : defaultValue(childDescriptor),
    );
    return { kind: 'array', descriptor, values };
  }

  private isAssignable(actual: string, expected: string): boolean {
    if (actual === expected || expected === 'java/lang/Object') return true;
    const builtins: Readonly<Record<string, string>> = {
      'java/lang/NullPointerException': 'java/lang/RuntimeException',
      'java/lang/IllegalArgumentException': 'java/lang/RuntimeException',
      'java/lang/IllegalStateException': 'java/lang/RuntimeException',
      'java/lang/ArithmeticException': 'java/lang/RuntimeException',
      'java/lang/ArrayIndexOutOfBoundsException': 'java/lang/IndexOutOfBoundsException',
      'java/lang/IndexOutOfBoundsException': 'java/lang/RuntimeException',
      'java/lang/ClassCastException': 'java/lang/RuntimeException',
      'java/lang/UnsupportedOperationException': 'java/lang/RuntimeException',
      'java/lang/NegativeArraySizeException': 'java/lang/RuntimeException',
      'java/lang/StringIndexOutOfBoundsException': 'java/lang/IndexOutOfBoundsException',
      'java/lang/RuntimeException': 'java/lang/Exception',
      'java/lang/Exception': 'java/lang/Throwable',
    };
    let current = actual;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      if (current === expected) return true;
      seen.add(current);
      const file = this.classes.get(current);
      const parent = file?.superClass ?? builtins[current];
      if (!parent) return false;
      current = parent;
    }
    return false;
  }

  private throwJava(className: string, message: string): never {
    throw new JavaThrown({ kind: 'object', cls: className, fields: new Map() }, message);
  }

  private bootstrapName(
    classFile: ClassFile,
    constant: Extract<ResolvedConstant, { kind: 'dynamic' }>,
  ): string {
    const methods = classFile.attributes.find((attribute) => attribute.kind === 'bootstrapMethods');
    if (methods?.kind !== 'bootstrapMethods') {
      return `invokedynamic bootstrap #${constant.bootstrapMethodIndex}`;
    }
    const bootstrap = methods.methods[constant.bootstrapMethodIndex];
    if (!bootstrap) return `invokedynamic bootstrap #${constant.bootstrapMethodIndex}`;
    const methodHandle = classFile.constantPool[bootstrap.methodRef];
    if (methodHandle?.kind !== 'methodHandle') return `invokedynamic bootstrap #${constant.bootstrapMethodIndex}`;
    const methodRef = classFile.constantPool[methodHandle.referenceIndex];
    if (methodRef?.kind !== 'methodRef' && methodRef?.kind !== 'interfaceMethodRef') {
      return `invokedynamic bootstrap #${constant.bootstrapMethodIndex}`;
    }
    const nameAndType = classFile.constantPool[methodRef.nameAndTypeIndex];
    const name = nameAndType?.kind === 'nameAndType' ? classFile.constantPool[nameAndType.nameIndex] : null;
    return name?.kind === 'utf8' ? `invokedynamic bootstrap ${name.value}` : 'invokedynamic bootstrap';
  }

  private step(event: StepEvent): void {
    this.steps += 1;
    const budget = this.options.stepBudget ?? 1_000_000;
    if (this.steps > budget) throw new StepBudgetExceeded(budget);
    this.options.onStep?.(event);
  }

  private normalizeInput(value: JvmValue): JvmValue {
    return typeof value === 'string' ? this.string(value) : value;
  }

  private registerNatives(): void {
    this.register('java/lang/Object', '<init>', '()V', () => null);
    this.register('java/lang/Object', 'equals', '(Ljava/lang/Object;)Z', (receiver, [other]) =>
      referenceEquals(receiver, other ?? null) ? 1 : 0,
    );
    this.register('java/lang/Object', 'hashCode', '()I', (receiver) => this.identity(receiver));
    this.register('java/lang/Object', 'toString', '()Ljava/lang/String;', (receiver) =>
      this.string(`${referenceClass(receiver)}@${this.identity(receiver).toString(16)}`),
    );
    this.register('java/lang/Object', 'getClass', '()Ljava/lang/Class;', () => this.newObject('java/lang/Class'));

    this.register('java/lang/String', 'equals', '(Ljava/lang/Object;)Z', (receiver, [other]) =>
      isString(other ?? null) && stringValue(receiver) === stringValue(other ?? null) ? 1 : 0,
    );
    this.register('java/lang/String', 'concat', '(Ljava/lang/String;)Ljava/lang/String;', (receiver, [other]) =>
      this.string(stringValue(receiver) + stringValue(other ?? null)),
    );
    this.register('java/lang/String', 'length', '()I', (receiver) => stringValue(receiver).length);
    this.register('java/lang/String', 'isEmpty', '()Z', (receiver) => (stringValue(receiver).length === 0 ? 1 : 0));
    this.register('java/lang/String', 'isBlank', '()Z', (receiver) => (stringValue(receiver).trim().length === 0 ? 1 : 0));
    this.register('java/lang/String', 'startsWith', '(Ljava/lang/String;)Z', (receiver, [prefix]) =>
      stringValue(receiver).startsWith(stringValue(prefix ?? null)) ? 1 : 0,
    );
    this.register('java/lang/String', 'endsWith', '(Ljava/lang/String;)Z', (receiver, [suffix]) =>
      stringValue(receiver).endsWith(stringValue(suffix ?? null)) ? 1 : 0,
    );
    this.register('java/lang/String', 'contains', '(Ljava/lang/CharSequence;)Z', (receiver, [part]) =>
      stringValue(receiver).includes(stringValue(part ?? null)) ? 1 : 0,
    );
    this.register('java/lang/String', 'trim', '()Ljava/lang/String;', (receiver) => this.string(stringValue(receiver).trim()));
    this.register('java/lang/String', 'toUpperCase', '()Ljava/lang/String;', (receiver) =>
      this.string(stringValue(receiver).toUpperCase()),
    );
    this.register('java/lang/String', 'toLowerCase', '()Ljava/lang/String;', (receiver) =>
      this.string(stringValue(receiver).toLowerCase()),
    );
    this.register('java/lang/String', 'charAt', '(I)C', (receiver, [index]) => {
      const string = stringValue(receiver);
      const position = intValue(index ?? 0);
      if (position < 0 || position >= string.length) {
        this.throwJava('java/lang/StringIndexOutOfBoundsException', String(position));
      }
      return string.charCodeAt(position);
    });
    this.register('java/lang/String', 'compareTo', '(Ljava/lang/String;)I', (receiver, [other]) =>
      compareStrings(stringValue(receiver), stringValue(other ?? null)),
    );
    this.register('java/lang/String', 'equalsIgnoreCase', '(Ljava/lang/String;)Z', (receiver, [other]) =>
      stringValue(receiver).toLowerCase() === stringValue(other ?? null).toLowerCase() ? 1 : 0,
    );
    this.register('java/lang/String', 'hashCode', '()I', (receiver) => javaStringHash(stringValue(receiver)));
    this.register('java/lang/String', 'valueOf', '(Ljava/lang/Object;)Ljava/lang/String;', (_receiver, [value]) =>
      this.string(renderJvmValue(value ?? null)),
    );
    for (const [descriptor, render] of [
      ['(Z)Ljava/lang/String;', (value: JvmValue) => (intValue(value) === 0 ? 'false' : 'true')],
      ['(C)Ljava/lang/String;', (value: JvmValue) => String.fromCharCode(intValue(value))],
      ['(I)Ljava/lang/String;', (value: JvmValue) => String(intValue(value))],
      ['(J)Ljava/lang/String;', (value: JvmValue) => String(bigintValue(value))],
      ['(F)Ljava/lang/String;', (value: JvmValue) => String(numberValue(value))],
      ['(D)Ljava/lang/String;', (value: JvmValue) => String(numberValue(value))],
    ] as const) {
      this.register('java/lang/String', 'valueOf', descriptor, (_receiver, [value]) =>
        this.string(render(value ?? 0)),
      );
    }
    this.register('java/lang/String', 'valueOf', '([C)Ljava/lang/String;', (_receiver, [value]) => {
      if (value === null || value === undefined) this.throwJava('java/lang/NullPointerException', '');
      return this.string(requireArray(value).values.map((item) => String.fromCharCode(intValue(item))).join(''));
    });

    this.register('java/lang/StringBuilder', '<init>', '()V', (receiver) => {
      requireObject(receiver).fields.set('$value', this.string(''));
      return null;
    });
    this.register('java/lang/StringBuilder', '<init>', '(Ljava/lang/String;)V', (receiver, [initial]) => {
      requireObject(receiver).fields.set('$value', this.string(stringValue(initial ?? null)));
      return null;
    });
    for (const [descriptor, render] of [
      ['(Ljava/lang/String;)Ljava/lang/StringBuilder;', (value: JvmValue) => stringValue(value)],
      ['(Ljava/lang/Object;)Ljava/lang/StringBuilder;', (value: JvmValue) => renderJvmValue(value)],
      ['(I)Ljava/lang/StringBuilder;', (value: JvmValue) => String(intValue(value))],
      ['(J)Ljava/lang/StringBuilder;', (value: JvmValue) => String(bigintValue(value))],
      ['(Z)Ljava/lang/StringBuilder;', (value: JvmValue) => (intValue(value) !== 0 ? 'true' : 'false')],
      ['(C)Ljava/lang/StringBuilder;', (value: JvmValue) => String.fromCharCode(intValue(value))],
      ['(F)Ljava/lang/StringBuilder;', (value: JvmValue) => String(numberValue(value))],
      ['(D)Ljava/lang/StringBuilder;', (value: JvmValue) => String(numberValue(value))],
    ] as const) {
      this.register('java/lang/StringBuilder', 'append', descriptor, (receiver, [value]) => {
        const object = requireObject(receiver);
        const current = stringValue(object.fields.get('$value') ?? null);
        object.fields.set('$value', this.string(current + render(value ?? null)));
        return receiver;
      });
    }
    this.register('java/lang/StringBuilder', 'toString', '()Ljava/lang/String;', (receiver) =>
      this.string(stringValue(requireObject(receiver).fields.get('$value') ?? null)),
    );
    this.register('java/lang/StringBuilder', 'length', '()I', (receiver) =>
      stringValue(requireObject(receiver).fields.get('$value') ?? null).length,
    );

    this.register('java/lang/Math', 'min', '(II)I', (_receiver, [left, right]) => Math.min(intValue(left ?? 0), intValue(right ?? 0)));
    this.register('java/lang/Math', 'max', '(II)I', (_receiver, [left, right]) => Math.max(intValue(left ?? 0), intValue(right ?? 0)));
    this.register('java/lang/Math', 'abs', '(I)I', (_receiver, [value]) => Math.abs(intValue(value ?? 0)));
    this.register('java/lang/Math', 'min', '(JJ)J', (_receiver, [left, right]) => {
      const a = bigintValue(left ?? 0n);
      const b = bigintValue(right ?? 0n);
      return a < b ? a : b;
    });
    this.register('java/lang/Math', 'max', '(JJ)J', (_receiver, [left, right]) => {
      const a = bigintValue(left ?? 0n);
      const b = bigintValue(right ?? 0n);
      return a > b ? a : b;
    });
    this.register('java/lang/Math', 'abs', '(J)J', (_receiver, [value]) => {
      const number = bigintValue(value ?? 0n);
      return number < 0n ? -number : number;
    });
    this.register('java/lang/Math', 'min', '(DD)D', (_receiver, [left, right]) =>
      Math.min(numberValue(left ?? 0), numberValue(right ?? 0)),
    );
    this.register('java/lang/Math', 'max', '(DD)D', (_receiver, [left, right]) =>
      Math.max(numberValue(left ?? 0), numberValue(right ?? 0)),
    );
    this.register('java/lang/Math', 'abs', '(D)D', (_receiver, [value]) =>
      Math.abs(numberValue(value ?? 0)),
    );
    this.registerBoxedAndUtilities();
    this.registerCollections();
  }

  private registerBoxedAndUtilities(): void {
    this.register('java/lang/String', 'toString', '()Ljava/lang/String;', (receiver) => receiver);
    for (const [owner, boxed, unboxed, convert, parse] of [
      ['java/lang/Integer', '(I)Ljava/lang/Integer;', 'intValue()I', (value: JvmValue) => intValue(value), 'parseInt(Ljava/lang/String;)I'],
      ['java/lang/Long', '(J)Ljava/lang/Long;', 'longValue()J', (value: JvmValue) => bigintValue(value), 'parseLong(Ljava/lang/String;)J'],
      ['java/lang/Double', '(D)Ljava/lang/Double;', 'doubleValue()D', (value: JvmValue) => numberValue(value), 'parseDouble(Ljava/lang/String;)D'],
      ['java/lang/Boolean', '(Z)Ljava/lang/Boolean;', 'booleanValue()Z', (value: JvmValue) => intValue(value) === 0 ? 0 : 1, ''],
    ] as const) {
      const objectName = owner;
      const valueDescriptor = boxed.slice(1, boxed.indexOf(')'));
      this.register(objectName, 'valueOf', boxed, (_receiver, [value]) => ({
        kind: 'object',
        cls: objectName,
        fields: new Map([['$value', convert(value ?? 0)]]),
      }));
      const unboxName = unboxed.slice(0, unboxed.indexOf('('));
      const unboxDescriptor = `()${unboxed.slice(unboxed.indexOf(')') + 1)}`;
      this.register(objectName, unboxName, unboxDescriptor, (receiver) =>
        requireObject(receiver).fields.get('$value') ?? 0,
      );
      if (parse) {
        this.register(objectName, parse.slice(0, parse.indexOf('(')), `(${parse.slice(parse.indexOf('(') + 1, parse.indexOf(')'))})${parse.slice(parse.indexOf(')') + 1)}`, (_receiver, [text]) => {
          const string = stringValue(text ?? null);
          if (objectName === 'java/lang/Integer') return int(Number.parseInt(string, 10));
          if (objectName === 'java/lang/Long') return BigInt(string);
          return Number.parseFloat(string);
        });
      }
      this.register(objectName, 'compare', `(${valueDescriptor}${valueDescriptor})I`, (_receiver, [left, right]) => {
        const a = convert(left ?? 0);
        const b = convert(right ?? 0);
        if (typeof a === 'bigint' && typeof b === 'bigint') return a > b ? 1 : a < b ? -1 : 0;
        const numberA = Number(a);
        const numberB = Number(b);
        return numberA > numberB ? 1 : numberA < numberB ? -1 : 0;
      });
    }
    this.register('java/util/Objects', 'equals', '(Ljava/lang/Object;Ljava/lang/Object;)Z', (_receiver, [left, right]) =>
      valuesEqual(left ?? null, right ?? null) ? 1 : 0,
    );
    this.register('java/util/Objects', 'isNull', '(Ljava/lang/Object;)Z', (_receiver, [value]) =>
      value === null ? 1 : 0,
    );
    this.register('java/util/Objects', 'nonNull', '(Ljava/lang/Object;)Z', (_receiver, [value]) =>
      value === null ? 0 : 1,
    );
    this.register('java/util/Objects', 'requireNonNull', '(Ljava/lang/Object;)Ljava/lang/Object;', (_receiver, [value]) => {
      if (value === null || value === undefined) this.throwJava('java/lang/NullPointerException', '');
      return value;
    });
    this.register('java/util/Objects', 'hash', '([Ljava/lang/Object;)I', (_receiver, [values]) => {
      if (values === null || values === undefined) return 0;
      const array = requireArray(values);
      return array.values.reduce<number>((hash, value) => int(31 * hash + hashValue(value)), 1);
    });
  }

  private registerCollections(): void {
    this.register('java/util/ArrayList', '<init>', '()V', (receiver) => {
      this.listArray(receiver).values.length = 0;
      return null;
    });
    this.register('java/util/ArrayList', '<init>', '(I)V', (receiver) => {
      this.listArray(receiver).values.length = 0;
      return null;
    });
    this.register('java/util/ArrayList', '<init>', '(Ljava/util/Collection;)V', (receiver, [source]) => {
      this.listArray(receiver).values.push(...this.listValues(source ?? null));
      return null;
    });
    const listMethods: readonly [string, NativeFunction][] = [
      ['add(Ljava/lang/Object;)Z', (receiver, [value]) => {
        this.assertMutableList(receiver);
        this.listValues(receiver).push(value ?? null);
        return 1;
      }],
      ['get(I)Ljava/lang/Object;', (receiver, [index]) =>
        this.listElement(receiver, intValue(index ?? 0)),
      ],
      ['size()I', (receiver) => this.listValues(receiver).length],
      ['isEmpty()Z', (receiver) => (this.listValues(receiver).length === 0 ? 1 : 0)],
      ['contains(Ljava/lang/Object;)Z', (receiver, [value]) => this.listContains(receiver, value ?? null) ? 1 : 0],
      ['iterator()Ljava/util/Iterator;', (receiver) => ({
        kind: 'object',
        cls: 'java/util/ArrayList$Iterator',
        fields: new Map([['$list', receiver], ['$index', 0]]),
      })],
    ];
    for (const [signature, native] of listMethods) {
      const nameEnd = signature.indexOf('(');
      const name = signature.slice(0, nameEnd);
      const descriptor = signature.slice(nameEnd);
      this.register('java/util/List', name, descriptor, native);
      this.register('java/util/Collection', name, descriptor, native);
      this.register('java/util/ArrayList', name, descriptor, native);
    }
    this.register('java/util/Iterator', 'hasNext', '()Z', (receiver) => {
      const object = requireObject(receiver);
      const list = object.fields.get('$list') ?? null;
      return intValue(object.fields.get('$index') ?? 0) < this.listValues(list).length ? 1 : 0;
    });
    this.register('java/util/ArrayList$Iterator', 'hasNext', '()Z', (receiver, args) =>
      this.callNative('java/util/Iterator.hasNext()Z', receiver, args),
    );
    this.register('java/util/Iterator', 'next', '()Ljava/lang/Object;', (receiver) => {
      const object = requireObject(receiver);
      const list = object.fields.get('$list') ?? null;
      const index = intValue(object.fields.get('$index') ?? 0);
      if (index >= this.listValues(list).length) this.throwJava('java/util/NoSuchElementException', '');
      object.fields.set('$index', index + 1);
      return this.listElement(list, index);
    });
    this.register('java/util/ArrayList$Iterator', 'next', '()Ljava/lang/Object;', (receiver, args) =>
      this.callNative('java/util/Iterator.next()Ljava/lang/Object;', receiver, args),
    );

    this.register('java/util/HashMap', '<init>', '()V', (receiver) => {
      this.mapValues.set(requireObject(receiver), new Map());
      return null;
    });
    this.register('java/util/Map', 'get', '(Ljava/lang/Object;)Ljava/lang/Object;', (receiver, [key]) =>
      this.mapGet(receiver, key ?? null) ?? null,
    );
    this.register('java/util/Map', 'put', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', (receiver, [key, value]) =>
      this.mapPut(receiver, key ?? null, value ?? null),
    );
    this.register('java/util/Map', 'containsKey', '(Ljava/lang/Object;)Z', (receiver, [key]) =>
      this.mapHas(receiver, key ?? null) ? 1 : 0,
    );
    this.register('java/util/Map', 'getOrDefault', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', (receiver, [key, fallback]) =>
      this.mapHas(receiver, key ?? null) ? this.mapGet(receiver, key ?? null) ?? null : fallback ?? null,
    );
    this.register('java/util/Map', 'size', '()I', (receiver) => this.mapFor(receiver).size);
    this.register('java/util/Map', 'keySet', '()Ljava/util/Set;', (receiver) => {
      const set = { kind: 'object', cls: 'java/util/HashSet', fields: new Map<string, JvmValue>() } satisfies JObject;
      this.setValues.set(set, [...this.mapFor(receiver).keys()]);
      return set;
    });
    this.register('java/util/HashMap', 'get', '(Ljava/lang/Object;)Ljava/lang/Object;', (receiver, args) =>
      this.callNative('java/util/Map.get(Ljava/lang/Object;)Ljava/lang/Object;', receiver, args),
    );
    this.register('java/util/HashMap', 'put', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', (receiver, args) =>
      this.callNative('java/util/Map.put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', receiver, args),
    );
    this.register('java/util/HashMap', 'containsKey', '(Ljava/lang/Object;)Z', (receiver, args) =>
      this.callNative('java/util/Map.containsKey(Ljava/lang/Object;)Z', receiver, args),
    );
    this.register('java/util/HashMap', 'getOrDefault', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', (receiver, args) =>
      this.callNative('java/util/Map.getOrDefault(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', receiver, args),
    );
    this.register('java/util/HashMap', 'size', '()I', (receiver, args) =>
      this.callNative('java/util/Map.size()I', receiver, args),
    );
    this.register('java/util/HashMap', 'keySet', '()Ljava/util/Set;', (receiver, args) =>
      this.callNative('java/util/Map.keySet()Ljava/util/Set;', receiver, args),
    );

    this.register('java/util/HashSet', '<init>', '()V', (receiver) => {
      this.setValues.set(requireObject(receiver), []);
      return null;
    });
    this.register('java/util/Set', 'add', '(Ljava/lang/Object;)Z', (receiver, [value]) => {
      this.assertMutableSet(receiver);
      const values = this.setFor(receiver);
      if (values.some((existing) => valuesEqual(existing, value ?? null))) return 0;
      values.push(value ?? null);
      return 1;
    });
    this.register('java/util/Set', 'contains', '(Ljava/lang/Object;)Z', (receiver, [value]) =>
      this.setContains(receiver, value ?? null) ? 1 : 0,
    );
    this.register('java/util/Set', 'size', '()I', (receiver) => this.setFor(receiver).length);
    for (const [name, descriptor] of [
      ['add', '(Ljava/lang/Object;)Z'],
      ['contains', '(Ljava/lang/Object;)Z'],
      ['size', '()I'],
    ] as const) {
      this.register('java/util/HashSet', name, descriptor, (receiver, args) =>
        this.callNative(`java/util/Set.${name}${descriptor}`, receiver, args),
      );
    }
    this.register('java/util/Set', 'iterator', '()Ljava/util/Iterator;', (receiver) => ({
      kind: 'object',
      cls: 'java/util/ArrayList$Iterator',
      fields: new Map<string, JvmValue>([
        ['$list', this.newList(this.setFor(receiver))],
        ['$index', 0],
      ]),
    }));
    this.register('java/util/HashSet', 'iterator', '()Ljava/util/Iterator;', (receiver, args) =>
      this.callNative('java/util/Set.iterator()Ljava/util/Iterator;', receiver, args),
    );

    this.register('java/util/List', 'of', '()Ljava/util/List;', () => this.immutableList([]));
    this.register('java/util/Set', 'of', '()Ljava/util/Set;', () => this.immutableSet([]));
    this.register('java/util/Map', 'of', '()Ljava/util/Map;', () => this.immutableMap([]));
    for (const count of [1, 2, 3, 4, 5]) {
      const args = Array.from({ length: count }, () => 'Ljava/lang/Object;').join('');
      this.register('java/util/List', 'of', `(${args})Ljava/util/List;`, (_receiver, values) =>
        this.immutableList(values),
      );
      this.register('java/util/Set', 'of', `(${args})Ljava/util/Set;`, (_receiver, values) =>
        this.immutableSet(values),
      );
    }
    for (let pairs = 1; pairs <= 5; pairs += 1) {
      const descriptor = `(${Array.from({ length: pairs * 2 }, () => 'Ljava/lang/Object;').join('')})Ljava/util/Map;`;
      this.register('java/util/Map', 'of', descriptor, (_receiver, values) => {
        const entries: [JvmValue, JvmValue][] = [];
        for (let index = 0; index < values.length; index += 2) {
          const key = values[index] ?? null;
          if (entries.some(([existing]) => valuesEqual(existing, key))) {
            this.throwJava('java/lang/IllegalArgumentException', 'duplicate key');
          }
          entries.push([key, values[index + 1] ?? null]);
        }
        return this.immutableMap(entries);
      });
    }
    this.register('java/util/Collections', 'emptyList', '()Ljava/util/List;', () => ({
      kind: 'object',
      cls: 'java/util/Collections$EmptyList',
      fields: new Map(),
    }));
    this.register('java/util/Collections', 'unmodifiableList', '(Ljava/util/List;)Ljava/util/List;', (_receiver, [list]) => {
      const wrapper: JObject = {
        kind: 'object',
        cls: 'java/util/Collections$UnmodifiableList',
        fields: new Map([['$delegate', list ?? null]]),
      };
      return wrapper;
    });
    this.register('java/util/Collections', 'unmodifiableSet', '(Ljava/util/Set;)Ljava/util/Set;', (_receiver, [set]) => ({
      kind: 'object',
      cls: 'java/util/Collections$UnmodifiableSet',
      fields: new Map([['$delegate', set ?? null]]),
    }));
  }

  private listArray(receiver: JvmValue): JArray {
    const object = requireObject(receiver);
    const existing = object.fields.get('$elements');
    if (existing && typeof existing === 'object' && existing.kind === 'array') return existing;
    const array: JArray = { kind: 'array', descriptor: '[Ljava/lang/Object;', values: [] };
    object.fields.set('$elements', array);
    return array;
  }

  private listValues(receiver: JvmValue): JvmValue[] {
    if (receiver === null) this.throwJava('java/lang/NullPointerException', 'list receiver');
    const object = requireObject(receiver);
    if (object.cls === 'java/util/Collections$UnmodifiableList') {
      return this.listValues(object.fields.get('$delegate') ?? null);
    }
    if (object.cls === 'java/util/Collections$EmptyList') return [];
    return this.listArray(object).values;
  }

  private listContains(receiver: JvmValue, value: JvmValue): boolean {
    if (receiver === null) this.throwJava('java/lang/NullPointerException', 'list receiver');
    const object = requireObject(receiver);
    if (object.cls === 'java/util/Collections$UnmodifiableList') {
      return this.listContains(object.fields.get('$delegate') ?? null, value);
    }
    if (object.cls === 'java/util/Collections$EmptyList') return false;
    if (value === null && object.cls === 'java/util/ImmutableCollections$ListN') {
      this.throwJava('java/lang/NullPointerException', '');
    }
    return this.listValues(object).some((item) => valuesEqual(item, value));
  }

  private listElement(receiver: JvmValue, index: number): JvmValue {
    const values = this.listValues(receiver);
    if (index < 0 || index >= values.length) {
      this.throwJava('java/lang/IndexOutOfBoundsException', String(index));
    }
    return values[index] ?? null;
  }

  private assertMutableList(receiver: JvmValue): void {
    if (
      receiver !== null &&
      ['java/util/Collections$UnmodifiableList', 'java/util/Collections$EmptyList', 'java/util/ImmutableCollections$ListN']
        .includes(requireObject(receiver).cls)
    ) {
      this.throwJava('java/lang/UnsupportedOperationException', '');
    }
  }

  private mapFor(receiver: JvmValue): Map<JvmValue, JvmValue> {
    const object = requireObject(receiver);
    if (object.cls === 'java/util/Collections$UnmodifiableMap') {
      return this.mapFor(object.fields.get('$delegate') ?? null);
    }
    let values = this.mapValues.get(object);
    if (!values) {
      values = new Map();
      this.mapValues.set(object, values);
    }
    return values;
  }

  private mapGet(receiver: JvmValue, key: JvmValue): JvmValue | undefined {
    for (const [candidate, value] of this.mapFor(receiver)) {
      if (valuesEqual(candidate, key)) return value;
    }
    return undefined;
  }

  private mapHas(receiver: JvmValue, key: JvmValue): boolean {
    return [...this.mapFor(receiver).keys()].some((candidate) => valuesEqual(candidate, key));
  }

  private mapPut(receiver: JvmValue, key: JvmValue, value: JvmValue): JvmValue {
    if (receiver !== null && requireObject(receiver).cls === 'java/util/Collections$UnmodifiableMap') {
      this.throwJava('java/lang/UnsupportedOperationException', '');
    }
    const map = this.mapFor(receiver);
    for (const [candidate, existing] of map) {
      if (valuesEqual(candidate, key)) {
        map.set(candidate, value);
        return existing;
      }
    }
    map.set(key, value);
    return null;
  }

  private setFor(receiver: JvmValue): JvmValue[] {
    const object = requireObject(receiver);
    if (object.cls === 'java/util/Collections$UnmodifiableSet') {
      return this.setFor(object.fields.get('$delegate') ?? null);
    }
    let values = this.setValues.get(object);
    if (!values) {
      values = [];
      this.setValues.set(object, values);
    }
    return values;
  }

  private setContains(receiver: JvmValue, value: JvmValue): boolean {
    if (receiver === null) this.throwJava('java/lang/NullPointerException', 'set receiver');
    const object = requireObject(receiver);
    if (object.cls === 'java/util/Collections$UnmodifiableSet') {
      return this.setContains(object.fields.get('$delegate') ?? null, value);
    }
    if (value === null && object.cls === 'java/util/ImmutableCollections$SetN') {
      this.throwJava('java/lang/NullPointerException', '');
    }
    return this.setFor(object).some((existing) => valuesEqual(existing, value));
  }

  private assertMutableSet(receiver: JvmValue): void {
    if (
      receiver !== null &&
      ['java/util/Collections$UnmodifiableSet', 'java/util/ImmutableCollections$SetN']
        .includes(requireObject(receiver).cls)
    ) {
      this.throwJava('java/lang/UnsupportedOperationException', '');
    }
  }

  private newList(values: readonly JvmValue[]): JObject {
    const list: JObject = {
      kind: 'object',
      cls: 'java/util/ArrayList',
      fields: new Map([
        ['$elements', { kind: 'array', descriptor: '[Ljava/lang/Object;', values: [...values] } satisfies JArray],
      ]),
    };
    return list;
  }

  private immutableList(values: readonly JvmValue[]): JObject {
    if (values.some((value) => value === null)) this.throwJava('java/lang/NullPointerException', '');
    return {
      kind: 'object',
      cls: 'java/util/ImmutableCollections$ListN',
      fields: new Map([
        ['$elements', { kind: 'array', descriptor: '[Ljava/lang/Object;', values: [...values] } satisfies JArray],
      ]),
    };
  }

  private newSet(values: readonly JvmValue[] = []): JObject {
    const set: JObject = { kind: 'object', cls: 'java/util/HashSet', fields: new Map() };
    this.setValues.set(set, []);
    for (const value of values) {
      const current = this.setFor(set);
      if (!current.some((existing) => valuesEqual(existing, value))) current.push(value);
    }
    return set;
  }

  private immutableSet(values: readonly JvmValue[]): JObject {
    const unique: JvmValue[] = [];
    for (const value of values) {
      if (value === null) this.throwJava('java/lang/NullPointerException', '');
      if (unique.some((existing) => valuesEqual(existing, value))) {
        this.throwJava('java/lang/IllegalArgumentException', 'duplicate element');
      }
      unique.push(value);
    }
    return this.newImmutableSet(unique);
  }

  private newImmutableSet(values: readonly JvmValue[]): JObject {
    const set: JObject = { kind: 'object', cls: 'java/util/ImmutableCollections$SetN', fields: new Map() };
    this.setValues.set(set, [...values]);
    return set;
  }

  private newMap(): JObject {
    const map: JObject = { kind: 'object', cls: 'java/util/HashMap', fields: new Map() };
    this.mapValues.set(map, new Map());
    return map;
  }

  private immutableMap(entries: readonly (readonly [JvmValue, JvmValue])[]): JObject {
    const map = this.newMap();
    for (const [key, value] of entries) this.mapPut(map, key, value);
    return {
      kind: 'object',
      cls: 'java/util/Collections$UnmodifiableMap',
      fields: new Map([['$delegate', map]]),
    };
  }

  private register(owner: string, name: string, descriptor: string, native: NativeFunction): void {
    this.natives.set(`${owner}.${name}${descriptor}`, native);
  }

  private callNative(key: string, receiver: JvmValue, args: readonly JvmValue[]): JvmValue {
    const native = this.natives.get(key);
    if (!native) throw new Error(`Missing native implementation ${key}`);
    return native(receiver, args);
  }

  private identity(value: JvmValue): number {
    if (value === null) this.throwJava('java/lang/NullPointerException', 'null identity');
    if (typeof value === 'number' || typeof value === 'bigint') return javaStringHash(String(value));
    if (isString(value)) return javaStringHash(value.value);
    if (value.kind === 'array') return javaStringHash(`${value.descriptor}:${this.nextIdentity++}`);
    const existing = value.fields.get('$identity');
    if (typeof existing === 'number') return existing;
    const identity = this.nextIdentity++;
    value.fields.set('$identity', identity);
    return identity;
  }
}

function executeArithmetic(
  opcode: number,
  pop: () => JvmValue,
  push: (value: JvmValue, size?: 1 | 2) => void,
  arithmeticError: (message: string) => never,
): void {
  const isLong = [0x61, 0x65, 0x69, 0x6d, 0x71].includes(opcode);
  const isFloat = opcode === 0x62 || opcode === 0x66 || opcode === 0x6a || opcode === 0x6e || opcode === 0x72;
  const isDouble = opcode === 0x63 || opcode === 0x67 || opcode === 0x6b || opcode === 0x6f || opcode === 0x73;
  if (opcode >= 0x60 && opcode <= 0x73) {
    const rightValue = pop();
    const leftValue = pop();
    if (isLong) {
      const right = bigintValue(rightValue);
      const left = bigintValue(leftValue);
      const base = opcode & 0xfc;
      if (base === 0x6c && right === 0n) arithmeticError('/ by zero');
      if (base === 0x70 && right === 0n) arithmeticError('/ by zero');
      const result =
        base === 0x60 ? left + right :
        base === 0x64 ? left - right :
        base === 0x68 ? left * right :
        base === 0x6c ? left / right :
        base === 0x70 ? left % right :
        (() => { throw new Error(`Invalid long arithmetic opcode ${opcode}`); })();
      push(BigInt.asIntN(64, result), 2);
    } else if (isFloat || isDouble) {
      const right = numberValue(rightValue);
      const left = numberValue(leftValue);
      const base = opcode & 0xfc;
      const result =
        base === 0x60 ? left + right :
        base === 0x64 ? left - right :
        base === 0x68 ? left * right :
        base === 0x6c ? left / right :
        base === 0x70 ? left % right :
        (() => { throw new Error(`Invalid floating arithmetic opcode ${opcode}`); })();
      push(isFloat ? Math.fround(result) : result, isDouble ? 2 : 1);
    } else {
      const right = intValue(rightValue);
      const left = intValue(leftValue);
      if ((opcode === 0x6c || opcode === 0x70) && right === 0) arithmeticError('/ by zero');
      const result =
        opcode === 0x60 ? left + right :
        opcode === 0x64 ? left - right :
        opcode === 0x68 ? left * right :
        opcode === 0x6c ? Math.trunc(left / right) :
        opcode === 0x70 ? left % right :
        (() => { throw new Error(`Invalid int arithmetic opcode ${opcode}`); })();
      push(int(result));
    }
    return;
  }
  if (opcode >= 0x74 && opcode <= 0x77) {
    const value = pop();
    push(opcode === 0x75 ? BigInt.asIntN(64, -bigintValue(value)) : opcode === 0x74 ? int(-intValue(value)) : -numberValue(value), opcode === 0x75 || opcode === 0x77 ? 2 : 1);
    return;
  }
  if (opcode >= 0x78 && opcode <= 0x7d) {
    const shift = intValue(pop());
    const value = pop();
    const amount = shift & (opcode === 0x79 || opcode === 0x7b || opcode === 0x7d ? 63 : 31);
    if (opcode === 0x78) push(int(intValue(value) << amount));
    else if (opcode === 0x7a) push(int(intValue(value) >> amount));
    else if (opcode === 0x7c) push(int(intValue(value) >>> amount));
    else if (opcode === 0x79) push(BigInt.asIntN(64, bigintValue(value) << BigInt(amount)), 2);
    else if (opcode === 0x7b) push(bigintValue(value) >> BigInt(amount), 2);
    else push(BigInt.asIntN(64, BigInt.asUintN(64, bigintValue(value)) >> BigInt(amount)), 2);
    return;
  }
  const right = pop();
  const left = pop();
  const long = opcode === 0x7f || opcode === 0x81 || opcode === 0x83;
  const result =
    opcode === 0x7e || opcode === 0x7f
      ? (long ? bigintValue(left) & bigintValue(right) : intValue(left) & intValue(right))
      : opcode === 0x80 || opcode === 0x81
        ? (long ? bigintValue(left) | bigintValue(right) : intValue(left) | intValue(right))
        : long
          ? bigintValue(left) ^ bigintValue(right)
          : intValue(left) ^ intValue(right);
  push(long ? BigInt.asIntN(64, result as bigint) : int(result as number), long ? 2 : 1);
}

function executeConversion(
  opcode: number,
  pop: () => JvmValue,
  push: (value: JvmValue, size?: 1 | 2) => void,
): void {
  const value = pop();
  switch (opcode) {
    case 0x85: push(BigInt(intValue(value)), 2); break;
    case 0x86: push(Math.fround(intValue(value))); break;
    case 0x87: push(intValue(value), 2); break;
    case 0x88: push(intNumber(bigintValue(value))); break;
    case 0x89: push(Math.fround(Number(bigintValue(value)))); break;
    case 0x8a: push(Number(bigintValue(value)), 2); break;
    case 0x8b: push(floatToInt(numberValue(value))); break;
    case 0x8c: push(BigInt(floatToInt(numberValue(value))), 2); break;
    case 0x8d: push(Math.fround(numberValue(value))); break;
    case 0x8e: push(floatToInt(numberValue(value))); break;
    case 0x8f: push(BigInt(floatToInt(numberValue(value))), 2); break;
    case 0x90: push(numberValue(value), 2); break;
    case 0x91: push((intValue(value) << 24) >> 24); break;
    case 0x92: push(intValue(value) & 0xffff); break;
    case 0x93: push((intValue(value) << 16) >> 16); break;
    default: throw new Error(`Unknown conversion opcode ${opcode}`);
  }
}

function executeStackOpcode(opcode: number, stack: RuntimeSlot[]): void {
  const pop = (): RuntimeSlot => {
    const value = stack.pop();
    if (!value) throw new Error('Operand stack underflow');
    return value;
  };
  const top = pop();
  if (opcode === 0x57) {
    if (top.size !== 1) throw new Error('pop requires category-1');
  } else if (opcode === 0x58) {
    if (top.size === 1 && pop().size !== 1) throw new Error('Invalid pop2 form');
  } else if (opcode === 0x59) {
    if (top.size !== 1) throw new Error('Invalid dup form');
    stack.push(top, top);
  } else if (opcode === 0x5a) {
    const below = pop();
    if (top.size !== 1 || below.size !== 1) throw new Error('Invalid dup_x1 form');
    stack.push(top, below, top);
  } else if (opcode === 0x5b) {
    const below = pop();
    if (top.size !== 1) throw new Error('Invalid dup_x2 form');
    if (below.size === 2) stack.push(top, below, top);
    else {
      const third = pop();
      if (third.size !== 1) throw new Error('Invalid dup_x2 form');
      stack.push(top, third, below, top);
    }
  } else if (opcode === 0x5c) {
    if (top.size === 2) stack.push(top, top);
    else {
      const below = pop();
      if (below.size !== 1) throw new Error('Invalid dup2 form');
      stack.push(below, top, below, top);
    }
  } else if (opcode === 0x5d) {
    if (top.size === 2) {
      const below = pop();
      if (below.size !== 1) throw new Error('Invalid dup2_x1 form');
      stack.push(top, below, top);
    } else {
      const below = pop();
      const third = pop();
      if (below.size !== 1 || third.size !== 1) throw new Error('Invalid dup2_x1 form');
      stack.push(below, top, third, below, top);
    }
  } else if (opcode === 0x5e) {
    if (top.size === 2) {
      const below = pop();
      if (below.size === 2) stack.push(top, below, top);
      else {
        const third = pop();
        if (third.size !== 1) throw new Error('Invalid dup2_x2 form');
        stack.push(top, third, below, top);
      }
    } else {
      const below = pop();
      if (below.size !== 1) throw new Error('Invalid dup2_x2 form');
      const third = pop();
      if (third.size === 2) stack.push(below, top, third, below, top);
      else {
        const fourth = pop();
        if (fourth.size !== 1) throw new Error('Invalid dup2_x2 form');
        stack.push(below, top, fourth, third, below, top);
      }
    }
  } else if (opcode === 0x5f) {
    const below = pop();
    if (top.size !== 1 || below.size !== 1) throw new Error('Invalid swap form');
    stack.push(top, below);
  }
}

function localValue(locals: readonly (RuntimeSlot | undefined)[], index: number): RuntimeSlot {
  const result = locals[index];
  if (!result) throw new Error(`Invalid or uninitialized local ${index}`);
  return result;
}

function setLocal(locals: (RuntimeSlot | undefined)[], index: number, value: RuntimeSlot): void {
  if (index < 0 || index >= locals.length) throw new Error(`Invalid local index ${index}`);
  locals[index] = value;
  if (value.size === 2 && index + 1 < locals.length) locals[index + 1] = value;
}

function typeSize(type: { readonly kind: string; readonly name?: string }): 1 | 2 {
  return type.kind === 'primitive' && (type.name === 'long' || type.name === 'double') ? 2 : 1;
}

function opcodeValueSize(opcode: number): 1 | 2 {
  return opcode === 0x16 || opcode === 0x18 ? 2 : 1;
}

function int(value: number): number {
  return value | 0;
}

function intValue(value: JvmValue): number {
  if (typeof value !== 'number') throw new Error(`Expected numeric int, received ${typeof value}`);
  return value | 0;
}

function numberValue(value: JvmValue): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number') throw new Error('Expected numeric value');
  return value;
}

function bigintValue(value: JvmValue): bigint {
  if (typeof value !== 'bigint') throw new Error('Expected long value');
  return value;
}

function intNumber(value: bigint): number {
  return Number(BigInt.asIntN(32, value));
}

function floatToInt(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value >= 0x7fffffff) return 0x7fffffff;
  if (value <= -0x80000000) return -0x80000000;
  return Math.trunc(value) | 0;
}

function compare(opcode: number, left: JvmValue, right: JvmValue): number {
  if (opcode === 0x94) {
    const a = bigintValue(left);
    const b = bigintValue(right);
    return a > b ? 1 : a < b ? -1 : 0;
  }
  const a = numberValue(left);
  const b = numberValue(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return opcode === 0x95 || opcode === 0x97 ? -1 : 1;
  return a > b ? 1 : a < b ? -1 : 0;
}

function requireObject(value: JvmValue): JObject {
  if (value === null) throw new Error('Expected non-null object');
  if (typeof value !== 'object') throw new Error(`Expected object, received ${typeof value}`);
  if (value.kind !== 'object') throw new Error(`Expected object, received ${value.kind}`);
  return value;
}

function requireArray(value: JvmValue): JArray {
  if (value === null) throw new Error('Expected non-null array');
  if (typeof value !== 'object') throw new Error(`Expected array, received ${typeof value}`);
  if (value.kind !== 'array') throw new Error(`Expected array, received ${value.kind}`);
  return value;
}

function isObject(value: JvmValue): value is JObject {
  return typeof value === 'object' && value !== null && value.kind === 'object';
}

function isString(value: JvmValue): value is JString {
  return typeof value === 'object' && value !== null && value.kind === 'string';
}

function referenceClass(value: JvmValue): string {
  if (value === null) return 'null';
  if (typeof value !== 'object') throw new Error(`Expected reference, received ${typeof value}`);
  return value.kind === 'array' ? value.descriptor : value.cls;
}

function referenceEquals(left: JvmValue, right: JvmValue): boolean {
  return left === right;
}

function valuesEqual(left: JvmValue, right: JvmValue): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (isString(left) && isString(right)) return left.value === right.value;
  if (left.kind === 'object' && right.kind === 'object') {
    if (left.cls !== right.cls) return false;
    const leftValue = left.fields.get('$value');
    const rightValue = right.fields.get('$value');
    if (leftValue !== undefined || rightValue !== undefined) {
      return leftValue !== undefined && rightValue !== undefined && valuesEqual(leftValue, rightValue);
    }
  }
  return false;
}

function hashValue(value: JvmValue): number {
  if (value === null) return 0;
  if (typeof value === 'number') return int(value);
  if (typeof value === 'bigint') return Number(BigInt.asIntN(32, value ^ (value >> 32n)));
  if (isString(value)) return javaStringHash(value.value);
  if (value.kind === 'object') {
    const primitive = value.fields.get('$value');
    return primitive === undefined ? javaStringHash(value.cls) : hashValue(primitive);
  }
  return javaStringHash(value.descriptor);
}

function stringValue(value: JvmValue): string {
  if (value === null) throw new Error('Null string receiver');
  if (!isString(value)) throw new Error('Expected java/lang/String');
  return value.value;
}

function renderJvmValue(value: JvmValue): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (isString(value)) return value.value;
  if (value.kind === 'array') return value.values.map(renderJvmValue).join(', ');
  const wrapped = value.fields.get('$value');
  return wrapped === undefined ? `${value.cls}@${javaStringHash(value.cls).toString(16)}` : renderJvmValue(wrapped);
}

function defaultValue(descriptor: string): JvmValue {
  if (descriptor.startsWith('L') || descriptor.startsWith('[')) return null;
  if (descriptor === 'J') return 0n;
  if (descriptor === 'F' || descriptor === 'D') return 0;
  return 0;
}

function immediateOperand(instruction: Instruction): number {
  const operand = instruction.operands.find((item) => item.kind === 'immediate');
  if (operand?.kind !== 'immediate') throw new Error(`Missing immediate for ${instruction.mnemonic}`);
  return operand.value;
}

function constantOperand(instruction: Instruction): ResolvedConstant {
  const operand = instruction.operands.find((item) => item.kind === 'constant');
  if (operand?.kind !== 'constant') throw new Error(`Missing constant for ${instruction.mnemonic}`);
  return operand.constant;
}

function classConstantName(instruction: Instruction): string {
  const constant = constantOperand(instruction);
  if (constant.kind !== 'class') throw new Error(`${instruction.mnemonic} requires a class constant`);
  return constant.name;
}

function operandOf<T extends InstructionOperand['kind']>(
  instruction: Instruction,
  kind: T,
): Extract<InstructionOperand, { kind: T }> {
  const operand = instruction.operands.find((item) => item.kind === kind);
  if (!operand) throw new Error(`${instruction.mnemonic} is missing ${kind} operand`);
  return operand as Extract<InstructionOperand, { kind: T }>;
}

function newArrayDescriptor(atype: number): string {
  const descriptors: Readonly<Record<number, string>> = {
    4: 'Z',
    5: 'C',
    6: 'F',
    7: 'D',
    8: 'B',
    9: 'S',
    10: 'I',
    11: 'J',
  };
  const descriptor = descriptors[atype];
  if (!descriptor) throw new Error(`Invalid newarray atype ${atype}`);
  return `[${descriptor}`;
}

function javaStringHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = int(hash * 31 + value.charCodeAt(index));
  return hash;
}

function compareStrings(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function objectMessage(object: JObject): string {
  const message: JvmValue = object.fields.get('java/lang/Throwable.detailMessage:Ljava/lang/String;') ?? null;
  if (!isString(message)) return '';
  return message.value;
}

function requiredAt<T>(values: readonly T[], index: number, name: string): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing ${name}`);
  return value;
}

function isStaticField(classFile: ClassFile, name: string, descriptor: string): boolean {
  return classFile.fields.some(
    (field) => field.name === name && field.descriptor === descriptor && (field.accessFlags & 0x0008) !== 0,
  );
}

function isStaticMethod(classFile: ClassFile, name: string, descriptor: string): boolean {
  return classFile.methods.some(
    (method) =>
      method.name === name &&
      method.descriptor === descriptor &&
      (method.accessFlags & 0x0008) !== 0,
  );
}
