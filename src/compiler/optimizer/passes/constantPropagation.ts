/**
 * CONSTANT PROPAGATION
 * ====================
 *
 * COMPILER CONCEPT: constant propagation is a forward dataflow pass that
 * tracks which variables and temporaries are currently known to hold a
 * fixed compile-time value, and substitutes that value wherever the name is
 * read.
 *
 *      a = 10          a is now known to be 10
 *      t1 = a + 5      substitute a  -->  t1 = 10 + 5
 *
 * THIS PASS DOES NOT EVALUATE ARITHMETIC. `t1 = 10 + 5` is exactly where
 * this pass stops -- it has replaced the READ of `a` with the value it
 * already knew, but `10 + 5` is still a `binary` instruction, unevaluated.
 * Turning it into `t1 = 15` is constant folding's job (`constantFolding.ts`),
 * which runs afterwards. Keeping these two responsibilities apart is what
 * makes each pass independently simple to explain: propagation only ever
 * asks "do I already know this name's value?"; it never asks "what does
 * this expression compute to?".
 *
 * THE ENVIRONMENT
 *
 * A forward scan carries `env: name -> known constant value` within a basic
 * block. Facts are reset at labels and unconditional jumps, and after calls;
 * a conditional branch keeps facts on its fallthrough path, while its target
 * label starts with an empty environment. This deliberately conservative
 * boundary handling avoids carrying a value from one branch or loop iteration
 * into another without requiring a global dataflow solver. It can miss an
 * optimization at a merge point, but it will not substitute a stale fact from
 * a different control-flow path.
 *
 *   - `x = <constant>`               -->  env[x] = that constant
 *   - `x = <name known in env>`      -->  env[x] = the known value (a copy
 *                                          of a known constant is itself a
 *                                          known constant)
 *   - `x = <name NOT known>`         -->  env[x] is REMOVED. Assigning `x` a
 *                                          value that is not a known
 *                                          constant means whatever `env`
 *                                          remembered about `x` before is
 *                                          now stale and must be forgotten.
 *
 * `binary` and `unary` instructions never update the environment. Their
 * target is always a freshly minted temporary (see tacGenerator.ts), and
 * propagation never infers a temporary's value from an operation -- only
 * folding computes values, and folding runs after propagation is already
 * finished. This is why, for `a = 10; t1 = a + 5; b = t1`, the final `b = t1`
 * line is untouched: nothing in this pass ever taught the environment that
 * `t1` is 15.
 *
 * WHY VARIABLES AND TEMPORARIES ARE KEYED SEPARATELY
 *
 * The environment key combines an operand's `kind` with its `name`, rather
 * than using the name alone. MiniC does not forbid a user from naming a
 * variable `t1`, and temporaries are also named `t1`, `t2`, ... -- keying by
 * name alone could confuse a real temporary with a same-named user variable.
 * Keying by (kind, name) makes that collision structurally impossible.
 *
 * IMMUTABILITY
 *
 * This pass never mutates its input. `substitute` returns the SAME operand
 * object when there is nothing to substitute (constants are always returned
 * as-is; an unresolved name is returned as-is), and a BRAND NEW operand
 * object when a substitution happens. An instruction is rebuilt with the
 * spread operator only when at least one of its operands actually changed;
 * otherwise the original instruction object is reused untouched. Either way,
 * nothing in `program.instructions` or its objects is ever written to -- the
 * caller's original TACProgram remains exactly as it was.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';
import type { MiniCType } from '../../types.ts';

/** Only variables and temporaries can be tracked; a constant has no name to key on. */
type TrackableKind = 'variable' | 'temporary';

/** Build the environment key that keeps variables and temporaries from colliding. */
function envKey(kind: TrackableKind, name: string, scope?: 'global' | 'local'): string {
  return kind === 'variable' ? `${kind}:${scope ?? 'unspecified'}:${name}` : `${kind}:${name}`;
}

/**
 * Replace `operand` with its known constant value, if any.
 *
 * A constant operand has nothing to substitute and is returned unchanged.
 * A variable or temporary is looked up by (kind, name); if the environment
 * does not currently know its value, it is returned unchanged too.
 */
function substitute(operand: Operand, env: ReadonlyMap<string, { value: number | boolean; valueType?: MiniCType }>): Operand {
  if (operand.kind === 'constant') return operand;
  const known = env.get(envKey(operand.kind, operand.name, operand.kind === 'variable' ? operand.scope : undefined));
  if (known === undefined) return operand;
  return { kind: 'constant', value: known.value, valueType: known.valueType };
}

/**
 * Record what is now known about `target` after it has been assigned
 * `resolved` (an operand that has already been through `substitute`).
 *
 * `assign` and `copy` targets are always plain declared-variable names in
 * this generator's output (temporaries are only ever the TARGET of a
 * `binary`/`unary` instruction, never of an `assign`/`copy`), so the target
 * is always tracked with kind `'variable'`.
 */
function updateTarget(
  env: Map<string, { value: number | boolean; valueType?: MiniCType }>,
  target: string,
  resolved: Operand,
  targetKind: 'variable' | 'temporary' = 'variable',
  targetScope?: 'global' | 'local',
): void {
  const key = envKey(targetKind, target, targetKind === 'variable' ? targetScope : undefined);
  if (resolved.kind === 'constant') {
    env.set(key, { value: resolved.value, valueType: resolved.valueType });
  } else {
    // The new value is not a known constant, so whatever this name used to
    // be known as is stale now and must not be handed out to a later read.
    env.delete(key);
  }
}

/**
 * Run constant propagation over a TAC program.
 *
 * Pure function: the input `program` is never modified. Returns a new
 * TACProgram; `result !== program` and `result.instructions !== program.instructions`.
 *
 * @example
 *   constantPropagation(tacOf('a = 10;\nt1 = a + 5;'))
 *   // a = 10
 *   // t1 = 10 + 5      <- substituted, NOT evaluated
 */
export function constantPropagation(program: TACProgram): TACProgram {
  const env = new Map<string, { value: number | boolean; valueType?: MiniCType }>();
  const instructions: TACInstruction[] = [];

  for (const instruction of program.instructions) {
    switch (instruction.kind) {
      case 'assign': {
        const substituted = substitute(instruction.value, env);
        const targetType = instruction.targetType ?? substituted.valueType;
        // Keep legacy hand-built/untyped TAC structurally unchanged. Real
        // compiler-generated TAC is always typed, so this compatibility path
        // does not weaken type-aware optimization for actual MiniC programs.
        const value = targetType === undefined || substituted.valueType === targetType
          ? substituted
          : { ...substituted, valueType: targetType };
        updateTarget(env, instruction.target, value, instruction.targetKind ?? 'variable', instruction.targetScope);
        instructions.push(value === instruction.value ? instruction : { ...instruction, value });
        break;
      }

      case 'copy': {
        const substituted = substitute(instruction.source, env);
        const targetType = instruction.targetType ?? substituted.valueType;
        const source = targetType === undefined || substituted.valueType === targetType
          ? substituted
          : { ...substituted, valueType: targetType };
        updateTarget(env, instruction.target, source, instruction.targetKind ?? 'variable', instruction.targetScope);
        instructions.push(
          source === instruction.source ? instruction : { ...instruction, source }
        );
        break;
      }

      case 'binary': {
        // Substitute each operand independently. Even if BOTH turn out to be
        // constants, this pass stops here -- see the module comment for why
        // evaluating them is folding's job, not propagation's.
        const left = substitute(instruction.left, env);
        const right = substitute(instruction.right, env);
        instructions.push(
          left === instruction.left && right === instruction.right
            ? instruction
            : { ...instruction, left, right }
        );
        break;
      }

      case 'unary': {
        const operand = substitute(instruction.operand, env);
        instructions.push(
          operand === instruction.operand ? instruction : { ...instruction, operand }
        );
        break;
      }

      case 'print': {
        const operand = substitute(instruction.operand, env);
        instructions.push(operand === instruction.operand ? instruction : { ...instruction, operand });
        break;
      }

      case 'return': {
        const operand = substitute(instruction.operand, env);
        instructions.push(operand === instruction.operand ? instruction : { ...instruction, operand });
        break;
      }

      case 'call': {
        const args = instruction.args.map(a => substitute(a, env));
        // A call may change values visible to the caller. Preserve substitutions
        // in its arguments, then discard facts that may no longer be valid.
        env.clear();
        instructions.push(args.every((a,i)=>a===instruction.args[i]) ? instruction : { ...instruction, args });
        break;
      }
      case 'param':
        // A function parameter establishes an incoming value, not a constant
        // inherited from any preceding hand-built TAC.
        env.clear();
        instructions.push(instruction);
        break;
      case 'functionBegin':
      case 'functionEnd':
      case 'label':
      case 'jump':
        // Do not carry facts across a control-flow edge. This keeps the pass
        // safe for branches and loop back-edges without needing a CFG solver
        // for constant propagation.
        env.clear();
        instructions.push(instruction);
        break;
      case 'jumpIfFalse': {
        // The condition can use facts from the current basic block, but the
        // next instruction may be on a different path after this branch.
        const condition = substitute(instruction.condition, env);
        instructions.push(condition === instruction.condition ? instruction : { ...instruction, condition });
        // Facts remain valid along the linear fallthrough path. Any alternate
        // entry through the branch target is reset by that target's label.
        break;
      }
    }
  }

  return { ...program, instructions, functions: program.functions };
}
