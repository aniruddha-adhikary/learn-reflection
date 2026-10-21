import { Jvm, Reflection, type JObject, type JString, type JvmValue } from '../jvm';
import { courseData, type CourseBinding, type CourseBindings, type CourseEvent } from '../course-data';
import { courseSourceName, parseClasses } from './common';

export interface EvidenceRow {
  readonly legacyField: string;
  readonly status: 'CONFIRMED' | 'REJECTED';
  readonly matches: number;
  readonly total: number;
  readonly firstRecordId: string;
  readonly reason: string;
}

export interface EvidenceTrace {
  readonly recordId: string;
  readonly legacyField: string;
  readonly legacyValue: unknown;
  readonly modernValue: unknown;
  readonly agree: boolean;
}

export interface EvidenceResult {
  readonly bindings: string;
  readonly data: readonly EvidenceRow[];
  readonly trace: readonly EvidenceTrace[];
}

export function evidence(
  bindings: CourseBindings = courseData.bindings.correct,
  data: typeof courseData = courseData,
): EvidenceResult {
  const classes = parseClasses();
  const jvm = new Jvm(classes);
  const reflection = new Reflection(jvm, classes);
  const rows = csvRows(data.csv);
  const header = rows[0];
  if (!header) throw new Error('Course CSV has no header');
  const indexes = new Map(header.map((name, index) => [name, index]));
  const events = new Map(data.events.map((event) => [event.id, event]));
  const traces: EvidenceTrace[] = [];
  const result = bindings.bindings.map((binding): EvidenceRow => {
    let matches = 0;
    let firstRecordId = '';
    let firstDifference = '';
    for (const columns of rows.slice(1)) {
      const record = Object.fromEntries([...indexes].map(([name, index]) => [name, columns[index] ?? '']));
      const id = record.APP_ID ?? '';
      const event = events.get(id);
      if (!event) throw new Error(`Missing modern event ${id}`);
      const app = applicationFromCsv(jvm, record);
      const { target, fieldName } = targetFor(app, binding.legacy);
      const field = reflection.forName(fieldName.slice(0, fieldName.lastIndexOf('#'))).getDeclaredFields()
        .find((candidate) => candidate.name === fieldName.slice(fieldName.lastIndexOf('#') + 1));
      if (!field) throw new Error(`Missing reflected field ${fieldName}`);
      field.setAccessible(true);
      const raw = field.get(target);
      const legacyValue = fieldName.endsWith('#coSigners')
        ? readList(jvm, raw)
        : field.typeDescriptor === 'Z'
          ? raw === 1
          : plainValue(raw);
      const modernValue = readModernValue(binding, legacyValue, event, data.bureauScores);
      const expected = binding.modern === 'employment' ? event.applicant.employment : binding.via === 'size' ? event.guarantors.length : legacyValue;
      const agree = deepEqual(expected, modernValue);
      if (agree) matches += 1;
      else if (!firstRecordId) {
        firstRecordId = id;
        firstDifference = `${String(legacyValue)} != ${String(modernValue)}`;
      }
      traces.push({ recordId: id, legacyField: binding.legacy, legacyValue, modernValue, agree });
    }
    const mappedValues = binding.values ? Object.values(binding.values) : [];
    const injective = new Set(mappedValues).size === mappedValues.length;
    let reason = firstDifference;
    if (!injective) reason = reason ? `${reason}; value map is not injective` : 'value map is not injective';
    return {
      legacyField: binding.legacy,
      status: matches === rows.length - 1 && injective ? 'CONFIRMED' : 'REJECTED',
      matches,
      total: rows.length - 1,
      firstRecordId,
      reason,
    };
  });
  return { bindings: courseSourceName(bindings), data: result, trace: traces };
}

function applicationFromCsv(jvm: Jvm, record: Readonly<Record<string, string>>): JObject {
  const applicant = construct(jvm, 'legacy/model/Applicant');
  invoke(jvm, 'legacy/model/Applicant', 'setName', '(Ljava/lang/String;)V', applicant, javaString(record.APPL_NAME ?? ''));
  invoke(jvm, 'legacy/model/Applicant', 'setAnnualIncome', '(I)V', applicant, number(record.ANNUAL_INC));
  invoke(jvm, 'legacy/model/Applicant', 'setCredScr', '(I)V', applicant, number(record.CRED_SCR));
  invoke(jvm, 'legacy/model/Applicant', 'setEmpStat', '(Ljava/lang/String;)V', applicant, javaString(record.EMP_STAT ?? ''));
  invoke(jvm, 'legacy/model/Applicant', 'setDebt', '(I)V', applicant, number(record.DEBT_MO));
  invoke(jvm, 'legacy/model/Applicant', 'setCountry', '(Ljava/lang/String;)V', applicant, emptyToNull(record.CNTRY) === null ? null : javaString(record.CNTRY ?? ''));

  const application = construct(jvm, 'legacy/model/LoanApplication');
  invoke(jvm, 'legacy/model/LoanApplication', 'setAppId', '(Ljava/lang/String;)V', application, javaString(record.APP_ID ?? ''));
  invoke(jvm, 'legacy/model/LoanApplication', 'setApplicant', '(Llegacy/model/Applicant;)V', application, applicant);
  invoke(jvm, 'legacy/model/LoanApplication', 'setAmount', '(I)V', application, number(record.LOAN_AMT));
  invoke(jvm, 'legacy/model/LoanApplication', 'setTermMonths', '(I)V', application, number(record.TERM_MO));
  invoke(jvm, 'legacy/model/LoanApplication', 'setCollateral', '(Z)V', application, record.COLLAT === 'Y' ? 1 : 0);
  const names = (record.CO_SIGNERS ?? '').split(';').filter((name) => name.length > 0);
  const list = jvm.invokeMethod('legacy/model/LoanApplication', 'getCoSigners', '()Ljava/util/List;', application, []);
  for (const name of names) jvm.invokeMethod('java/util/List', 'add', '(Ljava/lang/Object;)Z', list, [javaString(name)]);
  return application;
}

function targetFor(application: JObject, legacyField: string): { readonly target: JObject; readonly fieldName: string } {
  const delimiter = legacyField.lastIndexOf('#');
  const fieldName = legacyField;
  if (legacyField.startsWith('legacy.model.Applicant#')) {
    const applicant = application.fields.get('legacy/model/LoanApplication.applicant:Llegacy/model/Applicant;');
    if (!applicant || typeof applicant !== 'object' || applicant.kind !== 'object') {
      throw new Error(`Missing applicant for ${fieldName}`);
    }
    return { target: applicant, fieldName };
  }
  if (delimiter < 0) throw new Error(`Malformed field key ${legacyField}`);
  return { target: application, fieldName };
}

function readModernValue(
  binding: CourseBinding,
  legacyValue: unknown,
  event: CourseEvent,
  bureauScores: Readonly<Record<string, number>>,
): unknown {
  switch (binding.modern) {
    case 'credit.score': {
      const score = bureauScores[event.applicant.applicantId];
      if (score === undefined) throw new Error(`Missing bureau score for ${event.applicant.applicantId}`);
      return score;
    }
    case 'income.annual': return event.applicant.income.annual;
    case 'debt.monthly': return event.applicant.debts.monthlyTotal;
    case 'employment': return binding.values?.[String(legacyValue)] ?? null;
    case 'residence.country': return event.applicant.residence.countryCode;
    case 'loan.principal': return event.request.principal;
    case 'loan.term': return event.request.termMonths;
    case 'loan.secured': return event.request.secured;
    case 'guarantors.count': return event.guarantors.length;
    default: return null;
  }
}

function construct(jvm: Jvm, className: string): JObject {
  const result = jvm.newObject(className);
  jvm.invokeMethod(className, '<init>', '()V', result, []);
  return result;
}

function invoke(
  jvm: Jvm,
  owner: string,
  name: string,
  descriptor: string,
  receiver: JvmValue,
  value: JvmValue,
): void {
  jvm.invokeMethod(owner, name, descriptor, receiver, [value]);
}

function readList(jvm: Jvm, value: JvmValue): readonly unknown[] {
  const iterator = jvm.invokeMethod('java/util/List', 'iterator', '()Ljava/util/Iterator;', value, []);
  const result: unknown[] = [];
  while (jvm.invokeMethod('java/util/Iterator', 'hasNext', '()Z', iterator, []) !== 0) {
    result.push(plainValue(jvm.invokeMethod('java/util/Iterator', 'next', '()Ljava/lang/Object;', iterator, [])));
  }
  return result;
}

function plainValue(value: JvmValue): unknown {
  return value && typeof value === 'object' && value.kind === 'string' ? value.value : value;
}

function javaString(value: string): JString {
  return { kind: 'string', cls: 'java/lang/String', value, fields: new Map() };
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function number(value: string | undefined): number {
  const result = Number(value ?? '0');
  if (!Number.isFinite(result)) throw new Error(`Invalid CSV number ${value}`);
  return result;
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  return false;
}
