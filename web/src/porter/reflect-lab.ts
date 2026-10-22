import {
  Introspector,
  JavaThrown,
  Jvm,
  parseFieldDescriptor,
  parseMethodDescriptor,
  Proxy,
  Reflection,
  type ClassFile,
  type JavaType,
  type JObject,
  type JvmValue,
  type ReflectClass,
  type ReflectField,
  type ReflectMethod,
} from '../jvm';
import { courseData } from '../course-data';
import { parseClasses, type ClassBytes, type ParsedClasses } from './common';
import { applicationFromCsv, courseRecordByAppId } from './evidence';

export type LabValue =
  | string
  | number
  | boolean
  | null
  | readonly LabValue[]
  | { readonly object: string };

export interface MemberView {
  readonly name: string;
  readonly modifiers: readonly string[];
  readonly javaType: string;
}

export interface MethodView {
  readonly name: string;
  readonly modifiers: readonly string[];
  readonly returnType: string;
  readonly parameterTypes: readonly string[];
  readonly declaredIn: string;
}

export interface PropertyView {
  readonly name: string;
  readonly type: string;
  readonly getter: string | null;
  readonly setter: string | null;
}

export interface ClassView {
  readonly name: string;
  readonly kind: 'class' | 'interface' | 'enum';
  readonly modifiers: readonly string[];
  readonly superclass: string | null;
  readonly interfaces: readonly string[];
  readonly declaredFields: readonly MemberView[];
  readonly fields: readonly MemberView[];
  readonly declaredMethods: readonly MethodView[];
  /**
   * Methods from the loaded hierarchy only; java.lang.Object is omitted when it is not loaded.
   */
  readonly methods: readonly MethodView[];
  readonly constructors: readonly {
    readonly modifiers: readonly string[];
    readonly parameterTypes: readonly string[];
  }[];
  readonly properties: readonly PropertyView[];
}

export interface LabCall {
  readonly java: string;
  readonly outcome:
    | { readonly ok: true; readonly value: LabValue }
    | { readonly ok: false; readonly exception: string; readonly message: string };
}

export const APPLICANT_COLUMNS: Readonly<Record<string, string>> = {
  APPL_NAME: 'name',
  ANNUAL_INC: 'annualIncome',
  CRED_SCR: 'credScr',
  EMP_STAT: 'empStat',
  DEBT_MO: 'debt',
  CNTRY: 'country',
};

export interface RowBinding {
  readonly column: string;
  readonly raw: string;
  readonly property: string;
  readonly setter: string;
  readonly javaType: string;
  readonly value: LabValue;
}

export interface RowBuild {
  readonly target: 'legacy.model.Applicant';
  readonly bindings: readonly RowBinding[];
  readonly readBack: Readonly<Record<string, LabValue>>;
}

export interface ProxyEvent {
  readonly method: string;
  readonly args: readonly LabValue[];
  readonly result: LabValue;
}

export interface ProxyRun {
  readonly rule: string;
  readonly appId: string;
  readonly events: readonly ProxyEvent[];
  readonly codes: readonly string[];
  readonly directCodes: readonly string[];
}

const applicantName = 'legacy.model.Applicant';
const decisionName = 'legacy/model/Decision';
const executeDescriptor = '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V';

export function courseClassNames(bytes?: ClassBytes): readonly string[] {
  return [...parseClasses(bytes).values()]
    .map((classFile) => classFile.thisClass.replaceAll('/', '.'))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function classView(binaryName: string, bytes?: ClassBytes): ClassView {
  const classes = parseClasses(bytes);
  const reflection = new Reflection(new Jvm(classes), classes);
  const reflectedClass = reflection.forName(binaryName);
  const classFile = reflectedClass.classFile;
  const fields = reflectedClass.getDeclaredFields();
  const methods = reflectedClass.getDeclaredMethods().filter(isVisibleDeclaredMethod);
  const constructors = reflectedClass.getDeclaredConstructors();
  const properties = Introspector.getBeanInfo(reflectedClass);
  const isInterface = (classFile.accessFlags & 0x0200) !== 0;
  const isEnum = (classFile.accessFlags & 0x4000) !== 0;

  return {
    name: reflectedClass.name,
    kind: isInterface ? 'interface' : isEnum ? 'enum' : 'class',
    modifiers: classModifiers(classFile.accessFlags),
    superclass:
      isInterface || classFile.superClass === null || classFile.superClass === 'java/lang/Object'
        ? null
        : classFile.superClass.replaceAll('/', '.'),
    interfaces: classFile.interfaces.map((name) => name.replaceAll('/', '.')),
    declaredFields: fields.map((field) => fieldView(field)),
    fields: reflectedClass.getFields().map((field) => fieldView(field)),
    declaredMethods: methods.map((method) => methodView(method)),
    methods: reflectedClass.getMethods().filter(isVisibleMethod).map((method) => methodView(method)),
    constructors: constructors.map((constructor) => ({
      modifiers: memberModifiers(constructor.info.accessFlags, 'method'),
      parameterTypes: parseMethodDescriptor(constructor.info.descriptor).parameters.map(javaTypeName),
    })),
    properties: properties.map((property) => ({
      name: property.name,
      type: property.type,
      getter: property.readMethod?.name ?? null,
      setter: property.writeMethod?.name ?? null,
    })),
  };
}

export function implementors(interfaceName: string, bytes?: ClassBytes): readonly string[] {
  const classes = parseClasses(bytes);
  const reflection = new Reflection(new Jvm(classes), classes);
  const target = reflection.forName(interfaceName).classFile;
  if ((target.accessFlags & 0x0200) === 0) throw new Error(`${interfaceName} is not an interface`);

  return [...classes.values()]
    .filter((classFile) => (classFile.accessFlags & 0x0200) === 0 && implementsInterface(classFile, target.thisClass, classes))
    .map((classFile) => classFile.thisClass.replaceAll('/', '.'))
    .sort((left, right) => left.localeCompare(right, 'en'));
}

export function invokeLab(
  appId: string,
  bytes?: ClassBytes,
  data: typeof courseData = courseData,
): readonly LabCall[] {
  const classes = parseClasses(bytes);
  const jvm = new Jvm(classes);
  const reflection = new Reflection(jvm, classes);
  const applicantClass = reflection.forName(applicantName);
  const record = courseRecordByAppId(data.csv, appId);
  const application = applicationFromCsv(jvm, record);
  const applicant = applicantOf(application);
  let creditScore: ReflectField | undefined;
  let annualIncome: ReflectField | undefined;

  return [
    invokeCall('Class<?> c = Class.forName("legacy.model.Applicant");', () => {
      reflection.forName(applicantName);
      return 'class legacy.model.Applicant';
    }),
    invokeCall('c.getMethod("getCredScr").invoke(applicant);', () =>
      labValue(requiredMethod(applicantClass, 'getCredScr').invoke(applicant)),
    ),
    invokeCall('Field f = c.getDeclaredField("creditScore"); f.get(applicant);', () => {
      creditScore = requiredField(applicantClass, 'creditScore');
      return labValue(creditScore.get(applicant));
    }),
    invokeCall('f.setAccessible(true); f.get(applicant);', () => {
      if (!creditScore) throw new Error('Missing reflected field creditScore');
      creditScore.setAccessible(true);
      return labValue(creditScore.get(applicant));
    }),
    invokeCall('f.set(applicant, 640); c.getMethod("getCredScr").invoke(applicant);', () => {
      if (!creditScore) throw new Error('Missing reflected field creditScore');
      creditScore.set(applicant, 640);
      return labValue(requiredMethod(applicantClass, 'getCredScr').invoke(applicant));
    }),
    invokeCall('c.getMethod("getIncome").invoke(applicant);', () =>
      labValue(requiredMethod(applicantClass, 'getIncome').invoke(applicant)),
    ),
    invokeCall('Field a = c.getDeclaredField("annualIncome"); a.setAccessible(true); a.get(applicant);', () => {
      annualIncome = requiredField(applicantClass, 'annualIncome');
      annualIncome.setAccessible(true);
      return labValue(annualIncome.get(applicant));
    }),
  ];
}

export function buildFromRow(
  appId: string,
  columns: Readonly<Record<string, string>> = APPLICANT_COLUMNS,
  bytes?: ClassBytes,
  data: typeof courseData = courseData,
): RowBuild {
  const classes = parseClasses(bytes);
  const jvm = new Jvm(classes);
  const reflection = new Reflection(jvm, classes);
  const applicantClass = reflection.forName(applicantName);
  const record = courseRecordByAppId(data.csv, appId);
  const applicant = reflection.objenesisInstantiate(applicantClass);
  const properties = new Map(Introspector.getBeanInfo(applicantClass).map((property) => [property.name, property]));
  const bindings = Object.entries(columns).map(([column, propertyName]): RowBinding => {
    const property = properties.get(propertyName);
    if (!property) throw new Error(`Unknown property ${propertyName} for column ${column}`);
    if (!property.writeMethod) throw new Error(`Property ${propertyName} has no setter`);
    const raw = record[column];
    if (raw === undefined) throw new Error(`Unknown column ${column}`);
    const parameter = parseMethodDescriptor(property.writeMethod.descriptor).parameters[0];
    if (!parameter) throw new Error(`Setter ${property.writeMethod.name} has no parameter`);
    const value = valueFromRaw(column, raw, parameter);
    property.writeMethod.invoke(applicant, value);
    return {
      column,
      raw,
      property: propertyName,
      setter: property.writeMethod.name,
      javaType: javaTypeName(parameter),
      value: labValue(value, parameter),
    };
  });

  const readBack: Record<string, LabValue> = {};
  for (const property of Introspector.getBeanInfo(applicantClass)) {
    if (property.readMethod) {
      const descriptor = parseMethodDescriptor(property.readMethod.descriptor);
      readBack[property.name] = labValue(property.readMethod.invoke(applicant), descriptor.returnType);
    }
  }
  return { target: applicantName, bindings, readBack };
}

export function proxyLab(
  rule: string,
  appId: string,
  bytes?: ClassBytes,
  data: typeof courseData = courseData,
): ProxyRun {
  const classes = parseClasses(bytes);
  const ruleClassName = `legacy/rules/${rule}`;
  const ruleClassFile = classes.get(ruleClassName);
  if (!ruleClassFile) throw new Error(`Unknown rule ${rule}`);

  const ruleInterfaceFile = ruleClassFile.interfaces
    .map((name) => classes.get(name))
    .find((classFile) => classFile !== undefined &&
      (classFile.accessFlags & 0x0200) !== 0 &&
      classFile.methods.some((method) => method.name === 'execute' && method.descriptor === executeDescriptor));
  if (!ruleInterfaceFile) throw new Error(`${ruleClassName} does not implement a loaded rule interface`);

  const jvm = new Jvm(classes);
  const reflection = new Reflection(jvm, classes);
  const interfaceClass = reflection.forName(ruleInterfaceFile.thisClass.replaceAll('/', '.'));
  const ruleClass = reflection.forName(ruleClassName.replaceAll('/', '.'));
  const ruleObject = construct(jvm, ruleClassName);
  const application = applicationFromCsv(jvm, courseRecordByAppId(data.csv, appId));
  const proxyDecision = construct(jvm, decisionName);
  const directDecision = construct(jvm, decisionName);
  const events: ProxyEvent[] = [];
  const executeMethod = requiredMethod(interfaceClass, 'execute', executeDescriptor);
  const realMethod = requiredMethod(ruleClass, 'execute', executeDescriptor);
  const proxy = Proxy.newProxyInstance(reflection, [interfaceClass], (_proxy, method, args) => {
    const descriptor = parseMethodDescriptor(method.descriptor);
    const result = realMethod.invoke(ruleObject, ...args);
    events.push({
      method: method.name,
      args: args.map((value, index) => labValue(value, descriptor.parameters[index])),
      result: descriptor.returnType.kind === 'void' ? null : labValue(result, descriptor.returnType),
    });
    return result;
  });

  executeMethod.invoke(proxy, application, proxyDecision);
  realMethod.invoke(ruleObject, application, directDecision);
  const codes = readStringList(jvm, decisionCodes(jvm, proxyDecision));
  const directCodes = readStringList(jvm, decisionCodes(jvm, directDecision));
  if (!sameStrings(codes, directCodes)) {
    throw new Error(`Proxy result for ${rule} differs from direct result: ${codes.join(',')} != ${directCodes.join(',')}`);
  }
  return { rule, appId, events, codes, directCodes };
}

function fieldView(field: ReflectField): MemberView {
  return {
    name: field.name,
    modifiers: memberModifiers(field.info.accessFlags, 'field'),
    javaType: javaTypeName(parseFieldDescriptor(field.typeDescriptor)),
  };
}

function methodView(method: ReflectMethod): MethodView {
  const descriptor = parseMethodDescriptor(method.descriptor);
  return {
    name: method.name,
    modifiers: memberModifiers(method.info.accessFlags, 'method'),
    returnType: javaTypeName(descriptor.returnType),
    parameterTypes: descriptor.parameters.map(javaTypeName),
    declaredIn: method.declaringClass.name,
  };
}

function classModifiers(flags: number): string[] {
  return memberModifiers(flags, 'class');
}

function memberModifiers(flags: number, kind: 'class' | 'field' | 'method'): string[] {
  const modifiers: readonly { readonly flag: number; readonly name: string; readonly kinds: readonly string[] }[] = [
    { flag: 0x0001, name: 'public', kinds: ['class', 'field', 'method'] },
    { flag: 0x0004, name: 'protected', kinds: ['class', 'field', 'method'] },
    { flag: 0x0002, name: 'private', kinds: ['class', 'field', 'method'] },
    { flag: 0x0400, name: 'abstract', kinds: ['class', 'method'] },
    { flag: 0x0008, name: 'static', kinds: ['class', 'field', 'method'] },
    { flag: 0x0010, name: 'final', kinds: ['class', 'field', 'method'] },
    { flag: 0x0080, name: 'transient', kinds: ['field'] },
    { flag: 0x0040, name: 'volatile', kinds: ['field'] },
    { flag: 0x0020, name: 'synchronized', kinds: ['method'] },
    { flag: 0x0100, name: 'native', kinds: ['method'] },
    { flag: 0x0800, name: 'strictfp', kinds: ['class', 'method'] },
    { flag: 0x0200, name: 'interface', kinds: ['class'] },
    { flag: 0x4000, name: 'enum', kinds: ['class', 'field'] },
  ];
  return modifiers.filter((modifier) => modifier.kinds.includes(kind) && (flags & modifier.flag) !== 0)
    .map((modifier) => modifier.name);
}

function isVisibleDeclaredMethod(method: ReflectMethod): boolean {
  return isVisibleMethod(method) && (method.info.accessFlags & (0x1000 | 0x0040)) === 0;
}

function isVisibleMethod(method: ReflectMethod): boolean {
  return (method.info.accessFlags & (0x1000 | 0x0040)) === 0;
}

function javaTypeName(type: JavaType | { readonly kind: 'void' }): string {
  switch (type.kind) {
    case 'primitive': return type.name;
    case 'object': return type.internalName.replaceAll('/', '.');
    case 'array': return `${javaTypeName(type.component)}[]`;
    case 'void': return 'void';
  }
}

function implementsInterface(classFile: ClassFile, target: string, classes: ParsedClasses, visited = new Set<string>()): boolean {
  if (visited.has(classFile.thisClass)) return false;
  visited.add(classFile.thisClass);
  for (const interfaceName of classFile.interfaces) {
    if (interfaceName === target) return true;
    const interfaceFile = classes.get(interfaceName);
    if (interfaceFile && implementsInterface(interfaceFile, target, classes, visited)) return true;
  }
  if (classFile.superClass) {
    const superclass = classes.get(classFile.superClass);
    if (superclass && implementsInterface(superclass, target, classes, visited)) return true;
  }
  return false;
}

function applicantOf(application: JObject): JObject {
  const value = application.fields.get('legacy/model/LoanApplication.applicant:Llegacy/model/Applicant;');
  if (!value || typeof value !== 'object' || value.kind !== 'object') {
    throw new Error('LoanApplication has no Applicant');
  }
  return value;
}

function requiredField(type: ReflectClass, name: string): ReflectField {
  const field = type.getDeclaredFields().find((candidate) => candidate.name === name);
  if (!field) throw new Error(`No declared field ${type.name}.${name}`);
  return field;
}

function requiredMethod(type: ReflectClass, name: string, descriptor?: string): ReflectMethod {
  const method = type.getMethods().find(
    (candidate) => candidate.name === name && (descriptor === undefined || candidate.descriptor === descriptor),
  );
  if (!method) throw new Error(`No public method ${type.name}.${name}${descriptor ?? ''}`);
  return method;
}

function invokeCall(java: string, operation: () => LabValue): LabCall {
  try {
    return { java, outcome: { ok: true, value: operation() } };
  } catch (error) {
    if (!(error instanceof JavaThrown)) throw error;
    return {
      java,
      outcome: {
        ok: false,
        exception: error.object.cls.replaceAll('/', '.'),
        message: error.message,
      },
    };
  }
}

function labValue(value: JvmValue, type?: JavaType | { readonly kind: 'void' }): LabValue {
  if (value === null) return null;
  if (typeof value === 'number') {
    return type?.kind === 'primitive' && type.name === 'boolean' ? value !== 0 : value;
  }
  if (typeof value === 'bigint') return Number(value);
  if (value.kind === 'string') return value.value;
  if (value.kind === 'array') return value.values.map((element) => labValue(element));
  return { object: value.cls.replaceAll('/', '.') };
}

function valueFromRaw(column: string, raw: string, type: JavaType): JvmValue {
  if (type.kind === 'primitive' && type.name === 'int') return strictInteger(raw);
  if (type.kind === 'object' && type.internalName === 'java/lang/String') {
    return column === 'CNTRY' && raw.length === 0 ? null : javaString(raw);
  }
  throw new Error(`Unsupported Applicant setter type ${javaTypeName(type)} for ${column}`);
}

function strictInteger(raw: string): number {
  let index = raw.startsWith('+') || raw.startsWith('-') ? 1 : 0;
  if (index === raw.length) throw new Error(`Invalid integer ${JSON.stringify(raw)}`);
  for (; index < raw.length; index += 1) {
    const character = raw.charCodeAt(index);
    if (character < 48 || character > 57) throw new Error(`Invalid integer ${JSON.stringify(raw)}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new Error(`Invalid integer ${JSON.stringify(raw)}`);
  }
  return value;
}

function javaString(value: string): Extract<JvmValue, { readonly kind: 'string' }> {
  return { kind: 'string', cls: 'java/lang/String', value, fields: new Map() };
}

function construct(jvm: Jvm, className: string): JObject {
  const object = jvm.newObject(className);
  jvm.invokeMethod(className, '<init>', '()V', object, []);
  return object;
}

function decisionCodes(jvm: Jvm, decision: JObject): JvmValue {
  return jvm.invokeMethod(decisionName, 'getCodes', '()Ljava/util/List;', decision, []);
}

function readStringList(jvm: Jvm, value: JvmValue): string[] {
  const iterator = jvm.invokeMethod('java/util/List', 'iterator', '()Ljava/util/Iterator;', value, []);
  const result: string[] = [];
  while (jvm.invokeMethod('java/util/Iterator', 'hasNext', '()Z', iterator, []) !== 0) {
    const item = jvm.invokeMethod('java/util/Iterator', 'next', '()Ljava/lang/Object;', iterator, []);
    if (item === null || typeof item !== 'object' || item.kind !== 'string') {
      throw new Error('Decision code list contains a non-String value');
    }
    result.push(item.value);
  }
  return result;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
