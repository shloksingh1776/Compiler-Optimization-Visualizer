/**
 * SYNTAX ANALYSIS  (Phase 2 of the compiler)
 * ==========================================
 *
 * COMPILER CONCEPT: the parser checks that the token stream matches the
 * grammar of the language, and builds an abstract syntax tree describing its
 * structure.
 *
 *      tokens  -->  [ PARSER ]  -->  AST
 *
 * PARSING STRATEGY: recursive descent, which is a *top-down predictive*
 * parser. There is one function per grammar rule, and each function calls the
 * functions for the symbols on the right hand side of its production. The
 * call stack of the program IS the parse tree being walked.
 *
 * WHY THIS WORKS HERE: the grammar below is LL(1), meaning one token of
 * lookahead is always enough to decide which production to use, so the parser
 * never needs to backtrack.
 *
 *      statement -> declaration | assignment
 *      FIRST(declaration) = { int }
 *      FIRST(assignment)  = { IDENTIFIER }
 *
 * Those sets are disjoint, so a single `peek()` picks the right branch.
 *
 * THE GRAMMAR IMPLEMENTED HERE
 *
 *      program      -> statement* EOF
 *      statement    -> declaration | assignment
 *
 *      declaration  -> "int" IDENTIFIER ( "=" expression )? ";"
 *      assignment   -> IDENTIFIER "=" expression ";"
 *
 *      expression   -> logicalOr
 *      logicalOr     -> logicalAnd ( "||" logicalAnd )*
 *      logicalAnd    -> comparison ( "&&" comparison )*
 *      comparison    -> additive ( comparison-op additive )?
 *      additive      -> term ( ( "+" | "-" ) term )*
 *      term          -> factor ( ( "*" | "/" ) factor )*
 *      factor        -> ("-" | "!") factor | primary
 *      primary      -> NUMBER | IDENTIFIER | "(" expression ")"
 *
 * TWO THINGS THIS GRAMMAR GETS FOR FREE
 *
 * 1. PRECEDENCE comes from the layering, not from a precedence table.
 *    `expression` is defined in terms of `term`, and `term` in terms of
 *    `factor`. So parseExpression cannot see a `*` directly -- parseTerm has
 *    already consumed it and returned a finished multiplication node. That is
 *    why `a + b * 2` builds the `*` node deeper than the `+` node.
 *
 * 2. NO LEFT RECURSION. The textbook rule `E -> E + T | T` is left recursive
 *    and would make parseExpression call itself forever without consuming a
 *    token. The `( ... )*` repetition above is exactly the standard
 *    `E -> T E'` transformation, written as a loop instead of a rule.
 *
 * DETERMINISM: no randomness, no shared state between runs. Parsing the same
 * token stream twice produces two identical trees, right down to the node ids.
 */

import { TokenType, type Token } from '../lexer/tokens.ts';
import type { MiniCType } from '../types.ts';
import { makeError, type CompilerError } from '../errors.ts';
import type {
  Assignment,
  BinaryOperator,
  BooleanLiteral,
  Expr,
  Identifier,
  NumberLiteral,
  Program,
  Stmt,
  VarDecl,
  PrintStmt,
  ReturnStmt,
  IfStmt,
  WhileStmt,
  FunctionDecl,
  ConditionalExpr,
} from './ast.ts';

/** Result of parsing a token stream. */
export interface ParseResult {
  /**
   * The tree, or null if any syntax error was found. Parsing continues past
   * the first error so that every syntax error can be reported at once, but a
   * tree built from broken input is not safe to hand to later phases.
   */
  readonly program: Program | null;
  /** All syntax errors found. Empty means the parse succeeded. */
  readonly errors: CompilerError[];
}

/**
 * Thrown internally to unwind out of a failed production.
 *
 * COMPILER CONCEPT: this is how "panic mode" recovery is implemented. When a
 * production cannot continue, it throws; parseProgram catches, records the
 * error, skips tokens until it reaches a plausible restart point, and tries
 * the next statement. Using an exception avoids threading a failure flag
 * through every single parse function.
 *
 * This is an internal control-flow signal, never surfaced to the caller --
 * `parse` always returns normally.
 */
class ParseError extends Error {
  constructor(public readonly compilerError: CompilerError) {
    super(compilerError.message);
    this.name = 'ParseError';
  }
}

/* ------------------------------------------------------------------ */

class Parser {
  private readonly tokens: readonly Token[];
  private readonly errors: CompilerError[] = [];

  /** Index of the next token to look at. */
  private current = 0;

  /** Counter behind the stable node ids n0, n1, n2, ... */
  private nextNodeId = 0;

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }

  /* ---------------- token cursor ---------------- */

  /**
   * The next token without consuming it.
   *
   * The scanner guarantees the stream ends with an EOF token and the parser
   * never advances past it, so this index is always in range. The throw is a
   * guard against an internal bug, not an expected condition.
   */
  private peek(): Token {
    const token = this.tokens[this.current];
    if (token === undefined) {
      throw new Error(`Internal parser error: no token at index ${this.current}`);
    }
    return token;
  }

  private previous(): Token {
    const token = this.tokens[this.current - 1];
    if (token === undefined) {
      throw new Error(`Internal parser error: no token before index ${this.current}`);
    }
    return token;
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  /** True if the next token has this type. Does not consume it. */
  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  /**
   * Consume and return the next token. Never moves past EOF.
   *
   * The consumed token is captured BEFORE the cursor moves, rather than read
   * back afterwards. That matters for the EOF token: the cursor deliberately
   * stops at EOF, so reading backwards would look at the token before it --
   * and in an empty program there is no such token at all.
   */
  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) this.current++;
    return token;
  }

  /** If the next token has this type, consume it and return true. */
  private match(type: TokenType): boolean {
    if (!this.check(type)) return false;
    this.advance();
    return true;
  }

  /**
   * Consume a token of the required type, or fail with a syntax error.
   * This is the single place where "expected X but found Y" is produced.
   */
  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw this.error(this.peek(), message);
  }

  /** Build a ParseError positioned at the offending token. */
  private error(token: Token, message: string): ParseError {
    const found =
      token.type === TokenType.EOF ? 'end of file' : `'${token.lexeme}'`;
    return new ParseError(
      makeError('syntax', `${message}, but found ${found}`, {
        line: token.line,
        column: token.column,
        start: token.start,
        end: token.end,
      })
    );
  }

  /* ---------------- node construction ---------------- */

  /** Next stable node id. */
  private id(): string {
    return `n${this.nextNodeId++}`;
  }

  /* ---------------- grammar rules ---------------- */

  /**
   *      program -> statement* EOF
   *
   * Parse statements until the end of input. Each statement is parsed inside
   * a try/catch so that one bad statement does not abandon the whole file.
   */
  parseProgram(): Program {
    const body: Stmt[] = [];
    const firstToken = this.peek();

    while (!this.isAtEnd()) {
      const positionBefore = this.current;
      try {
        body.push(this.parseStatement());
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        this.errors.push(error.compilerError);
        this.synchronize();
        // Safety net: synchronize always consumes at least one token unless we
        // are at EOF, so this can only trigger on an internal bug. Without it,
        // a production that failed without consuming anything could spin here
        // forever.
        if (this.current === positionBefore && !this.isAtEnd()) {
          this.advance();
        }
      }
    }

    // The parser consumes the EOF token explicitly, so that "end of input" is
    // matched like any other terminal symbol rather than being a special case.
    const eof = this.consume(TokenType.EOF, 'Expected end of file');

    return {
      type: 'Program',
      id: this.id(),
      body,
      line: firstToken.line,
      column: firstToken.column,
      start: firstToken.start,
      end: eof.end,
    };
  }

  /**
   *      statement -> declaration | assignment
   *
   * One token of lookahead is enough: `int` starts a declaration, an
   * identifier starts an assignment. Nothing else can begin a statement.
   */
  private parseStatement(): Stmt {
    if (this.check(TokenType.INT) || this.check(TokenType.FLOAT) || this.check(TokenType.BOOL)) {
      if (this.tokens[this.current + 2]?.type === TokenType.LPAREN) return this.parseFunction();
      return this.parseDeclaration();
    }
    if (this.check(TokenType.PRINT)) return this.parsePrint();
    if (this.check(TokenType.IF)) return this.parseIf();
    if (this.check(TokenType.WHILE)) return this.parseWhile();
    if (this.check(TokenType.RETURN)) return this.parseReturn();
    if (this.check(TokenType.IDENTIFIER)) return this.parseAssignment();
    throw this.error(
      this.peek(),
      "Expected a statement starting with a type keyword or a variable name"
    );
  }

  /**
   *      declaration -> "int" IDENTIFIER ( "=" expression )? ";"
   */

  private parseFunction(): FunctionDecl {
    const typeToken = this.advance();
    const returnType: MiniCType = typeToken.type === TokenType.FLOAT ? 'float' : typeToken.type === TokenType.BOOL ? 'bool' : 'int';
    const nameToken = this.consume(TokenType.IDENTIFIER, "Expected a function name after return type");
    this.consume(TokenType.LPAREN, "Expected '(' after function name");
    const parameters: { name: string; type: MiniCType; line: number; column: number }[] = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        const pt = this.advance();
        if (pt.type !== TokenType.INT && pt.type !== TokenType.FLOAT && pt.type !== TokenType.BOOL) throw this.error(pt, "Expected parameter type");
        const type: MiniCType = pt.type === TokenType.FLOAT ? 'float' : pt.type === TokenType.BOOL ? 'bool' : 'int';
        const name = this.consume(TokenType.IDENTIFIER, "Expected parameter name");
        parameters.push({ name: name.lexeme, type, line: name.line, column: name.column });
      } while (this.match(TokenType.COMMA));
    }
    this.consume(TokenType.RPAREN, "Expected ')' after parameters");
    const body = this.parseBlock();
    return { type: 'FunctionDecl', id: this.id(), name: nameToken.lexeme, returnType, parameters, body,
      line: typeToken.line, column: typeToken.column, start: typeToken.start, end: this.previous().end };
  }

  private parseDeclaration(): VarDecl {
    const typeToken = this.advance();
    if (typeToken.type !== TokenType.INT && typeToken.type !== TokenType.FLOAT && typeToken.type !== TokenType.BOOL) {
      throw this.error(typeToken, "Expected 'int', 'float' or 'bool'");
    }
    const declaredType: MiniCType =
      typeToken.type === TokenType.FLOAT ? 'float' :
      typeToken.type === TokenType.BOOL ? 'bool' : 'int';
    const nameToken = this.consume(
      TokenType.IDENTIFIER,
      "Expected a variable name after the type"
    );

    // The initializer is optional: `int a;` is legal.
    let init: Expr | null = null;
    if (this.match(TokenType.ASSIGN)) {
      init = this.parseExpression();
    }

    const semicolon = this.consume(
      TokenType.SEMICOLON,
      init === null
        ? "Expected '=' or ';' after variable name"
        : "Expected ';' after declaration"
    );

    return {
      type: 'VarDecl',
      id: this.id(),
      name: nameToken.lexeme,
      init,
      nameLine: nameToken.line,
      nameColumn: nameToken.column,
      varType: declaredType,
      line: typeToken.line,
      column: typeToken.column,
      start: typeToken.start,
      end: semicolon.end,
    };
  }

  /** `print(expression);` prints one evaluated value. */
  private parsePrint(): PrintStmt {
    const printToken = this.consume(TokenType.PRINT, "Expected 'print'");
    this.consume(TokenType.LPAREN, "Expected '(' after 'print'");
    const expression = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after print expression");
    const semicolon = this.consume(TokenType.SEMICOLON, "Expected ';' after print statement");
    return {
      type: 'PrintStmt',
      id: this.id(),
      expression,
      line: printToken.line, column: printToken.column,
      start: printToken.start, end: semicolon.end,
    };
  }

  /** `return expression;` returns a value from the current program/function context. */
  private parseReturn(): ReturnStmt {
    const returnToken = this.consume(TokenType.RETURN, "Expected 'return'");
    const expression = this.parseExpression();
    const semicolon = this.consume(TokenType.SEMICOLON, "Expected ';' after return statement");
    return {
      type: 'ReturnStmt', id: this.id(), expression,
      line: returnToken.line, column: returnToken.column,
      start: returnToken.start, end: semicolon.end,
    };
  }

  /** `if (condition) { ... } else { ... }` */
  private parseIf(): IfStmt {
    const ifToken = this.consume(TokenType.IF, "Expected 'if'");
    this.consume(TokenType.LPAREN, "Expected '(' after 'if'");
    const condition = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after if condition");
    const thenBranch = this.parseBlock();
    let elseBranch: Stmt[] | null = null;
    if (this.match(TokenType.ELSE)) elseBranch = this.parseBlock();
    const end = elseBranch !== null ? this.previous().end : this.previous().end;
    return {
      type: 'IfStmt', id: this.id(), condition, thenBranch, elseBranch,
      line: ifToken.line, column: ifToken.column, start: ifToken.start, end,
    };
  }

  /** `while (condition) { ... }` */
  private parseWhile(): WhileStmt {
    const whileToken = this.consume(TokenType.WHILE, "Expected 'while'");
    this.consume(TokenType.LPAREN, "Expected '(' after 'while'");
    const condition = this.parseExpression();
    this.consume(TokenType.RPAREN, "Expected ')' after while condition");
    const body = this.parseBlock();
    return {
      type: 'WhileStmt',
      id: this.id(),
      condition,
      body,
      line: whileToken.line,
      column: whileToken.column,
      start: whileToken.start,
      end: this.previous().end,
    };
  }

  private parseBlock(): Stmt[] {
    this.consume(TokenType.LBRACE, "Expected '{' to start block");
    const statements: Stmt[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const positionBefore = this.current;
      try { statements.push(this.parseStatement()); }
      catch (error) {
        if (!(error instanceof ParseError)) throw error;
        this.errors.push(error.compilerError);
        this.synchronize();
        if (this.current === positionBefore && !this.isAtEnd()) this.advance();
      }
    }
    this.consume(TokenType.RBRACE, "Expected '}' after block");
    return statements;
  }

  /**
   *      assignment -> IDENTIFIER "=" expression ";"
   */
  private parseAssignment(): Assignment {
    const nameToken = this.consume(
      TokenType.IDENTIFIER,
      'Expected a variable name'
    );
    this.consume(TokenType.ASSIGN, "Expected '=' after variable name");
    const value = this.parseExpression();
    const semicolon = this.consume(
      TokenType.SEMICOLON,
      "Expected ';' after assignment"
    );

    return {
      type: 'Assignment',
      id: this.id(),
      name: nameToken.lexeme,
      value,
      nameLine: nameToken.line,
      nameColumn: nameToken.column,
      line: nameToken.line,
      column: nameToken.column,
      start: nameToken.start,
      end: semicolon.end,
    };
  }

  /**
   *      expression -> term ( ( "+" | "-" ) term )*
   *
   * LEFT ASSOCIATIVITY: each time round the loop, the tree built so far
   * becomes the LEFT child of the new node. So `20 - 5 - 3` builds
   *
   *      pass 1:  (20 - 5)
   *      pass 2:  ((20 - 5) - 3)
   *
   * which evaluates to 12, matching C. Recursing on the right instead would
   * produce `20 - (5 - 3)` = 18, which is wrong.
   */
  private parseExpression(): Expr {
    return this.parseConditional();
  }

  /** conditional -> logicalOr ( '?' expression ':' conditional )? */
  private parseConditional(): Expr {
    const condition = this.parseLogicalOr();
    if (!this.match(TokenType.QUESTION)) return condition;

    const thenExpression = this.parseExpression();
    this.consume(TokenType.COLON, "Expected ':' after ternary true expression");
    const elseExpression = this.parseConditional();
    const node: ConditionalExpr = {
      type: 'ConditionalExpr',
      id: this.id(),
      condition,
      thenExpression,
      elseExpression,
      line: condition.line,
      column: condition.column,
      start: condition.start,
      end: elseExpression.end,
    };
    return node;
  }

  /** logicalOr -> logicalAnd ( "||" logicalAnd )* */
  private parseLogicalOr(): Expr {
    let left = this.parseLogicalAnd();
    while (this.check(TokenType.OR_OR)) {
      this.advance();
      const right = this.parseLogicalAnd();
      left = {
        type: 'BinaryExpr', id: this.id(), operator: '||', left, right,
        line: left.line, column: left.column, start: left.start, end: right.end,
      };
    }
    return left;
  }

  /** logicalAnd -> comparison ( "&&" comparison )* */
  private parseLogicalAnd(): Expr {
    let left = this.parseComparison();
    while (this.check(TokenType.AND_AND)) {
      this.advance();
      const right = this.parseComparison();
      left = {
        type: 'BinaryExpr', id: this.id(), operator: '&&', left, right,
        line: left.line, column: left.column, start: left.start, end: right.end,
      };
    }
    return left;
  }

  /** comparison -> additive ( ( < | > | <= | >= | == | != ) additive )? */
  private parseComparison(): Expr {
    let left = this.parseAdditive();

    if (
      this.check(TokenType.LT) ||
      this.check(TokenType.GT) ||
      this.check(TokenType.LE) ||
      this.check(TokenType.GE) ||
      this.check(TokenType.EQ) ||
      this.check(TokenType.NE)
    ) {
      const operatorToken = this.advance();
      const operatorMap: Partial<Record<TokenType, BinaryOperator>> = {
        [TokenType.LT]: '<', [TokenType.GT]: '>', [TokenType.LE]: '<=',
        [TokenType.GE]: '>=', [TokenType.EQ]: '==', [TokenType.NE]: '!=',
      };
      const operator = operatorMap[operatorToken.type];
      if (operator === undefined) throw this.error(operatorToken, 'Invalid comparison operator');
      const right = this.parseAdditive();
      left = {
        type: 'BinaryExpr', id: this.id(), operator, left, right,
        line: left.line, column: left.column, start: left.start, end: right.end,
      };
    }

    return left;
  }

  /** expression's arithmetic layer: additive -> term ( ("+" | "-") term )* */
  private parseAdditive(): Expr {
    let left = this.parseTerm();

    while (this.check(TokenType.PLUS) || this.check(TokenType.MINUS)) {
      const operatorToken = this.advance();
      const operator: BinaryOperator =
        operatorToken.type === TokenType.PLUS ? '+' : '-';
      const right = this.parseTerm();
      left = {
        type: 'BinaryExpr',
        id: this.id(),
        operator,
        left,
        right,
        line: left.line,
        column: left.column,
        start: left.start,
        end: right.end,
      };
    }

    return left;
  }

  /**
   *      term -> factor ( ( "*" | "/" ) factor )*
   *
   * Identical in shape to parseExpression, one level down. Because
   * parseExpression calls parseTerm before it ever looks for `+`, any
   * multiplication or division has already been folded into a finished node
   * by the time the addition is built. That is the whole precedence
   * mechanism -- there is no precedence table anywhere in this parser.
   */
  private parseTerm(): Expr {
    let left = this.parseFactor();

    while (this.check(TokenType.STAR) || this.check(TokenType.SLASH)) {
      const operatorToken = this.advance();
      const operator: BinaryOperator =
        operatorToken.type === TokenType.STAR ? '*' : '/';
      const right = this.parseFactor();
      left = {
        type: 'BinaryExpr',
        id: this.id(),
        operator,
        left,
        right,
        line: left.line,
        column: left.column,
        start: left.start,
        end: right.end,
      };
    }

    return left;
  }

  /**
   *      factor -> "-" factor | primary
   *
   * UNARY MINUS. Note this rule is RIGHT recursive: `-` is followed by
   * another `factor`, not by a `primary`. That is deliberate, and it is what
   * makes `--5` parse as -(-5).
   *
   * MiniC has no `--` decrement operator. The scanner emits two separate
   * MINUS tokens and this rule applies twice.
   *
   * Unary minus binds tighter than any binary operator because it lives below
   * `term` in the grammar: `-a * b` parses as `(-a) * b`, since parseTerm
   * calls parseFactor for its left operand and parseFactor consumes the minus
   * before parseTerm ever sees the `*`.
   */
  private parseFactor(): Expr {
    if (this.check(TokenType.MINUS) || this.check(TokenType.BANG)) {
      const operatorToken = this.advance();
      const operand = this.parseFactor(); // right recursion, allows -(-x) and !!x
      return {
        type: 'UnaryExpr',
        id: this.id(),
        operator: operatorToken.type === TokenType.BANG ? '!' : '-',
        operand,
        line: operatorToken.line,
        column: operatorToken.column,
        start: operatorToken.start,
        end: operand.end,
      };
    }

    return this.parsePrimary();
  }

  /**
   *      primary -> NUMBER | IDENTIFIER | "(" expression ")"
   *
   * The base case of the recursion. Parentheses work by simply calling back
   * into parseExpression, which restarts the whole precedence ladder from the
   * top -- that is how `(a + b) * 2` overrides the default precedence.
   */
  private parsePrimary(): Expr {
    if (this.check(TokenType.NUMBER)) {
      const token = this.advance();
      // The scanner attaches `value` to every NUMBER token; this guard exists
      // only to satisfy the type system.
      const value = token.value ?? 0;
      const literal: NumberLiteral = {
        type: 'NumberLiteral',
        id: this.id(),
        value,
        valueType: token.lexeme.includes('.') ? 'float' : 'int',
        line: token.line,
        column: token.column,
        start: token.start,
        end: token.end,
      };
      return literal;
    }

    if (this.check(TokenType.TRUE) || this.check(TokenType.FALSE)) {
      const token = this.advance();
      const literal: BooleanLiteral = {
        type: 'BooleanLiteral',
        id: this.id(),
        value: token.type === TokenType.TRUE,
        line: token.line,
        column: token.column,
        start: token.start,
        end: token.end,
      };
      return literal;
    }

    if (this.check(TokenType.IDENTIFIER)) {
      const token = this.advance();
      if (this.match(TokenType.LPAREN)) {
        const args: Expr[] = [];
        if (!this.check(TokenType.RPAREN)) {
          do { args.push(this.parseExpression()); } while (this.match(TokenType.COMMA));
        }
        const close = this.consume(TokenType.RPAREN, "Expected ')' after function arguments");
        return { type: 'CallExpr', id: this.id(), name: token.lexeme, arguments: args, line: token.line, column: token.column, start: token.start, end: close.end };
      }
      const identifier: Identifier = {
        type: 'Identifier',
        id: this.id(),
        name: token.lexeme,
        line: token.line,
        column: token.column,
        start: token.start,
        end: token.end,
      };
      return identifier;
    }

    if (this.check(TokenType.LPAREN)) {
      this.advance();
      const inner = this.parseExpression();
      this.consume(TokenType.RPAREN, "Expected ')' after expression");
      // The parentheses are NOT kept as an AST node. They existed only to
      // guide the parser, and the grouping they expressed is now recorded in
      // the shape of the tree: `(a + b) * 2` has already been built with the
      // `+` node below the `*` node. A "ParenExpr" node would carry no
      // information and every later phase would have to skip over it.
      return inner;
    }

    throw this.error(
      this.peek(),
      `Expected a number, a variable name or '(' to start an expression`
    );
  }

  /* ---------------- error recovery ---------------- */

  /**
   * PANIC MODE RECOVERY.
   *
   * After a syntax error we cannot trust the parser's position, so we discard
   * tokens until we reach somewhere a new statement plausibly begins:
   *
   *   - just after a ';', which ends the broken statement, or
   *   - at an 'int', which can only start a new declaration.
   *
   * This is why `int a = ;` and `int b = 2;` in the same file both get
   * reported: the parser resynchronises at the first semicolon and carries on.
   *
   * It always consumes at least one token (unless already at EOF), which
   * guarantees the statement loop in parseProgram makes progress and cannot
   * hang the application on a syntax error.
   */
  private synchronize(): void {
    if (!this.isAtEnd()) this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().type === TokenType.SEMICOLON) return;
      if (this.check(TokenType.INT) || this.check(TokenType.FLOAT) || this.check(TokenType.BOOL) || this.check(TokenType.PRINT) || this.check(TokenType.RETURN)) return;
      this.advance();
    }
  }

  getErrors(): CompilerError[] {
    return this.errors;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Run syntax analysis on a token stream from the lexer.
 *
 * Pure function: no shared state, no side effects, fully deterministic.
 *
 * @example
 *   const { tokens } = tokenize('int c = a + b * 2;');
 *   const { program, errors } = parse(tokens);
 */
export function parse(tokens: readonly Token[]): ParseResult {
  // Defensive: the scanner always appends EOF, so this cannot happen from
  // `tokenize`, but `parse` is a public function and should not crash.
  if (tokens.length === 0) {
    return {
      program: null,
      errors: [
        makeError('syntax', 'Empty token stream: expected at least an EOF token', {
          line: 1,
          column: 1,
          start: 0,
          end: 0,
        }),
      ],
    };
  }

  const parser = new Parser(tokens);

  try {
    const program = parser.parseProgram();
    const errors = parser.getErrors();
    // A tree built from input with syntax errors is not safe for the later
    // phases, so it is withheld. The errors are still all reported.
    return { program: errors.length === 0 ? program : null, errors };
  } catch (error) {
    // Nothing should reach here: every ParseError is caught per statement in
    // parseProgram. This last resort exists so that an unforeseen internal
    // fault surfaces as an ordinary error in the UI instead of blanking the
    // whole application.
    const last = tokens[tokens.length - 1];
    const message = error instanceof Error ? error.message : String(error);
    return {
      program: null,
      errors: [
        ...parser.getErrors(),
        makeError('syntax', `Internal parser error: ${message}`, {
          line: last?.line ?? 1,
          column: last?.column ?? 1,
          start: last?.start ?? 0,
          end: last?.end ?? 0,
        }),
      ],
    };
  }
}
