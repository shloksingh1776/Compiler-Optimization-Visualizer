/**
 * COPY PROPAGATION
 * =================
 *
 * Copy propagation tracks safe TAC aliases created by dedicated `copy` instructions
 * and same-type variable-to-variable `assign` instructions. Later reads are
 * replaced by the current source value while the relationship remains valid.
 *
 * Example:
 *   x = y
 *   z = x + 1   ->   z = y + 1
 *
 * The pass is deliberately conservative:
 * - same-type variable-to-variable `assign` instructions and dedicated TAC `copy` instructions are tracked;
 * - writes invalidate dependent copy relationships;
 * - calls, labels and jumps clear the copy environment;
 * - function bodies are handled independently by the optimizer caller;
 * - type-changing assignments are not treated as aliases;
 * - print and return operands are rewritten, but the observable instruction
 *   itself is never removed here.
 *
 * The pass rewrites uses rather than aggressively deleting copy instructions.
 * Dead Code Elimination remains responsible for removing copies that become
 * unnecessary after propagation.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';
import type { MiniCType } from '../../types.ts';

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

/** Resolve an alias while preserving the type of the value at this use site. */
function resolveForUse(operand: Operand, env: CopyEnvironment): Operand {
  const resolved = resolve(operand, env);
  if (resolved.kind !== 'constant' && operand.valueType !== undefined && resolved.valueType !== operand.valueType) {
    // For example, `float z = alias` can carry a float-typed use of an int
    // variable because the TAC generator encodes assignment promotion in the
    // operand metadata. Renaming `alias` to its source must not lose that type.
    return { ...resolved, valueType: operand.valueType };
  }
  return resolved;
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

function rewriteInstruction(
  instruction: TACInstruction,
  env: CopyEnvironment,
  temporaryNames: ReadonlySet<string>,
  declaredTypes: ReadonlyMap<string, MiniCType>,
): TACInstruction {
  switch (instruction.kind) {
    case 'assign': {
      const target: Trackable = {
        kind: temporaryNames.has(instruction.target) ? 'temporary' : 'variable',
        name: instruction.target,
        valueType: instruction.targetType,
      };
      const value = resolveForUse(instruction.value, env);
      invalidateWrittenName(env, target);

      // A source-level assignment such as `b = a` is a real copy-propagation
      // opportunity too. Track only named-variable aliases with the same
      // declared type: the TAC generator annotates assignment operands with
      // the destination type, so checking value.valueType alone could erase
      // an int-to-float assignment conversion. Parameter/target declarations
      // collected before the scan provide the source variable's actual type.
      if (target.kind === 'variable' && value.kind === 'variable') {
        const targetType = instruction.targetType ?? declaredTypes.get(key(target));
        const sourceType = declaredTypes.get(key(value));
        if (targetType !== undefined && sourceType === targetType && key(target) !== key(value)) {
          env.set(key(target), value);
        }
      }

      return value === instruction.value ? instruction : { ...instruction, value };
    }

    case 'copy': {
      const source = resolveForUse(instruction.source, env);
      const target: Trackable = { kind: temporaryNames.has(instruction.target) ? 'temporary' : 'variable', name: instruction.target, valueType: instruction.targetType };
      trackCopy(env, target, source);
      return source === instruction.source ? instruction : { ...instruction, source };
    }

    case 'binary': {
      const left = resolveForUse(instruction.left, env);
      const right = resolveForUse(instruction.right, env);
      invalidateWrittenName(env, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType });
      return left === instruction.left && right === instruction.right
        ? instruction
        : { ...instruction, left, right };
    }

    case 'unary': {
      const operand = resolveForUse(instruction.operand, env);
      invalidateWrittenName(env, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType });
      return operand === instruction.operand ? instruction : { ...instruction, operand };
    }

    case 'call': {
      const args = instruction.args.map((arg) => resolveForUse(arg, env));
      invalidateWrittenName(env, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType === 'void' ? undefined : instruction.targetType });
      env.clear();
      return args.every((arg, i) => arg === instruction.args[i]) ? instruction : { ...instruction, args };
    }

    case 'param':
      env.clear();
      return instruction;

    case 'print': {
      const operand = resolveForUse(instruction.operand, env);
      return operand === instruction.operand ? instruction : { ...instruction, operand };
    }

    case 'return': {
      const operand = resolveForUse(instruction.operand, env);
      return operand === instruction.operand ? instruction : { ...instruction, operand };
    }

    case 'jumpIfFalse': {
      const condition = resolveForUse(instruction.condition, env);
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

  // Gather declared target/parameter types before rewriting anything. This
  // is needed because assignment generation normalizes an operand's type to
  // the destination type, which is not sufficient to detect type conversions.
  const declaredTypes = new Map<string, MiniCType>();
  const recordType = (operandKey: string, type: MiniCType | 'void' | undefined): void => {
    if (type === undefined || type === 'void') return;
    if (!declaredTypes.has(operandKey)) declaredTypes.set(operandKey, type);
  };

  for (const instruction of instructions) {
    if (instruction.kind === 'param') {
      recordType(key({ kind: 'variable', name: instruction.name }), instruction.valueType);
    } else if (instruction.kind === 'assign' || instruction.kind === 'copy' ||
      instruction.kind === 'binary' || instruction.kind === 'unary' || instruction.kind === 'call') {
      const kind = temporaryNames.has(instruction.target) ? 'temporary' : 'variable';
      recordType(key({ kind, name: instruction.target }), instruction.targetType);
    }
  }

  // If a variable's declared type is not available from this TAC body, we
  // intentionally avoid aliasing it. Operand annotations may already have
  // been normalized to an assignment target's type and are not authoritative.

  const env: CopyEnvironment = new Map();
  return instructions.map((instruction) => rewriteInstruction(instruction, env, temporaryNames, declaredTypes));
}

/** Run copy propagation over the main TAC instruction list. */
export function copyPropagation(program: TACProgram): TACProgram {
  return {
    ...program,
    instructions: copyPropagationInstructions(program.instructions),
  };
}
