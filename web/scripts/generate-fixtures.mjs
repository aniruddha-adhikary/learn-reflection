import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = path.join(root, 'test-fixtures');
const javaRoot = path.join(fixtureRoot, 'java');
const classRoot = path.join(fixtureRoot, 'classes');
const goldenRoot = path.join(fixtureRoot, 'goldens');

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
    return execFileSync(program, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const details = error.stderr?.toString() ?? error.message;
    throw new Error(`${program} ${args.join(' ')} failed:\n${details}`, { cause: error });
  }
}

function parseJavap(text, internalName, constantPoolCount) {
  const kinds = new Array(constantPoolCount).fill(null);
  const javapKinds = new Map([
    ['Utf8', 'utf8'],
    ['Integer', 'integer'],
    ['Float', 'float'],
    ['Long', 'long'],
    ['Double', 'double'],
    ['Class', 'class'],
    ['String', 'string'],
    ['Fieldref', 'fieldRef'],
    ['Methodref', 'methodRef'],
    ['InterfaceMethodref', 'interfaceMethodRef'],
    ['NameAndType', 'nameAndType'],
    ['MethodHandle', 'methodHandle'],
    ['MethodType', 'methodType'],
    ['Dynamic', 'dynamic'],
    ['InvokeDynamic', 'invokeDynamic'],
    ['Module', 'module'],
    ['Package', 'package'],
  ]);
  const methods = [];
  let currentMethod = null;
  const finishMethod = () => {
    if (currentMethod) {
      if (!currentMethod.descriptor) {
        throw new Error(`javap omitted a descriptor for ${internalName}.${currentMethod.name}`);
      }
      methods.push(currentMethod);
      currentMethod = null;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (currentMethod && line.trim() !== '' && !/^\s/.test(line)) finishMethod();
    const poolEntry = line.match(/^\s+#(\d+) = ([A-Za-z][A-Za-z0-9]*)\b/);
    if (poolEntry) {
      const index = Number(poolEntry[1]);
      const kind = javapKinds.get(poolEntry[2]);
      if (!kind) throw new Error(`Unrecognized javap constant-pool tag: ${poolEntry[2]}`);
      if (index <= 0 || index >= constantPoolCount || kinds[index] !== null) {
        throw new Error(`Invalid or duplicate javap constant-pool index ${index}`);
      }
      kinds[index] = kind;
      continue;
    }
    if (
      /^\s{2}\S.*\(.*\)(?:\s+throws\s+[^;]+)?;\s*$/.test(line) ||
      /^\s{2}static \{\};\s*$/.test(line)
    ) {
      finishMethod();
      const header = line.trim();
      const openParen = header.indexOf('(');
      const token = (openParen < 0 ? header.slice(0, -1) : header.slice(0, openParen))
        .trim()
        .split(/\s+/)
        .at(-1);
      const simpleName = internalName.slice(internalName.lastIndexOf('/') + 1);
      const fullName = internalName.replaceAll('/', '.');
      currentMethod = {
        name:
          header.startsWith('static {};')
            ? '<clinit>'
            : token === simpleName || token === fullName
              ? '<init>'
              : token,
        descriptor: null,
        instructions: [],
      };
      continue;
    }
    if (!currentMethod) continue;
    const descriptor = line.match(/^\s+descriptor: (\S+)\s*$/);
    if (descriptor) {
      currentMethod.descriptor = descriptor[1];
      continue;
    }
    const instruction = line.match(/^\s*(\d+):\s+([A-Za-z][A-Za-z0-9_]*)\b/);
    if (instruction) {
      currentMethod.instructions.push({
        offset: Number(instruction[1]),
        mnemonic: instruction[2],
      });
    }
  }
  finishMethod();
  for (let index = 1; index < kinds.length; index += 1) {
    const previous = kinds[index - 1];
    if (kinds[index] === null && previous !== 'long' && previous !== 'double') {
      throw new Error(`javap omitted constant-pool entry ${index} for ${internalName}`);
    }
  }
  return { constantPoolKinds: kinds, methods };
}

const sources = filesUnder(javaRoot).filter((source) => source.endsWith('.java'));
if (sources.length === 0) throw new Error(`No Java fixture sources under ${javaRoot}`);
rmSync(classRoot, { recursive: true, force: true });
rmSync(goldenRoot, { recursive: true, force: true });
mkdirSync(classRoot, { recursive: true });
mkdirSync(goldenRoot, { recursive: true });
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

const classFiles = filesUnder(classRoot).filter((file) => file.endsWith('.class'));
const javaGoldens = path.join(goldenRoot, 'javap');
mkdirSync(javaGoldens, { recursive: true });
for (const classFile of classFiles) {
  const relativeName = path.relative(classRoot, classFile).replaceAll(path.sep, '/');
  const internalName = relativeName.slice(0, -'.class'.length);
  const bytes = readFileSync(classFile);
  const constantPoolCount = bytes.readUInt16BE(8);
  const listing = run('javap', ['-classpath', classRoot, '-p', '-s', '-c', '-v', internalName]);
  const structure = parseJavap(listing, internalName, constantPoolCount);
  const outputPath = path.join(javaGoldens, `${internalName}.json`);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify({ internalName, ...structure }, null, 2)}\n`);
}

const harness = run('java', ['-cp', classRoot, 'fixtures.FixtureHarness']);
writeFileSync(path.join(goldenRoot, 'runtime.json'), `${JSON.stringify(JSON.parse(harness), null, 2)}\n`);
