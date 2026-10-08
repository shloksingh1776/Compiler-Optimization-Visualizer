import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/pipeline.ts';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';

function run(source: string) {
  return compile(source);
}

describe('Stage 8 - basic functions', () => {
  it('exposes function body TAC separately from main TAC', () => {
    const r = run('int add(int a, int b) { int result = a + b; return result; } int x = add(10, 20); print(x);');
    expect(r.tac?.instructions.map(i => i.kind)).toEqual(['call', 'copy', 'print']);
    expect(r.tac?.functions?.add?.instructions.map(i => i.kind)).toEqual(['param', 'param', 'binary', 'copy', 'return']);
    expect(r.tac?.functions?.add?.parameters).toEqual([{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }]);
  });

  it('exposes local function symbols without changing the global symbols array', () => {
    const r = run('int g = 5; int add(int a, int b) { int result = a + b; return result; } print(add(g, 10));');
    expect(r.symbols.map(s => s.name)).toEqual(['g']);
    expect(r.functionSymbols.add?.map(s => s.name)).toEqual(['a', 'b', 'result']);
    expect(r.functionSymbols.add?.every(s => s.scope === 'local')).toBe(true);
    expect(r.functionSymbols.add?.map(s => s.type)).toEqual(['int', 'int', 'int']);
  });

  it('lexes function syntax and comma', () => {
    const { tokens, errors } = tokenize('int add(int a, int b) { return a + b; }');
    expect(errors).toHaveLength(0);
    expect(tokens.map(t => t.type)).toContain('COMMA');
  });

  it('parses function declaration and call expression', () => {
    const result = parse(tokenize('int add(int a, int b) { return a + b; } int x = add(1, 2);').tokens);
    expect(result.errors).toHaveLength(0);
    expect(result.program?.body[0]?.type).toBe('FunctionDecl');
    expect(result.program?.body[1]?.type).toBe('VarDecl');
  });

  it('executes an int function', () => {
    const r = run('int add(int a, int b) { return a + b; } print(add(10, 20));');
    expect(r.errors).toHaveLength(0);
    expect(r.output).toEqual(['30']);
  });

  it('supports multiple parameters and local variables', () => {
    const r = run('int add(int a, int b) { int result = a + b; return result; } int x = add(5, 7); print(x);');
    expect(r.output).toEqual(['12']);
  });

  it('supports float return values', () => {
    const r = run('float add(float a, float b) { return a + b; } print(add(10.5, 2.5));');
    expect(r.output).toEqual(['13']);
  });

  it('supports bool return values', () => {
    const r = run('bool greater(int a, int b) { return a > b; } print(greater(10, 5));');
    expect(r.output).toEqual(['true']);
  });

  it('supports nested function calls', () => {
    const r = run('int add(int a, int b) { return a + b; } int mul(int a, int b) { return a * b; } print(mul(add(2, 3), 4));');
    expect(r.output).toEqual(['20']);
  });

  it('supports if/else inside a function', () => {
    const r = run('int max(int a, int b) { if (a > b) { return a; } else { return b; } } print(max(10, 20));');
    expect(r.output).toEqual(['20']);
  });

  it('keeps function locals separate from globals', () => {
    const r = run('int x = 10; int test() { int x = 20; return x; } print(test()); print(x);');
    expect(r.output).toEqual(['20', '10']);
  });

  it('supports functions declared after their call site', () => {
    const r = run('int x = add(2, 3); print(x); int add(int a, int b) { return a + b; }');
    expect(r.output).toEqual(['5']);
  });

  it('rejects undefined functions', () => {
    const r = run('print(missing(1));');
    expect(r.semanticErrors.some(e => e.message.includes('Undefined function'))).toBe(true);
  });

  it('rejects wrong argument count', () => {
    const r = run('int add(int a, int b) { return a + b; } print(add(1));');
    expect(r.semanticErrors.some(e => e.message.includes('expects 2 argument'))).toBe(true);
  });

  it('rejects incompatible argument type', () => {
    const r = run('int add(int a) { return a; } float x = 1.5; print(add(x));');
    expect(r.semanticErrors.some(e => e.message.includes('expects int'))).toBe(true);
  });

  it('rejects invalid function return type', () => {
    const r = run('int bad() { return 1.5; } print(bad());');
    expect(r.semanticErrors.some(e => e.message.includes('Cannot return float'))).toBe(true);
  });

  it('rejects duplicate functions', () => {
    const r = run('int f() { return 1; } int f() { return 2; } print(f());');
    expect(r.semanticErrors.some(e => e.message.includes('Function \'f\' has already been declared'))).toBe(true);
  });

  it('preserves function calls through optimization', () => {
    const r = run('int add(int a, int b) { return a + b; } int x = add(10, 20); print(x);');
    expect(r.optimizedTac?.instructions.some(i => i.kind === 'call')).toBe(true);
  });

  it('propagates function return to program return', () => {
    const r = run('int add(int a, int b) { return a + b; } return add(10, 20);');
    expect(r.returnValue).toBe(30);
  });

  it('function print output returns to caller in order', () => {
    const r = run('int show(int x) { print(x); return x + 1; } print(show(10));');
    expect(r.output).toEqual(['10', '11']);
  });

  it('reports runtime error for a function with no reached return', () => {
    const r = run('int f(int x) { if (x > 0) { return x; } } print(f(0));');
    expect(r.runtimeError).toContain('returned no value');
  });
});
