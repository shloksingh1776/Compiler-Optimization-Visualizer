/**
 * COMMON SUBEXPRESSION ELIMINATION (CSE)
 * ======================================
 *
 * CSE reuses the result of an expression that has already been computed and
 * whose operands have not changed since that computation.
 *
 * Example:
 *   t1 = a + b
 *   x = t1
 *   t2 = a + b   ->   t2 = t1
 *
 * Stage 9 deliberately uses a conservative local algorithm:
 * - only binary expressions are candidates;
 * - expression identity is structural (operator + operand identity + type);
 * - operand order is significant (`a + b` is different from `b + a`);
 * - assignments invalidate cached expressions that read the assigned variable;
 * - calls invalidate the complete cache because a function may change values
 *   visible to the caller;
 * - labels and jumps form basic-block boundaries, so expressions are never
 *   reused across control-flow edges;
 * - function bodies are handled independently by the caller.
 *
 * No CFG, SSA, alias analysis, loop analysis, or interprocedural CSE is used.
 */

import type { Operand, TACInstruction, TACProgram } from '../../ir/tac.ts';

function operandKey(operand: Operand): string {
  switch (operand.kind) {
    case 'variable':
      return `v:${operand.scope ?? 'unspecified'}:${operand.name}:${operand.valueType ?? ''}`;
    case 'temporary':
      return `t:${operand.name}:${operand.valueType ?? ''}`;
    case 'constant':
      return `c:${typeof operand.value}:${String(operand.value)}:${operand.valueType ?? ''}`;
  }
}

function expressionKey(instruction: Extract<TACInstruction, { kind: 'binary' }>): string {
  return `${operandKey(instruction.left)}|${instruction.operator}|${operandKey(instruction.right)}|${instruction.targetType ?? ''}`;
}

function expressionUsesLocation(key: string, kind: 'variable' | 'temporary', name: string, scope?: 'global' | 'local'): boolean {
  const parts = key.split('|');
  const prefix = kind === 'temporary'
    ? `t:${name}:`
    : `v:${scope ?? 'unspecified'}:${name}:`;
  return parts.some((part) => part.startsWith(prefix));
}

function invalidateLocation(cache: Map<string, Operand>, kind: 'variable' | 'temporary', name: string, scope?: 'global' | 'local'): void {
  for (const key of cache.keys()) {
    if (expressionUsesLocation(key, kind, name, scope)) cache.delete(key);
  }
}

/**
 * Run local CSE over one TAC instruction sequence.
 *
 * The result is a new instruction array; the input instructions are never
 * mutated. A repeated expression becomes a `copy` from the earlier result.
 */
export function commonSubexpressionEliminationInstructions(
  instructions: readonly TACInstruction[],
): TACInstruction[] {
  const cache = new Map<string, Operand>();
  const result: TACInstruction[] = [];

  const clearCache = () => cache.clear();

  for (const instruction of instructions) {
    switch (instruction.kind) {
      case 'binary': {
        const key = expressionKey(instruction);
        const previous = cache.get(key);
        if (previous !== undefined) {
          result.push({
            kind: 'copy',
            target: instruction.target,
            targetKind: 'temporary',
            targetType: instruction.targetType,
            source: previous,
            sourceNodeId: instruction.sourceNodeId,
          });
        } else {
          result.push(instruction);
          cache.set(key, { kind: 'temporary', name: instruction.target, valueType: instruction.targetType });
        }
        break;
      }

      case 'assign':
        invalidateLocation(cache, instruction.targetKind === 'temporary' ? 'temporary' : 'variable', instruction.target, instruction.targetScope);
        result.push(instruction);
        break;

      case 'copy':
        invalidateLocation(cache, instruction.targetKind === 'temporary' ? 'temporary' : 'variable', instruction.target, instruction.targetScope);
        result.push(instruction);
        break;

      case 'call':
        // A call may change any externally visible variable, so no expression
        // computed before it is assumed available afterward.
        clearCache();
        result.push(instruction);
        break;

      case 'param':
        // Parameters are established at function entry. Clearing here is
        // harmless and makes the pass safe for hand-built function TAC.
        clearCache();
        result.push(instruction);
        break;

      case 'label':
      case 'jump':
      case 'jumpIfFalse':
        clearCache();
        result.push(instruction);
        break;

      case 'print':
      case 'return':
        // Observable uses do not modify the operands, so the cache remains
        // valid after them. They are still preserved exactly.
        result.push(instruction);
        break;

      case 'unary':
        // Unary computations do not modify a named variable, so existing
        // binary-expression facts remain valid.
        result.push(instruction);
        break;

      case 'functionBegin':
      case 'functionEnd':
        clearCache();
        result.push(instruction);
        break;
    }
  }

  return result;
}

/** Run CSE over the main TAC instruction list. */
export function commonSubexpressionElimination(program: TACProgram): TACProgram {
  return {
    ...program,
    instructions: commonSubexpressionEliminationInstructions(program.instructions),
  };
}
