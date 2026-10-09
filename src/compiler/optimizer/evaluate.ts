/** Pure compile-time evaluation helpers for arithmetic and comparisons. */

import type { TACBinaryOperator, TACUnaryOperator } from '../ir/tac.ts';
import type { MiniCType } from '../types.ts';

/** Evaluate a fully-constant MiniC binary expression. */
export function evaluateBinary(
  operator: TACBinaryOperator,
  left: number | boolean,
  right: number | boolean,
  resultType: MiniCType = 'int'
): number | boolean | undefined {
  switch (operator) {
    case '+':
      return (left as number) + (right as number);
    case '-':
      return (left as number) - (right as number);
    case '*':
      return (left as number) * (right as number);
    case '%':
      if ((right as number) === 0) return undefined;
      return (left as number) % (right as number);
    case '/':
      if ((right as number) === 0) return undefined;
      return resultType === 'float' ? (left as number) / (right as number) : Math.trunc((left as number) / (right as number));
    case '<':
      return (left as number) < (right as number);
    case '>':
      return (left as number) > (right as number);
    case '<=':
      return (left as number) <= (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '==':
      return left === right;
    case '!=':
      return left !== right;
  }
}

/** Evaluate MiniC's unary minus. Semantic analysis guarantees a numeric operand. */
export function evaluateUnary(operator: TACUnaryOperator, operand: number | boolean): number | boolean {
  switch (operator) {
    case '-':
      return -(operand as number);
    case '!':
      return !(operand as boolean);
  }
}
