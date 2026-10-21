import { Introspector, Jvm, Reflection, parseFieldDescriptor, type JavaType } from '../jvm';
import { decodeCourseClasses } from '../course-data';
import type { ClassBytes, ParsedClasses } from './common';
import { parseClasses } from './common';

const factClasses = [
  'legacy.model.Applicant',
  'legacy.model.LoanApplication',
  'legacy.model.Decision',
  'modern.model.Applicant',
  'modern.model.LoanEvent',
  'modern.model.Income',
  'modern.model.Debts',
  'modern.model.Residence',
  'modern.model.LoanRequest',
  'modern.model.Guarantor',
  'modern.model.Employment',
] as const;

const modifierNames = [
  [0x0001, 'public'],
  [0x0004, 'protected'],
  [0x0002, 'private'],
  [0x0008, 'static'],
  [0x0010, 'final'],
  [0x0020, 'synchronized'],
  [0x0040, 'volatile'],
  [0x0080, 'transient'],
  [0x0100, 'native'],
  [0x0400, 'abstract'],
  [0x0800, 'strictfp'],
] as const;

export interface FactField {
  readonly field: string;
  readonly type: string;
  readonly modifiers: string;
}

export interface FactProperty {
  readonly property: string;
  readonly readMethod: string;
  readonly writeMethod: string;
}

export interface ClassFacts {
  readonly class: string;
  readonly fields: readonly FactField[];
  readonly properties: readonly FactProperty[];
}

export interface FactsResult {
  readonly data: readonly ClassFacts[];
  readonly trace: readonly { readonly class: string; readonly fields: number; readonly properties: number }[];
}

export function facts(bytes: ClassBytes = decodeCourseClasses()): FactsResult {
  const parsed = parseClasses(bytes);
  return factsFromParsed(parsed);
}

export function factsFromParsed(classes: ParsedClasses): FactsResult {
  const jvm = new Jvm(classes);
  const reflection = new Reflection(jvm, classes);
  const data = factClasses.map((name): ClassFacts => {
    const reflected = reflection.forName(name);
    const fields = reflected
      .getDeclaredFields()
      .map((field): FactField => ({
        field: field.name,
        type: genericTypeName(field.getGenericType()?.value) ?? descriptorType(field.typeDescriptor),
        modifiers: modifierNames
          .filter(([mask]) => (field.info.accessFlags & mask) !== 0)
          .map(([, label]) => label)
          .join(' '),
      }))
      .sort((left, right) => compareJavaStrings(left.field, right.field));
    const properties = Introspector.getBeanInfo(reflected)
      .filter((property) => property.name !== 'class')
      .map((property): FactProperty => ({
        property: property.name,
        readMethod: property.readMethod?.name ?? '',
        writeMethod: property.writeMethod?.name ?? '',
      }))
      .sort((left, right) => compareJavaStrings(left.property, right.property));
    return { class: name, fields, properties };
  });
  return {
    data,
    trace: data.map(({ class: className, fields: declared, properties }) => ({
      class: className,
      fields: declared.length,
      properties: properties.length,
    })),
  };
}

function compareJavaStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function descriptorType(descriptor: string): string {
  return javaTypeName(parseFieldDescriptor(descriptor));
}

function javaTypeName(type: JavaType): string {
  if (type.kind === 'primitive') return type.name;
  if (type.kind === 'object') return type.internalName.replaceAll('/', '.');
  return `${javaTypeName(type.component)}[]`;
}

function genericTypeName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('kind' in value)) return null;
  const generic = value as { readonly kind: string; readonly type?: unknown };
  if (generic.kind === 'field' && 'type' in generic) return signatureTypeName(generic.type);
  return null;
}

function signatureTypeName(value: unknown): string {
  if (!value || typeof value !== 'object' || !('kind' in value)) return 'java.lang.Object';
  const type = value as {
    readonly kind: string;
    readonly descriptor?: string;
    readonly name?: string;
    readonly component?: unknown;
    readonly segments?: readonly {
      readonly name: string;
      readonly arguments: readonly { readonly kind: string; readonly type?: unknown }[];
    }[];
  };
  if (type.kind === 'base') {
    const names: Readonly<Record<string, string>> = {
      B: 'byte',
      C: 'char',
      D: 'double',
      F: 'float',
      I: 'int',
      J: 'long',
      S: 'short',
      Z: 'boolean',
    };
    return names[type.descriptor ?? ''] ?? 'java.lang.Object';
  }
  if (type.kind === 'typeVariable') return type.name ?? 'T';
  if (type.kind === 'array') return `${signatureTypeName(type.component)}[]`;
  if (type.kind === 'class') {
    const segments = type.segments ?? [];
    const first = segments[0];
    if (!first) return 'java.lang.Object';
    const base = first.name.replaceAll('/', '.');
    const typeArguments = (arguments_: typeof first.arguments): string =>
      arguments_.length === 0
        ? ''
        : `<${arguments_
            .map((argument) => {
              if (argument.kind === 'any') return '?';
              if (argument.kind === 'exact') return signatureTypeName(argument.type);
              return `? ${argument.kind} ${signatureTypeName(argument.type)}`;
            })
            .join(', ')}>`;
    return `${base}${typeArguments(first.arguments)}${segments
      .slice(1)
      .map((segment) => `.${segment.name}${typeArguments(segment.arguments)}`)
      .join('')}`;
  }
  return 'java.lang.Object';
}
