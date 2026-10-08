/**
 * COMPILE-TIME DIVISION-BY-ZERO DETECTION
 * ========================================
 *
 * COMPILER CONCEPT: this is a small, focused check that answers one
 * question -- "is any division in this program guaranteed, at compile
 * time, to divide by zero?" -- by inspecting TAC `binary` instructions
 * whose operator is `/`.
 *
 *      TAC (after constant propagation)  -->  [ THIS CHECK ]  -->  errors
 *
 * WHY THIS RUNS ON TAC, AFTER CONSTANT PROPAGATION
 *
 * A divisor is "provably zero" in exactly two situations:
 *
 *   1. The source wrote a literal zero directly:      10 / 0
 *   2. Constant propagation resolved the divisor to a  int y = 0;
 *      known-zero value before this check ran:         10 / y
 *
 * Both situations look IDENTICAL once constant propagation has already run:
 * in either case the TAC instruction's right operand is `{ kind: 'constant',
 * value: 0 }`. That is exactly why this check is written against the
 * ALREADY-PROPAGATED TAC rather than the raw TAC straight out of the
 * generator or the AST -- it reuses the existing constant-propagation
 * infrastructure instead of re-implementing "is this variable a known
 * constant?" a second time.
 *
 * If the divisor is a variable, a temporary, or any operand that
 * propagation did NOT resolve to a constant, this check reports nothing --
 * an unknown divisor is not an error (see deliberately unhandled case
 * below).
 *
 * WHY THIS IS A SEPARATE CHECK, NOT PART OF constantFolding.ts
 *
 * `constantFolding.ts` already refuses to evaluate a division by a
 * constant zero -- `evaluateBinary` returns `undefined` for it, and folding
 * leaves the instruction untouched rather than producing Infinity or NaN.
 * That guarantee already existed and is kept exactly as-is (see the
 * "defence in depth" note below). But leaving the instruction silently
 * unfolded is not the same as reporting that the *program itself* is
 * invalid. This module adds the missing half: turning a proven division by
 * zero into a genuine `CompilerError`, using the same shared error
 * infrastructure every other phase already uses.
 *
 * WHAT THIS DOES **NOT** DO (by design, matching the optimizer's existing
 * "one pass, no fixpoint" limitation documented in optimizer.ts)
 *
 * Constant propagation never learns the value of a TEMPORARY (only
 * `assign`/`copy` targets update its environment -- see
 * constantPropagation.ts). So something like `int x = 10 / (5 - 5);`
 * is NOT caught here: propagation does not know the nested `5 - 5`
 * temporary is zero, because it never evaluates operations, only
 * substitutes already-known values. That is an accepted limitation of
 * reusing the existing single-pass propagation infrastructure rather than
 * building a new, separate constant-evaluation analysis for this one
 * check -- and `constantFolding.ts`'s existing division-by-zero guard
 * still protects that case from ever becoming Infinity/NaN, it just is not
 * reported as a compile error the way `10 / 0` and `10 / y` (with `y`
 * known to be 0) are.
 *
 * DEFENCE IN DEPTH
 *
 * Even though this check runs before folding and is expected to catch
 * every division whose divisor propagation resolved to a literal zero,
 * `evaluateBinary`'s own zero-guard is NOT removed. If some division by a
 * constant zero ever reached folding regardless (for instance the nested
 * `(5 - 5)` case above, which this check cannot see), folding still leaves
 * it unevaluated rather than computing Infinity or NaN. This check adds a
 * compile-time diagnostic; it does not replace that existing guard.
 *
 * SOURCE POSITION: every TAC instruction carries the id of the AST node it
 * was generated from (`sourceNodeId`). For a `binary` instruction this is
 * always the `BinaryExpr` node itself (see tacGenerator.ts), so walking the
 * AST to find that id gives the exact span of the division expression the
 * error is about -- the same span the AST view already highlights for that
 * node.
 */

import type { Expr, Program, Stmt } from '../parser/ast.ts';
import type { TACProgram } from '../ir/tac.ts';
import { makeError, type CompilerError, type SourceSpan } from '../errors.ts';

/** Search one expression subtree for the node with this id. */
function findSpanInExpr(node: Expr, id: string): SourceSpan | undefined {
  if (node.id === id) return node;
  switch (node.type) {
    case 'BinaryExpr':
      return findSpanInExpr(node.left, id) ?? findSpanInExpr(node.right, id);
    case 'UnaryExpr':
      return findSpanInExpr(node.operand, id);
    case 'CallExpr':
      for (const arg of node.arguments) { const found = findSpanInExpr(arg, id); if (found) return found; }
      return undefined;
    case 'ConditionalExpr':
      return findSpanInExpr(node.condition, id)
        ?? findSpanInExpr(node.thenExpression, id)
        ?? findSpanInExpr(node.elseExpression, id);
    case 'NumberLiteral':
    case 'BooleanLiteral':
    case 'Identifier':
      return undefined;
  }
}

/** Search one statement (and the expression it contains) for the node with this id. */
function findSpanInStmt(stmt: Stmt, id: string): SourceSpan | undefined {
  if (stmt.id === id) return stmt;
  switch (stmt.type) {
    case 'VarDecl':
      return stmt.init === null ? undefined : findSpanInExpr(stmt.init, id);
    case 'Assignment':
      return findSpanInExpr(stmt.value, id);
    case 'PrintStmt':
      return findSpanInExpr(stmt.expression, id);
    case 'ReturnStmt':
      return findSpanInExpr(stmt.expression, id);
    case 'FunctionDecl':
      return stmt.body.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
    case 'WhileStmt':
      return findSpanInExpr(stmt.condition, id)
        ?? stmt.body.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
    case 'IfStmt': {
      if (stmt.condition.id === id) return stmt.condition;
      return findSpanInExpr(stmt.condition, id)
        ?? stmt.thenBranch.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined)
        ?? stmt.elseBranch?.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
    }
  }
}

/**
 * Find the source span of the AST node with the given id.
 *
 * Falls back to the whole program's span if the id is not found. This
 * should not happen in practice -- every `binary` TAC instruction's
 * `sourceNodeId` is a real `BinaryExpr` node id minted by the same parse
 * that built `program` -- but a check that reports errors must never throw,
 * so this stays defensive rather than asserting.
 */
function findSpan(program: Program, id: string): SourceSpan {
  for (const stmt of program.body) {
    const found = findSpanInStmt(stmt, id);
    if (found !== undefined) return found;
  }
  return program;
}

/**
 * Find every division whose divisor is provably zero at compile time.
 *
 * Pure function: reads both arguments, mutates neither.
 *
 * @param tac      TAC that has already been through `constantPropagation`,
 *                 so a divisor known only indirectly (via a variable
 *                 assigned a literal) has already been resolved to a
 *                 `constant` operand if propagation could prove it.
 * @param program  The AST `tac` was generated from, used only to recover
 *                 accurate source positions for the reported errors.
 *
 * @example
 *   checkDivisionByZero(constantPropagation(generateTAC(astOf('int x = 10 / 0;'))), ast)
 *   // [{ stage: 'optimizer', message: 'Division by zero: ...', ... }]
 */
export function checkDivisionByZero(tac: TACProgram, program: Program): CompilerError[] {
  const errors: CompilerError[] = [];

  const allInstructions = [...tac.instructions, ...Object.values(tac.functions ?? {}).flatMap(fn => fn.instructions)];
  for (const instruction of allInstructions) {
    if (
      instruction.kind === 'binary' &&
      instruction.operator === '/' &&
      instruction.right.kind === 'constant' &&
      instruction.right.value === 0
    ) {
      errors.push(
        makeError(
          'optimizer',
          'Division by zero: the divisor is a compile-time constant 0',
          findSpan(program, instruction.sourceNodeId)
        )
      );
    }
  }

  return errors;
}
