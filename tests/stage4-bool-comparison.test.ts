/** Stage 4: bool type and relational/equality operators. */
import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { TokenType } from '../src/compiler/lexer/tokens.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { compile } from '../src/compiler/pipeline.ts';

function astOf(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.program).not.toBeNull();
  return parsed.program!;
}

function semanticOf(source: string) {
  return analyze(astOf(source));
}

describe('Stage 4: lexer', () => {
  it('recognizes bool and boolean literals', () => {
    const result = tokenize('bool a = true; bool b = false;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map(t => t.type)).toEqual([
      TokenType.BOOL, TokenType.IDENTIFIER, TokenType.ASSIGN, TokenType.TRUE, TokenType.SEMICOLON,
      TokenType.BOOL, TokenType.IDENTIFIER, TokenType.ASSIGN, TokenType.FALSE, TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('recognizes all six comparison/equality operators', () => {
    const result = tokenize('a < b; a > b; a <= b; a >= b; a == b; a != b;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.filter(t => [TokenType.LT, TokenType.GT, TokenType.LE, TokenType.GE, TokenType.EQ, TokenType.NE].includes(t.type)).map(t => t.type)).toEqual([
      TokenType.LT, TokenType.GT, TokenType.LE, TokenType.GE, TokenType.EQ, TokenType.NE,
    ]);
  });

  it('accepts ! as the logical NOT operator', () => {
    const result = tokenize('bool x = !true;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.some(t => t.type === TokenType.BANG)).toBe(true);
  });
});

describe('Stage 4: parser', () => {
  it('parses bool declarations and comparison expressions', () => {
    const program = astOf('bool x = 10 < 20;');
    const stmt = program.body[0]!;
    expect(stmt.type).toBe('VarDecl');
    if (stmt.type === 'VarDecl') {
      expect(stmt.varType).toBe('bool');
      expect(stmt.init?.type).toBe('BinaryExpr');
      if (stmt.init?.type === 'BinaryExpr') expect(stmt.init.operator).toBe('<');
    }
  });

  it('gives arithmetic higher precedence than comparison', () => {
    const program = astOf('bool x = 1 + 2 * 3 < 10;');
    const stmt = program.body[0]!;
    if (stmt.type !== 'VarDecl' || stmt.init?.type !== 'BinaryExpr') throw new Error('unexpected AST');
    expect(stmt.init.operator).toBe('<');
    expect(stmt.init.left.type).toBe('BinaryExpr');
    if (stmt.init.left.type !== 'BinaryExpr') throw new Error('unexpected AST');
    expect(stmt.init.left.operator).toBe('+');
    expect(stmt.init.left.right.type).toBe('BinaryExpr');
    if (stmt.init.left.right.type === 'BinaryExpr') expect(stmt.init.left.right.operator).toBe('*');
  });

  it('rejects chained comparisons', () => {
    const result = parse(tokenize('bool x = 1 < 2 < 3;').tokens);
    expect(result.program).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('Stage 4: semantic analysis', () => {
  it('accepts bool literals and stores bool symbols', () => {
    const result = semanticOf('bool a = true; bool b = false;');
    expect(result.errors).toHaveLength(0);
    expect(result.symbols.map(s => s.type)).toEqual(['bool', 'bool']);
  });

  it('accepts numeric comparisons and returns bool', () => {
    const result = semanticOf('int a = 10; float b = 10.5; bool c = a < b;');
    expect(result.errors).toHaveLength(0);
    expect(result.symbols.find(s => s.name === 'c')?.type).toBe('bool');
  });

  it('accepts bool equality and inequality', () => {
    expect(semanticOf('bool a = true; bool b = false; bool c = a == b;').errors).toHaveLength(0);
    expect(semanticOf('bool a = true; bool b = false; bool c = a != b;').errors).toHaveLength(0);
  });

  it('rejects assigning numeric values to bool', () => {
    expect(semanticOf('bool x = 10;').errors.length).toBeGreaterThan(0);
    expect(semanticOf('float x = 10.5; bool y = x;').errors.length).toBeGreaterThan(0);
  });

  it('rejects assigning bool to numeric types', () => {
    expect(semanticOf('bool x = true; int y = x;').errors.length).toBeGreaterThan(0);
    expect(semanticOf('bool x = true; float y = x;').errors.length).toBeGreaterThan(0);
  });

  it('rejects bool arithmetic and unary minus', () => {
    expect(semanticOf('bool x = true; int y = x + 1;').errors.length).toBeGreaterThan(0);
    expect(semanticOf('bool x = true; int y = -x;').errors.length).toBeGreaterThan(0);
  });

  it('rejects relational comparison between incompatible bool and numeric operands', () => {
    expect(semanticOf('bool x = true < 1;').errors.length).toBeGreaterThan(0);
  });
});

describe('Stage 4: TAC and optimization', () => {
  it('generates a bool comparison result in TAC', () => {
    const tac = generateTAC(astOf('bool x = 10 < 20;'));
    expect(formatTAC(tac)).toBe('t1 = 10 < 20\nx = t1');
    expect(tac.instructions[0]?.targetType).toBe('bool');
    expect(tac.instructions[0]?.kind === 'binary' && tac.instructions[0].operator).toBe('<');
  });

  it('folds constant comparisons to true/false', () => {
    const result = compile('bool a = 10 < 20; bool b = 10 == 20; bool c = 10 != 20;');
    expect(result.errors).toHaveLength(0);
    expect(formatTAC(result.optimizedTac!)).toBe([
      't1 = true', 'a = t1',
      't2 = false', 'b = t2',
      't3 = true', 'c = t3',
    ].join('\n'));
  });

  it('folds float comparisons correctly', () => {
    const result = compile('bool x = 10.5 > 5.5;');
    expect(result.errors).toHaveLength(0);
    expect(formatTAC(result.optimizedTac!)).toBe('t1 = true\nx = t1');
  });

  it('preserves mixed int/float comparison semantics', () => {
    const result = compile('int x = 10; float y = 10.5; bool z = x < y;');
    expect(result.errors).toHaveLength(0);
    expect(result.optimizedTac).not.toBeNull();
  });

  it('keeps existing integer and float division behavior', () => {
    expect(formatTAC(compile('int x = 7 / 2;').optimizedTac!)).toBe('t1 = 3\nx = t1');
    expect(formatTAC(compile('float x = 7.0 / 2.0;').optimizedTac!)).toBe('t1 = 3.5\nx = t1');
  });

  it('keeps division-by-zero protection', () => {
    const result = compile('float x = 10.0; float y = 0.0; float z = x / y;');
    expect(result.divisionByZeroErrors).toHaveLength(1);
    expect(result.optimizedTac).toBeNull();
  });
});
