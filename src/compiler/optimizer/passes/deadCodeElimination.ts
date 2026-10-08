/**
 * DEAD CODE ELIMINATION  (DCE)
 * =============================
 *
 * COMPILER CONCEPT: dead code elimination removes instructions whose result
 * is never needed. In a language with branches this requires a control flow
 * graph and an iterative liveness analysis across it, because a value's
 * "next use" can depend on which path execution takes. MiniC v1 has no `if`,
 * `while`, or any branch at all, so the TAC is a single straight-line list
 * with exactly one path through it -- a SINGLE backward pass over that list
 * computes exact liveness. No CFG, no basic blocks, no iteration to a
 * fixpoint: one pass is already exact, not an approximation.
 *
 * THE ALGORITHM
 *
 * Walk the instructions from last to first, maintaining `live`: the set of
 * names (variables and temporaries) some ALREADY-PROCESSED (i.e. later in
 * program order) instruction still needs.
 *
 *   For each instruction, looking at its target `x`:
 *     - if `x` is in `live`  (something after this instruction reads it), OR
 *     - if this is `x`'s FINAL write and `x` is a declared variable
 *           (see "final variables" below)
 *     then KEEP it: remove `x` from `live` (this instruction supplies it)
 *     and add every name THIS instruction reads to `live`.
 *
 *     Otherwise the instruction is dead: DROP it, and change nothing else.
 *     Its reads never happen once it is removed, so they must not be added
 *     to `live` -- this is exactly what lets a chain of now-unused
 *     temporaries disappear together (see "chains" below).
 *
 * WHY DECLARED VARIABLES NEED A SPECIAL RULE ("FINAL VARIABLES")
 *
 * MiniC has no `print` or `return` statement, so nothing in the TAC itself
 * ever reads a variable's LAST value -- by pure liveness the way temporaries
 * work, EVERY variable's final assignment would look dead. That would make
 * DCE erase the entire visible result of every program, which defeats the
 * purpose of a compiler visualizer. So this pass adopts one conservative
 * extra rule: a declared variable's FINAL write in the whole program is
 * always treated as observable, whether or not anything in the TAC reads it
 * afterward. An EARLIER write to the same variable is not protected this
 * way -- if it is overwritten before ever being read, it is genuinely dead
 * (see Example 3 below) and is removed exactly like any other dead
 * instruction.
 *
 * TELLING A TEMPORARY FROM A DECLARED VARIABLE, WITHOUT THE SYMBOL TABLE
 *
 * This pass is explicitly required to compute everything it needs from TAC
 * alone. Temporary names are not guessed from their spelling (a user is not
 * forbidden from naming a variable `t1`); instead they are derived
 * authoritatively from `TACProgram.temporaryCount`, which records exactly
 * how many `tN` names the generator minted: the true set of temporaries is
 * always precisely `{ t1, t2, ..., t<temporaryCount> }`. Every OTHER target
 * name appearing in the TAC is a declared variable, because
 * `tacGenerator.ts` never targets anything else with `assign`/`copy`, and
 * this pass never changes what any instruction targets.
 *
 * (`temporaryCount` and the literal name a user typed could still collide in
 * the one narrow case where a program declares a variable spelled exactly
 * like a temporary that is ALSO minted in that same program, e.g. a variable
 * literally named `t1` in a program whose first temporary is also `t1`. This
 * is a known limitation of using bare strings for instruction targets -- see
 * the final report -- and does not affect any ordinary program.)
 *
 * WORKED EXAMPLE: A CHAIN COLLAPSES TOGETHER
 *
 *      t1 = a + b
 *      t2 = t1 * 2
 *      t3 = t2 + 1      <- t3 is never used anywhere afterward
 *
 * Processing backward: t3 is not live and is not a declared variable's
 * final write, so it is DROPPED -- and because it is dropped, `t2` is never
 * added to `live` by it. That makes t2 dead too, so it is also dropped,
 * which in turn keeps `t1` from ever being marked live, and it is dropped as
 * well. All three vanish together, in one pass, with no repeated scanning.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';

/** Every operand an instruction reads (not the one it writes). */
function operandsOf(instruction: TACInstruction): Operand[] {
  switch (instruction.kind) {
    case 'assign':
      return [instruction.value];
    case 'copy':
      return [instruction.source];
    case 'binary':
      return [instruction.left, instruction.right];
    case 'unary':
      return [instruction.operand];
    case 'print':
      return [instruction.operand];
    case 'return':
      return [instruction.operand];
    case 'label':
    case 'jump':
      return [];
    case 'jumpIfFalse':
      return [instruction.condition];
    case 'call':
      return instruction.args;
    case 'param':
    case 'functionBegin':
    case 'functionEnd':
      return [];
  }
}

/** The variable/temporary NAMES an instruction reads. Constants are never "used" names. */
function usedNames(instruction: TACInstruction): string[] {
  const names: string[] = [];
  for (const operand of operandsOf(instruction)) {
    if (operand.kind !== 'constant') names.push(operand.name);
  }
  return names;
}

/**
 * Run dead code elimination over a TAC program.
 *
 * Pure function: the input `program` is never modified. Returns a new
 * TACProgram; `result !== program` and `result.instructions !== program.instructions`.
 *
 * @example
 *   deadCodeElimination(programWith('t1 = a + b;\nc = 10;'))   // t1 unused
 *   // c = 10
 */
export function deadCodeElimination(program: TACProgram): TACProgram {
  if (program.instructions.some((instruction) => instruction.kind === 'label' || instruction.kind === 'jump' || instruction.kind === 'jumpIfFalse' || instruction.kind === 'return' || instruction.kind === 'call')) {
    return { instructions: [...program.instructions], temporaryCount: program.temporaryCount };
  }
  const instructions = program.instructions;
  const count = instructions.length;

  // The authoritative set of compiler-minted temporary names -- see the
  // module comment for why this is derived from the counter rather than
  // guessed from spelling.
  const temporaryNames = new Set<string>();
  for (let i = 1; i <= program.temporaryCount; i++) {
    temporaryNames.add(`t${i}`);
  }

  // Forward pre-pass: for every DECLARED VARIABLE target (never a
  // temporary), remember the index of its LAST write in the program. That
  // write is the one instruction protected regardless of later TAC use.
  const lastWriteOfVariable = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const candidate = instructions[i];
    if (candidate && 'target' in candidate && typeof candidate.target === 'string') {
      const target = candidate.target;
      if (!temporaryNames.has(target)) lastWriteOfVariable.set(target, i);
    }
  }

  // Backward pass: standard dead-store / dead-computation elimination.
  const keep = new Array<boolean>(count).fill(false);
  const live = new Set<string>();

  for (let i = count - 1; i >= 0; i--) {
    const instruction = instructions[i]!;

    // print is an observable side effect, so it is always live. Its operand
    // becomes live too, which protects the assignments/computations needed
    // to produce the value being printed.
    if (instruction.kind === 'print') {
      keep[i] = true;
      for (const name of usedNames(instruction)) live.add(name);
      continue;
    }

    if (!('target' in instruction) || typeof instruction.target !== 'string') {
      keep[i] = true;
      for (const name of usedNames(instruction)) live.add(name);
      continue;
    }
    const target = instruction.target;

    const neededByLaterInstruction = live.has(target);
    const isVariablesFinalWrite =
      !temporaryNames.has(target) && lastWriteOfVariable.get(target) === i;

    if (neededByLaterInstruction || isVariablesFinalWrite) {
      keep[i] = true;
      // This instruction supplies the value; an EARLIER write to the same
      // name is now a separate question, not automatically satisfied by
      // this one.
      live.delete(target);
      for (const name of usedNames(instruction)) live.add(name);
    }
    // Dead: `live` is left untouched. This instruction's reads never happen
    // once it is removed, so they must not make anything ELSE look needed.
  }

  return {
    instructions: instructions.filter((_, i) => keep[i]),
    temporaryCount: program.temporaryCount,
  };
}
