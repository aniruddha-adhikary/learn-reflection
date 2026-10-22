import type { InstructionOperand, ResolvedConstant } from '../jvm';

export function instructionOperand(operands: readonly InstructionOperand[]): string {
  return operands.map(formatInstructionOperand).filter(Boolean).join(', ');
}

function formatInstructionOperand(operand: InstructionOperand): string {
  switch (operand.kind) {
    case 'immediate': return String(operand.value);
    case 'local': return String(operand.index);
    case 'increment': return `${operand.index}, ${operand.amount}`;
    case 'branchTarget': return String(operand.target);
    case 'constant': return formatConstant(operand.constant);
    case 'dimensions': return String(operand.count);
    case 'invokeCount': return String(operand.count);
    case 'wideOpcode': return operand.mnemonic;
    case 'switch':
      return [
        `default: ${operand.defaultTarget}`,
        ...operand.cases.map(({ key, target }) => `${key}: ${target}`),
      ].join(', ');
  }
}

function formatConstant(constant: ResolvedConstant): string {
  switch (constant.kind) {
    case 'integer':
    case 'float':
    case 'long':
    case 'double': return String(constant.value);
    case 'string': return JSON.stringify(constant.value);
    case 'class': return constant.name;
    case 'fieldRef': return `${constant.owner}.${constant.name}`;
    case 'methodRef': return `${constant.owner}.${constant.name}${constant.descriptor}`;
    case 'methodHandle': return formatConstant(constant.reference);
    case 'methodType': return constant.descriptor;
    case 'dynamic': return `${constant.name}${constant.descriptor}`;
  }
}
