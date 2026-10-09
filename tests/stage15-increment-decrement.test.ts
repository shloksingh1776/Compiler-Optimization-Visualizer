import { describe, expect, it } from 'vitest';
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

describe('Stage 15: postfix increment/decrement', () => {
  it('lexes ++ and -- as dedicated tokens', () => {
    const result = tokenize('i++; j--; k + + 1; m - - 1;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map(t => t.type)).toEqual([
      TokenType.IDENTIFIER, TokenType.INCREMENT, TokenType.SEMICOLON,
      TokenType.IDENTIFIER, TokenType.DECREMENT, TokenType.SEMICOLON,
      TokenType.IDENTIFIER, TokenType.PLUS, TokenType.PLUS, TokenType.NUMBER, TokenType.SEMICOLON,
      TokenType.IDENTIFIER, TokenType.MINUS, TokenType.MINUS, TokenType.NUMBER, TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('parses postfix increment/decrement statements', () => {
    const program = astOf('int i = 0; i++; i--;');
    expect(program.body.map(s => s.type)).toEqual(['VarDecl', 'IncrementStmt', 'IncrementStmt']);
    const inc = program.body[1] as Extract<(typeof program.body)[number], { type: 'IncrementStmt' }>;
    const dec = program.body[2] as Extract<(typeof program.body)[number], { type: 'IncrementStmt' }>;
    expect(inc.operator).toBe('++');
    expect(dec.operator).toBe('--');
    expect(inc.name).toBe('i');
  });

  it('rejects prefix ++/-- in this stage', () => {
    const lex = tokenize('++i; --i;');
    expect(lex.errors).toHaveLength(0);
    const parsed = parse(lex.tokens);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('requires ++/-- to be followed by a semicolon', () => {
    const parsed = parse(tokenize('int i = 0; i++').tokens);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('reports undeclared increment/decrement targets', () => {
    const program = astOf('x++;');
    const result = analyze(program);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('undeclared variable');
  });

  it('rejects increment/decrement on bool variables', () => {
    const program = astOf('bool b = true; b++;');
    const result = analyze(program);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('requires a numeric variable');
  });

  it('accepts increment/decrement on int and float variables', () => {
    const program = astOf('int i = 1; float x = 1.5; i++; x--;');
    expect(analyze(program).errors).toHaveLength(0);
  });

  it('lowers ++ to binary add followed by a copy', () => {
    const tac = generateTAC(astOf('int i = 1; i++;'));
    expect(formatTAC(tac)).toContain('t1 = i + 1');
    expect(formatTAC(tac)).toContain('i = t1');
  });

  it('lowers -- to binary subtract followed by a copy', () => {
    const tac = generateTAC(astOf('int i = 1; i--;'));
    expect(formatTAC(tac)).toContain('t1 = i - 1');
    expect(formatTAC(tac)).toContain('i = t1');
  });

  it('executes ++ and -- with the expected final value', () => {
    const result = compile('int i = 10; i++; i++; i--; print(i);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['11']);
  });

  it('works inside a while loop', () => {
    const result = compile(`
      int i = 0;
      while (i < 3) {
        i++;
      }
      print(i);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['3']);
  });

  it('works inside a function body', () => {
    const result = compile(`
      int f(int x) {
        x++;
        x--;
        x++;
        return x;
      }
      int r = f(5);
      print(r);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['6']);
  });

  it('does not reinterpret separated + or - tokens as increment/decrement', () => {
    const result = tokenize('i + + 1; i - - 1;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map(t => t.type)).toEqual([
      TokenType.IDENTIFIER, TokenType.PLUS, TokenType.PLUS, TokenType.NUMBER, TokenType.SEMICOLON,
      TokenType.IDENTIFIER, TokenType.MINUS, TokenType.MINUS, TokenType.NUMBER, TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('allows optimizer passes to process the lowered TAC normally', () => {
    const result = compile('int i = 1; i++; print(i);');
    expect(result.errors).toHaveLength(0);
    expect(result.optimizedTac).not.toBeNull();
    expect(result.output).toEqual(['2']);
  });
});
