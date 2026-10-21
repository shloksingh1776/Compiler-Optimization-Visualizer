/**
 * DEAD CODE ELIMINATION (DCE)
 * ==========================
 *
 * Removes computations whose values are not needed, while preserving
 * observable operations and control flow. Straight-line TAC is handled by
 * the same backwards liveness principle used by the original pass. When
 * labels, branches, jumps, or returns are present, this implementation builds
 * a small basic-block control-flow graph and solves liveness to a fixpoint.
 * That lets DCE work on functions and control-flow programs without assuming
 * that textual instruction order is the only execution path.
 *
 * This remains deliberately local: it does not do interprocedural analysis,
 * value numbering, CFG restructuring, or unreachable-code deletion. Calls,
 * prints, returns, parameter bindings, and control-flow instructions are kept.
 * For the main program, the final write to a non-temporary variable is
 * preserved for compatibility with the visualizer's variable-state model.
 * In a function body, global writes are retained conservatively because the
 * pass does not perform interprocedural liveness. In the main program, calls
 * make global values implicit live-ins, including across basic-block edges:
 * an overwritten write is removable only when no read or call can observe it.
 * Function-local assignments may be removed when their values are not needed
 * by a return, print, call, or another live computation.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';

function operandsOf(instruction: TACInstruction): Operand[] {
  switch (instruction.kind) {
    case 'assign': return [instruction.value];
    case 'copy': return [instruction.source];
    case 'binary': return [instruction.left, instruction.right];
    case 'unary': return [instruction.operand];
    case 'print': return [instruction.operand];
    case 'return': return [instruction.operand];
    case 'jumpIfFalse': return [instruction.condition];
    case 'call': return instruction.args;
    case 'label':
    case 'jump':
    case 'param':
    case 'functionBegin':
    case 'functionEnd': return [];
  }
}

function usedNames(instruction: TACInstruction): string[] {
  return operandsOf(instruction)
    .filter((operand) => operand.kind !== 'constant')
    .map((operand) => operand.kind === 'temporary'
      ? `temporary:${operand.name}`
      : `variable:${operand.scope ?? 'unspecified'}:${operand.name}`);
}

function writtenName(instruction: TACInstruction, temporaryNames: ReadonlySet<string> = new Set()): string | undefined {
  switch (instruction.kind) {
    case 'assign':
    case 'copy': {
      const kind = instruction.targetKind ?? (temporaryNames.has(instruction.target) ? 'temporary' : 'variable');
      return kind === 'temporary'
        ? `temporary:${instruction.target}`
        : `variable:${instruction.targetScope ?? 'unspecified'}:${instruction.target}`;
    }
    case 'binary':
    case 'unary':
    case 'call': return `temporary:${instruction.target}`;
    case 'param': return `variable:local:${instruction.name}`;
    case 'print':
    case 'return':
    case 'label':
    case 'jump':
    case 'jumpIfFalse':
    case 'functionBegin':
    case 'functionEnd': return undefined;
  }
}

interface BasicBlock {
  readonly start: number;
  readonly end: number;
  successors: number[];
  use: Set<string>;
  def: Set<string>;
  liveIn: Set<string>;
  liveOut: Set<string>;
}

function isTerminator(instruction: TACInstruction): boolean {
  return instruction.kind === 'jump' || instruction.kind === 'jumpIfFalse' ||
    instruction.kind === 'return' || instruction.kind === 'functionEnd';
}

function buildBasicBlocks(
  instructions: readonly TACInstruction[],
  temporaryNames: ReadonlySet<string>,
  globalsMayBeReadAtCalls: ReadonlySet<string>,
): BasicBlock[] {
  if (instructions.length === 0) return [];

  const starts = new Set<number>([0]);
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i]!;
    if (instruction.kind === 'label') starts.add(i);
    if (isTerminator(instruction) && i + 1 < instructions.length) starts.add(i + 1);
  }

  const orderedStarts = [...starts].sort((a, b) => a - b);
  const blocks: BasicBlock[] = orderedStarts.map((start, index) => ({
    start,
    end: (orderedStarts[index + 1] ?? instructions.length) - 1,
    successors: [],
    use: new Set<string>(),
    def: new Set<string>(),
    liveIn: new Set<string>(),
    liveOut: new Set<string>(),
  }));
  const labelToBlock = new Map<string, number>();

  blocks.forEach((block, blockIndex) => {
    for (let i = block.start; i <= block.end; i++) {
      const instruction = instructions[i]!;
      if (instruction.kind === 'label') labelToBlock.set(instruction.label, blockIndex);
    }
  });

  blocks.forEach((block, blockIndex) => {
    const last = instructions[block.end]!;
    const fallthrough = blockIndex + 1 < blocks.length ? blockIndex + 1 : undefined;
    const addSuccessor = (successor: number | undefined) => {
      if (successor !== undefined && !block.successors.includes(successor)) {
        block.successors.push(successor);
      }
    };

    if (last.kind === 'jump') {
      const target = labelToBlock.get(last.label);
      // A missing label indicates malformed/hand-built TAC. Retaining a
      // fallthrough edge is safer than deleting code based on an unknown edge.
      addSuccessor(target ?? fallthrough);
    } else if (last.kind === 'jumpIfFalse') {
      const target = labelToBlock.get(last.label);
      addSuccessor(target ?? fallthrough);
      addSuccessor(fallthrough);
    } else if (last.kind === 'return' || last.kind === 'functionEnd') {
      // No normal successor after a return/function end.
    } else {
      addSuccessor(fallthrough);
    }
  });

  for (const block of blocks) {
    for (let i = block.start; i <= block.end; i++) {
      const instruction = instructions[i]!;
      for (const name of usedNames(instruction)) {
        if (!block.def.has(name)) block.use.add(name);
      }
      // A function call may read any global. Model those as implicit uses in
      // the block dataflow as well as during the backwards rewrite below, so
      // global liveness propagates correctly across branch/basic-block edges.
      // They are not modeled as definite definitions: a callee may leave a
      // particular global unchanged, so a live-out value may still depend on
      // the value that existed before the call.
      if (instruction.kind === 'call') {
        for (const name of globalsMayBeReadAtCalls) {
          if (!block.def.has(name)) block.use.add(name);
        }
      }
      const written = writtenName(instruction, temporaryNames);
      if (written !== undefined) block.def.add(written);
    }
  }

  return blocks;
}

function solveLiveness(blocks: BasicBlock[]): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = blocks.length - 1; index >= 0; index--) {
      const block = blocks[index]!;
      const nextOut = new Set<string>();
      for (const successorIndex of block.successors) {
        for (const name of blocks[successorIndex]!.liveIn) nextOut.add(name);
      }
      const nextIn = new Set(block.use);
      for (const name of nextOut) {
        if (!block.def.has(name)) nextIn.add(name);
      }
      if (!setEquals(nextOut, block.liveOut) || !setEquals(nextIn, block.liveIn)) {
        block.liveOut = nextOut;
        block.liveIn = nextIn;
        changed = true;
      }
    }
  }
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function dceInstructionSequence(
  instructions: readonly TACInstruction[],
  temporaryCount: number,
  preserveFinalVariableWrites: boolean,
  preserveGlobalWrites = false,
  globalsMayBeReadAtCalls: ReadonlySet<string> = new Set<string>(),
): TACInstruction[] {
  if (instructions.length === 0) return [];

  const temporaryNames = new Set<string>();
  for (let i = 1; i <= temporaryCount; i++) temporaryNames.add(`t${i}`);

  const lastWriteOfVariable = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i]!;
    const target = writtenName(instruction, temporaryNames);
    const isVariableTarget = instruction.kind === 'assign' || instruction.kind === 'copy'
      ? instruction.targetKind !== 'temporary' && (instruction.targetKind === 'variable' || !temporaryNames.has(instruction.target))
      : false;
    if (preserveFinalVariableWrites && target !== undefined && isVariableTarget && instruction.kind !== 'param') {
      lastWriteOfVariable.set(target, i);
    }
  }

  const blocks = buildBasicBlocks(instructions, temporaryNames, globalsMayBeReadAtCalls);
  solveLiveness(blocks);
  const keep = new Array<boolean>(instructions.length).fill(false);

  for (const block of blocks) {
    const live = new Set(block.liveOut);
    for (let i = block.end; i >= block.start; i--) {
      const instruction = instructions[i]!;

      if (instruction.kind === 'param') {
        keep[i] = true;
        live.delete(`variable:local:${instruction.name}`);
        continue;
      }

      if (instruction.kind === 'print') {
        keep[i] = true;
        for (const name of usedNames(instruction)) live.add(name);
        continue;
      }

      if (instruction.kind === 'call') {
        // A call may have observable effects even if its return value is dead.
        // Kill its result's old value, then keep its arguments live. A called
        // function may read or modify any global, so those values must also be
        // live before the call. This allows us to remove overwritten global
        // writes when no call can observe them, without deleting the last
        // global value written before a call.
        keep[i] = true;
        live.delete(`temporary:${instruction.target}`);
        for (const name of usedNames(instruction)) live.add(name);
        for (const name of globalsMayBeReadAtCalls) live.add(name);
        continue;
      }

      if (instruction.kind === 'return' || instruction.kind === 'jumpIfFalse') {
        keep[i] = true;
        for (const name of usedNames(instruction)) live.add(name);
        continue;
      }

      if (instruction.kind === 'label' || instruction.kind === 'jump' ||
          instruction.kind === 'functionBegin' || instruction.kind === 'functionEnd') {
        keep[i] = true;
        continue;
      }

      const target = writtenName(instruction, temporaryNames);
      if (target === undefined) {
        // Defensive fallback: an unrecognized/non-writing TAC operation is
        // retained rather than silently discarded.
        keep[i] = true;
        for (const name of usedNames(instruction)) live.add(name);
        continue;
      }

      const isGlobalWrite = preserveGlobalWrites &&
        (instruction.kind === 'assign' || instruction.kind === 'copy') &&
        instruction.targetKind !== 'temporary' && instruction.targetScope === 'global';
      const isFinalVariableWrite = preserveFinalVariableWrites && lastWriteOfVariable.get(target) === i;
      if (live.has(target) || isFinalVariableWrite || isGlobalWrite) {
        keep[i] = true;
        live.delete(target);
        for (const name of usedNames(instruction)) live.add(name);
      }
      // If an instruction is dead, its operands are not made live by it.
    }
  }

  return instructions.filter((_, index) => keep[index]);
}

/** Run DCE on main TAC and independently on every function body. */
export function deadCodeElimination(program: TACProgram): TACProgram {
  // Prefer the declaration metadata, but also derive globals from scoped TAC
  // operands/targets. TACProgram.globalVariables is optional for backwards
  // compatibility with hand-built TAC fixtures.
  const globalNamesByName = new Set(program.globalVariables ?? []);
  const collectGlobals = (instructions: readonly TACInstruction[]) => {
    for (const instruction of instructions) {
      for (const operand of operandsOf(instruction)) {
        if (operand.kind === 'variable' && operand.scope === 'global') {
          globalNamesByName.add(operand.name);
        }
      }
      if ((instruction.kind === 'assign' || instruction.kind === 'copy') &&
          instruction.targetScope === 'global') {
        globalNamesByName.add(instruction.target);
      }
    }
  };
  collectGlobals(program.instructions);
  for (const fn of Object.values(program.functions ?? {})) collectGlobals(fn.instructions);

  const globalNames = new Set(
    [...globalNamesByName].map((name) => `variable:global:${name}`),
  );
  const functions = Object.fromEntries(
    Object.entries(program.functions ?? {}).map(([name, fn]) => [name, {
      ...fn,
      instructions: dceInstructionSequence(fn.instructions, program.temporaryCount, false, true, globalNames),
    }]),
  );

  return {
    ...program,
    // Preserve a main-program variable's final write for the visualizer's
    // variable-state model. Earlier overwritten writes can still be removed,
    // except when a function call may observe the value between writes. At
    // each call, globals become live conservatively because this pass does not
    // perform interprocedural read/write analysis.
    instructions: dceInstructionSequence(
      program.instructions,
      program.temporaryCount,
      true,
      false,
      globalNames,
    ),
    functions,
  };
}
