import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { optimize } from '../src/compiler/optimizer/optimizer.ts';
import { compile } from '../src/compiler/pipeline.ts';
import { executeTAC } from '../src/compiler/interpreter.ts';

function tacOf(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toEqual([]);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toEqual([]);
  expect(parsed.program).not.toBeNull();
  const semantic = analyze(parsed.program!);
  expect(semantic.errors).toEqual([]);
  return generateTAC(parsed.program!);
}

describe('Stage 5: print()', () => {
  it('lexes and parses print as a statement', () => {
    const result = compile('int x = 10; print(x);');
    expect(result.errors).toEqual([]);
    expect(result.ast?.body[1]?.type).toBe('PrintStmt');
  });

  it('generates a print TAC instruction', () => {
    const tac = tacOf('int x = 10; print(x);');
    expect(formatTAC(tac)).toBe('x = 10\nprint x');
    expect(tac.instructions.at(-1)?.kind).toBe('print');
  });

  it('prints an int value', () => {
    expect(compile('int x = 10; print(x);').output).toEqual(['10']);
  });

  it('prints a float value', () => {
    expect(compile('float x = 10.5; print(x);').output).toEqual(['10.5']);
  });

  it('prints a bool value', () => {
    expect(compile('bool x = true; print(x);').output).toEqual(['true']);
  });

  it('prints multiple values in source order', () => {
    const source = 'int x = 10; float y = 2.5; bool z = true; print(x); print(y); print(z);';
    expect(compile(source).output).toEqual(['10', '2.5', 'true']);
  });

  it('executes optimized TAC, so constant folding still produces the printed value', () => {
    const result = compile('int x = 10 + 20; print(x);');
    expect(formatTAC(result.optimizedTac!)).toBe('x = 30\nprint 30');
    expect(result.output).toEqual(['30']);
  });

  it('constant propagation preserves print and supplies its known value', () => {
    const result = compile('int x = 10; int y = x + 5; print(y);');
    expect(formatTAC(result.optimizedTac!)).toContain('print 15');
    expect(result.output).toEqual(['15']);
  });

  it('DCE never removes print or the computation needed by print', () => {
    const result = compile('int a = 10; int b = 20; int x = a + b; print(x);');
    expect(formatTAC(result.optimizedTac!)).toContain('print 30');
    expect(result.output).toEqual(['30']);
  });

  it('prints a float result of arithmetic', () => {
    expect(compile('float x = 7.0 / 2.0; print(x);').output).toEqual(['3.5']);
  });

  it('prints a comparison result', () => {
    expect(compile('bool x = 10 < 20; print(x);').output).toEqual(['true']);
  });

  it('reports an undeclared variable used by print', () => {
    const result = compile('print(x);');
    expect(result.semanticErrors.length).toBeGreaterThan(0);
    expect(result.output).toEqual([]);
    expect(result.tac).toBeNull();
  });

  it('preserves print through the standalone optimizer', () => {
    const tac = tacOf('int x = 10; print(x);');
    const optimized = optimize(tac);
    expect(formatTAC(optimized)).toBe('x = 10\nprint 10');
    expect(executeTAC(optimized).output).toEqual(['10']);
  });

  it('supports printing an expression directly', () => {
    const result = compile('print(10 + 5);');
    expect(result.errors).toEqual([]);
    expect(result.output).toEqual(['15']);
  });

  it('supports printing a mixed numeric expression', () => {
    const result = compile('int x = 10; print(x + 2.5);');
    expect(result.errors).toEqual([]);
    expect(result.output).toEqual(['12.5']);
  });

  it('does not create output for a program with no print statement', () => {
    expect(compile('int x = 10;').output).toEqual([]);
  });
});


describe('Stage 5: runtime edge cases', () => {
  it('does not crash when print reads an uninitialized variable', () => {
    const result = compile('int a;\nprint(a);');
    expect(result.tac).not.toBeNull();
    expect(result.optimizedTac).not.toBeNull();
    expect(result.output).toEqual([]);
    expect(result.runtimeError).toBe("Runtime value for 'a' is unavailable");
  });
});
