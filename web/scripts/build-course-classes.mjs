import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(webRoot, '..');
const courseData = path.join(webRoot, 'src', 'course-data');
const sourceRoots = [
  path.join(repoRoot, 'playground', 'legacy', 'src', 'main', 'java'),
  path.join(repoRoot, 'playground', 'modern', 'src', 'main', 'java'),
];
const goldenSource = path.join(repoRoot, 'playground', 'porter', 'src', 'test', 'resources');
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'learn-reflection-course-'));
const classRoot = path.join(temporaryRoot, 'classes');

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
    })
    .sort();
}

function run(program, args) {
  try {
    execFileSync(program, args, {
      cwd: repoRoot,
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(`${program} ${args.join(' ')} failed`, { cause: error });
  }
}

try {
  const sources = sourceRoots.flatMap(filesUnder).filter((source) => source.endsWith('.java')).sort();
  if (sources.length === 0) throw new Error('No legacy or modern Java sources found');

  mkdirSync(classRoot, { recursive: true });
  run('javac', [
    '--release',
    '17',
    '-g',
    '-parameters',
    '-XDstringConcat=inline',
    '-d',
    classRoot,
    ...sources,
  ]);

  const classes = filesUnder(classRoot)
    .filter((file) => file.endsWith('.class'))
    .map((file) => {
      const internalName = path.relative(classRoot, file).split(path.sep).join('/').slice(0, -'.class'.length);
      return [internalName, readFileSync(file).toString('base64')];
    })
    .sort(([left], [right]) => left.localeCompare(right, 'en'));
  const classEntries = classes
    .map(([internalName, bytes]) => `  ${JSON.stringify(internalName)}: ${JSON.stringify(bytes)},`)
    .join('\n');
  mkdirSync(courseData, { recursive: true });
  writeFileSync(
    path.join(courseData, 'classes.generated.ts'),
    `export const courseClasses: Readonly<Record<string, string>> = {\n${classEntries}\n};\n`,
  );

  const dataTarget = path.join(courseData, 'data');
  rmSync(dataTarget, { recursive: true, force: true });
  cpSync(path.join(repoRoot, 'playground', 'data'), dataTarget, { recursive: true });

  const goldensTarget = path.join(courseData, 'java-goldens');
  rmSync(goldensTarget, { recursive: true, force: true });
  mkdirSync(goldensTarget, { recursive: true });
  for (const golden of filesUnder(goldenSource).filter((file) => file.endsWith('.golden.json'))) {
    cpSync(golden, path.join(goldensTarget, path.basename(golden)));
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
