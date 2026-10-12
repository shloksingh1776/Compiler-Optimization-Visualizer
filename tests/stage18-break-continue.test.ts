import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { compile } from '../src/compiler/pipeline.ts';
import { formatAstTree } from '../src/components/astTree.ts';

function astOf(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.program).not.toBeNull();
  return parsed.program!;
}

describe('Stage 18 - break and continue', () => {
  it('recognizes break and continue as keywords', () => {
    const result = tokenize('break; continue;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map(t => t.type)).toContain('BREAK');
    expect(result.tokens.map(t => t.type)).toContain('CONTINUE');
  });

  it('parses both loop-control statements and shows them in the AST', () => {
    const ast = astOf('while (true) { break; continue; }');
    const tree = formatAstTree(ast);
    expect(tree).toContain('BreakStmt: break');
    expect(tree).toContain('ContinueStmt: continue');
  });

  it('break exits a while loop immediately', () => {
    const result = compile(`int i = 0; while (i < 5) { i++; if (i == 3) { break; } print(i); } print(99);`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '2', '99']);
  });

  it('continue in a while loop returns to its condition', () => {
    const result = compile(`int i = 0; while (i < 5) { i++; if (i == 2) { continue; } print(i); }`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '3', '4', '5']);
  });

  it('break exits a for loop without running further iterations', () => {
    const result = compile(`for (int i = 0; i < 5; i++) { if (i == 3) { break; } print(i); } print(100);`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1', '2', '100']);
  });

  it('continue in a for loop still executes the update expression', () => {
    const result = compile(`int sum = 0; for (int i = 0; i < 5; i++) { if (i == 2) { continue; } sum += i; } print(sum);`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['8']);
  });

  it('nested loops control only the nearest loop', () => {
    const result = compile(`int i = 0; int count = 0; for (i = 0; i < 3; i++) { int j = 0; while (j < 3) { j++; if (j == 2) { break; } count++; } } print(count);`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['3']);
  });

  it('continue inside an inner for loop targets the inner update', () => {
    const result = compile(`int count = 0; for (int i = 0; i < 2; i++) { for (int j = 0; j < 3; j++) { if (j == 1) { continue; } count++; } } print(count);`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['4']);
  });

  it('allows break and continue inside if blocks nested in loops', () => {
    const result = compile(`int i = 0; while (i < 5) { i++; if (i == 2) { continue; } if (i == 4) { break; } print(i); }`);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '3']);
  });

  it('rejects break outside any loop', () => {
    const result = compile('break; print(1);');
    expect(result.errors.some(e => e.message.includes("'break' can only be used inside a loop"))).toBe(true);
  });

  it('rejects continue outside any loop', () => {
    const result = compile('continue; print(1);');
    expect(result.errors.some(e => e.message.includes("'continue' can only be used inside a loop"))).toBe(true);
  });

  it('does not allow an enclosing loop to authorize break inside a function', () => {
    const result = compile(`while (false) { int f() { break; return 1; } }`);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.message.includes("'break' can only be used inside a loop"))).toBe(true);
  });

  it('does not allow an enclosing loop to authorize continue inside a function', () => {
    const result = compile(`for (;;) { int f() { continue; return 1; } }`);
    expect(result.errors.some(e => e.message.includes("'continue' can only be used inside a loop"))).toBe(true);
  });

  it('preserves break/continue behavior when optimization is enabled', () => {
    const source = `int sum = 0; for (int i = 0; i < 6; i++) { if (i == 2) { continue; } if (i == 5) { break; } sum += i; } print(sum);`;
    const result = compile(source);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['8']);
    expect(result.optimizedTac).not.toBeNull();
  });
});
