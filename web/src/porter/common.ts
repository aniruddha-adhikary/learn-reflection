import { parseClassFile, type ClassFile, type MemberInfo } from '../jvm';
import { courseData, decodeCourseClasses, type CourseBindings } from '../course-data';

export type ClassBytes = ReadonlyMap<string, Uint8Array>;
export type ParsedClasses = ReadonlyMap<string, ClassFile>;

export function parseClasses(bytes: ClassBytes = decodeCourseClasses()): ParsedClasses {
  const classes = new Map<string, ClassFile>();
  for (const [name, content] of bytes) classes.set(name, parseClassFile(content));
  return classes;
}

export function methodOf(classFile: ClassFile, name: string, descriptor?: string): MemberInfo {
  const method = classFile.methods.find(
    (candidate) => candidate.name === name && (descriptor === undefined || candidate.descriptor === descriptor),
  );
  if (!method) throw new Error(`Missing method ${classFile.thisClass}.${name}${descriptor ?? ''}`);
  return method;
}

export function courseSourceName(bindings: CourseBindings): string {
  return bindings === courseData.bindings.mistake ? 'data/bindings.ai-mistake.json' : 'data/bindings.ai.json';
}
