import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { compile } from '../src/compiler/pipeline.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatAstTree } from '../src/components/astTree.ts';

function astOf(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.program).not.toBeNull();
  return parsed.program!;
}

describe('Stage 20 - switch/case', () => {
  it('recognizes switch, case, and default as keywords', () => {
    const result = tokenize('switch case default');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map(t => t.type)).toContain('SWITCH');
    expect(result.tokens.map(t => t.type)).toContain('CASE');
    expect(result.tokens.map(t => t.type)).toContain('DEFAULT');
  });

  it('parses switch labels and displays them in the AST', () => {
    const ast = astOf('int n = 2; switch (n) { case 1: print(10); break; case 2: print(20); break; default: print(99); }');
    const node = ast.body[1] as any;
    expect(node.type).toBe('SwitchStmt');
    expect(node.cases.map((entry: any) => entry.value)).toEqual([1, 2, null]);
    const tree = formatAstTree(ast);
    expect(tree).toContain('SwitchStmt: switch');
    expect(tree).toContain('Case: 1');
    expect(tree).toContain('DefaultCase: default');
  });

  it('executes the matching case and exits at break', () => {
    const result = compile('int n = 2; switch (n) { case 1: print(10); break; case 2: print(20); break; default: print(99); } print(7);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20', '7']);
  });

  it('executes default when no case matches', () => {
    const result = compile('int n = 8; switch (n) { case 1: print(10); break; default: print(99); break; }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['99']);
  });

  it('allows a switch without default', () => {
    const result = compile('int n = 8; switch (n) { case 1: print(10); break; } print(99);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['99']);
  });

  it('preserves C-like fall-through when a case has no break', () => {
    const result = compile('int n = 1; switch (n) { case 1: print(1); case 2: print(2); break; default: print(3); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '2']);
  });

  it('supports negative integer case labels', () => {
    const result = compile('int n = -2; switch (n) { case -2: print(20); break; default: print(0); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20']);
  });

  it('supports switch inside a loop and break exits only the switch', () => {
    const result = compile('int i = 0; while (i < 3) { i++; switch (i) { case 2: break; default: print(i); break; } print(9); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '9', '9', '3', '9']);
  });

  it('supports break inside a loop nested in a switch', () => {
    const result = compile('int n = 1; switch (n) { case 1: for (int i = 0; i < 3; i++) { if (i == 1) { break; } print(i); } print(8); break; default: print(0); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '8']);
  });

  it('continue inside switch still targets the enclosing loop', () => {
    const result = compile('int i = 0; while (i < 4) { i++; switch (i) { case 2: continue; default: print(i); break; } print(9); }');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '9', '3', '9', '4', '9']);
  });

  it('supports switch inside a function', () => {
    const result = compile('int classify(int n) { switch (n) { case 1: return 10; case 2: return 20; default: return 0; } } print(classify(2)); print(classify(9));');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20', '0']);
  });

  it('rejects duplicate case values', () => {
    const result = compile('int n = 1; switch (n) { case 1: print(1); break; case 1: print(2); break; }');
    expect(result.errors.some(e => e.message.includes('Duplicate case value'))).toBe(true);
  });

  it('rejects multiple default labels', () => {
    const result = compile('int n = 1; switch (n) { default: print(1); break; default: print(2); break; }');
    expect(result.errors.some(e => e.message.includes('only one'))).toBe(true);
  });

  it('requires an int switch expression', () => {
    const result = compile('bool flag = true; switch (flag) { case 1: print(1); break; }');
    expect(result.errors.some(e => e.message.includes('Switch expression must have type int'))).toBe(true);
  });

  it('rejects floating-point case labels', () => {
    const result = compile('int n = 1; switch (n) { case 1.5: print(1); break; }');
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });

  it('rejects break outside loops and switches', () => {
    const result = compile('break;');
    expect(result.errors.some(e => e.message.includes("'break' can only be used inside a loop or switch"))).toBe(true);
  });

  it('rejects continue in a switch when no loop encloses it', () => {
    const result = compile('int n = 1; switch (n) { case 1: continue; }');
    expect(result.errors.some(e => e.message.includes("'continue' can only be used inside a loop"))).toBe(true);
  });

  it('generates comparison and jump instructions for switch dispatch', () => {
    const text = formatTAC(generateTAC(astOf('int n = 2; switch (n) { case 1: print(1); break; default: print(0); }')));
    expect(text).toContain(' == 1');
    expect(text).toContain('ifFalse');
    expect(text).toContain('goto L');
  });

  it('preserves switch behavior with optimization enabled', () => {
    const result = compile('int n = 2; int answer = 0; switch (n) { case 1: answer = 10; break; case 2: answer = 20 + 0; break; default: answer = 99; } print(answer);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20']);
    expect(result.optimizedTac).not.toBeNull();
  });
});
