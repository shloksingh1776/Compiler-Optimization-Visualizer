/**
 * COPY PROPAGATION
 * =================
 *
 * Copy propagation tracks TAC `copy` assignments such as `x = y` (where `x = y` is represented
 * by the dedicated `copy` instruction) and replaces later reads of x with the current source value when that relationship is
 * still valid.
 *
 * Example:
 *   x = y
 *   z = x + 1   ->   z = y + 1
 *
 * The pass is deliberately conservative:
 * - only dedicated TAC `copy` instructions are tracked;
 * - writes invalidate dependent copy relationships;
 * - calls, labels and jumps clear the copy environment;
 * - function bodies are handled independently by the optimizer caller;
 * - print and return operands are rewritten, but the observable instruction
 *   itself is never removed here.
 *
 * The pass rewrites uses rather than aggressively deleting copy instructions.
 * Dead Code Elimination remains responsible for removing copies that become
 * unnecessary after propagation.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';

type Trackable = Extract<Operand, { kind: 'variable' | 'temporary' }>;

type CopyEnvironment = Map<string, Trackable>;

function key(operand: Trackable): string {
  return `${operand.kind}:${operand.name}`;
}

function resolve(operand: Operand, env: CopyEnvironment): Operand {
  if (operand.kind === 'constant') return operand;

  let current: Trackable = operand;
  const seen = new Set<string>();

  while (true) {
    const currentKey = key(current);
    if (seen.has(currentKey)) return current;
    seen.add(currentKey);

    const next = env.get(currentKey);
    if (!next) return current;
    current = next;
  }
}

function operandDependsOn(operand: Trackable, nameKey: string, env: CopyEnvironment): boolean {
  let current: Trackable = operand;
  const seen = new Set<string>();

  while (true) {
    const currentKey = key(current);
    if (currentKey === nameKey) return true;
    if (seen.has(currentKey)) return false;
    seen.add(currentKey);

    const next = env.get(currentKey);
    if (!next) return false;
    current = next;
  }
}

/** Invalidate every tracked copy whose current source depends on `written`. */
function invalidateWrittenName(env: CopyEnvironment, written: Trackable): void {
  const writtenKey = key(written);
  env.delete(writtenKey);

  for (const [targetKey, source] of env.entries()) {
    if (operandDependsOn(source, writtenKey, env)) env.delete(targetKey);
  }
}

function trackCopy(env: CopyEnvironment, target: Trackable, source: Operand): void {
  invalidateWrittenName(env, target);
  if (source.kind === 'variable' || source.kind === 'temporary') {
    // A source-level assignment such as `b = t1` is represented as a TAC
    // copy from a temporary to a named variable. Do not turn that assignment
    // into an alias: earlier-stage regression tests intentionally preserve
    // that boundary. Temporary-to-temporary copies (including CSE-produced
    // copies) and variable-to-variable copies remain eligible.
    if (source.kind === 'temporary' && target.kind === 'variable') return;
    const resolved = source;
    if (key(resolved) !== key(target)) env.set(key(target), resolved);
  }
}

function rewriteInstruction(instruction: TACInstruction, env: CopyEnvironment, temporaryNames: ReadonlySet<string>): TACInstruction {
  switch (instruction.kind) {
    case 'assign': {
      // `assign` represents a direct source-level assignment such as
      // `b = a` or `a = 10`. Keep it opaque here for compatibility with the
      // earlier optimizer passes: Stage 10 propagates the dedicated TAC
      // `copy` instruction, which is the compiler's explicit representation
      // of a computed-result transfer (`b = t1`). This prevents Copy
      // Propagation from changing the established output of earlier
      // constant/algebraic optimization tests while still eliminating
      // genuine TAC copy chains and CSE-produced copies.
      invalidateWrittenName(env, {
        kind: temporaryNames.has(instruction.target) ? 'temporary' : 'variable',
        name: instruction.target,
        valueType: instruction.targetType,
      });
      return instruction;
    }

    case 'copy': {
      const source = resolve(instruction.source, env);
      const target: Trackable = { kind: temporaryNames.has(instruction.target) ? 'temporary' : 'variable', name: instruction.target, valueType: instruction.targetType };
      trackCopy(env, target, source);
      return source === instruction.source ? instruction : { ...instruction, source };
    }

    case 'binary': {
      const left = resolve(instruction.left, env);
      const right = resolve(instruction.right, env);
      invalidateWrittenName(env, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType });
      return left === instruction.left && right === instruction.right
        ? instruction
        : { ...instruction, left, right };
    }

    case 'unary': {
      const operand = resolve(instruction.operand, env);
      invalidateWrittenName(env, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType });
      return operand === instruction.operand ? instruction : { ...instruction, operand };
    }

    case 'call': {
      const args = instruction.args.map((arg) => resolve(arg, env));
      invalidateWrittenName(env, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType });
      env.clear();
      return args.every((arg, i) => arg === instruction.args[i]) ? instruction : { ...instruction, args };
    }

    case 'param':
      env.clear();
      return instruction;

    case 'print': {
      const operand = resolve(instruction.operand, env);
      return operand === instruction.operand ? instruction : { ...instruction, operand };
    }

    case 'return': {
      const operand = resolve(instruction.operand, env);
      return operand === instruction.operand ? instruction : { ...instruction, operand };
    }

    case 'jumpIfFalse': {
      const condition = resolve(instruction.condition, env);
      env.clear();
      return condition === instruction.condition ? instruction : { ...instruction, condition };
    }

    case 'label':
    case 'jump':
    case 'functionBegin':
    case 'functionEnd':
      env.clear();
      return instruction;
  }
}

/** Run copy propagation over one TAC instruction sequence. */
export function copyPropagationInstructions(instructions: readonly TACInstruction[]): TACInstruction[] {
  const temporaryNames = new Set<string>();
  for (const instruction of instructions) {
    if (instruction.kind === 'binary' || instruction.kind === 'unary' || instruction.kind === 'call') {
      temporaryNames.add(instruction.target);
    }
    const operands: Operand[] = instruction.kind === 'assign' ? [instruction.value]
      : instruction.kind === 'copy' ? [instruction.source]
      : instruction.kind === 'binary' ? [instruction.left, instruction.right]
      : instruction.kind === 'unary' ? [instruction.operand]
      : instruction.kind === 'call' ? instruction.args
      : instruction.kind === 'print' ? [instruction.operand]
      : instruction.kind === 'return' ? [instruction.operand]
      : instruction.kind === 'jumpIfFalse' ? [instruction.condition]
      : [];
    for (const operand of operands) {
      if (operand.kind === 'temporary') temporaryNames.add(operand.name);
    }
  }

  const env: CopyEnvironment = new Map();
  return instructions.map((instruction) => rewriteInstruction(instruction, env, temporaryNames));
}

/** Run copy propagation over the main TAC instruction list. */
export function copyPropagation(program: TACProgram): TACProgram {
  return {
    ...program,
    instructions: copyPropagationInstructions(program.instructions),
  };
}
