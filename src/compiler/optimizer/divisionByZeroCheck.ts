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
 * WHY THIS RUNS ON PREPARED TAC (PROPAGATION + FOLDING)
 *
 * A divisor is "provably zero" when it is a literal zero in the prepared
 * TAC, including cases made visible by assignment propagation or folding
 * a nested expression such as `5 - 5`. For example:
 *
 *   1. The source wrote a literal zero directly:      10 / 0
 *   2. Propagation resolved a known-zero variable:     int y = 0; 10 / y
 *   3. Folding evaluated the divisor expression:      10 / (5 - 5)
 *
 * These situations look IDENTICAL once the diagnostic precheck has prepared the TAC:
 * in either case the TAC instruction's right operand is `{ kind: 'constant',
 * value: 0 }`. That is exactly why this check is written against the
 * prepared TAC rather than raw TAC straight out of the generator or the AST.
 * The precheck reuses the existing constant-propagation and folding passes
 * instead of re-implementing constant reasoning inside this diagnostic.
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
 * The pipeline supplies a diagnostic-only TAC snapshot prepared by repeating
 * constant propagation and constant folding within each independent body.
 * This means nested expressions such as `10 / (5 - 5)` can become visible to
 * this check without changing the main optimization trace or carrying facts
 * across labels, jumps, or function-call boundaries. Callers that invoke this
 * helper directly are responsible for providing TAC prepared to the desired
 * level of propagation/folding.
 *
 * DEFENCE IN DEPTH
 *
 * `constantFolding.ts` retains its own division-by-zero guard so folding never
 * evaluates division by zero to Infinity or NaN. This diagnostic adds the
 * compile-time error reporting layer; it does not replace that guard.
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
    case 'IncrementStmt':
    case 'BreakStmt':
    case 'ContinueStmt':
      return undefined;
    case 'PrintStmt':
      return findSpanInExpr(stmt.expression, id);
    case 'CallStmt':
      for (const arg of stmt.arguments) { const found = findSpanInExpr(arg, id); if (found) return found; }
      return undefined;
    case 'ReturnStmt':
      return stmt.expression === null ? undefined : findSpanInExpr(stmt.expression, id);
    case 'FunctionDecl':
      return stmt.body.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
    case 'WhileStmt':
      return findSpanInExpr(stmt.condition, id)
        ?? stmt.body.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
    case 'ForStmt':
      return (stmt.initializer ? findSpanInStmt(stmt.initializer, id) : undefined)
        ?? (stmt.condition ? findSpanInExpr(stmt.condition, id) : undefined)
        ?? (stmt.update ? findSpanInStmt(stmt.update, id) : undefined)
        ?? stmt.body.map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
    case 'SwitchStmt':
      return findSpanInExpr(stmt.expression, id)
        ?? stmt.cases.flatMap((entry) => entry.body).map((child) => findSpanInStmt(child, id)).find((x) => x !== undefined);
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
      (instruction.operator === '/' || instruction.operator === '%') &&
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
