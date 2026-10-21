export { ClassFormatError } from './classfile/errors';
export { parseClassFile } from './classfile/parse';
export {
  parseFieldDescriptor,
  parseMethodDescriptor,
  type JavaType,
  type MethodDescriptor,
} from './classfile/descriptor';
export {
  parseClassSignature,
  parseFieldSignature,
  parseMethodSignature,
  type ClassSignature,
  type FieldSignature,
  type MethodSignature,
  type SignatureType,
  type TypeArgument,
  type TypeParameter,
} from './classfile/signature';
export type {
  Annotation,
  AttributeInfo,
  ClassFile,
  ConstantPoolEntry,
  ElementValue,
  ExceptionHandler,
  MemberInfo,
} from './classfile/types';
export { BytecodeDecodeError, decode } from './bytecode/decode';
export type { Instruction, InstructionOperand, ResolvedConstant } from './bytecode/decode';
export {
  analyzeSources,
  findCalls,
  producersOf,
  type AnalyzeOptions,
  type Frame,
  type Source,
  type SourceValue,
} from './analysis/sources';
export { Jvm, type ProxyHandler } from './runtime/jvm';
export {
  StepBudgetExceeded,
  UnsupportedBytecode,
  UnsupportedNative,
} from './runtime/errors';
export type {
  JArray,
  JObject,
  JString,
  JvmOptions,
  JvmReference,
  JvmValue,
  RunResult,
  StepEvent,
} from './runtime/types';
export {
  decapitalize,
  Introspector,
  Proxy,
  Reflection,
  ReflectClass,
  ReflectConstructor,
  ReflectField,
  ReflectMethod,
  type GenericTypeInfo,
  type PropertyDescriptor,
  type ReflectedAnnotation,
} from './reflect/index';
