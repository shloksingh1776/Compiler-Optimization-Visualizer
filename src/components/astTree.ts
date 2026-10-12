/**
 * AST TREE LAYOUT
 * ===============
 *
 * Turns the parser's AST into a flat list of rows, each carrying the box
 * drawing prefix that makes the parent/child structure visible:
 *
 *      Program
 *      └── VarDecl: c
 *          └── BinaryExpr: +
 *              ├── Identifier: a
 *              └── BinaryExpr: *
 *                  ├── Identifier: b
 *                  └── NumberLiteral: 2
 *
 * This file contains NO React. It is plain data transformation, which means
 * the tree layout can be unit tested directly with `formatAstTree` instead of
 * having to render a component and inspect the DOM. `AstView.tsx` does
 * nothing but style the rows this module returns.
 *
 * Note there is no ParenExpr row: parentheses are not AST nodes. The grouping
 * they expressed is already recorded in the shape of the tree, which is
 * exactly what this rendering makes visible.
 */

import type { Expr, Program, Stmt } from '../compiler/parser/ast.ts';

/** A node reduced to just what the display needs. */
interface TreeNode {
  readonly id: string;
  /** The node type, e.g. "BinaryExpr". */
  readonly kind: string;
  /** The interesting value, e.g. "+" or "c" or "10". Null for Program. */
  readonly value: string | null;
  readonly line: number;
  readonly column: number;
  readonly children: TreeNode[];
}

/** One printable line of the tree. */
export interface AstRow {
  /** Stable AST node id, used as the React key. */
  readonly id: string;
  /** Box drawing prefix, e.g. "│   ├── ". Empty for the root. */
  readonly prefix: string;
  readonly kind: string;
  readonly value: string | null;
  readonly line: number;
  readonly column: number;
  /** Nesting depth, 0 for the root. */
  readonly depth: number;
}

/* ------------------------------------------------------------------ */
/* AST  ->  display tree                                               */
/* ------------------------------------------------------------------ */

/**
 * Reduce an expression to a display node.
 *
 * The switch is exhaustive over the Expr union, so if a new expression node
 * type is ever added the TypeScript compiler will flag this function.
 */
function expressionNode(expr: Expr): TreeNode {
  const base = { id: expr.id, line: expr.line, column: expr.column };

  switch (expr.type) {
    case 'BinaryExpr':
      return {
        ...base,
        kind: 'BinaryExpr',
        value: expr.operator,
        children: [expressionNode(expr.left), expressionNode(expr.right)],
      };
    case 'UnaryExpr':
      return {
        ...base,
        kind: 'UnaryExpr',
        value: expr.operator,
        children: [expressionNode(expr.operand)],
      };
    case 'NumberLiteral':
      return { ...base, kind: 'NumberLiteral', value: String(expr.value), children: [] };
    case 'BooleanLiteral':
      return { ...base, kind: 'BooleanLiteral', value: String(expr.value), children: [] };
    case 'Identifier':
      return { ...base, kind: 'Identifier', value: expr.name, children: [] };
    case 'CallExpr':
      return { ...base, kind: 'CallExpr', value: expr.name, children: expr.arguments.map(expressionNode) };
    case 'ConditionalExpr':
      return {
        ...base, kind: 'ConditionalExpr', value: '? :',
        children: [
          { id: `${expr.id}-condition`, kind: 'Condition', value: null, line: expr.condition.line, column: expr.condition.column, children: [expressionNode(expr.condition)] },
          { id: `${expr.id}-then`, kind: 'ThenExpression', value: null, line: expr.thenExpression.line, column: expr.thenExpression.column, children: [expressionNode(expr.thenExpression)] },
          { id: `${expr.id}-else`, kind: 'ElseExpression', value: null, line: expr.elseExpression.line, column: expr.elseExpression.column, children: [expressionNode(expr.elseExpression)] },
        ],
      };
  }
}

/** Reduce a statement to a display node. */
function statementNode(stmt: Stmt): TreeNode {
  const base = { id: stmt.id, line: stmt.line, column: stmt.column };

  switch (stmt.type) {
    case 'VarDecl':
      return {
        ...base,
        kind: 'VarDecl',
        value: stmt.name,
        // A declaration with no initializer is a leaf: `int a;`
        children: stmt.init === null ? [] : [expressionNode(stmt.init)],
      };
    case 'IncrementStmt':
      return { ...base, kind: 'IncrementStmt', value: `${stmt.name}${stmt.operator}`, children: [] };
    case 'PrintStmt':
      return { ...base, kind: 'PrintStmt', value: 'print', children: [expressionNode(stmt.expression)] };
    case 'ReturnStmt':
      return { ...base, kind: 'ReturnStmt', value: 'return', children: stmt.expression === null ? [] : [expressionNode(stmt.expression)] };
    case 'CallStmt':
      return { ...base, kind: 'CallStmt', value: `${stmt.name}()`, children: stmt.arguments.map(expressionNode) };
    case 'BreakStmt':
      return { ...base, kind: 'BreakStmt', value: 'break', children: [] };
    case 'ContinueStmt':
      return { ...base, kind: 'ContinueStmt', value: 'continue', children: [] };
    case 'FunctionDecl':
      return { ...base, kind: 'FunctionDecl', value: `${stmt.returnType} ${stmt.name}`, children: [
        { id: `${stmt.id}-params`, kind: 'Parameters', value: null, line: stmt.line, column: stmt.column, children: stmt.parameters.map(p => ({ id: `${stmt.id}-param-${p.name}`, kind: 'Parameter', value: `${p.type} ${p.name}`, line: p.line, column: p.column, children: [] })) },
        { id: `${stmt.id}-body`, kind: 'FunctionBody', value: null, line: stmt.line, column: stmt.column, children: stmt.body.map(statementNode) },
      ] };
    case 'ForStmt':
      return {
        ...base, kind: 'ForStmt', value: 'for',
        children: [
          ...(stmt.initializer ? [{ id: `${stmt.id}-initializer`, kind: 'Initializer', value: null, line: stmt.initializer.line, column: stmt.initializer.column, children: [statementNode(stmt.initializer)] }] : []),
          ...(stmt.condition ? [{ id: `${stmt.id}-condition`, kind: 'Condition', value: null, line: stmt.condition.line, column: stmt.condition.column, children: [expressionNode(stmt.condition)] }] : []),
          ...(stmt.update ? [{ id: `${stmt.id}-update`, kind: 'Update', value: null, line: stmt.update.line, column: stmt.update.column, children: [statementNode(stmt.update)] }] : []),
          { id: `${stmt.id}-body`, kind: 'ForBody', value: null, line: stmt.line, column: stmt.column, children: stmt.body.map(statementNode) },
        ],
      };
    case 'SwitchStmt':
      return {
        ...base, kind: 'SwitchStmt', value: 'switch',
        children: [
          { id: `${stmt.id}-expression`, kind: 'Expression', value: null, line: stmt.expression.line, column: stmt.expression.column, children: [expressionNode(stmt.expression)] },
          ...stmt.cases.map((entry, index) => ({
            id: `${stmt.id}-case-${index}`, kind: entry.value === null ? 'DefaultCase' : 'Case',
            value: entry.value === null ? 'default' : String(entry.value), line: entry.line, column: entry.column,
            children: entry.body.map(statementNode),
          })),
        ],
      };
    case 'WhileStmt':
      return {
        ...base, kind: 'WhileStmt', value: 'while',
        children: [
          { id: `${stmt.id}-condition`, kind: 'Condition', value: null, line: stmt.condition.line, column: stmt.condition.column, children: [expressionNode(stmt.condition)] },
          { id: `${stmt.id}-body`, kind: 'WhileBody', value: null, line: stmt.line, column: stmt.column, children: stmt.body.map(statementNode) },
        ],
      };
    case 'IfStmt':
      return {
        ...base, kind: 'IfStmt', value: 'if',
        children: [
          { id: `${stmt.id}-condition`, kind: 'Condition', value: null, line: stmt.condition.line, column: stmt.condition.column, children: [expressionNode(stmt.condition)] },
          { id: `${stmt.id}-then`, kind: 'ThenBranch', value: null, line: stmt.line, column: stmt.column, children: stmt.thenBranch.map(statementNode) },
          ...(stmt.elseBranch !== null ? [{ id: `${stmt.id}-else`, kind: 'ElseBranch', value: null, line: stmt.line, column: stmt.column, children: stmt.elseBranch.map(statementNode) }] : []),
        ],
      };
    case 'Assignment':
      return {
        ...base,
        kind: 'Assignment',
        value: stmt.compoundOperator ? `${stmt.name} ${stmt.compoundOperator}` : stmt.name,
        children: [expressionNode(stmt.value)],
      };
  }
}

function programNode(program: Program): TreeNode {
  return {
    id: program.id,
    kind: 'Program',
    value: null,
    line: program.line,
    column: program.column,
    children: program.body.map(statementNode),
  };
}

/* ------------------------------------------------------------------ */
/* Display tree  ->  rows                                              */
/* ------------------------------------------------------------------ */

/**
 * Walk the tree in pre-order, building each row's connector prefix.
 *
 * The rule is the same one the `tree` command uses:
 *   - the last child of a parent gets "└── ", every other child gets "├── ";
 *   - below a last child the indentation is blank, because that branch is
 *     finished; below any other child a "│   " continues the vertical line.
 *
 * `selfPrefix` is what prints in front of this node. `childIndent` is what
 * every descendant line starts with, before its own connector.
 */
function collectRows(
  node: TreeNode,
  selfPrefix: string,
  childIndent: string,
  depth: number,
  rows: AstRow[]
): void {
  rows.push({
    id: node.id,
    prefix: selfPrefix,
    kind: node.kind,
    value: node.value,
    line: node.line,
    column: node.column,
    depth,
  });

  node.children.forEach((child, index) => {
    const isLast = index === node.children.length - 1;
    collectRows(
      child,
      childIndent + (isLast ? '└── ' : '├── '),
      childIndent + (isLast ? '    ' : '│   '),
      depth + 1,
      rows
    );
  });
}

/** Flatten a Program into printable rows. */
export function buildAstRows(program: Program): AstRow[] {
  const rows: AstRow[] = [];
  collectRows(programNode(program), '', '', 0, rows);
  return rows;
}

/**
 * Render the whole tree as plain text.
 *
 * Used by the tests, and handy for debugging. Asserting against this string
 * is much clearer than walking nested objects, and it demonstrates operator
 * precedence at a glance.
 */
export function formatAstTree(program: Program): string {
  return buildAstRows(program)
    .map((row) => `${row.prefix}${row.kind}${row.value === null ? '' : `: ${row.value}`}`)
    .join('\n');
}
