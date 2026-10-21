/**
 * CONSTANT FOLDING
 * ================
 *
 * COMPILER CONCEPT: constant folding evaluates an operation at compile time
 * when every operand it needs is already a literal constant, replacing the
 * operation with its computed result.
 *
 *      t1 = 10 + 20     -->     t1 = 30
 *      t2 = -5          -->     t2 = -5    (see "unary" below)
 *
 * This pass performs NO analysis and needs no environment: unlike constant
 * propagation, it never asks "what is this name's value?" -- it only ever
 * looks at the operands an instruction ALREADY has, and evaluates when they
 * are already literal constants. Because it runs after propagation in this
 * optimizer's fixed pipeline, many of the constants it evaluates are ones
 * propagation has just substituted in (`a + b` became `10 + 20` first; THIS
 * pass turns that into `30`). Folding also fires on any expression the AST
 * already handed the generator as a purely literal computation, such as
 * `10 + 20` written directly in the source -- there is nothing that
 * distinguishes a "propagated" constant from a "written" one once it has
 * become an operand of kind `'constant'`.
 *
 * WHAT COUNTS AS "FOLDABLE"
 *
 *   binary   -  BOTH operands are constants           -->  evaluate, replace
 *               with an `assign` holding the result
 *   unary    -  the operand is a constant              -->  evaluate, replace
 *               with an `assign` holding the result
 *   assign   -  nothing to evaluate: it already holds a bare value, not an
 *               operation
 *   copy     -  likewise nothing to evaluate: it moves a value, it does not
 *               compute one
 *
 * A folded `binary`/`unary` becomes an `assign` rather than staying a
 * `binary`/`unary` with a literal in place of the old operands, because
 * there is no operation left to perform -- `t1 = 30` is a value, not a
 * computation, and `assign` is exactly the instruction kind this codebase
 * uses for "a target holding a plain value" (see tac.ts). Note that for
 * `t1 = -5`, folding into `assign { value: -5 }` prints as `t1 = -5` --
 * character-for-character the same text the unfolded `unary` instruction
 * already printed. The instruction's KIND changes; the visible text does
 * not.
 *
 * DIVISION BY ZERO: `evaluateBinary` (in `../evaluate.ts`) returns
 * `undefined` for a division whose right operand is zero. This pass treats
 * that as "cannot fold" and leaves the instruction completely untouched --
 * never Infinity, never 0, never a crash. The optimizer is not a runtime
 * evaluator, and a program that would divide by zero at runtime is not this
 * pass's problem to solve.
 *
 * WHAT THIS PASS DELIBERATELY DOES NOT DO
 *
 * It never applies an algebraic identity. `t1 = c * 1` stays exactly
 * `t1 = c * 1` -- `c` is a variable, not a constant, so the "both operands
 * constant" condition simply is not met, and no special case exists
 * anywhere in this file for "operand equals 1" or "operand equals 0". Those
 * rewrites are algebraic simplification, a distinct optimization technique
 * that belongs to a later phase. The only thing that ever changes an
 * instruction here is BOTH of its operands already being literal numbers.
 *
 * IMMUTABILITY: this pass never mutates its input. `program.instructions.map`
 * always returns a new array; each element is either the ORIGINAL
 * instruction object (when nothing was folded) or a freshly constructed
 * `assign` instruction (when it was) -- never a mutated copy of the input.
 */

import type { TACInstruction, TACProgram } from '../../ir/tac.ts';
import { evaluateBinary, evaluateUnary } from '../evaluate.ts';
import { isComparisonOperator, numericResultType, operandType } from '../typeUtils.ts';

/** Fold one instruction if it is a fully-constant operation; otherwise return it unchanged. */
function foldInstruction(instruction: TACInstruction): TACInstruction {
  switch (instruction.kind) {
    case 'binary': {
      if (instruction.left.kind !== 'constant' || instruction.right.kind !== 'constant') {
        return instruction; // at least one operand is not yet known: nothing to fold
      }
      const resultType = isComparisonOperator(instruction.operator)
        ? 'bool' as const
        : numericResultType(instruction.targetType, instruction.left, instruction.right);
      const result = evaluateBinary(instruction.operator, instruction.left.value, instruction.right.value, resultType);
      if (result === undefined) return instruction; // division by zero: leave it alone
      return {
        kind: 'assign',
        target: instruction.target,
        targetKind: 'temporary',
        value: { kind: 'constant', value: result, valueType: resultType },
        targetType: resultType,
        sourceNodeId: instruction.sourceNodeId,
      };
    }

    case 'unary': {
      if (instruction.operand.kind !== 'constant') return instruction;
      if (instruction.operator === '-' && typeof instruction.operand.value !== 'number') return instruction;
      if (instruction.operator === '!' && typeof instruction.operand.value !== 'boolean') return instruction;
      const result = evaluateUnary(instruction.operator, instruction.operand.value);
      const resultType = instruction.targetType ?? operandType(instruction.operand);
      return {
        kind: 'assign',
        target: instruction.target,
        targetKind: 'temporary',
        value: { kind: 'constant', value: result, valueType: resultType },
        targetType: resultType,
        sourceNodeId: instruction.sourceNodeId,
      };
    }

    case 'assign':
    case 'copy':
    case 'print':
    case 'return':
    case 'call':
    case 'param':
    case 'functionBegin':
    case 'functionEnd':
    case 'label':
    case 'jump':
    case 'jumpIfFalse':
      // Neither holds an operator, so there is nothing here to evaluate.
      return instruction;
  }
}

/**
 * Run constant folding over a TAC program.
 *
 * Pure function: the input `program` is never modified. Returns a new
 * TACProgram; `result !== program` and `result.instructions !== program.instructions`.
 *
 * @example
 *   constantFolding(tacOf('t1 = 10 + 20;'))   // (illustrative; TAC is built, not parsed)
 *   // t1 = 30
 */
export function constantFolding(program: TACProgram): TACProgram {
  return { ...program, instructions: program.instructions.map(foldInstruction) };
}
