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

export function csvRows(text: string): string[][] {
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

export function csvAppIds(csv: string): readonly { readonly appId: string }[] {
  const rows = csvRows(csv);
  const header = rows[0];
  if (!header) throw new Error('Course CSV has no header');
  const index = header.indexOf('APP_ID');
  if (index < 0) throw new Error('Course CSV has no APP_ID column');
  return rows.slice(1).map((row, rowIndex) => {
    const appId = row[index];
    if (!appId) throw new Error(`Missing APP_ID in CSV row ${rowIndex + 2}`);
    return { appId };
  });
}
