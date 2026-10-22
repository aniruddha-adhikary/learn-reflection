import { decode, Jvm, Reflection, type ClassFile, type JObject, type JString, type JvmValue, type MemberInfo } from '../jvm';
import { courseData, type CourseBinding, type CourseBindings, type CourseEvent } from '../course-data';
import { courseSourceName, parseClasses, type ParsedClasses } from './common';
import { createMetricReader } from './metrics';
import { transformFromParsed, type RuleRecord } from './transform';
import { JavaRandom, javaStringHash } from './java-random';

export interface Outcome {
  readonly codes: readonly string[];
  readonly error: string;
}

interface RuleDomain {
  readonly fields: Readonly<Record<string, readonly unknown[]>>;
  readonly integerLiterals: readonly number[];
  readonly stringLiterals: readonly string[];
}

export interface FuzzCaseTrace {
  readonly rule: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly legacy: Outcome;
  readonly modern: Outcome;
  readonly agree: boolean;
}

export interface FuzzData {
  readonly bindings: string;
  readonly domains: Readonly<Record<string, RuleDomain>>;
  readonly cases: number;
  readonly disagreements: readonly {
    readonly rule: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly legacy: Outcome;
    readonly modern: Outcome;
  }[];
}

export interface FuzzResult {
  readonly data: FuzzData;
  readonly trace: readonly FuzzCaseTrace[];
}

export function evaluateCondition(
  expr: Readonly<Record<string, unknown>>,
  read: (metric: string) => unknown,
): unknown {
  return evaluate(expr, read);
}

export function fuzz(
  bindings: CourseBindings = courseData.bindings.correct,
  data: typeof courseData = courseData,
  seed = 731,
): FuzzResult {
  const classes = parseClasses();
  const transformed = transformFromParsed(classes);
  const grouped = new Map<string, RuleRecord[]>();
  for (const rule of transformed.rules) grouped.set(rule.legacyRule, [...(grouped.get(rule.legacyRule) ?? []), rule]);
  const correct = bindingMap(courseData.bindings.correct);
  const active = bindingMap(bindings);
  const legacyRules = new Map<string, string>();
  for (const name of classes.keys()) {
    if (name.startsWith('legacy/rules/') && !name.includes('$')) legacyRules.set(simpleName(name), name);
  }

  const jvm = new Jvm(classes);
  const reflection = new Reflection(jvm, classes);
  const scores = new Map<string, number>();
  const domainReport: Record<string, RuleDomain> = {};
  const disagreements: FuzzData['disagreements'][number][] = [];
  const trace: FuzzCaseTrace[] = [];
  let total = 0;

  for (const [ruleName, ruleGroup] of grouped) {
    const className = legacyRules.get(ruleName);
    if (!className) throw new Error(`No legacy bytecode for ${ruleName}`);
    const domain = deriveDomain(classes, className, correct);
    domainReport[ruleName] = domain.report;
    const cases = cartesian(domain.report.fields, 12_000);
    addSeededCases(cases, domain.report.fields, 24, BigInt(seed) + BigInt(javaStringHash(ruleName)));
    for (const input of cases) {
      total += 1;
      const application = buildLegacyApplication(jvm, classes, input);
      const event = pushForward(application, reflection, active, scores, data.events[0]?.applicant.income.currency ?? 'USD', total);
      const expected = legacyOutcome(jvm, className, application);
      const actual = modernOutcome(ruleGroup, event, scores);
      const agree = outcomesEqual(expected, actual);
      const caseTrace = { rule: ruleName, input, legacy: expected, modern: actual, agree };
      trace.push(caseTrace);
      if (!agree) {
        disagreements.push({ rule: ruleName, input, legacy: expected, modern: actual });
      }
    }
  }
  return {
    data: { bindings: courseSourceName(bindings), domains: domainReport, cases: total, disagreements },
    trace,
  };
}

function deriveDomain(
  classes: ParsedClasses,
  className: string,
  bindings: ReadonlyMap<string, CourseBinding>,
): { readonly report: RuleDomain } {
  const rule = requireClass(classes, className);
  const method = methodOf(rule, 'execute');
  const fields = new Set<string>();
  const integers = new Set<number>();
  const strings = new Set<string>();
  const doubles = new Set<number>();
  scanMethod(classes, rule, method, bindings, fields, integers, strings, doubles, new Set());
  const initializer = rule.methods.find((candidate) => candidate.name === '<clinit>');
  if (initializer) scanMethod(classes, rule, initializer, bindings, fields, integers, strings, doubles, new Set());

  const integerValues = integerDomain(integers);
  const doubleValues = doubleDomain(doubles);
  const fieldDomains: Record<string, readonly unknown[]> = {};
  for (const key of fields) {
    const binding = bindings.get(key);
    if (!binding) continue;
    const [ownerName, fieldName] = splitFieldKey(key);
    const owner = requireClass(classes, ownerName.replaceAll('.', '/'));
    const field = owner.fields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new Error(`Missing domain field ${key}`);
    let values: unknown[];
    if (binding.via === 'size') values = [[], ['A'], ['A', '']];
    else if (field.descriptor === 'I') values = [...integerValues];
    else if (field.descriptor === 'D' || field.descriptor === 'F') values = [...doubleValues];
    else if (field.descriptor === 'Z') values = [false, true];
    else if (field.descriptor === 'Ljava/lang/String;') {
      values = [...strings, ...Object.keys(binding.values ?? {}), '', null];
    } else {
      throw new Error(`No fuzz domain for ${key} (${field.descriptor})`);
    }
    fieldDomains[key] = deduplicate(values);
  }
  return {
    report: {
      fields: fieldDomains,
      integerLiterals: [...integers],
      stringLiterals: [...strings],
    },
  };
}

function scanMethod(
  classes: ParsedClasses,
  owner: ClassFile,
  method: MemberInfo,
  bindings: ReadonlyMap<string, CourseBinding>,
  fields: Set<string>,
  integers: Set<number>,
  strings: Set<string>,
  doubles: Set<number>,
  visited: Set<string>,
): void {
  const code = codeOf(method);
  if (!code) return;
  for (const instruction of decode(code.code, owner.constantPool)) {
    const opcode = instruction.opcode;
    if (opcode >= 0x02 && opcode <= 0x08) integers.add(opcode - 0x03);
    const immediate = instruction.operands.find((operand) => operand.kind === 'immediate');
    if ((opcode === 0x10 || opcode === 0x11) && immediate?.kind === 'immediate') integers.add(immediate.value);
    const constant = instruction.operands.find((operand) => operand.kind === 'constant');
    if (constant?.kind === 'constant') {
      if (constant.constant.kind === 'integer' && typeof constant.constant.value === 'number') {
        integers.add(constant.constant.value);
      }
      else if (constant.constant.kind === 'string') strings.add(constant.constant.value);
      else if ((constant.constant.kind === 'double' || constant.constant.kind === 'float') &&
          typeof constant.constant.value === 'number') doubles.add(constant.constant.value);
      if (constant.constant.kind === 'fieldRef' && opcode === 0xb4) {
        const key = `${constant.constant.owner.replaceAll('/', '.')}#${constant.constant.name}`;
        if (bindings.has(key)) fields.add(key);
      }
      if (constant.constant.kind === 'methodRef' &&
          constant.constant.owner.startsWith('legacy/model/') &&
          (constant.constant.name.startsWith('get') || constant.constant.name.startsWith('is'))) {
        const getterKey = `${constant.constant.owner}.${constant.constant.name}${constant.constant.descriptor}`;
        if (!visited.has(getterKey)) {
          visited.add(getterKey);
          const getterOwner = requireClass(classes, constant.constant.owner);
          const getter = methodOf(getterOwner, constant.constant.name, constant.constant.descriptor);
          scanMethod(classes, getterOwner, getter, bindings, fields, integers, strings, doubles, visited);
        }
      }
    }
  }
}

function buildLegacyApplication(
  jvm: Jvm,
  classes: ParsedClasses,
  assignment: Readonly<Record<string, unknown>>,
): JObject {
  const applicant = construct(jvm, 'legacy/model/Applicant');
  setField(jvm, classes, applicant, 'legacy.model.Applicant#name', 'Fuzz Applicant');
  setField(jvm, classes, applicant, 'legacy.model.Applicant#annualIncome', 120_000);
  setField(jvm, classes, applicant, 'legacy.model.Applicant#creditScore', 700);
  setField(jvm, classes, applicant, 'legacy.model.Applicant#empStat', 'E');
  setField(jvm, classes, applicant, 'legacy.model.Applicant#monthlyDebt', 1_000);
  setField(jvm, classes, applicant, 'legacy.model.Applicant#country', 'US');
  const application = construct(jvm, 'legacy/model/LoanApplication');
  jvm.setFieldValue(application, 'legacy/model/LoanApplication', 'applicant', 'Llegacy/model/Applicant;', applicant);
  setField(jvm, classes, application, 'legacy.model.LoanApplication#amount', 40_000);
  setField(jvm, classes, application, 'legacy.model.LoanApplication#termMonths', 180);
  setField(jvm, classes, application, 'legacy.model.LoanApplication#collateral', false);

  for (const [key, value] of Object.entries(assignment)) {
    const [ownerName] = splitFieldKey(key);
    const target = ownerName.endsWith('.Applicant') ? applicant : application;
    if (key.endsWith('#coSigners')) {
      const list = construct(jvm, 'java/util/ArrayList');
      for (const item of value as readonly unknown[]) {
        jvm.invokeMethod('java/util/List', 'add', '(Ljava/lang/Object;)Z', list, [toJvmValue(item)]);
      }
      setField(jvm, classes, application, key, list);
    } else {
      setField(jvm, classes, target, key, value);
    }
  }
  return application;
}

function pushForward(
  application: JObject,
  reflection: Reflection,
  bindings: ReadonlyMap<string, CourseBinding>,
  scores: Map<string, number>,
  currency: string,
  sequence: number,
): CourseEvent {
  const applicant = application.fields.get('legacy/model/LoanApplication.applicant:Llegacy/model/Applicant;');
  if (!applicant || typeof applicant !== 'object' || applicant.kind !== 'object') throw new Error('Missing legacy applicant');
  const applicantId = `P-FUZZ-${sequence}`;
  const fullName = plainValue(readField(reflection, applicant, 'legacy.model.Applicant#name'));
  const modernApplicant = {
    applicantId,
    fullName: typeof fullName === 'string' ? fullName : '',
    income: { annual: 0, currency },
    employment: null as string | null,
    debts: { monthlyTotal: 0 },
    residence: { countryCode: null as string | null },
  };
  const request = { principal: 0, termMonths: 0, secured: false };
  const guarantors: { name: string }[] = [];
  for (const binding of bindings.values()) {
    const raw = readField(reflection, binding.legacy.startsWith('legacy.model.Applicant#') ? applicant : application, binding.legacy);
    switch (binding.modern) {
      case 'credit.score': {
        const score = asNumber(raw);
        scores.set(applicantId, score);
        break;
      }
      case 'income.annual': modernApplicant.income.annual = asNumber(raw); break;
      case 'debt.monthly': modernApplicant.debts.monthlyTotal = asNumber(raw); break;
      case 'employment': {
        const value = plainValue(raw);
        modernApplicant.employment = binding.values?.[typeof value === 'string' ? value : ''] ?? null;
        break;
      }
      case 'residence.country': modernApplicant.residence.countryCode = plainValue(raw) as string | null; break;
      case 'loan.principal': request.principal = asNumber(raw); break;
      case 'loan.term': request.termMonths = asNumber(raw); break;
      case 'loan.secured': request.secured = raw === 1; break;
      case 'guarantors.count': {
        const names = readList(reflection.jvm, raw);
        for (const [index] of names.entries()) guarantors.push({ name: `G${index}` });
        break;
      }
      default: throw new Error(`Unsupported metric ${binding.modern}`);
    }
  }
  return { id: `F-${sequence}`, applicant: modernApplicant, request, guarantors };
}

function legacyOutcome(jvm: Jvm, className: string, application: JObject): Outcome {
  try {
    const rule = construct(jvm, className);
    const decision = construct(jvm, 'legacy/model/Decision');
    jvm.invokeMethod(
      className,
      'execute',
      '(Llegacy/model/LoanApplication;Llegacy/model/Decision;)V',
      rule,
      [application, decision],
    );
    const codes = jvm.invokeMethod('legacy/model/Decision', 'getCodes', '()Ljava/util/List;', decision, []);
    return { codes: readList(jvm, codes).map((value) => String(value)), error: '' };
  } catch (error) {
    return { codes: [], error: javaErrorName(error) };
  }
}

export function modernOutcome(
  rules: readonly RuleRecord[],
  event: CourseEvent,
  scores: ReadonlyMap<string, number>,
): Outcome {
  const codes: string[] = [];
  const metric = createMetricReader(event, (applicantId) => {
    const score = scores.get(applicantId);
    if (score === undefined) throw new Error(`Missing bureau score for ${applicantId}`);
    return score;
  });
  try {
    for (const rule of rules) if (evaluate(rule.when, metric)) codes.push(rule.emit);
    return { codes, error: '' };
  } catch (error) {
    return { codes: [], error: javaErrorName(error) };
  }
}

function evaluate(expr: Readonly<Record<string, unknown>>, read: (metric: string) => unknown): unknown {
  if (expr.kind === 'expr' && 'expr' in expr) return evaluate(expr.expr as Record<string, unknown>, read);
  if ('read' in expr) return read(String(expr.read));
  if ('int' in expr) return expr.int;
  if ('str' in expr) return expr.str;
  if ('enum' in expr) return expr.enum;
  if ('isTrue' in expr) return evaluate(expr.isTrue as Record<string, unknown>, read) === true;
  if ('isFalse' in expr) return evaluate(expr.isFalse as Record<string, unknown>, read) === false;
  if ('not' in expr) return !evaluate(expr.not as Record<string, unknown>, read);
  if ('and' in expr) return (expr.and as readonly Record<string, unknown>[]).every((item) => evaluate(item, read));
  if ('or' in expr) return (expr.or as readonly Record<string, unknown>[]).some((item) => evaluate(item, read));
  if ('eq' in expr) {
    const [left, right] = expr.eq as readonly Record<string, unknown>[];
    return evaluate(left ?? {}, read) === evaluate(right ?? {}, read);
  }
  if ('in' in expr) {
    const value = evaluate(expr.in as Record<string, unknown>, read);
    if (value === null || value === undefined) throw new Error('java.lang.NullPointerException');
    return (expr.members as readonly unknown[]).includes(value);
  }
  if ('cmp' in expr) {
    const left = evaluate(expr.l as Record<string, unknown>, read);
    const right = evaluate(expr.r as Record<string, unknown>, read);
    switch (expr.cmp) {
      case '<': return Number(left) < Number(right);
      case '<=': return Number(left) <= Number(right);
      case '>': return Number(left) > Number(right);
      case '>=': return Number(left) >= Number(right);
      case '==': return left === right;
      case '!=': return left !== right;
      default: throw new Error(`Unknown comparison ${String(expr.cmp)}`);
    }
  }
  if ('arith' in expr) {
    const left = Number(evaluate(expr.l as Record<string, unknown>, read));
    const right = Number(evaluate(expr.r as Record<string, unknown>, read));
    switch (expr.arith) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return Math.imul(left, right);
      case '/':
        if (right === 0) throw new Error('java.lang.ArithmeticException');
        return Math.trunc(left / right);
      default: throw new Error(`Unknown arithmetic ${String(expr.arith)}`);
    }
  }
  throw new Error(`Unknown expression ${JSON.stringify(expr)}`);
}

function readField(reflection: Reflection, target: JObject, key: string): JvmValue {
  const [ownerName, fieldName] = splitFieldKey(key);
  const field = reflection.forName(ownerName).getDeclaredFields().find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`Missing field ${key}`);
  field.setAccessible(true);
  return field.get(target);
}

function setField(jvm: Jvm, classes: ParsedClasses, target: JObject, key: string, value: unknown): void {
  const [ownerName, fieldName] = splitFieldKey(key);
  const owner = requireClass(classes, ownerName.replaceAll('.', '/'));
  const field = owner.fields.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`Missing field ${key}`);
  let normalized = value;
  if (field.descriptor === 'Z') normalized = value === true ? 1 : value === false ? 0 : value;
  jvm.setFieldValue(target, owner.thisClass, fieldName, field.descriptor, toJvmValue(normalized));
}

function construct(jvm: Jvm, className: string): JObject {
  const object = jvm.newObject(className);
  jvm.invokeMethod(className, '<init>', '()V', object, []);
  return object;
}

function toJvmValue(value: unknown): JvmValue {
  if (value === null || typeof value === 'number' || typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return javaString(value);
  if (typeof value === 'object' && 'kind' in value) return value as JvmValue;
  throw new Error(`Cannot represent JVM value of type ${typeof value}`);
}

function javaString(value: string): JString {
  return { kind: 'string', cls: 'java/lang/String', value, fields: new Map() };
}

function plainValue(value: JvmValue): unknown {
  return value && typeof value === 'object' && value.kind === 'string' ? value.value : value;
}

function asNumber(value: JvmValue): number {
  const plain = plainValue(value);
  if (typeof plain !== 'number') throw new Error(`Expected numeric value, received ${String(plain)}`);
  return plain;
}

function readList(jvm: Jvm, value: JvmValue): readonly unknown[] {
  const iterator = jvm.invokeMethod('java/util/List', 'iterator', '()Ljava/util/Iterator;', value, []);
  const result: unknown[] = [];
  while (jvm.invokeMethod('java/util/Iterator', 'hasNext', '()Z', iterator, []) !== 0) {
    result.push(plainValue(jvm.invokeMethod('java/util/Iterator', 'next', '()Ljava/lang/Object;', iterator, [])));
  }
  return result;
}

function codeOf(method: MemberInfo) {
  return method.attributes.find((attribute) => attribute.kind === 'code');
}

function splitFieldKey(key: string): [string, string] {
  const delimiter = key.lastIndexOf('#');
  if (delimiter < 0) throw new Error(`Malformed field key ${key}`);
  return [key.slice(0, delimiter), key.slice(delimiter + 1)];
}

function integerDomain(constants: ReadonlySet<number>): number[] {
  const values = new Set<number>([0]);
  for (const constant of constants) {
    if (constant > -0x80000000) values.add(constant - 1);
    values.add(constant);
    if (constant < 0x7fffffff) values.add(constant + 1);
  }
  return [...values];
}

function doubleDomain(constants: ReadonlySet<number>): number[] {
  const values = new Set<number>([0]);
  for (const constant of constants) {
    values.add(nextDouble(constant, -1));
    values.add(constant);
    values.add(nextDouble(constant, 1));
  }
  return [...values];
}

function nextDouble(value: number, direction: -1 | 1): number {
  if (Number.isNaN(value || 0)) return Number.NaN;
  if (value === (direction > 0 ? Infinity : -Infinity)) return value;
  if (value === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  let bits = view.getBigUint64(0);
  bits += (value > 0) === (direction > 0) ? 1n : -1n;
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

function cartesian(
  domains: Readonly<Record<string, readonly unknown[]>>,
  limit: number,
): Readonly<Record<string, unknown>>[] {
  const entries = Object.entries(domains);
  const result: Readonly<Record<string, unknown>>[] = [];
  const expand = (index: number, current: Readonly<Record<string, unknown>>): void => {
    if (result.length >= limit) return;
    if (index === entries.length) {
      result.push(current);
      return;
    }
    const entry = entries[index];
    if (!entry) return;
    const [key, values] = entry;
    for (const value of values) {
      expand(index + 1, { ...current, [key]: value });
      if (result.length >= limit) break;
    }
  };
  expand(0, {});
  return result;
}

function addSeededCases(
  output: Readonly<Record<string, unknown>>[],
  domains: Readonly<Record<string, readonly unknown[]>>,
  count: number,
  seed: bigint,
): void {
  const entries = Object.entries(domains);
  if (entries.length === 0) return;
  const random = new JavaRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const assignment: Record<string, unknown> = {};
    for (const [key, values] of entries) {
      assignment[key] = values[random.nextInt(values.length)];
    }
    output.push(assignment);
  }
}

function deduplicate(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function bindingMap(bindings: CourseBindings): Map<string, CourseBinding> {
  return new Map(bindings.bindings.map((binding) => [binding.legacy, binding]));
}

function outcomesEqual(left: Outcome, right: Outcome): boolean {
  return left.error === right.error &&
    left.codes.length === right.codes.length &&
    left.codes.every((code, index) => code === right.codes[index]);
}

function javaErrorName(error: unknown): string {
  if (error && typeof error === 'object' && 'object' in error) {
    const thrown = error as { readonly object?: { readonly cls?: string } };
    if (thrown.object?.cls) return thrown.object.cls.replaceAll('/', '.');
  }
  if (error instanceof Error && error.message.startsWith('java.lang.')) return error.message;
  if (error instanceof Error) return error.name;
  return String(error);
}

function simpleName(internalName: string): string {
  return internalName.slice(internalName.lastIndexOf('/') + 1);
}

function requireClass(classes: ParsedClasses, internalName: string): ClassFile {
  const result = classes.get(internalName);
  if (!result) throw new Error(`Missing class ${internalName}`);
  return result;
}

function methodOf(owner: ClassFile, name: string, descriptor?: string): MemberInfo {
  const method = owner.methods.find((candidate) => candidate.name === name && (descriptor === undefined || candidate.descriptor === descriptor));
  if (!method) throw new Error(`Missing method ${owner.thisClass}.${name}${descriptor ?? ''}`);
  return method;
}
