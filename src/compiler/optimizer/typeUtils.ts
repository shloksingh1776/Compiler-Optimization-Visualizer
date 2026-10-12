/** Type helpers shared by the optimization passes. */
import type { Operand, TACInstruction, TACBinaryOperator } from '../ir/tac.ts';
import type { MiniCType } from '../types.ts';

export function operandType(operand: Operand): MiniCType {
  return operand.valueType ?? (operand.kind === 'constant' && typeof operand.value === 'boolean' ? 'bool' : 'int');
}

export function isComparisonOperator(operator: TACBinaryOperator): boolean {
  return operator === '<' || operator === '>' || operator === '<=' || operator === '>=' || operator === '==' || operator === '!=';
}

export function numericResultType(
  targetType: MiniCType | undefined,
  left: Operand,
  right?: Operand
): MiniCType {
  if (targetType !== undefined) return targetType;
  if (operandType(left) === 'float' || (right !== undefined && operandType(right) === 'float')) return 'float';
  return 'int';
}

export function instructionTargetType(instruction: TACInstruction): MiniCType {
  switch (instruction.kind) {
    case 'label': case 'jump': case 'param': case 'functionBegin': case 'functionEnd': return 'int';
    case 'jumpIfFalse': return operandType(instruction.condition);
    case 'call': return instruction.targetType === 'void' ? 'int' : instruction.targetType ?? 'int';
    case 'assign': return instruction.targetType ?? operandType(instruction.value);
    case 'copy': return instruction.targetType ?? operandType(instruction.source);
    case 'binary': return instruction.targetType ?? (isComparisonOperator(instruction.operator) ? 'bool' : numericResultType(undefined, instruction.left, instruction.right));
    case 'unary': return instruction.targetType ?? operandType(instruction.operand);
    case 'print': return instruction.targetType ?? operandType(instruction.operand);
    case 'return': return instruction.targetType === 'void' ? operandType(instruction.operand) : instruction.targetType ?? operandType(instruction.operand);
  }
}
