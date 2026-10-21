import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSources,
  BytecodeDecodeError,
  ClassFormatError,
  decode,
  findCalls,
  Introspector,
  Jvm,
  parseClassFile,
  parseClassSignature,
  parseFieldDescriptor,
  parseFieldSignature,
  parseMethodDescriptor,
  parseMethodSignature,
  producersOf,
  Proxy,
  Reflection,
  StepBudgetExceeded,
  UnsupportedBytecode,
  UnsupportedNative,
  type ClassFile,
  type JvmValue,
  type Source,
} from '../src/jvm/index';

const fixtureRoot = fileURLToPath(new URL('../test-fixtures/classes/', import.meta.url));
const goldenRoot = fileURLToPath(new URL('../test-fixtures/goldens/', import.meta.url));

interface JavapGolden {
  readonly internalName: string;
  readonly constantPoolKinds: readonly (string | null)[];
  readonly methods: readonly {
    readonly name: string;
    readonly descriptor: string;
    readonly instructions: readonly { readonly offset: number; readonly mnemonic: string }[];
  }[];
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

function loadFixtures(): Map<string, ClassFile> {
  const classes = new Map<string, ClassFile>();
  for (const file of filesUnder(fixtureRoot).filter((file) => file.endsWith('.class'))) {
    const internalName = path
      .relative(fixtureRoot, file)
      .split(path.sep)
      .join('/')
      .slice(0, -'.class'.length);
    classes.set(internalName, parseClassFile(readFileSync(file)));
  }
  return classes;
}

function methodOf(classFile: ClassFile, name: string) {
  const method = classFile.methods.find((candidate) => candidate.name === name);
  if (!method) throw new Error(`Missing method ${classFile.thisClass}.${name}`);
  return method;
}

function classOf(classes: ReadonlyMap<string, ClassFile>, name: string): ClassFile {
  const classFile = classes.get(name);
  if (!classFile) throw new Error(`Missing fixture class ${name}`);
  return classFile;
}

function codeOf(classFile: ClassFile, name: string) {
  const code = methodOf(classFile, name).attributes.find((attribute) => attribute.kind === 'code');
  if (!code) throw new Error(`Missing Code for ${classFile.thisClass}.${name}`);
  return { method: methodOf(classFile, name), code };
}

function normalizeValue(value: JvmValue): unknown {
  if (typeof value === 'bigint') return { $long: value.toString() };
  if (value === null || typeof value === 'number') return value;
  if (value.kind === 'string') return value.value;
  if (value.kind === 'array') return value.values.map(normalizeValue);
  const boxed = value.fields.get('$value');
  return boxed === undefined ? value.cls : normalizeValue(boxed);
}

function runtimeArgument(value: unknown): JvmValue {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (
    typeof value === 'object' &&
    value !== null &&
    '$long' in value &&
    typeof value.$long === 'string'
  ) {
    return BigInt(value.$long);
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return value;
  }
  if (typeof value === 'string') {
    return { kind: 'string', cls: 'java/lang/String', value, fields: new Map() };
  }
  throw new Error(`Unsupported runtime test argument ${JSON.stringify(value)}`);
}

function sourceMatches(
  sources: ReadonlySet<Source>,
  predicate: (source: Source) => boolean,
): boolean {
  return [...sources].some(predicate);
}

describe('class-file parsing and JDK differential goldens', () => {
  const classes = loadFixtures();

  it('matches javap method descriptors, constant-pool kinds, and every instruction', () => {
    const goldenFiles = filesUnder(path.join(goldenRoot, 'javap')).filter((file) => file.endsWith('.json'));
    expect(goldenFiles.length).toBe(classes.size);
    for (const file of goldenFiles) {
      const golden = JSON.parse(readFileSync(file, 'utf8')) as JavapGolden;
      const classFile = classes.get(golden.internalName);
      expect(classFile, golden.internalName).toBeDefined();
      if (!classFile) continue;
      expect(classFile.constantPool.map((entry) => entry?.kind ?? null)).toEqual(
        golden.constantPoolKinds,
      );
      const actualMethods = classFile.methods.map((method) => {
        const code = method.attributes.find((attribute) => attribute.kind === 'code');
        return {
          name: method.name,
          descriptor: method.descriptor,
          instructions:
            code?.kind === 'code'
              ? decode(code.code, classFile.constantPool).map(({ offset, mnemonic }) => ({
                  offset,
                  mnemonic,
                }))
              : [],
        };
      });
      expect(actualMethods, golden.internalName).toEqual(golden.methods);
    }
  });

  it('decodes all requested structural class attributes from javac fixtures', () => {
    const legacy = classes.get('fixtures/LegacyCases');
    const record = classes.get('fixtures/RecordPoint');
    const sealed = classes.get('fixtures/Shape');
    const holder = classes.get('fixtures/FixtureHarness');
    const generic = classes.get('fixtures/GenericBox');
    expect(legacy?.fields.some((field) => field.name === 'LONG_LIMIT' && field.attributes.some((attribute) => attribute.kind === 'constantValue'))).toBe(true);
    expect(legacy?.attributes.some((attribute) => attribute.kind === 'bootstrapMethods')).toBe(true);
    expect(legacy?.attributes.some((attribute) => attribute.kind === 'sourceFile')).toBe(true);
    expect(record?.attributes.some((attribute) => attribute.kind === 'record')).toBe(true);
    expect(sealed?.attributes.some((attribute) => attribute.kind === 'permittedSubclasses')).toBe(true);
    expect(holder?.attributes.some((attribute) => attribute.kind === 'nestMembers')).toBe(true);
    expect(generic?.attributes.some((attribute) => attribute.kind === 'signature')).toBe(true);
    expect(
      generic?.fields.some((field) =>
        field.attributes.some((attribute) => attribute.kind === 'signature'),
      ),
    ).toBe(true);
    expect(
      legacy?.methods.some((method) =>
        method.attributes.some(
          (attribute) => attribute.kind === 'unknown' && attribute.name === 'MethodParameters',
        ),
      ),
    ).toBe(true);
    expect(
      legacy?.methods.some((method) =>
        method.attributes.some(
          (attribute) =>
            attribute.kind === 'code' &&
            attribute.attributes.some((nested) => nested.kind === 'lineNumberTable'),
        ),
      ),
    ).toBe(true);
    expect(legacy?.methods.some((method) => method.attributes.some((attribute) => attribute.kind === 'exceptions'))).toBe(true);
    expect(legacy?.methods.some((method) => method.attributes.some((attribute) => attribute.kind === 'parameterAnnotations'))).toBe(true);
    expect(
      legacy?.methods.some((method) =>
        method.attributes.some(
          (attribute) =>
            attribute.kind === 'code' &&
            attribute.attributes.some((nested) => nested.kind === 'stackMapTable'),
        ),
      ),
    ).toBe(true);
  });

  it('fails loudly on malformed class files, descriptors, and opcodes', () => {
    expect(() => parseClassFile(Uint8Array.of(0, 0, 0, 0))).toThrow(ClassFormatError);
    const bytes = readFileSync(path.join(fixtureRoot, 'fixtures/LegacyCases.class'));
    expect(() => parseClassFile(bytes.subarray(0, 10))).toThrow(ClassFormatError);
    const invalidPoolReference = new Uint8Array(bytes);
    invalidPoolReference[11] = 0;
    invalidPoolReference[12] = 0;
    expect(() => parseClassFile(invalidPoolReference)).toThrow(ClassFormatError);
    expect(() => parseFieldDescriptor('Lmissing/semicolon')).toThrow();
    expect(() => parseMethodDescriptor('(I)')).toThrow();
    expect(() => decode(Uint8Array.of(0xcb), [])).toThrow(BytecodeDecodeError);
  });

  it('parses descriptors and generic signatures as typed structures', () => {
    expect(parseFieldDescriptor('[Ljava/lang/String;')).toEqual({
      kind: 'array',
      component: { kind: 'object', internalName: 'java/lang/String' },
    });
    expect(parseMethodDescriptor('(ID)Ljava/lang/String;').parameters).toHaveLength(2);
    const classSignature = parseClassSignature('<T:Ljava/lang/Number;>Ljava/lang/Object;');
    expect(classSignature.typeParameters[0]?.name).toBe('T');
    expect(parseFieldSignature('Ljava/util/List<+Ljava/lang/String;>;').type.kind).toBe('class');
    const methodSignature = parseMethodSignature('(TT;)Ljava/util/List<TT;>;^Ljava/lang/Exception;');
    expect(methodSignature.parameters[0]).toEqual({ kind: 'typeVariable', name: 'T' });
    expect(methodSignature.throws).toHaveLength(1);
  });
});

describe('bytecode decoding and source analysis', () => {
  const classes = loadFixtures();
  const legacy = classes.get('fixtures/LegacyCases');

  if (!legacy) throw new Error('Missing LegacyCases fixture');

  it('resolves switch, wide, and invokedynamic operands', () => {
    const tableCode = codeOf(legacy, 'tableSwitch').code;
    const tableSwitch = decode(tableCode.code, legacy.constantPool).find((instruction) =>
      instruction.operands.some((operand) => operand.kind === 'switch'),
    );
    expect(tableSwitch?.mnemonic).toBe('tableswitch');
    const lookupCode = codeOf(legacy, 'lookupSwitch').code;
    expect(
      decode(lookupCode.code, legacy.constantPool).some((instruction) => instruction.mnemonic === 'lookupswitch'),
    ).toBe(true);

    const wide = decode(Uint8Array.of(0xc4, 0x15, 0x01, 0x2c), []);
    expect(wide[0]?.operands).toContainEqual({ kind: 'local', index: 300 });
    const multiArray = decode(
      Uint8Array.of(0xc5, 0x00, 0x01, 0x02),
      [null, { kind: 'class', tag: 7, nameIndex: 2 }, { kind: 'utf8', tag: 1, value: '[[I' }],
    );
    expect(multiArray[0]?.operands).toContainEqual({ kind: 'dimensions', count: 2 });
    const dynamicCode = codeOf(legacy, 'lambdaFactory').code;
    const dynamic = decode(dynamicCode.code, legacy.constantPool).find((instruction) =>
      instruction.operands.some((operand) => operand.kind === 'constant'),
    );
    expect(dynamic?.operands.some((operand) => operand.kind === 'constant' && operand.constant.kind === 'dynamic')).toBe(true);
  });

  it('traces copied values through DUP and arguments through calls', () => {
    const { method: arrayMethod, code: arrayCode } = codeOf(legacy, 'arrayWrite');
    const arrayInstructions = decode(arrayCode.code, legacy.constantPool);
    const duplicateIndex = arrayInstructions.findIndex((instruction) => instruction.mnemonic === 'dup_x2');
    expect(duplicateIndex).toBeGreaterThanOrEqual(0);
    const preserved = analyzeSources(legacy, arrayMethod);
    const stock = analyzeSources(legacy, arrayMethod, { stockAsmCopySemantics: true });
    const getter = findCalls(arrayInstructions, (call) => call.name === 'getValue')[0];
    const getterIndex = arrayInstructions.findIndex((instruction) => instruction === getter);
    expect(
      sourceMatches(producersOf(preserved, duplicateIndex + 1, 0), (source) =>
        source.kind === 'insn' && source.index === getterIndex,
      ),
    ).toBe(true);
    expect(
      sourceMatches(producersOf(stock, duplicateIndex + 1, 0), (source) =>
        source.kind === 'insn' && source.index === duplicateIndex,
      ),
    ).toBe(true);

    const { method: addMethod, code: addCode } = codeOf(legacy, 'addValue');
    const addInstructions = decode(addCode.code, legacy.constantPool);
    const addIndex = addInstructions.findIndex((instruction) =>
      instruction.mnemonic === 'invokeinterface' &&
      findCalls([instruction], (call) => call.name === 'add').length === 1,
    );
    const getterCall = findCalls(addInstructions, (call) => call.name === 'getLabel')[0];
    const getterCallIndex = addInstructions.findIndex((instruction) => instruction === getterCall);
    expect(
      sourceMatches(producersOf(analyzeSources(legacy, addMethod), addIndex, 0), (source) =>
        source.kind === 'insn' && source.index === getterCallIndex,
      ),
    ).toBe(true);
  });

  it('merges branch sources at control-flow joins', () => {
    const { method, code } = codeOf(legacy, 'branchMerge');
    const instructions = decode(code.code, legacy.constantPool);
    const returnIndex = instructions.findIndex((instruction) => instruction.mnemonic === 'ireturn');
    const sources = producersOf(analyzeSources(legacy, method), returnIndex, 0);
    const producerIndexes = [...sources]
      .filter((source) => source.kind === 'insn')
      .map((source) => source.index);
    expect(new Set(producerIndexes).size).toBeGreaterThanOrEqual(2);
  });
});

describe('teaching JVM and reflection', () => {
  const classes = loadFixtures();

  it('matches the real JVM harness results for fixture methods', () => {
    const golden = JSON.parse(readFileSync(path.join(goldenRoot, 'runtime.json'), 'utf8')) as {
      readonly method: string;
      readonly args: readonly unknown[];
      readonly result?: unknown;
      readonly threw?: string;
    }[];
    for (const testCase of golden) {
      const method = methodOf(classOf(classes, 'fixtures/LegacyCases'), testCase.method);
      const result = new Jvm(classes).run(
        'fixtures/LegacyCases',
        testCase.method,
        method.descriptor,
        testCase.args.map(runtimeArgument),
      );
      if ('threw' in testCase) {
        expect(result).toMatchObject({ threw: testCase.threw });
      } else if ('result' in result) {
        expect(normalizeValue(result.result)).toEqual(testCase.result);
      } else {
        throw new Error(`${testCase.method} unexpectedly threw ${result.threw}`);
      }
    }
  });

  it('enforces step budgets and reports intentionally unsupported operations', () => {
    const steps: string[] = [];
    new Jvm(classes, {
      onStep: ({ className, methodName }) => steps.push(`${className}.${methodName}`),
    }).run('fixtures/LegacyCases', 'add', '(II)I', [1, 2]);
    expect(steps).toContain('fixtures/LegacyCases.add');

    const budgetJvm = new Jvm(classes, { stepBudget: 5 });
    expect(() => budgetJvm.run('fixtures/LegacyCases', 'nestedLoop', '(I)I', [5])).toThrow(
      StepBudgetExceeded,
    );
    expect(() => new Jvm(classes).run('fixtures/LegacyCases', 'lambdaFactory', '()Ljava/lang/Runnable;'))
      .toThrow(UnsupportedBytecode);
    expect(() =>
      new Jvm(classes).run('fixtures/LegacyCases', 'unsupportedNative', '(Ljava/lang/String;)Ljava/lang/String;', [
        { kind: 'string', cls: 'java/lang/String', value: 'value', fields: new Map() },
      ]),
    ).toThrow(UnsupportedNative);
  });

  it('supports bean introspection, annotations, private access, and proxies', () => {
    const jvm = new Jvm(classes);
    const reflection = new Reflection(jvm, classes);
    const beanClass = reflection.forName('fixtures.Bean');
    const constructor = beanClass.getDeclaredConstructors()[0];
    if (!constructor) throw new Error('Bean has no constructor');
    const bean = constructor.newInstance();
    const properties = Introspector.getBeanInfo(beanClass);
    expect(properties.map(({ name }) => name)).toContain('name');
    expect(properties.map(({ name }) => name)).toContain('ready');
    expect(properties.map(({ name }) => name)).toContain('URL');
    const beanAnnotation = beanClass
      .getAnnotations()
      .find((candidate) => candidate.typeName === 'fixtures.Audit');
    expect(beanAnnotation?.values.get('value')).toBe('bean');
    const explicitAnnotation = reflection
      .forName('fixtures.LegacyCases')
      .getAnnotations()
      .find((candidate) => candidate.typeName === 'fixtures.Audit');
    expect(explicitAnnotation?.values.get('numbers')).toEqual([2, 3]);
    expect(beanClass.getDeclaredMethod('getName').invoke(bean)).toMatchObject({
      kind: 'string',
      value: '',
    });
    beanClass
      .getDeclaredMethod('setName', 'java.lang.String')
      .invoke(bean, { kind: 'string', cls: 'java/lang/String', value: 'updated', fields: new Map() });
    expect(beanClass.getDeclaredMethod('getName').invoke(bean)).toMatchObject({
      kind: 'string',
      value: 'updated',
    });

    const secret = beanClass.getDeclaredFields().find((field) => field.name === 'secret');
    if (!secret) throw new Error('Missing private bean field');
    let accessFailure: unknown;
    try {
      secret.get(bean);
    } catch (error) {
      accessFailure = error;
    }
    expect(accessFailure).toBeDefined();
    expect((accessFailure as { readonly object?: { readonly cls?: string } }).object?.cls).toBe(
      'java/lang/IllegalAccessException',
    );
    secret.setAccessible(true);
    secret.set(bean, {
      kind: 'string',
      cls: 'java/lang/String',
      value: 'changed',
      fields: new Map(),
    });
    expect(normalizeValue(secret.get(bean))).toBe('changed');

    const generic = reflection.forName('fixtures.GenericBox');
    expect(generic.getGenericType()?.kind).toBe('class');
    expect(
      generic.getDeclaredFields().find((field) => field.name === 'values')?.getGenericType()?.kind,
    ).toBe('field');
    const holderClass = reflection.forName('fixtures.ValueHolder');
    expect(holderClass.getMethods().some((method) => method.name === 'getBase')).toBe(true);
    const uninitialized = reflection.objenesisInstantiate(holderClass);
    expect(holderClass.getDeclaredMethod('getValue').invoke(uninitialized)).toBe(0);

    const transformer = reflection.forName('fixtures.Transformer');
    const proxy = Proxy.newProxyInstance(reflection, [transformer], (_proxy, method, args) => {
      expect(method.name).toBe('transform');
      expect(args[0]).toMatchObject({ kind: 'string', value: 'source' });
      return {
        kind: 'string',
        cls: 'java/lang/String',
        value: 'handled',
        fields: new Map(),
      };
    });
    const call = jvm.run(
      'fixtures/ProxyClient',
      'call',
      '(Lfixtures/Transformer;)Ljava/lang/String;',
      [proxy],
    );
    expect(call).toMatchObject({ result: { kind: 'string', value: 'handled' } });

    const throwingProxy = Proxy.newProxyInstance(reflection, [transformer], () =>
      jvm.throwException('java/lang/IllegalStateException', 'handler failed'),
    );
    expect(
      jvm.run(
        'fixtures/ProxyClient',
        'call',
        '(Lfixtures/Transformer;)Ljava/lang/String;',
        [throwingProxy],
      ),
    ).toMatchObject({ threw: 'java.lang.IllegalStateException' });
  });
});
