import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { TokenType } from '../src/compiler/lexer/tokens.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { executeTAC } from '../src/compiler/interpreter.ts';
import { compile } from '../src/compiler/pipeline.ts';

function astOf(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.program).not.toBeNull();
  return parsed.program!;
}

describe('Stage 7 - return statements', () => {
  it('lexes return as a keyword', () => {
    const result = tokenize('return 10;');
    expect(result.tokens.map(t => t.type)).toEqual([TokenType.RETURN, TokenType.NUMBER, TokenType.SEMICOLON, TokenType.EOF]);
  });

  it('parses return statements', () => {
    const program = astOf('return 10 + 5;');
    expect(program.body[0]?.type).toBe('ReturnStmt');
  });

  it('semantically accepts int, float and bool returns', () => {
    for (const source of ['return 10;', 'return 10.5;', 'return true;']) {
      const result = analyze(astOf(source));
      expect(result.errors).toHaveLength(0);
    }
  });

  it('generates return TAC', () => {
    const tac = generateTAC(astOf('return 10;'));
    expect(formatTAC(tac)).toBe('return 10');
  });

  it('executes an integer return', () => {
    expect(executeTAC(generateTAC(astOf('return 10 + 5;'))).returnValue).toBe(15);
  });

  it('executes float and bool returns', () => {
    expect(executeTAC(generateTAC(astOf('return 10.5;'))).returnValue).toBe(10.5);
    expect(executeTAC(generateTAC(astOf('return true;'))).returnValue).toBe(true);
  });

  it('returns a variable value', () => {
    const result = compile('int x = 10; return x + 20;');
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(30);
  });

  it('stops execution at return', () => {
    const result = compile('print(10); return 20; print(30);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
    expect(result.returnValue).toBe(20);
  });

  it('returns from the selected if branch', () => {
    const source = 'int a = 10; int b = 20; if (a < b) { return 100; } else { return 200; }';
    const result = compile(source);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(100);
  });

  it('returns from the else branch when condition is false', () => {
    const source = 'int a = 30; int b = 20; if (a < b) { return 100; } else { return 200; }';
    const result = compile(source);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(200);
  });

  it('preserves print output before a branch return', () => {
    const result = compile('int a = 10; if (a > 5) { print(a); return a + 5; } else { print(0); return 0; }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
    expect(result.returnValue).toBe(15);
  });

  it('reports a missing return expression', () => {
    const result = compile('return;');
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
    expect(result.tac).toBeNull();
  });

  it('reports a missing return semicolon', () => {
    const result = compile('return 10');
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });

  it('reports an undeclared variable in return', () => {
    const result = compile('return x;');
    expect(result.semanticErrors.some(e => e.message.includes('Undeclared variable'))).toBe(true);
  });

  it('propagates constants into return values', () => {
    const result = compile('int x = 10; return x;');
    expect(result.returnValue).toBe(10);
    expect(result.optimizedTac && formatTAC(result.optimizedTac)).toContain('return 10');
  });

  it('preserves division-by-zero diagnostics in return expressions', () => {
    const result = compile('return 10 / 0;');
    expect(result.divisionByZeroErrors.length).toBe(1);
    expect(result.optimizedTac).toBeNull();
  });

  it('does not regress programs without return', () => {
    const result = compile('int x = 10; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
    expect(result.returnValue).toBeUndefined();
  });
});
