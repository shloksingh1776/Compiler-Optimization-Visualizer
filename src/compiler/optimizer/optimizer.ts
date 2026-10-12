/**
 * OPTIMIZER  (Phases 6-7 of the compiler)
 * ========================================
 *
 * COMPILER CONCEPT: an optimizer is a sequence of passes over the same
 * intermediate representation, each rewriting it into an equivalent but
 * "better" program. This module fixes that sequence for the four techniques
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
 * display purposes only -- it has no effect on `optimize()` itself, which
 * still runs the six pass functions directly, in the fixed order below.
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
    description: "Replaces a TAC copy's target with its current source value when that relationship is still valid.",
  },
  {
    name: 'Dead Code Elimination',
    description:
      'Removes computations or overwritten assignments whose results are no longer needed.',
  },
];


function materializePrintedConstants(program: TACProgram): TACProgram {
  const constantEnv = new Map<string, { value: number | boolean; valueType?: import('../types.ts').MiniCType }>();
  const result: TACInstruction[] = [];
  const temporaryNames = new Set(Array.from({ length: program.temporaryCount }, (_, i) => `t${i + 1}`));

  const keyForTarget = (target: string) => `${temporaryNames.has(target) ? 'temporary' : 'variable'}:${target}`;

  for (const instruction of program.instructions) {
    switch (instruction.kind) {
      case 'assign': {
        const value = instruction.value.kind === 'constant'
          ? instruction.value
          : constantEnv.get(`${instruction.value.kind}:${instruction.value.name}`);
        if (value && typeof value !== 'undefined') {
          const constant = { kind: 'constant' as const, value: value.value, valueType: value.valueType };
          constantEnv.set(keyForTarget(instruction.target), { value: constant.value, valueType: constant.valueType });
          result.push({ ...instruction, value: constant });
        } else {
          constantEnv.delete(keyForTarget(instruction.target));
          result.push(instruction);
        }
        break;
      }
      case 'copy': {
        const value = instruction.source.kind === 'constant'
          ? instruction.source
          : constantEnv.get(`${instruction.source.kind}:${instruction.source.name}`);
        if (value && typeof value !== 'undefined') {
          const constant = { kind: 'constant' as const, value: value.value, valueType: value.valueType };
          constantEnv.set(keyForTarget(instruction.target), { value: constant.value, valueType: constant.valueType });
          result.push({ kind: 'assign', target: instruction.target, targetType: instruction.targetType, value: constant, sourceNodeId: instruction.sourceNodeId });
        } else {
          constantEnv.delete(keyForTarget(instruction.target));
          result.push(instruction);
        }
        break;
      }
      case 'return': {
        const value = instruction.operand.kind === 'constant'
          ? instruction.operand
          : constantEnv.get(`${instruction.operand.kind}:${instruction.operand.name}`);
        if (value && typeof value !== 'undefined') {
          result.push({ ...instruction, operand: { kind: 'constant', value: value.value, valueType: value.valueType } });
        } else {
          result.push(instruction);
        }
        break;
      }
      case 'print': {
        const value = instruction.operand.kind === 'constant'
          ? instruction.operand
          : constantEnv.get(`${instruction.operand.kind}:${instruction.operand.name}`);
        if (value && typeof value !== 'undefined') {
          result.push({ ...instruction, operand: { kind: 'constant', value: value.value, valueType: value.valueType } });
        } else {
          result.push(instruction);
        }
        break;
      }
      case 'label':
      case 'jump':
      case 'jumpIfFalse':
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

  // Remove temporary assignments that became dead once print operands were
  // materialized as constants. A temporary is safe to remove here only when
  // no remaining instruction reads it. User-variable assignments remain.
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
        : instruction.kind === 'print' ? [instruction.operand]
        : instruction.kind === 'jumpIfFalse' ? [instruction.condition]
        : instruction.kind === 'call' ? instruction.args
        : [];
      for (const operand of reads) {
        if (operand.kind !== 'constant') used.add(`${operand.kind}:${operand.name}`);
      }
    }
    const next = filtered.filter((instruction) => {
      if ((instruction.kind === 'assign' || instruction.kind === 'copy') && temporaryNames.has(instruction.target)) {
        return used.has(`temporary:${instruction.target}`);
      }
      return true;
    });
    changed = next.length !== filtered.length;
    filtered = next;
  }

  return { instructions: filtered, temporaryCount: program.temporaryCount, functions: program.functions };
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
 * Run the existing optimization pipeline and capture the TAC after every
 * pass. The optimization algorithms and their ordering are intentionally the
 * same as `optimize()` has always used; this function only records snapshots
 * for the visualizer.
 */
export function optimizeWithTrace(program: TACProgram): OptimizationResult {
  const hasMainControlFlow = program.instructions.some((instruction) =>
    instruction.kind === 'label' ||
    instruction.kind === 'jump' ||
    instruction.kind === 'jumpIfFalse' ||
    instruction.kind === 'call'
  );

  const trace: OptimizationTraceStep[] = [
    createOptimizationTraceStep('original', 'Original TAC', 'TAC generated before optimization begins.', program, false),
  ];

  const optimizeFunctionBodiesAtCSE = (input: TACProgram): TACProgram => ({
    ...input,
    functions: Object.fromEntries(
      Object.entries(input.functions ?? {}).map(([name, fn]) => {
        const afterCSE = commonSubexpressionEliminationInstructions(fn.instructions);
        return [name, { ...fn, instructions: afterCSE }];
      })
    ),
  });

  const optimizeFunctionBodiesAtCopy = (input: TACProgram): TACProgram => ({
    ...input,
    functions: Object.fromEntries(
      Object.entries(input.functions ?? {}).map(([name, fn]) => ({
        name,
        fn: { ...fn, instructions: copyPropagationInstructions(fn.instructions) },
      })).map(({ name, fn }) => [name, fn])
    ),
  });

  if (hasMainControlFlow) {
    const unchanged = (name: string, description: string, current: TACProgram, note: string) => {
      const pass = OPTIMIZATION_PASSES.find((item) => item.name === name);
      trace.push(createOptimizationTraceStep(name, pass?.name ?? name, description, current, false, note));
    };

    unchanged(
      OPTIMIZATION_PASSES[0]!.name,
      OPTIMIZATION_PASSES[0]!.description,
      program,
      'Skipped for the main program because the existing optimizer handles main-program control flow conservatively. Function bodies also remain unchanged until CSE and copy propagation.'
    );
    unchanged(
      OPTIMIZATION_PASSES[1]!.name,
      OPTIMIZATION_PASSES[1]!.description,
      program,
      'Skipped for the main program because the existing optimizer handles main-program control flow conservatively. Function bodies also remain unchanged until CSE and copy propagation.'
    );
    unchanged(
      OPTIMIZATION_PASSES[2]!.name,
      OPTIMIZATION_PASSES[2]!.description,
      program,
      'Skipped for the main program because the existing optimizer handles main-program control flow conservatively. Function bodies also remain unchanged until CSE and copy propagation.'
    );

    const afterCSE: TACProgram = {
      ...commonSubexpressionElimination(program),
      functions: optimizeFunctionBodiesAtCSE(program).functions,
    };
    trace.push(createOptimizationTraceStep(
      'cse',
      OPTIMIZATION_PASSES[3]!.name,
      OPTIMIZATION_PASSES[3]!.description,
      afterCSE,
    ));

    const afterCopyPropagation: TACProgram = {
      ...copyPropagation(afterCSE),
      functions: optimizeFunctionBodiesAtCopy(afterCSE).functions,
    };
    trace.push(createOptimizationTraceStep(
      'copy-propagation',
      OPTIMIZATION_PASSES[4]!.name,
      OPTIMIZATION_PASSES[4]!.description,
      afterCopyPropagation,
    ));

    trace.push(createOptimizationTraceStep(
      'dead-code-elimination',
      OPTIMIZATION_PASSES[5]!.name,
      OPTIMIZATION_PASSES[5]!.description,
      afterCopyPropagation,
      false,
      'Skipped for the main program because the existing optimizer keeps control-flow TAC conservative. The existing pipeline does not run DCE on function bodies.'
    ));
    trace.push(createOptimizationTraceStep(
      'final',
      'Final Optimized TAC',
      'The exact TAC returned by the compiler after the existing optimization work.',
      afterCopyPropagation,
    ));

    return {
      program: afterCopyPropagation,
      trace: { steps: trace },
    };
  }

  const afterPropagation: TACProgram = {
    ...constantPropagation(program),
    functions: program.functions,
  };
  trace.push(createOptimizationTraceStep('constant-propagation', OPTIMIZATION_PASSES[0]!.name, OPTIMIZATION_PASSES[0]!.description, afterPropagation, true, 'Applied to the main program only; function bodies remain unchanged in this pass.'));

  const afterFolding: TACProgram = {
    ...constantFolding(afterPropagation),
    functions: afterPropagation.functions,
  };
  trace.push(createOptimizationTraceStep('constant-folding', OPTIMIZATION_PASSES[1]!.name, OPTIMIZATION_PASSES[1]!.description, afterFolding, true, 'Applied to the main program only; function bodies remain unchanged in this pass.'));

  const afterSimplification: TACProgram = {
    ...algebraicSimplification(afterFolding),
    functions: afterFolding.functions,
  };
  trace.push(createOptimizationTraceStep('algebraic-simplification', OPTIMIZATION_PASSES[2]!.name, OPTIMIZATION_PASSES[2]!.description, afterSimplification, true, 'Applied to the main program only; function bodies remain unchanged in this pass.'));

  const afterCSE: TACProgram = {
    ...commonSubexpressionElimination(afterSimplification),
    functions: optimizeFunctionBodiesAtCSE(afterSimplification).functions,
  };
  trace.push(createOptimizationTraceStep('cse', OPTIMIZATION_PASSES[3]!.name, OPTIMIZATION_PASSES[3]!.description, afterCSE));

  const afterCopyPropagation: TACProgram = {
    ...copyPropagation(afterCSE),
    functions: optimizeFunctionBodiesAtCopy(afterCSE).functions,
  };
  trace.push(createOptimizationTraceStep('copy-propagation', OPTIMIZATION_PASSES[4]!.name, OPTIMIZATION_PASSES[4]!.description, afterCopyPropagation));

  const afterDeadCodeElimination = deadCodeElimination(afterCopyPropagation);
  const afterDCE: TACProgram = {
    ...afterDeadCodeElimination,
    functions: afterCopyPropagation.functions,
  };
  trace.push(createOptimizationTraceStep('dead-code-elimination', OPTIMIZATION_PASSES[5]!.name, OPTIMIZATION_PASSES[5]!.description, afterDCE, true, 'Applied to the main program only; the existing optimizer does not run DCE on function bodies.'));

  const materialized = afterDCE.instructions.some((instruction) => instruction.kind === 'print')
    ? materializePrintedConstants(afterDCE)
    : afterDCE;

  trace.push(createOptimizationTraceStep(
    'final',
    'Final Optimized TAC',
    'The exact TAC returned by the compiler after all existing optimization work and print-value materialization.',
    materialized,
  ));

  return { program: materialized, trace: { steps: trace } };
}

export function optimize(program: TACProgram): TACProgram {
  return optimizeWithTrace(program).program;
}

