import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
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

describe('Stage 17 - for loops', () => {
  it('recognizes for as a keyword', () => {
    const result = tokenize('for (int i = 0; i < 3; i++) { print(i); }');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map(t => t.type)).toContain('FOR');
  });

  it('parses initializer, condition, update, and body', () => {
    const ast = astOf('for (int i = 0; i < 3; i++) { print(i); }');
    const loop = ast.body[0] as any;
    expect(loop.type).toBe('ForStmt');
    expect(loop.initializer.type).toBe('VarDecl');
    expect(loop.condition.type).toBe('BinaryExpr');
    expect(loop.update.type).toBe('IncrementStmt');
    expect(loop.body).toHaveLength(1);
  });

  it('executes a basic counting loop', () => {
    const result = compile('for (int i = 0; i < 3; i++) { print(i); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1', '2']);
  });

  it('supports compound assignment in the body', () => {
    const result = compile('int sum = 0; for (int i = 0; i < 5; i++) { sum += i; } print(sum);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
  });

  it('executes zero times when the initial condition is false', () => {
    const result = compile('for (int i = 10; i < 5; i++) { print(i); } print(99);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['99']);
  });

  it('supports an assignment update', () => {
    const result = compile('int i = 0; for (; i < 3; i = i + 1) { print(i); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1', '2']);
  });

  it('supports omitted initializer and update', () => {
    const result = compile('int i = 0; for (; i < 2;) { print(i); i++; }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1']);
  });

  it('supports a loop with an omitted condition', () => {
    const result = compile('int i = 0; for (;;) { print(i); i++; if (i >= 2) { return i; } }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1']);
    expect(result.returnValue).toBe(2);
  });

  it('supports nested for loops', () => {
    const result = compile('for (int i = 0; i < 2; i++) { for (int j = 0; j < 2; j++) { print(i + j); } }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1', '1', '2']);
  });

  it('supports a for loop inside a function', () => {
    const result = compile('int sumTo(int n) { int sum = 0; for (int i = 1; i <= n; i++) { sum += i; } return sum; } print(sumTo(4));');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
  });

  it('requires a bool condition', () => {
    const result = compile('int i = 0; for (; i; i++) { print(i); }');
    expect(result.errors.some(e => e.message.includes('For condition must be a bool expression'))).toBe(true);
  });

  it('generates labels and conditional jumps in TAC', () => {
    const text = formatTAC(generateTAC(astOf('for (int i = 0; i < 2; i++) { print(i); }')));
    expect(text).toContain('ifFalse');
    expect(text).toContain('goto L0');
    expect(text).toContain('L1:');
  });

  it('shows the for loop in the AST visualizer', () => {
    const tree = formatAstTree(astOf('for (int i = 0; i < 2; i++) { print(i); }'));
    expect(tree).toContain('ForStmt: for');
    expect(tree).toContain('Initializer');
    expect(tree).toContain('Condition');
    expect(tree).toContain('Update');
    expect(tree).toContain('ForBody');
  });

  it('rejects an undeclared loop variable', () => {
    const result = compile('for (i = 0; i < 2; i++) { print(i); }');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('keeps while-loop behavior intact', () => {
    const result = compile('int i = 0; while (i < 2) { print(i); i++; }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1']);
  });
});
