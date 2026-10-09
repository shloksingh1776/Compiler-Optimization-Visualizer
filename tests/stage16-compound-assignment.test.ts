import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { TokenType } from '../src/compiler/lexer/tokens.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { compile } from '../src/compiler/pipeline.ts';

function parseSource(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const result = parse(lex.tokens);
  expect(result.errors).toHaveLength(0);
  expect(result.program).not.toBeNull();
  return result.program!;
}

describe('Stage 16: compound assignment', () => {
  it('lexes all five compound assignment operators', () => {
    const result = tokenize('a += 1; b -= 1; c *= 2; d /= 2; e %= 2;');
    expect(result.errors).toHaveLength(0);
    const compoundTypes: TokenType[] = [TokenType.PLUS_ASSIGN, TokenType.MINUS_ASSIGN, TokenType.STAR_ASSIGN, TokenType.SLASH_ASSIGN, TokenType.PERCENT_ASSIGN];
    expect(result.tokens.filter(t => compoundTypes.includes(t.type)).map(t => t.type)).toEqual([
      TokenType.PLUS_ASSIGN, TokenType.MINUS_ASSIGN, TokenType.STAR_ASSIGN, TokenType.SLASH_ASSIGN, TokenType.PERCENT_ASSIGN,
    ]);
  });

  it('parses compound assignment into Assignment nodes with operators', () => {
    const program = parseSource('int a = 1; a += 2; a -= 1;');
    expect(program.body.map(s => s.type)).toEqual(['VarDecl', 'Assignment', 'Assignment']);
    expect((program.body[1] as any).compoundOperator).toBe('+=');
    expect((program.body[2] as any).compoundOperator).toBe('-=');
  });

  it('executes all five compound operators', () => {
    const result = compile('int x = 10; x += 5; x -= 2; x *= 3; x /= 2; x %= 4; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['3']);
  });

  it('supports float compound arithmetic except modulo', () => {
    const result = compile('float x = 5.5; x += 1.0; x *= 2; x -= 1.0; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['12']);
  });

  it('lowers compound assignment to binary TAC followed by copy', () => {
    const program = parseSource('int x = 10; x += 5;');
    const tac = generateTAC(program);
    expect(formatTAC(tac)).toContain('t1 = x + 5');
    expect(formatTAC(tac)).toContain('x = t1');
  });

  it('rejects compound assignment to bool', () => {
    const program = parseSource('bool b = true; b += 1;');
    expect(analyze(program).errors.some(e => e.message.includes('numeric target'))).toBe(true);
  });

  it('rejects bool right-hand expressions for compound assignment', () => {
    const program = parseSource('int x = 1; bool b = true; x += b;');
    expect(analyze(program).errors.some(e => e.message.includes('numeric right-hand'))).toBe(true);
  });

  it('requires integer operands for %= ', () => {
    const program = parseSource('float x = 5.5; x %= 2;');
    expect(analyze(program).errors.some(e => e.message.includes("'%=' requires an int target"))).toBe(true);
  });

  it('rejects assignment to an undeclared variable', () => {
    const result = compile('x += 2;');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('works with while loops and increment/decrement', () => {
    const result = compile('int i = 0; int sum = 0; while (i < 4) { sum += i; i++; } print(sum);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['6']);
  });

  it('keeps existing plain assignment semantics', () => {
    const result = compile('int x = 1; x = x + 4; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['5']);
  });
});
