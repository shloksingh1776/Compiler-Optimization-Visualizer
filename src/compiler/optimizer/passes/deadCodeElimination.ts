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
 * Function locals have no such externally visible final state, so unused
 * local assignments may be removed unless they feed a return/print/call.
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
    .map((operand) => operand.name);
}

function writtenName(instruction: TACInstruction): string | undefined {
  switch (instruction.kind) {
    case 'assign':
    case 'copy':
    case 'binary':
    case 'unary':
    case 'call': return instruction.target;
    case 'param': return instruction.name;
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

function buildBasicBlocks(instructions: readonly TACInstruction[]): BasicBlock[] {
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
      const written = writtenName(instruction);
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
): TACInstruction[] {
  if (instructions.length === 0) return [];

  const temporaryNames = new Set<string>();
  for (let i = 1; i <= temporaryCount; i++) temporaryNames.add(`t${i}`);

  const lastWriteOfVariable = new Map<string, number>();
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i]!;
    const target = writtenName(instruction);
    if (preserveFinalVariableWrites && target !== undefined && instruction.kind !== 'param' && !temporaryNames.has(target)) {
      lastWriteOfVariable.set(target, i);
    }
  }

  const blocks = buildBasicBlocks(instructions);
  solveLiveness(blocks);
  const keep = new Array<boolean>(instructions.length).fill(false);

  for (const block of blocks) {
    const live = new Set(block.liveOut);
    for (let i = block.end; i >= block.start; i--) {
      const instruction = instructions[i]!;

      if (instruction.kind === 'param') {
        keep[i] = true;
        live.delete(instruction.name);
        continue;
      }

      if (instruction.kind === 'print') {
        keep[i] = true;
        for (const name of usedNames(instruction)) live.add(name);
        continue;
      }

      if (instruction.kind === 'call') {
        // A call may have observable effects even if its return value is dead.
        // Kill its result's old value, then keep its arguments live.
        keep[i] = true;
        live.delete(instruction.target);
        for (const name of usedNames(instruction)) live.add(name);
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

      const target = writtenName(instruction);
      if (target === undefined) {
        // Defensive fallback: an unrecognized/non-writing TAC operation is
        // retained rather than silently discarded.
        keep[i] = true;
        for (const name of usedNames(instruction)) live.add(name);
        continue;
      }

      const isFinalVariableWrite = preserveFinalVariableWrites &&
        !temporaryNames.has(target) && lastWriteOfVariable.get(target) === i;
      if (live.has(target) || isFinalVariableWrite) {
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
  const functions = Object.fromEntries(
    Object.entries(program.functions ?? {}).map(([name, fn]) => [name, {
      ...fn,
      instructions: dceInstructionSequence(fn.instructions, program.temporaryCount, false),
    }]),
  );

  return {
    ...program,
    instructions: dceInstructionSequence(program.instructions, program.temporaryCount, true),
    functions,
  };
}
