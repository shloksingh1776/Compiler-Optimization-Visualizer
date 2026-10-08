/**
 * TESTS FOR PHASE 2: SYNTAX ANALYSIS
 *
 * These test the public `parse` function against a token stream from the
 * lexer, so the two phases are exercised together exactly as the pipeline
 * will use them.
 *
 * Precedence and associativity are asserted using `expressionToString`, which
 * renders an expression in fully parenthesised form. Comparing
 * `(a + (b * 2))` against `((a + b) * 2)` is far clearer than walking nested
 * objects by hand.
 *
 * Run them with: npm test
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import {
  expressionToString,
  type Assignment,
  type Expr,
  type Program,
  type Stmt,
  type VarDecl,
} from '../src/compiler/parser/ast.ts';
import type { CompilerError } from '../src/compiler/errors.ts';


describe('parser: floating-point declarations', () => {
  it('parses a float declaration and float literal', () => {
    const { tokens, errors: lexErrors } = tokenize('float x = 10.5;');
    expect(lexErrors).toHaveLength(0);
    const { program, errors } = parse(tokens);
    expect(errors).toHaveLength(0);
    expect(program?.body[0]).toMatchObject({ type: 'VarDecl', name: 'x', varType: 'float' });
    expect((program?.body[0] as VarDecl).init).toMatchObject({ type: 'NumberLiteral', value: 10.5, valueType: 'float' });
  });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Run both phases on a source string. */
function parseSource(source: string) {
  const { tokens, errors: lexErrors } = tokenize(source);
  const { program, errors } = parse(tokens);
  return { program, errors, lexErrors };
}

/** Parse source that is expected to be valid, and return the tree. */
function parseOk(source: string): Program {
  const { program, errors, lexErrors } = parseSource(source);
  if (lexErrors.length > 0) {
    throw new Error(`Unexpected lexical errors: ${JSON.stringify(lexErrors)}`);
  }
  if (program === null) {
    throw new Error(`Unexpected syntax errors: ${JSON.stringify(errors)}`);
  }
  return program;
}

/** Parse source that is expected to fail, and return the errors. */
function parseErrors(source: string): CompilerError[] {
  const { program, errors } = parseSource(source);
  if (errors.length === 0) {
    throw new Error('Expected at least one syntax error, but parsing succeeded');
  }
  // A tree is never returned when there are errors.
  expect(program).toBe(null);
  return errors;
}

/** Fetch a statement by index. Keeps `noUncheckedIndexedAccess` happy. */
function stmt(program: Program, index: number): Stmt {
  const node = program.body[index];
  if (node === undefined) {
    throw new Error(`No statement at index ${index} (only ${program.body.length})`);
  }
  return node;
}

/** Fetch a statement and assert it is a declaration. */
function decl(program: Program, index: number): VarDecl {
  const node = stmt(program, index);
  if (node.type !== 'VarDecl') {
    throw new Error(`Statement ${index} is a ${node.type}, not a VarDecl`);
  }
  return node;
}

/** Fetch a statement and assert it is an assignment. */
function assign(program: Program, index: number): Assignment {
  const node = stmt(program, index);
  if (node.type !== 'Assignment') {
    throw new Error(`Statement ${index} is a ${node.type}, not an Assignment`);
  }
  return node;
}

/** The initializer of a declaration, which must be present. */
function initOf(node: VarDecl): Expr {
  if (node.init === null) {
    throw new Error(`Declaration of '${node.name}' has no initializer`);
  }
  return node.init;
}

/**
 * Parse a single `int x = <expr>;` statement and render the initializer in
 * fully parenthesised form. This is the workhorse for the precedence and
 * associativity tests.
 */
function exprShape(expressionSource: string): string {
  const program = parseOk(`int x = ${expressionSource};`);
  return expressionToString(initOf(decl(program, 0)));
}

/** Index helper for the error array. */
function errorAt(errors: readonly CompilerError[], index: number): CompilerError {
  const error = errors[index];
  if (error === undefined) {
    throw new Error(`No error at index ${index} (only ${errors.length})`);
  }
  return error;
}

/* ------------------------------------------------------------------ */
/* 1-5: program structure and statements                               */
/* ------------------------------------------------------------------ */

describe('parser: program structure', () => {
  it('parses an empty program', () => {
    const program = parseOk('');
    expect(program.type).toBe('Program');
    expect(program.body.length).toBe(0);
  });

  it('parses a program containing only comments and whitespace', () => {
    const program = parseOk('// nothing here\n\n   // still nothing\n');
    expect(program.body.length).toBe(0);
  });

  it('parses a declaration without an initializer', () => {
    const program = parseOk('int a;');
    const node = decl(program, 0);
    expect(node.type).toBe('VarDecl');
    expect(node.name).toBe('a');
    expect(node.init).toBe(null);
  });

  it('parses a declaration with an initializer', () => {
    const program = parseOk('int a = 10;');
    const node = decl(program, 0);
    expect(node.name).toBe('a');
    expect(expressionToString(initOf(node))).toBe('10');
  });

  it('parses an assignment', () => {
    const program = parseOk('a = 42;');
    const node = assign(program, 0);
    expect(node.type).toBe('Assignment');
    expect(node.name).toBe('a');
    expect(expressionToString(node.value)).toBe('42');
  });

  it('parses multiple statements in order', () => {
    const program = parseOk('int a = 1;\nint b;\nb = 2;\nint c = a + b;');
    expect(program.body.length).toBe(4);
    expect(stmt(program, 0).type).toBe('VarDecl');
    expect(stmt(program, 1).type).toBe('VarDecl');
    expect(stmt(program, 2).type).toBe('Assignment');
    expect(stmt(program, 3).type).toBe('VarDecl');
    expect(decl(program, 0).name).toBe('a');
    expect(assign(program, 2).name).toBe('b');
    expect(expressionToString(initOf(decl(program, 3)))).toBe('(a + b)');
  });
});

/* ------------------------------------------------------------------ */
/* 6-13: expressions                                                   */
/* ------------------------------------------------------------------ */

describe('parser: arithmetic operators', () => {
  it('parses addition and subtraction', () => {
    expect(exprShape('1 + 2')).toBe('(1 + 2)');
    expect(exprShape('9 - 4')).toBe('(9 - 4)');
  });

  it('parses multiplication and division', () => {
    expect(exprShape('3 * 4')).toBe('(3 * 4)');
    expect(exprShape('8 / 2')).toBe('(8 / 2)');
  });

  it('parses identifiers inside expressions', () => {
    expect(exprShape('a')).toBe('a');
    expect(exprShape('a + b')).toBe('(a + b)');
    expect(exprShape('total * count')).toBe('(total * count)');
  });

  it('builds the correct node types for a binary expression', () => {
    const program = parseOk('int c = a + 2;');
    const root = initOf(decl(program, 0));
    if (root.type !== 'BinaryExpr') throw new Error('expected a BinaryExpr');
    expect(root.operator).toBe('+');
    expect(root.left.type).toBe('Identifier');
    expect(root.right.type).toBe('NumberLiteral');
  });
});

describe('parser: operator precedence', () => {
  it('gives * higher precedence than +', () => {
    // a + b * 2  must be  a + (b * 2),  NOT  (a + b) * 2
    expect(exprShape('a + b * 2')).toBe('(a + (b * 2))');
  });

  it('gives / higher precedence than -', () => {
    expect(exprShape('a - b / 2')).toBe('(a - (b / 2))');
  });

  it('keeps precedence when the higher operator comes first', () => {
    expect(exprShape('a * b + 2')).toBe('((a * b) + 2)');
  });

  it('builds the multiplication below the addition in the tree', () => {
    // The structural version of the same claim, checked node by node.
    const program = parseOk('int c = a + b * 2;');
    const root = initOf(decl(program, 0));

    if (root.type !== 'BinaryExpr') throw new Error('expected a BinaryExpr');
    expect(root.operator).toBe('+'); // the + is the ROOT
    expect(root.left.type).toBe('Identifier');

    const right = root.right;
    if (right.type !== 'BinaryExpr') throw new Error('expected a nested BinaryExpr');
    expect(right.operator).toBe('*'); // the * is DEEPER
    expect(right.left.type).toBe('Identifier');
    expect(right.right.type).toBe('NumberLiteral');
  });

  it('handles the three statement demo program', () => {
    const program = parseOk('int a = 10;\nint b = 20;\nint c = a + b * 2;');
    expect(program.body.length).toBe(3);
    expect(expressionToString(initOf(decl(program, 0)))).toBe('10');
    expect(expressionToString(initOf(decl(program, 1)))).toBe('20');
    expect(expressionToString(initOf(decl(program, 2)))).toBe('(a + (b * 2))');
  });
});

describe('parser: associativity', () => {
  it('makes subtraction left associative', () => {
    // 20 - 5 - 3  must be  (20 - 5) - 3 = 12,  NOT  20 - (5 - 3) = 18
    expect(exprShape('20 - 5 - 3')).toBe('((20 - 5) - 3)');
  });

  it('makes addition left associative', () => {
    expect(exprShape('1 + 2 + 3')).toBe('((1 + 2) + 3)');
  });

  it('makes division left associative', () => {
    // 100 / 5 / 2  must be  (100 / 5) / 2 = 10,  NOT  100 / (5 / 2)
    expect(exprShape('100 / 5 / 2')).toBe('((100 / 5) / 2)');
  });

  it('makes multiplication left associative', () => {
    expect(exprShape('2 * 3 * 4')).toBe('((2 * 3) * 4)');
  });

  it('nests the left operand deepest in a long chain', () => {
    const program = parseOk('int x = 20 - 5 - 3;');
    const root = initOf(decl(program, 0));
    if (root.type !== 'BinaryExpr') throw new Error('expected a BinaryExpr');
    // The outermost node subtracts 3; its LEFT child is the earlier work.
    expect(root.right.type).toBe('NumberLiteral');
    expect(expressionToString(root.right)).toBe('3');
    expect(root.left.type).toBe('BinaryExpr');
    expect(expressionToString(root.left)).toBe('(20 - 5)');
  });
});

describe('parser: parentheses', () => {
  it('lets parentheses override precedence', () => {
    expect(exprShape('(a + b) * 2')).toBe('((a + b) * 2)');
  });

  it('lets parentheses override associativity', () => {
    expect(exprShape('20 - (5 - 3)')).toBe('(20 - (5 - 3))');
  });

  it('handles redundant parentheses without creating extra nodes', () => {
    expect(exprShape('((((7))))')).toBe('7');
    expect(exprShape('(a + b)')).toBe('(a + b)');
  });

  it('handles nested parentheses', () => {
    expect(exprShape('((a + b) * (c - d)) / 2')).toBe('(((a + b) * (c - d)) / 2)');
  });
});

describe('parser: unary minus', () => {
  it('parses a negative literal', () => {
    expect(exprShape('-5')).toBe('(-5)');
    const program = parseOk('int x = -5;');
    const root = initOf(decl(program, 0));
    expect(root.type).toBe('UnaryExpr');
  });

  it('parses a negated identifier', () => {
    expect(exprShape('-a')).toBe('(-a)');
  });

  it('parses nested unary minus, since factor is right recursive', () => {
    // MiniC has no `--` operator: the scanner emits two MINUS tokens and
    // `factor -> "-" factor` applies twice.
    expect(exprShape('--5')).toBe('(-(-5))');
    expect(exprShape('---5')).toBe('(-(-(-5)))');

    const program = parseOk('int y = --5;');
    const outer = initOf(decl(program, 0));
    if (outer.type !== 'UnaryExpr') throw new Error('expected a UnaryExpr');
    expect(outer.operand.type).toBe('UnaryExpr');
  });

  it('binds unary minus tighter than any binary operator', () => {
    expect(exprShape('-a * b')).toBe('((-a) * b)');
    expect(exprShape('-a + b')).toBe('((-a) + b)');
  });

  it('distinguishes unary minus from binary subtraction', () => {
    // Same MINUS token, two different nodes, decided by grammar position.
    expect(exprShape('a - b')).toBe('(a - b)');
    expect(exprShape('a - -b')).toBe('(a - (-b))');

    const binary = parseOk('int x = a - b;');
    expect(initOf(decl(binary, 0)).type).toBe('BinaryExpr');

    const unary = parseOk('int x = -b;');
    expect(initOf(decl(unary, 0)).type).toBe('UnaryExpr');
  });

  it('applies unary minus to a parenthesised expression', () => {
    expect(exprShape('-(a + b)')).toBe('(-(a + b))');
  });
});

/* ------------------------------------------------------------------ */
/* 14-17: syntax errors                                                */
/* ------------------------------------------------------------------ */

describe('parser: syntax errors', () => {
  it('reports a missing semicolon after a declaration', () => {
    const errors = parseErrors('int a = 10');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).stage).toBe('syntax');
    expect(errorAt(errors, 0).severity).toBe('error');
    expect(errorAt(errors, 0).message).toContain(';');
  });

  it('reports a missing semicolon after an assignment', () => {
    const errors = parseErrors('int a;\na = 10\nint b;');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).message).toContain(';');
  });

  it('reports a missing identifier after int', () => {
    const errors = parseErrors('int = 10;');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).message).toContain('variable name');
  });

  it('reports a missing expression after =', () => {
    const errors = parseErrors('int a = ;');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).message).toContain('expression');
  });

  it('reports a missing closing parenthesis', () => {
    const errors = parseErrors('int a = (1 + 2;');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).message).toContain(')');
  });

  it('reports an unexpected token where a statement should start', () => {
    const errors = parseErrors('+ a;');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).message).toContain('statement');
  });

  it('reports a malformed statement that is an expression, not an assignment', () => {
    const errors = parseErrors('a + b;');
    expect(errors.length).toBe(1);
    expect(errorAt(errors, 0).message).toContain('=');
  });

  it('reports a missing operand between two operators', () => {
    const errors = parseErrors('int a = 1 + * 2;');
    expect(errors.length).toBe(1);
  });

  it('positions the error at the offending token', () => {
    //                        1234567890
    const errors = parseErrors('int a = ;');
    expect(errorAt(errors, 0).line).toBe(1);
    expect(errorAt(errors, 0).column).toBe(9); // the ';'
  });

  it('recovers at the next statement and reports several errors at once', () => {
    const errors = parseErrors('int a = ;\nint b = 2;\nint = 3;');
    // Statement 1 and statement 3 are broken; statement 2 is fine.
    expect(errors.length).toBe(2);
    expect(errorAt(errors, 0).line).toBe(1);
    expect(errorAt(errors, 1).line).toBe(3);
  });

  it('keeps parsing after a bad statement rather than giving up', () => {
    const errors = parseErrors('@ ;\nint b = ;\nint c = ;');
    // The '@' is a lexical error, so the parser sees `; int b = ; int c = ;`
    // and still reports both broken declarations plus the stray semicolon.
    expect(errors.length).toBe(3);
  });

  it('never returns a tree when there are syntax errors', () => {
    const { program } = parseSource('int a = ;');
    expect(program).toBe(null);
  });

  it('does not throw on any malformed input', () => {
    const nasty = [
      ';',
      '=',
      '(',
      ')',
      'int',
      'int a =',
      'a =',
      '((((',
      '))))',
      '- - -',
      'int int int;',
      '* / + -',
      'a b c d',
      'int a = ((1 + 2);',
    ];
    for (const source of nasty) {
      const { tokens } = tokenize(source);
      const result = parse(tokens); // must return, never throw
      expect(result.program).toBe(null);
      expect(result.errors.length > 0).toBe(true);
    }
  });

  it('handles an empty token stream defensively', () => {
    const result = parse([]);
    expect(result.program).toBe(null);
    expect(result.errors.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 18: AST metadata and determinism                                    */
/* ------------------------------------------------------------------ */

describe('parser: AST node metadata', () => {
  it('gives every node an id, line, column, start and end', () => {
    const program = parseOk('int c = a + b * 2;');

    const seen: string[] = [];
    function visit(node: Expr): void {
      expect(typeof node.id).toBe('string');
      expect(node.id.length > 0).toBe(true);
      expect(node.line >= 1).toBe(true);
      expect(node.column >= 1).toBe(true);
      expect(node.end >= node.start).toBe(true);
      seen.push(node.id);
      if (node.type === 'BinaryExpr') {
        visit(node.left);
        visit(node.right);
      } else if (node.type === 'UnaryExpr') {
        visit(node.operand);
      }
    }

    visit(initOf(decl(program, 0)));
    // a, b, 2, (b*2), (a + ...) = 5 expression nodes, all with unique ids.
    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('gives node spans that slice back to the source text', () => {
    const source = 'int total = a + b * 2;';
    const program = parseOk(source);
    const node = decl(program, 0);
    expect(source.slice(node.start, node.end)).toBe(source);
    expect(source.slice(initOf(node).start, initOf(node).end)).toBe('a + b * 2');
  });

  it('records the identifier position separately from the statement position', () => {
    const program = parseOk('int total = 1;');
    const node = decl(program, 0);
    expect(node.column).toBe(1); // the 'int' keyword
    expect(node.nameColumn).toBe(5); // the name 'total'
  });

  it('tracks line numbers across a multi line program', () => {
    const program = parseOk('int a = 1;\nint b = 2;\nc = 3;');
    expect(stmt(program, 0).line).toBe(1);
    expect(stmt(program, 1).line).toBe(2);
    expect(stmt(program, 2).line).toBe(3);
  });

  it('produces identical trees for repeated parses (deterministic ids)', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b * 2;\nint d = -(a - b);';
    expect(parseOk(source)).toEqual(parseOk(source));
  });

  it('assigns node ids in a stable order', () => {
    const first = parseOk('int c = a + b;');
    const second = parseOk('int c = a + b;');
    const idsOf = (program: Program): string[] => {
      const node = decl(program, 0);
      const root = initOf(node);
      if (root.type !== 'BinaryExpr') throw new Error('expected a BinaryExpr');
      return [root.left.id, root.right.id, root.id, node.id, program.id];
    };
    expect(idsOf(first)).toEqual(idsOf(second));
    // Children are constructed before their parent, so their ids come first.
    expect(idsOf(first)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
  });
});
