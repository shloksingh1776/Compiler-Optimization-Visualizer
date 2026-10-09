/**
 * ABSTRACT SYNTAX TREE  --  MiniC v1
 * ==================================
 *
 * COMPILER CONCEPT: the parser's output is an *abstract* syntax tree, not a
 * parse tree. A parse tree records every grammar production that fired,
 * including the ones that exist only to encode precedence:
 *
 *      parse tree for `2 + 3`          AST for `2 + 3`
 *
 *          expression                     BinaryExpr(+)
 *              |                            /      \
 *         term  +  term              NumberLit(2)  NumberLit(3)
 *           |         |
 *        factor    factor
 *           |         |
 *       primary    primary
 *           |         |
 *           2         3
 *
 * The AST throws away the chain of single-child nodes and keeps only what the
 * later phases actually need. Precedence is not lost: it is now encoded in the
 * *shape* of the tree, because the parser built the deeper node first.
 *
 * That last point is the whole reason the AST is worth building. Once
 * `a + b * 2` has become
 *
 *      BinaryExpr(+, a, BinaryExpr(*, b, 2))
 *
 * every later phase can walk the tree bottom-up and never think about
 * precedence again.
 *
 * TYPING: statements and expressions are *discriminated unions* keyed on the
 * `type` field. TypeScript narrows the union inside a `switch (node.type)`,
 * so the compiler itself checks that every tree walk handles every node kind.
 * Adding a node type later produces a compile error at each walk that forgot
 * it, which is exactly what we want.
 */

/**
 * Position information carried by every AST node.
 *
 * `start` / `end` are absolute 0-based offsets covering the *entire* node,
 * from the first character of its leftmost token to the last character of its
 * rightmost token. `end` is exclusive, so `source.slice(start, end)` gives the
 * exact text the node was built from.
 *
 * `line` / `column` are the 1-based human-readable position of `start`, so
 * they always agree with it.
 */
export interface NodeBase {
  /**
   * Stable identifier, assigned in the order nodes are constructed: n0, n1,
   * n2, ... Parsing is deterministic, so the same source always produces the
   * same ids. Later phases use this to link a TAC instruction back to the AST
   * node that generated it, and the UI uses it as a React key.
   */
  readonly id: string;
  readonly line: number;
  readonly column: number;
  readonly start: number;
  readonly end: number;
}

/* ------------------------------------------------------------------ */
/* Expressions                                                         */
/* ------------------------------------------------------------------ */

/** Binary arithmetic, comparison, and logical operators supported by MiniC. */
export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '<' | '>' | '<=' | '>=' | '==' | '!=' | '&&' | '||';

/** Unary numeric negation and boolean logical NOT. */
export type UnaryOperator = '-' | '!';

/** `left op right`, e.g. `a + b`. */
export interface BinaryExpr extends NodeBase {
  readonly type: 'BinaryExpr';
  readonly operator: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
}

/**
 * `-operand`, e.g. `-5`.
 *
 * Note this is a genuinely different node from BinaryExpr('-'). The scanner
 * emits the same MINUS token for both; deciding which one applies is the
 * parser's job, and the two land in different places in the grammar
 * (`factor` versus `expression`).
 */
export interface UnaryExpr extends NodeBase {
  readonly type: 'UnaryExpr';
  readonly operator: UnaryOperator;
  readonly operand: Expr;
}

/** An integer literal, e.g. `42`. */
import type { MiniCType } from '../types.ts';

export interface BooleanLiteral extends NodeBase {
  readonly type: 'BooleanLiteral';
  readonly value: boolean;
}

export interface NumberLiteral extends NodeBase {
  readonly type: 'NumberLiteral';
  readonly value: number;
  /** Numeric type of the literal; omitted by older hand-built AST tests means int. */
  readonly valueType?: MiniCType;
}

/** A reference to a variable, e.g. `a`. */
export interface Identifier extends NodeBase {
  readonly type: 'Identifier';
  readonly name: string;
}

export interface ConditionalExpr extends NodeBase {
  readonly type: 'ConditionalExpr';
  readonly condition: Expr;
  readonly thenExpression: Expr;
  readonly elseExpression: Expr;
}

export interface CallExpr extends NodeBase {
  readonly type: 'CallExpr';
  readonly name: string;
  readonly arguments: Expr[];
}

export type Expr = BinaryExpr | UnaryExpr | NumberLiteral | BooleanLiteral | Identifier | CallExpr | ConditionalExpr;

/* ------------------------------------------------------------------ */
/* Statements                                                          */
/* ------------------------------------------------------------------ */

/**
 * `int name;` or `int name = init;`
 *
 * `init` is null for a declaration with no initializer. That null is what the
 * semantic analyser will use in Phase 3 to detect use-before-initialization.
 */
export interface VarDecl extends NodeBase {
  readonly type: 'VarDecl';
  readonly name: string;
  readonly init: Expr | null;
  /** Declared variable type; omitted by older AST fixtures means int. */
  readonly varType?: MiniCType;
  /** Position of the identifier itself, for "redeclared variable" messages. */
  readonly nameLine: number;
  readonly nameColumn: number;
}

/** `name = value;` */
export interface PrintStmt extends NodeBase {
  readonly type: 'PrintStmt';
  readonly expression: Expr;
}

export interface ReturnStmt extends NodeBase {
  readonly type: 'ReturnStmt';
  readonly expression: Expr;
}

export interface FunctionDecl extends NodeBase {
  readonly type: 'FunctionDecl';
  readonly name: string;
  readonly returnType: MiniCType;
  readonly parameters: { readonly name: string; readonly type: MiniCType; readonly line: number; readonly column: number }[];
  readonly body: Stmt[];
}

export interface IfStmt extends NodeBase {
  readonly type: 'IfStmt';
  readonly condition: Expr;
  readonly thenBranch: Stmt[];
  readonly elseBranch: Stmt[] | null;
}

export interface WhileStmt extends NodeBase {
  readonly type: 'WhileStmt';
  readonly condition: Expr;
  readonly body: Stmt[];
}


/** Postfix increment/decrement statement, e.g. `i++;` or `i--;`. */
export interface IncrementStmt extends NodeBase {
  readonly type: 'IncrementStmt';
  readonly name: string;
  readonly operator: '++' | '--';
  readonly nameLine: number;
  readonly nameColumn: number;
}

export interface Assignment extends NodeBase {
  readonly type: 'Assignment';
  readonly name: string;
  readonly value: Expr;
  /** Compound operator when source uses +=, -=, *=, /= or %=; absent for plain =. */
  readonly compoundOperator?: '+=' | '-=' | '*=' | '/=' | '%=';
  /** Position of the identifier itself, for "undeclared variable" messages. */
  readonly nameLine: number;
  readonly nameColumn: number;
}

export type Stmt = VarDecl | Assignment | IncrementStmt | PrintStmt | ReturnStmt | IfStmt | WhileStmt | FunctionDecl;

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

/**
 * The root of the tree.
 *
 * A program is an ordered list of statements. Some statements generate labels
 * and jumps in TAC, including if/else, while loops, and short-circuit logical
 * expressions. The AST keeps those constructs structured so later phases can
 * translate them safely.
 */
export interface Program extends NodeBase {
  readonly type: 'Program';
  readonly body: Stmt[];
}

/** Every node kind in the tree. */
export type AstNode = Program | Stmt | Expr;

/* ------------------------------------------------------------------ */
/* Debugging helper                                                    */
/* ------------------------------------------------------------------ */

/**
 * Render an expression in fully parenthesised form.
 *
 * This is a small debugging and testing aid, not part of the compilation
 * pipeline. It makes precedence and associativity visible at a glance:
 *
 *      a + b * 2      ->  (a + (b * 2))
 *      20 - 5 - 3     ->  ((20 - 5) - 3)
 *      -5             ->  (-5)
 *
 * Writing tests against this string is far clearer than asserting on nested
 * object structures, and it is the quickest way to demonstrate in a viva that
 * the parser really did get precedence right.
 */
export function expressionToString(node: Expr): string {
  switch (node.type) {
    case 'NumberLiteral':
      return String(node.value);
    case 'BooleanLiteral':
      return String(node.value);
    case 'Identifier':
      return node.name;
    case 'CallExpr':
      return `${node.name}(${node.arguments.map(expressionToString).join(', ')})`;
    case 'ConditionalExpr':
      return `(${expressionToString(node.condition)} ? ${expressionToString(node.thenExpression)} : ${expressionToString(node.elseExpression)})`;
    case 'UnaryExpr':
      return node.operator === '!' ? `(!${expressionToString(node.operand)})` : `(-${expressionToString(node.operand)})`;
    case 'BinaryExpr':
      return `(${expressionToString(node.left)} ${node.operator} ${expressionToString(node.right)})`;
  }
}
