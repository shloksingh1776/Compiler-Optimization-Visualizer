import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
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

describe('Stage 6 - if/else', () => {
  it('lexes if, else and braces', () => {
    const { tokens, errors } = tokenize('if (true) { print(1); } else { print(2); }');
    expect(errors).toHaveLength(0);
    expect(tokens.map(t => t.type)).toContain('IF');
    expect(tokens.map(t => t.type)).toContain('ELSE');
    expect(tokens.map(t => t.type)).toContain('LBRACE');
    expect(tokens.map(t => t.type)).toContain('RBRACE');
  });

  it('parses if with no else', () => {
    const ast = astOf('if (true) { print(1); }');
    expect(ast.body[0]?.type).toBe('IfStmt');
    expect((ast.body[0] as any).elseBranch).toBeNull();
  });

  it('parses if/else blocks', () => {
    const ast = astOf('if (true) { print(1); } else { print(2); }');
    const stmt = ast.body[0] as any;
    expect(stmt.type).toBe('IfStmt');
    expect(stmt.thenBranch).toHaveLength(1);
    expect(stmt.elseBranch).toHaveLength(1);
  });

  it('requires a bool condition', () => {
    const ast = astOf('int x = 1; if (x) { print(1); }');
    const result = analyze(ast);
    expect(result.errors.some(e => e.message.includes('If condition must be a bool expression'))).toBe(true);
  });

  it('generates conditional and unconditional jumps', () => {
    const tac = generateTAC(astOf('if (true) { print(1); } else { print(2); }'));
    const text = formatTAC(tac);
    expect(text).toContain('ifFalse true goto L0');
    expect(text).toContain('goto L1');
    expect(text).toContain('L0:');
    expect(text).toContain('L1:');
  });

  it('executes the true branch', () => {
    const result = compile('int a=10; int b=20; if (a < b) { print(a+b); } else { print(a-b); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['30']);
  });

  it('executes the false branch', () => {
    const result = compile('int a=30; int b=20; if (a < b) { print(a+b); } else { print(a-b); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
  });

  it('executes an if without else', () => {
    const result = compile('if (false) { print(1); } print(2);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['2']);
  });

  it('supports nested if statements', () => {
    const result = compile('int a=10; if (a>5) { if (a<20) { print(7); } else { print(8); } }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['7']);
  });

  it('keeps branch TAC safe from straight-line optimizations', () => {
    const result = compile('int a=10; if (a > 5) { print(1); } else { print(2); }');
    expect(result.optimizedTac).not.toBeNull();
    expect(formatTAC(result.optimizedTac!)).toContain('ifFalse');
    expect(formatTAC(result.optimizedTac!)).toContain('L0:');
  });

  it('reports runtime errors without crashing for uninitialized branch prints', () => {
    const result = compile('int x; if (true) { print(x); }');
    expect(result.errors).toHaveLength(0);
    expect(result.runtimeError).toContain("Runtime value for 'x' is unavailable");
  });

  it('reports direct division by zero inside a branch', () => {
    const result = compile('if (true) { print(10 / 0); }');
    expect(result.divisionByZeroErrors).toHaveLength(1);
    expect(result.optimizedTac).toBeNull();
  });
});
