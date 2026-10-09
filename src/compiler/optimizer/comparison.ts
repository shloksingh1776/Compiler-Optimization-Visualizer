/**
 * TAC COMPARISON  (Phase 8)
 * =========================
 *
 * COMPILER CONCEPT: this module answers one question -- "what did
 * optimization actually change?" -- by comparing the original TAC against
 * the optimized TAC. It performs NO optimization itself; it only inspects
 * two already-computed `TACProgram`s and reports the difference.
 *
 *      original TAC  \
 *                      >  [ compareTAC ]  -->  counts + changed/unchanged
 *      optimized TAC /
 *
 * WHY "CHANGED" IS NOT JUST AN INSTRUCTION-COUNT CHECK
 *
 * Algebraic simplification can rewrite an instruction (`t2 = c * 1` becomes
 * `t2 = c`) without removing it, so the instruction COUNT can stay identical
 * even though the program genuinely changed. `changed` is therefore a
 * structural comparison of the instructions themselves, not merely a length
 * check -- exactly the distinction the main demo shows: it has the same
 * instruction count before and after, but `changed` is still `true`.
 *
 * WHY THIS IGNORES `sourceNodeId`
 *
 * Every instruction carries the AST node id it traces back to, for the UI's
 * own bookkeeping. Two instructions that compute the same thing should count
 * as "the same instruction" for comparison purposes even if that provenance
 * field happens to differ, so equality here is checked field by field over
 * the semantically meaningful parts of each instruction (`target`, operator,
 * operands) and `sourceNodeId` is deliberately never compared.
 *
 * IMMUTABILITY: this module only ever READS its two inputs. Nothing here
 * writes to any field of either `TACProgram`, so there is nothing to prove
 * about mutation beyond "a read-only function cannot mutate its arguments" --
 * which is verified anyway, alongside the optimizer's own guarantees, in the
 * test suite.
 */

import type { Operand, TACInstruction, TACProgram } from '../ir/tac.ts';

/** Structural equality between two operands, ignoring nothing -- every field matters here. */
function operandEqual(a: Operand, b: Operand): boolean {
  if (a.kind === 'constant' && b.kind === 'constant') return a.value === b.value && a.valueType === b.valueType;
  if (a.kind === 'variable' && b.kind === 'variable') return a.name === b.name && a.valueType === b.valueType;
  if (a.kind === 'temporary' && b.kind === 'temporary') return a.name === b.name && a.valueType === b.valueType;
  return false; // different kinds
}

/** Structural equality between two instructions, over their semantic fields only (never `sourceNodeId`). */
function instructionEqual(a: TACInstruction, b: TACInstruction): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'assign':
      return b.kind === 'assign' && a.target === b.target && a.targetType === b.targetType && operandEqual(a.value, b.value);
    case 'copy':
      return b.kind === 'copy' && a.target === b.target && a.targetType === b.targetType && operandEqual(a.source, b.source);
    case 'binary':
      return b.kind === 'binary' && a.target === b.target && a.targetType === b.targetType && a.operator === b.operator && operandEqual(a.left, b.left) && operandEqual(a.right, b.right);
    case 'unary':
      return b.kind === 'unary' && a.target === b.target && a.targetType === b.targetType && a.operator === b.operator && operandEqual(a.operand, b.operand);
    case 'print':
      return b.kind === 'print' && operandEqual(a.operand, b.operand);
    case 'label':
      return b.kind === 'label' && a.label === b.label;
    case 'jump':
      return b.kind === 'jump' && a.label === b.label;
    case 'jumpIfFalse':
      return b.kind === 'jumpIfFalse' && a.label === b.label && operandEqual(a.condition, b.condition);
    case 'return':
      return b.kind === 'return' && operandEqual(a.operand, b.operand);
    case 'call':
      return b.kind === 'call' && a.target === b.target && a.targetType === b.targetType && a.functionName === b.functionName && a.args.length === b.args.length && a.args.every((arg, i) => operandEqual(arg, b.args[i]!));
    case 'param':
      return b.kind === 'param' && a.name === b.name && a.target === b.target && a.targetType === b.targetType && a.valueType === b.valueType;
    case 'functionBegin':
      return b.kind === 'functionBegin' && a.functionName === b.functionName;
    case 'functionEnd':
      return b.kind === 'functionEnd' && a.functionName === b.functionName;
  }
}

/** True if two TAC instruction lists are instruction-for-instruction identical, in order. */
function instructionListEqual(a: readonly TACInstruction[], b: readonly TACInstruction[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!instructionEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

/** True if two complete TAC programs, including all function bodies, are structurally identical. */
function tacEqual(a: TACProgram, b: TACProgram): boolean {
  if (!instructionListEqual(a.instructions, b.instructions)) return false;
  const af = a.functions ?? {};
  const bf = b.functions ?? {};
  const namesA = Object.keys(af).sort();
  const namesB = Object.keys(bf).sort();
  if (namesA.length !== namesB.length || namesA.some((name, i) => name !== namesB[i])) return false;
  return namesA.every((name) => instructionListEqual(af[name]!.instructions, bf[name]!.instructions));
}

function instructionCount(program: TACProgram): number {
  return program.instructions.length + Object.values(program.functions ?? {}).reduce((total, fn) => total + fn.instructions.length, 0);
}

/**
 * The result of comparing an original TAC program against its optimized
 * counterpart -- everything the UI needs to render a before/after summary,
 * computed once here rather than recomputed piecemeal in a component.
 */
export interface TACComparison {
  readonly originalInstructionCount: number;
  readonly optimizedInstructionCount: number;
  /**
   * `originalInstructionCount - optimizedInstructionCount`. Every pass in
   * this optimizer only ever rewrites or removes instructions, never adds
   * one, so this is always >= 0 in practice -- but it is computed as a plain
   * difference, not clamped, so a violation of that invariant would surface
   * as a negative number instead of being silently hidden.
   */
  readonly removedInstructionCount: number;
  /**
   * True if the optimized program differs from the original in ANY way --
   * including a same-count rewrite such as `c * 1` becoming `c`. False only
   * when every instruction is structurally identical, in the same order.
   */
  readonly changed: boolean;
  readonly originalTemporaryCount: number;
  readonly optimizedTemporaryCount: number;
}

/**
 * Compare an original TAC program against its optimized counterpart.
 *
 * Pure function: reads both arguments, mutates neither, and returns a new
 * plain object. Calling this twice on the same pair of programs returns two
 * separate but deeply-equal results.
 *
 * @example
 *   const tac = generateTAC(ast);
 *   const optimizedTac = optimize(tac);
 *   const comparison = compareTAC(tac, optimizedTac);
 *   comparison.changed                  // true
 *   comparison.removedInstructionCount  // 0 for the main program -- nothing
 *                                       // was removed, only rewritten
 */
export function compareTAC(original: TACProgram, optimized: TACProgram): TACComparison {
  const originalInstructionCount = instructionCount(original);
  const optimizedInstructionCount = instructionCount(optimized);

  return {
    originalInstructionCount,
    optimizedInstructionCount,
    removedInstructionCount: originalInstructionCount - optimizedInstructionCount,
    changed: !tacEqual(original, optimized),
    originalTemporaryCount: original.temporaryCount,
    optimizedTemporaryCount: optimized.temporaryCount,
  };
}
