import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/pipeline.ts';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';

describe('Stage 19 - void functions', () => {
  it('recognizes void as a keyword', () => {
    const result = tokenize('void greet() { return; }');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens[0]?.type).toBe('VOID');
  });

  it('parses void function declarations and standalone calls', () => {
    const result = parse(tokenize('void greet() { return; } greet();').tokens);
    expect(result.errors).toHaveLength(0);
    expect(result.program?.body.map(s => s.type)).toEqual(['FunctionDecl', 'CallStmt']);
  });

  it('executes a void function and preserves its printed output', () => {
    const result = compile('void greet() { print(42); } greet();');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['42']);
  });

  it('supports parameters in void functions', () => {
    const result = compile('void show(int value) { print(value); return; } show(7);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['7']);
  });

  it('allows void functions to finish without an explicit return', () => {
    const result = compile('void greet() { print(1); } greet(); print(2);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1', '2']);
  });

  it('allows return; in a void function', () => {
    const result = compile('void greet() { print(1); return; print(2); } greet();');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1']);
  });

  it('rejects a valueless return at top level while allowing it in void functions', () => {
    const topLevel = compile('return;');
    expect(topLevel.syntaxErrors.length).toBeGreaterThan(0);
    expect(topLevel.tac).toBeNull();

    const inVoidFunction = compile('void greet() { return; } greet();');
    expect(inVoidFunction.errors).toHaveLength(0);
  });

  it('rejects returning a value from a void function', () => {
    const result = compile('void greet() { return 5; } greet();');
    expect(result.semanticErrors.some(e => e.message.includes('Void function cannot return a value'))).toBe(true);
  });

  it('rejects return; in a non-void function', () => {
    const result = compile('int value() { return; } print(value());');
    expect(result.semanticErrors.some(e => e.message.includes('must return a int value'))).toBe(true);
  });

  it('rejects using a void call as an expression', () => {
    const result = compile('void greet() { return; } int x = greet();');
    expect(result.semanticErrors.some(e => e.message.includes('cannot be used as an expression'))).toBe(true);
  });

  it('checks argument count and types for void calls', () => {
    const count = compile('void show(int value) { print(value); } show();');
    const type = compile('void show(bool value) { print(value); } show(3);');
    expect(count.semanticErrors.some(e => e.message.includes('expects 1 argument'))).toBe(true);
    expect(type.semanticErrors.some(e => e.message.includes('expects bool'))).toBe(true);
  });

  it('allows a value-returning function to be called as a statement', () => {
    const result = compile('int answer() { return 9; } answer(); print(1);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1']);
  });

  it('preserves void-call behavior with optimization enabled', () => {
    const source = 'void work() { print(3); } work(); work();';
    const result = compile(source);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['3', '3']);
    expect(result.optimizedTac).not.toBeNull();
  });
});
