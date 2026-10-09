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
      return `v:${operand.name}:${operand.valueType ?? ''}`;
    case 'temporary':
      return `t:${operand.name}:${operand.valueType ?? ''}`;
    case 'constant':
      return `c:${typeof operand.value}:${String(operand.value)}:${operand.valueType ?? ''}`;
  }
}

function expressionKey(instruction: Extract<TACInstruction, { kind: 'binary' }>): string {
  return `${operandKey(instruction.left)}|${instruction.operator}|${operandKey(instruction.right)}|${instruction.targetType ?? ''}`;
}

function expressionUsesVariable(key: string, name: string): boolean {
  // Keys are intentionally constructed with a `v:<name>:` component. The
  // exact split avoids treating a temporary with the same spelling as a
  // user variable as the same value.
  const parts = key.split('|');
  return parts.some((part) => part.startsWith(`v:${name}:`));
}

function invalidateVariable(cache: Map<string, Operand>, name: string): void {
  for (const key of cache.keys()) {
    if (expressionUsesVariable(key, name)) cache.delete(key);
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
        invalidateVariable(cache, instruction.target);
        result.push(instruction);
        break;

      case 'copy':
        invalidateVariable(cache, instruction.target);
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
    instructions: commonSubexpressionEliminationInstructions(program.instructions),
    temporaryCount: program.temporaryCount,
    functions: program.functions,
  };
}
