/**
 * OPTIMIZER  (Phases 6-7 of the compiler)
 * ========================================
 *
 * COMPILER CONCEPT: an optimizer is a sequence of passes over the same
 * intermediate representation, each rewriting it into an equivalent but
 * "better" program. This module fixes that sequence for the six techniques
 * implemented so far:
 *
 *      TAC -> [ CONSTANT -> [ CONSTANT -> [ ALGEBRAIC -> [ CSE -> [ COPY -> [ DEAD CODE
 *              PROPAGATION ]  FOLDING ]   SIMPLIFICATION ]    ]    PROPAGATION ]    ELIMINATION ] -> Optimized TAC
 *
 * WHY THIS ORDER
 *
 *   1. Propagation substitutes known constant values into operands but never
 *      evaluates anything (`a + b` -> `10 + 20`).
 *   2. Folding evaluates any operation whose operands are now BOTH literal
 *      constants (`10 + 20` -> `30`) -- most of what it finds to evaluate is
 *      only fully-constant because propagation just ran.
 *   3. Algebraic simplification looks for identities holding for AT MOST one
 *      constant operand (`c * 1` -> `c`). It runs after folding specifically
 *      so that a fully-constant expression is folded to a number FIRST,
 *      rather than accidentally matching an identity meant for the
 *      genuinely-non-constant case.
 *   4. Dead code elimination runs LAST, because it can only tell a
 *      computation is unnecessary after the first three passes have finished
 *      rewriting what each instruction actually computes -- an instruction
 *      that still looked essential before simplification may no longer be.
 *
 * ONLY ONE PASS OF EACH, NO FIXPOINT
 *
 * STAGE 3 TYPE SAFETY
 *
 * All six passes preserve the typed TAC metadata introduced in Stage 2.
 * Constant propagation carries value types, constant folding evaluates using
 * the instruction's result type, algebraic simplification preserves the
 * target type when it replaces an operation, and DCE keeps surviving
 * instructions intact rather than reconstructing them without type metadata.
 *
 * A real optimizer often repeats its passes until nothing changes, because
 * passes can enable each other across multiple rounds. This optimizer
 * deliberately does not: each pass runs exactly once, in the fixed order
 * above, and DCE is never followed by a second round of propagation/folding/
 * simplification even though, in principle, removing dead code could
 * occasionally reveal a further opportunity. That is a real limitation, kept
 * this way so each technique stays individually easy to demonstrate and
 * matches exactly what its own file is documented to do.
 *
 * IMMUTABILITY
 *
 * None of the six passes mutates its input (see the comments in each pass
 * file for how). `optimize` simply threads one pass's return value into the
 * next, so the ORIGINAL TACProgram passed in is never touched:
 * `optimize(tac) !== tac`, and every object reachable from the original
 * `tac` remains exactly as it was, safe to display next to the optimized
 * result for comparison.
 */

import type { TACInstruction, TACProgram } from '../ir/tac.ts';
import { constantPropagation } from './passes/constantPropagation.ts';
import { constantFolding } from './passes/constantFolding.ts';
import { algebraicSimplification } from './passes/algebraicSimplification.ts';
import { commonSubexpressionElimination, commonSubexpressionEliminationInstructions } from './passes/commonSubexpressionElimination.ts';
import { copyPropagation, copyPropagationInstructions } from './passes/copyPropagation.ts';
import { deadCodeElimination } from './passes/deadCodeElimination.ts';
import type { OptimizationTrace, OptimizationTraceStep } from './trace.ts';
import { createOptimizationTraceStep } from './trace.ts';

/**
 * One entry in `OPTIMIZATION_PASSES`: a pass name plus a one-line,
 * user-facing description of what it does. This is descriptive metadata for
 * display purposes only; the implementation below defines the execution order
 * and records the actual intermediate result after each pass.
 */
export interface OptimizationPassInfo {
  readonly name: string;
  readonly description: string;
}

/**
 * The six passes, in the fixed order `optimize` runs them. Exported so the
 * UI can display "which passes ran, in what order, and what each one does"
 * without hardcoding that information a second time somewhere in a
 * component -- this array is the one place it is written down.
 */
export const OPTIMIZATION_PASSES: readonly OptimizationPassInfo[] = [
  {
    name: 'Constant Propagation',
    description: 'Replaces a variable with a known constant value when that value is available.',
  },
  {
    name: 'Constant Folding',
    description: 'Evaluates expressions whose operands are already known constants.',
  },
  {
    name: 'Algebraic Simplification',
    description: 'Applies safe identities such as x + 0 \u2192 x and x * 1 \u2192 x.',
  },
  {
    name: 'Common Subexpression Elimination',
    description: 'Reuses an earlier identical expression when its operands are still unchanged.',
  },
  {
    name: 'Copy Propagation',
    description: 'Propagates safe variable and TAC-copy aliases when their source values remain unchanged.',
  },
  {
    name: 'Dead Code Elimination',
    description:
      'Removes computations or overwritten assignments whose results are no longer needed.',
  },
];


function materializePrintedConstantsInInstructions(
  instructions: readonly TACInstruction[],
  temporaryCount: number,
): TACInstruction[] {
  const constantEnv = new Map<string, { value: number | boolean; valueType?: import('../types.ts').MiniCType }>();
  const result: TACInstruction[] = [];
  const temporaryNames = new Set(Array.from({ length: temporaryCount }, (_, i) => `t${i + 1}`));
  const keyForOperand = (operand: import('../ir/tac.ts').Operand): string => operand.kind === 'constant'
    ? `constant:${typeof operand.value}:${String(operand.value)}:${operand.valueType ?? ''}`
    : operand.kind === 'temporary'
      ? `temporary:${operand.name}`
      : `variable:${operand.scope ?? 'unspecified'}:${operand.name}`;
  const keyForTarget = (instruction: Extract<TACInstruction, { kind: 'assign' | 'copy' }>): string => {
    const kind = instruction.targetKind ?? (temporaryNames.has(instruction.target) ? 'temporary' : 'variable');
    return kind === 'temporary'
      ? `temporary:${instruction.target}`
      : `variable:${instruction.targetScope ?? 'unspecified'}:${instruction.target}`;
  };

  for (const instruction of instructions) {
    switch (instruction.kind) {
      case 'assign': {
        const value = instruction.value.kind === 'constant'
          ? instruction.value
          : constantEnv.get(keyForOperand(instruction.value));
        if (value && typeof value !== 'undefined') {
          const constant = { kind: 'constant' as const, value: value.value, valueType: value.valueType };
          constantEnv.set(keyForTarget(instruction), { value: constant.value, valueType: constant.valueType });
          result.push({ ...instruction, value: constant });
        } else {
          constantEnv.delete(keyForTarget(instruction));
          result.push(instruction);
        }
        break;
      }
      case 'copy': {
        const value = instruction.source.kind === 'constant'
          ? instruction.source
          : constantEnv.get(keyForOperand(instruction.source));
        if (value && typeof value !== 'undefined') {
          const constant = { kind: 'constant' as const, value: value.value, valueType: value.valueType };
          constantEnv.set(keyForTarget(instruction), { value: constant.value, valueType: constant.valueType });
          result.push({ kind: 'assign', target: instruction.target, targetKind: instruction.targetKind, targetScope: instruction.targetScope, targetType: instruction.targetType, value: constant, sourceNodeId: instruction.sourceNodeId });
        } else {
          constantEnv.delete(keyForTarget(instruction));
          result.push(instruction);
        }
        break;
      }
      case 'return': {
        const value = instruction.operand.kind === 'constant'
          ? instruction.operand
          : constantEnv.get(keyForOperand(instruction.operand));
        result.push(value && typeof value !== 'undefined'
          ? { ...instruction, operand: { kind: 'constant', value: value.value, valueType: value.valueType } }
          : instruction);
        constantEnv.clear();
        break;
      }
      case 'print': {
        const value = instruction.operand.kind === 'constant'
          ? instruction.operand
          : constantEnv.get(keyForOperand(instruction.operand));
        result.push(value && typeof value !== 'undefined'
          ? { ...instruction, operand: { kind: 'constant', value: value.value, valueType: value.valueType } }
          : instruction);
        break;
      }
      case 'label':
        // Never carry a linear-scan fact through a branch target or loop back-edge.
        constantEnv.clear();
        result.push(instruction);
        break;
      case 'jump':
        result.push(instruction);
        constantEnv.clear();
        break;
      case 'jumpIfFalse':
        result.push(instruction);
        // The current facts remain valid on the fallthrough path; the branch
        // target's label resets them before that alternate path is processed.
        break;
      case 'call':
        result.push(instruction);
        constantEnv.clear();
        break;
      case 'param':
      case 'functionBegin':
      case 'functionEnd':
        constantEnv.clear();
        result.push(instruction);
        break;
      case 'binary':
      case 'unary':
        // A non-constant operation invalidates any previous constant for its target.
        constantEnv.delete(`temporary:${instruction.target}`);
        result.push(instruction);
        break;
    }
  }

  // Remove temporary assignments made unnecessary by print/return materialization.
  // Include every operand-bearing instruction when checking remaining uses.
  let filtered = result.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const used = new Set<string>();
    for (const instruction of filtered) {
      const reads = instruction.kind === 'assign' ? [instruction.value]
        : instruction.kind === 'copy' ? [instruction.source]
        : instruction.kind === 'binary' ? [instruction.left, instruction.right]
        : instruction.kind === 'unary' ? [instruction.operand]
        : instruction.kind === 'print' || instruction.kind === 'return' ? [instruction.operand]
        : instruction.kind === 'jumpIfFalse' ? [instruction.condition]
        : instruction.kind === 'call' ? instruction.args
        : [];
      for (const operand of reads) {
        if (operand.kind !== 'constant') used.add(keyForOperand(operand));
      }
    }
    const next = filtered.filter((instruction) => {
      if ((instruction.kind === 'assign' || instruction.kind === 'copy') &&
          (instruction.targetKind === 'temporary' || (instruction.targetKind === undefined && temporaryNames.has(instruction.target)))) {
        return used.has(`temporary:${instruction.target}`);
      }
      return true;
    });
    changed = next.length !== filtered.length;
    filtered = next;
  }

  return filtered;
}

function materializePrintedConstants(program: TACProgram): TACProgram {
  const instructions = program.instructions.some((instruction) => instruction.kind === 'print')
    ? materializePrintedConstantsInInstructions(program.instructions, program.temporaryCount)
    : program.instructions;
  const functions = Object.fromEntries(
    Object.entries(program.functions ?? {}).map(([name, fn]) => [name, {
      ...fn,
      instructions: fn.instructions.some((instruction) => instruction.kind === 'print')
        ? materializePrintedConstantsInInstructions(fn.instructions, program.temporaryCount)
        : fn.instructions,
    }]),
  );
  return { ...program, instructions, functions };
}

/** Run a pass over main TAC and independently over each function body. */
function applyPassToEveryBody(
  program: TACProgram,
  pass: (input: TACProgram) => TACProgram,
): TACProgram {
  const mainResult = pass({ instructions: program.instructions, temporaryCount: program.temporaryCount });
  const functions = Object.fromEntries(
    Object.entries(program.functions ?? {}).map(([name, fn]) => {
      const result = pass({ instructions: fn.instructions, temporaryCount: program.temporaryCount });
      return [name, { ...fn, instructions: result.instructions }];
    }),
  );
  return { ...program, instructions: mainResult.instructions, functions };
}

/**
 * Run the optimization pipeline over a TAC program.
 *
 * Pure function: the input `program` is never modified, and calling this
 * twice on the same input returns two deeply-equal (though not reference
 * -equal) results.
 *
 * @example
 *   const tac = generateTAC(ast);
 *   const optimizedTac = optimize(tac);
 *   tac !== optimizedTac   // true: the original is untouched
 */
export interface OptimizationResult {
  readonly program: TACProgram;
  readonly trace: OptimizationTrace;
}

/**
 * Run the fixed six-pass optimization pipeline and capture the actual TAC
 * after every pass for both the main program and independent function bodies.
 */
export function optimizeWithTrace(program: TACProgram): OptimizationResult {
  const trace: OptimizationTraceStep[] = [
    createOptimizationTraceStep('original', 'Original TAC', 'TAC generated before optimization begins.', program, false),
  ];

  const afterPropagation = applyPassToEveryBody(program, constantPropagation);
  trace.push(createOptimizationTraceStep(
    'constant-propagation',
    OPTIMIZATION_PASSES[0]!.name,
    OPTIMIZATION_PASSES[0]!.description,
    afterPropagation,
    true,
    'Applied independently to the main program and every function. Constant facts are reset at labels, jumps, conditional branches, calls, and function boundaries so facts are not carried unsafely between control-flow paths.',
  ));

  const afterFolding = applyPassToEveryBody(afterPropagation, constantFolding);
  trace.push(createOptimizationTraceStep(
    'constant-folding',
    OPTIMIZATION_PASSES[1]!.name,
    OPTIMIZATION_PASSES[1]!.description,
    afterFolding,
    true,
    'Applied instruction-by-instruction to the main program and every function; only expressions with literal constant operands are folded.',
  ));

  const afterSimplification = applyPassToEveryBody(afterFolding, algebraicSimplification);
  trace.push(createOptimizationTraceStep(
    'algebraic-simplification',
    OPTIMIZATION_PASSES[2]!.name,
    OPTIMIZATION_PASSES[2]!.description,
    afterSimplification,
    true,
    'Applied to the main program and every function. Only the existing approved identities are used.',
  ));

  const afterCSE: TACProgram = {
    ...commonSubexpressionElimination(afterSimplification),
    functions: Object.fromEntries(
      Object.entries(afterSimplification.functions ?? {}).map(([name, fn]) => [name, {
        ...fn,
        instructions: commonSubexpressionEliminationInstructions(fn.instructions),
      }]),
    ),
  };
  trace.push(createOptimizationTraceStep(
    'cse',
    OPTIMIZATION_PASSES[3]!.name,
    OPTIMIZATION_PASSES[3]!.description,
    afterCSE,
    true,
    'Applied independently to the main program and every function. CSE clears its expression cache at control-flow boundaries and calls.',
  ));

  const afterCopyPropagation: TACProgram = {
    ...copyPropagation(afterCSE),
    functions: Object.fromEntries(
      Object.entries(afterCSE.functions ?? {}).map(([name, fn]) => [name, {
        ...fn,
        instructions: copyPropagationInstructions(fn.instructions),
      }]),
    ),
  };
  trace.push(createOptimizationTraceStep(
    'copy-propagation',
    OPTIMIZATION_PASSES[4]!.name,
    OPTIMIZATION_PASSES[4]!.description,
    afterCopyPropagation,
    true,
    'Applied independently to the main program and every function. Copy facts are cleared at calls and control-flow boundaries.',
  ));

  const afterDCE = deadCodeElimination(afterCopyPropagation);
  trace.push(createOptimizationTraceStep(
    'dead-code-elimination',
    OPTIMIZATION_PASSES[5]!.name,
    OPTIMIZATION_PASSES[5]!.description,
    afterDCE,
    true,
    'Applied to the main program and every function. Control-flow bodies use basic-block liveness across branch and jump successors; calls, prints, returns, parameters, and control-flow instructions are preserved.',
  ));

  const materialized = materializePrintedConstants(afterDCE);
  trace.push(createOptimizationTraceStep(
    'final',
    'Final Optimized TAC',
    'The exact TAC returned by the compiler after all six optimization passes and final print/return constant materialization.',
    materialized,
  ));

  return { program: materialized, trace: { steps: trace } };
}

export function optimize(program: TACProgram): TACProgram {
  return optimizeWithTrace(program).program;
}

