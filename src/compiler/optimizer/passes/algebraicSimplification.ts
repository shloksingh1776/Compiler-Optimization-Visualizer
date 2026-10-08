/**
 * ALGEBRAIC SIMPLIFICATION
 * ========================
 *
 * COMPILER CONCEPT: algebraic simplification rewrites an operation using a
 * mathematical identity that holds for ANY value of the non-constant operand
 * -- unlike constant folding, it needs only ONE operand to be a specific
 * constant, not both.
 *
 *      t1 = c * 1     -->     t1 = c        (true whatever c is)
 *      t1 = 10 * 1    -->     t1 = 10       (this is constant FOLDING instead --
 *                                             both operands were already
 *                                             constant, so folding already
 *                                             consumed this instruction one
 *                                             pass earlier; this pass never
 *                                             even sees it)
 *
 * EXACTLY SIX IDENTITIES, NO MORE
 *
 *      x + 0  -> x          x - 0  -> x
 *      x * 1  -> x          x / 1  -> x
 *      x * 0  -> 0          0 * x  -> 0
 *
 * This list is deliberately not "closed under commutativity": `0 + x` and
 * `1 * x` are NOT simplified, even though they are mathematically identical
 * to two of the rules above. Only `0 * x -> 0` gets a left-hand form, paired
 * with `x * 0 -> 0`. This is a scope boundary, not an oversight -- adding the
 * missing symmetric forms would be "adding an algebraic rule" beyond the six
 * approved ones.
 *
 * WHY THESE SIX ARE SAFE FOR MiniC's INTEGER ARITHMETIC
 *
 * Every one of them holds for every possible integer value of the
 * non-constant operand, with no exception. Two similar-looking rules are
 * deliberately NOT implemented because they are NOT unconditionally safe:
 *
 *      0 / x -> 0     WRONG when x = 0 (that division is undefined, and
 *                     folding already refuses to evaluate it -- simplifying
 *                     it away here would silently invent a value instead)
 *      x / x -> 1     WRONG when x = 0, for the same reason
 *
 * Nothing resembling `x - x -> 0`, `x + x -> 2x`, `x * x -> x^2`, or
 * `x * 2 -> x + x` (strength reduction) is implemented either -- none of
 * those were requested, and the last one would need to compare two DIFFERENT
 * operands for equality, which none of the six approved rules ever do.
 *
 * WHY THIS RUNS AFTER FOLDING, NOT BEFORE
 *
 * Constant folding already replaces any BOTH-constant binary instruction
 * with a plain `assign`. So by the time this pass runs, a surviving
 * `binary` instruction is guaranteed to have AT MOST one constant operand --
 * there is no risk of double-handling a fully-constant expression here.
 *
 * WHAT THIS PASS PRODUCES
 *
 * The identity's surviving operand (`x`, or the constant `0` for the
 * annihilator rules) becomes the instruction's new value, using whichever
 * instruction kind this codebase already uses for "no operation, just a
 * value": `assign` when that operand is a constant or a plain variable, and
 * `copy` when it is a temporary -- exactly the same choice tacGenerator.ts
 * makes when translating a bare value in the first place, so the result is
 * indistinguishable in shape from TAC the generator could have produced
 * directly.
 *
 *      t1 = c * 1     -->   t1 = c     (assign: c is a variable)
 *      t4 = t3 / 1    -->   t4 = t3    (copy: t3 is a temporary)
 *
 * Only the ONE instruction that computed the identity is rewritten. A LATER
 * instruction that already reads the old temporary (e.g. `d = t1` sitting
 * below `t1 = c * 1`) is left completely untouched -- it still reads `t1` by
 * name, whatever `t1` is now defined to equal. Merging that use in as well
 * would be copy propagation, a separate technique this pass does not
 * perform.
 *
 * IMMUTABILITY: `program.instructions.map` always returns a new array, and
 * every element is either the ORIGINAL instruction (nothing matched) or a
 * freshly built `assign`/`copy` (something did) -- never a mutated copy.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';
import { instructionTargetType } from '../typeUtils.ts';
import type { MiniCType } from '../../types.ts';

function isConstantValue(operand: Operand, value: number): boolean {
  return operand.kind === 'constant' && operand.value === value;
}

/**
 * Build the instruction that replaces a fully-simplified binary op: `target`
 * now just holds `result`, with no operation left to perform.
 */
function toValueInstruction(target: string, result: Operand, sourceNodeId: string, targetType: MiniCType = result.valueType ?? 'int'): TACInstruction {
  const normalized: Operand = result.valueType === targetType ? result : { ...result, valueType: targetType };
  if (normalized.kind === 'temporary') {
    return { kind: 'copy', target, targetType, source: normalized, sourceNodeId };
  }
  return { kind: 'assign', target, targetType, value: normalized, sourceNodeId };
}

/** Apply the six approved identities to one instruction; everything else passes through untouched. */
function simplifyInstruction(instruction: TACInstruction): TACInstruction {
  // Only a binary operation can match one of these identities. `assign` and
  // `copy` already hold a bare value with no operator; `unary` has no
  // identity in the approved list (a constant-operand unary was already
  // folded away by the previous pass, so it has nothing left to simplify).
  if (instruction.kind !== 'binary') return instruction;

  const { target, left, operator, right, sourceNodeId } = instruction;

  switch (operator) {
    case '+':
      // x + 0 -> x
      if (isConstantValue(right, 0)) return toValueInstruction(target, left, sourceNodeId, instructionTargetType(instruction));
      return instruction;

    case '-':
      // x - 0 -> x
      if (isConstantValue(right, 0)) return toValueInstruction(target, left, sourceNodeId, instructionTargetType(instruction));
      return instruction;

    case '*':
      // x * 1 -> x
      if (isConstantValue(right, 1)) return toValueInstruction(target, left, sourceNodeId, instructionTargetType(instruction));
      // x * 0 -> 0
      if (isConstantValue(right, 0)) return toValueInstruction(target, right, sourceNodeId, instructionTargetType(instruction));
      // 0 * x -> 0
      if (isConstantValue(left, 0)) return toValueInstruction(target, left, sourceNodeId, instructionTargetType(instruction));
      return instruction;

    case '/':
      // x / 1 -> x
      if (isConstantValue(right, 1)) return toValueInstruction(target, left, sourceNodeId, instructionTargetType(instruction));
      return instruction;
    default:
      // Comparisons are not algebraic arithmetic identities in this pass.
      return instruction;
  }
}

/**
 * Run algebraic simplification over a TAC program.
 *
 * Pure function: the input `program` is never modified. Returns a new
 * TACProgram; `result !== program` and `result.instructions !== program.instructions`.
 *
 * @example
 *   algebraicSimplification(programWith('t1 = c * 1;'))
 *   // t1 = c
 */
export function algebraicSimplification(program: TACProgram): TACProgram {
  return {
    instructions: program.instructions.map(simplifyInstruction),
    temporaryCount: program.temporaryCount,
  };
}
