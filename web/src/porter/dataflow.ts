import { analyzeSources, decode, parseMethodDescriptor, producersOf, type ClassFile, type Instruction, type MemberInfo, type Source } from '../jvm';
import type { ClassBytes, ParsedClasses } from './common';
import { methodOf, parseClasses } from './common';
import { decodeCourseClasses } from '../course-data';

const legacyModelOrder = ['legacy/model/Applicant', 'legacy/model/LoanApplication', 'legacy/model/Decision'] as const;

export interface DataflowTrace {
  readonly line: string;
  readonly instructionOffsets: readonly number[];
  readonly callSiteOffset?: number;
}

export interface DataflowResult {
  readonly data: readonly string[];
  readonly trace: readonly DataflowTrace[];
}

export function dataflow(bytes: ClassBytes = decodeCourseClasses()): DataflowResult {
  return dataflowFromParsed(parseClasses(bytes));
}

export function dataflowFromParsed(classes: ParsedClasses): DataflowResult {
  const lines: string[] = [];
  const trace: DataflowTrace[] = [];
  const add = (line: string, offsets: readonly number[], callSiteOffset?: number): void => {
    lines.push(line);
    trace.push({
      line,
      instructionOffsets: [...new Set(offsets)].sort((left, right) => left - right),
      ...(callSiteOffset === undefined ? {} : { callSiteOffset }),
    });
  };

  for (const internalName of legacyModelOrder) {
    const owner = requireClass(classes, internalName);
    for (const method of owner.methods) {
      if (!method.name.startsWith('get') && !method.name.startsWith('is')) continue;
      const code = codeOf(method);
      if (!code) continue;
      const instructions = decode(code.code, owner.constantPool);
      try {
        const frames = analyzeSources(owner, method);
        for (const [index, instruction] of instructions.entries()) {
          const frame = frames[index];
          if (!isReturn(instruction.opcode) || !frame || frame.stack.length === 0) continue;
          const indices = producersOf(frames, index, 0);
          const provenance = provenanceFor(instructions, frames, indices);
          const line = `getter ${owner.thisClass.replaceAll('/', '.')}.${method.name}${method.descriptor} returns [${provenance.labels.join(', ')}]`;
          add(line, provenance.offsets);
        }
      } catch (error) {
        add(`FINDING unresolved getter dataflow ${owner.thisClass.replaceAll('/', '.')}.${method.name}: ${errorMessage(error)}`, []);
      }
    }
  }

  for (const internalName of [...classes.keys()].filter((name) => name.startsWith('legacy/rules/') && !name.includes('$')).sort()) {
    const owner = requireClass(classes, internalName);
    const method = methodOf(owner, 'execute');
    const code = codeOf(method);
    if (!code) continue;
    const instructions = decode(code.code, owner.constantPool);
    try {
      const frames = analyzeSources(owner, method);
      for (const [index, instruction] of instructions.entries()) {
        const call = methodReference(instruction);
        if (!call) continue;
        if (call.owner.startsWith('legacy/model/') && (call.name.startsWith('get') || call.name.startsWith('is'))) {
          const target = requireClass(classes, call.owner);
          const getter = methodOf(target, call.name, call.descriptor);
          const getterCode = codeOf(getter);
          if (!getterCode) {
            add(`FINDING unresolved getter call ${call.owner}.${call.name}${call.descriptor}: no Code attribute`, [], instruction.offset);
            continue;
          }
          const getterInstructions = decode(getterCode.code, target.constantPool);
          const getterFrames = analyzeSources(target, getter);
          const returned = returnedProvenance(target, getterInstructions, getterFrames);
          add(
            `rule ${internalName.slice(internalName.lastIndexOf('/') + 1)} getter-call ${call.owner}.${call.name}${call.descriptor} -> [${returned.labels.join(', ')}]`,
            returned.offsets,
            instruction.offset,
          );
        }
        if (
          (call.owner === 'java/util/List' || call.owner === 'java/util/Collection') &&
          call.name === 'add' &&
          call.descriptor === '(Ljava/lang/Object;)Z'
        ) {
          const indices = producersOf(frames, index, 0);
          const provenance = provenanceFor(instructions, frames, indices);
          add(
            `Collection.add ${internalName.slice(internalName.lastIndexOf('/') + 1)} argument <- [${provenance.labels.join(', ')}]`,
            provenance.offsets,
            instruction.offset,
          );
        }
      }
    } catch (error) {
      add(`FINDING unresolved rule dataflow ${owner.thisClass.replaceAll('/', '.')}: ${errorMessage(error)}`, []);
    }
  }
  return { data: lines, trace };
}

function returnedProvenance(
  owner: ClassFile,
  instructions: readonly Instruction[],
  frames: ReturnType<typeof analyzeSources>,
): { readonly labels: readonly string[]; readonly offsets: readonly number[] } {
  const labels = new Set<string>();
  const offsets = new Set<number>();
  for (const [index, instruction] of instructions.entries()) {
    if (!isReturn(instruction.opcode) || frames[index]?.stack.length === 0) continue;
    const sources = producersOf(frames, index, 0);
    const provenance = provenanceFor(instructions, frames, sources);
    for (const label of provenance.labels) labels.add(label);
    for (const offset of provenance.offsets) offsets.add(offset);
  }
  return { labels: [...labels].sort(), offsets: [...offsets].sort((left, right) => left - right) };
}

function provenanceFor(
  instructions: readonly Instruction[],
  frames: ReturnType<typeof analyzeSources>,
  sources: ReadonlySet<Source>,
): { readonly labels: readonly string[]; readonly offsets: readonly number[] } {
  const labels = new Set<string>();
  const offsets = new Set<number>();
  const visited = new Set<number>();
  const byOffset = new Map(instructions.map((instruction, index) => [instruction.offset, index]));

  const visit = (index: number): void => {
    if (visited.has(index)) return;
    visited.add(index);
    const instruction = instructions[index];
    const frame = frames[index];
    if (!instruction || !frame) return;
    const label = instructionLabel(instruction);
    if (label) {
      labels.add(label);
      offsets.add(instruction.offset);
    }
    for (const depth of consumedStackDepths(instruction)) {
      const stackIndex = frame.stack.length - 1 - depth;
      if (stackIndex < 0) continue;
      for (const source of frame.stack[stackIndex]?.sources ?? []) {
        if (source.kind === 'insn') visit(source.index);
      }
    }
    const target = branchTarget(instruction);
    if (target !== undefined && target === instruction.offset) {
      const targetIndex = byOffset.get(target);
      if (targetIndex !== undefined) visit(targetIndex);
    }
  };

  for (const source of sources) {
    if (source.kind === 'insn') visit(source.index);
  }
  return {
    labels: [...labels].sort(),
    offsets: [...offsets].sort((left, right) => left - right),
  };
}

function consumedStackDepths(instruction: Instruction): number[] {
  const opcode = instruction.opcode;
  if ([0x60, 0x64, 0x68, 0x6c, 0x70, 0x7e, 0x80, 0x82].includes(opcode)) return [0, 1];
  if (opcode === 0xc0 || opcode === 0xc1 || opcode === 0xbe || (opcode >= 0x74 && opcode <= 0x77)) return [0];
  if (opcode >= 0xb6 && opcode <= 0xb9) {
    const call = methodReference(instruction);
    if (!call) return [];
    const descriptor = parseMethodDescriptor(call.descriptor);
    const receiverCount = opcode === 0xb8 ? 0 : 1;
    return Array.from({ length: descriptor.parameters.length + receiverCount }, (_, index) => index);
  }
  return [];
}

function instructionLabel(instruction: Instruction): string | null {
  const constant = instruction.operands.find((operand) => operand.kind === 'constant');
  if (constant?.kind === 'constant') {
    if (constant.constant.kind === 'fieldRef') {
      return `${constant.constant.owner}.${constant.constant.name}`;
    }
    if (constant.constant.kind === 'methodRef') {
      return `${constant.constant.owner}.${constant.constant.name}`;
    }
  }
  if (instruction.opcode === 0xc0 || instruction.opcode === 0xc1) return instruction.mnemonic.toUpperCase();
  if (instruction.opcode >= 0x15 && instruction.opcode <= 0x19) return null;
  if (instruction.opcode >= 0x1a && instruction.opcode <= 0x2d) return null;
  return instruction.opcode < 0xb2 ? instruction.mnemonic.toUpperCase() : null;
}

function methodReference(instruction: Instruction): { owner: string; name: string; descriptor: string } | null {
  const operand = instruction.operands.find((item) => item.kind === 'constant');
  return operand?.kind === 'constant' && operand.constant.kind === 'methodRef'
    ? operand.constant
    : null;
}

function branchTarget(instruction: Instruction): number | undefined {
  const operand = instruction.operands.find((item) => item.kind === 'branchTarget');
  return operand?.kind === 'branchTarget' ? operand.target : undefined;
}

function isReturn(opcode: number): boolean {
  return opcode >= 0xac && opcode <= 0xb0;
}

function codeOf(method: MemberInfo) {
  return method.attributes.find((attribute) => attribute.kind === 'code');
}

function requireClass(classes: ParsedClasses, internalName: string): ClassFile {
  const result = classes.get(internalName);
  if (!result) throw new Error(`Missing class ${internalName}`);
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
