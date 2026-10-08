import { describe, expect, it } from 'vitest';
import { compile, copyPropagation, copyPropagationInstructions, type TACInstruction, type TACProgram } from '../src/compiler/index.ts';

const sourceId = 'stage10';
const simpleProgram = (instructions: TACInstruction[]): TACProgram => ({ instructions, temporaryCount: 10 });

const v = (name: string, valueType: 'int' | 'float' | 'bool' = 'int') => ({ kind: 'variable' as const, name, valueType });

describe('Stage 10 - Copy Propagation', () => {
  it('propagates a basic variable copy into a later binary use', () => {
    const result = copyPropagation(simpleProgram([
      { kind: 'copy', target: 'x', targetType: 'int', source: v('y'), sourceNodeId: sourceId },
      { kind: 'binary', target: 't1', targetType: 'int', left: v('x'), operator: '+', right: { kind: 'constant', value: 1, valueType: 'int' }, sourceNodeId: sourceId },
    ]));
    expect(result.instructions[1]).toMatchObject({ left: { kind: 'variable', name: 'y' } });
  });

  it('propagates through a copy chain', () => {
    const result = copyPropagationInstructions([
      { kind: 'copy', target: 'a', targetType: 'int', source: v('b'), sourceNodeId: sourceId },
      { kind: 'copy', target: 'c', targetType: 'int', source: v('a'), sourceNodeId: sourceId },
      { kind: 'print', operand: v('c'), sourceNodeId: sourceId },
    ]);
    expect(result[2]).toMatchObject({ kind: 'print', operand: { kind: 'variable', name: 'b' } });
  });

  it('invalidates a copy when the target is overwritten', () => {
    const result = copyPropagationInstructions([
      { kind: 'copy', target: 'a', targetType: 'int', source: v('b'), sourceNodeId: sourceId },
      { kind: 'assign', target: 'a', targetType: 'int', value: { kind: 'constant', value: 10, valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't1', targetType: 'int', left: v('a'), operator: '+', right: { kind: 'constant', value: 1, valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    expect(result[2]).toMatchObject({ left: { kind: 'variable', name: 'a' } });
  });

  it('invalidates dependent copies when the source changes', () => {
    const result = copyPropagationInstructions([
      { kind: 'copy', target: 'a', targetType: 'int', source: v('b'), sourceNodeId: sourceId },
      { kind: 'assign', target: 'b', targetType: 'int', value: { kind: 'constant', value: 50, valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'print', operand: v('a'), sourceNodeId: sourceId },
    ]);
    expect(result[2]).toMatchObject({ operand: { kind: 'variable', name: 'a' } });
  });

  it('propagates copies into print and return without removing them', () => {
    const result = copyPropagationInstructions([
      { kind: 'copy', target: 'a', targetType: 'int', source: v('b'), sourceNodeId: sourceId },
      { kind: 'print', operand: v('a'), sourceNodeId: sourceId },
      { kind: 'return', operand: v('a'), sourceNodeId: sourceId },
    ]);
    expect(result[1]).toMatchObject({ kind: 'print', operand: { kind: 'variable', name: 'b' } });
    expect(result[2]).toMatchObject({ kind: 'return', operand: { kind: 'variable', name: 'b' } });
  });

  it('clears copy information across calls and control-flow boundaries', () => {
    const result = copyPropagationInstructions([
      { kind: 'copy', target: 'a', targetType: 'int', source: v('b'), sourceNodeId: sourceId },
      { kind: 'call', target: 't1', targetType: 'int', functionName: 'f', args: [], sourceNodeId: sourceId },
      { kind: 'print', operand: v('a'), sourceNodeId: sourceId },
    ]);
    expect(result[2]).toMatchObject({ operand: { kind: 'variable', name: 'a' } });
  });

  it('preserves int, float, and bool types while propagating', () => {
    const result = copyPropagationInstructions([
      { kind: 'copy', target: 'i', targetType: 'int', source: v('j', 'int'), sourceNodeId: sourceId },
      { kind: 'copy', target: 'f', targetType: 'float', source: v('g', 'float'), sourceNodeId: sourceId },
      { kind: 'copy', target: 'p', targetType: 'bool', source: v('q', 'bool'), sourceNodeId: sourceId },
      { kind: 'print', operand: v('f', 'float'), sourceNodeId: sourceId },
    ]);
    expect(result[3]).toMatchObject({ operand: { kind: 'variable', name: 'g', valueType: 'float' } });
  });

  it('applies copy propagation inside function bodies', () => {
    const result = compile(`
      int f(int a) {
        int x = a;
        int y = x;
        return y;
      }
      return f(10);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(10);
    const fn = result.optimizedTac?.functions?.f;
    expect(fn).toBeDefined();
    expect(fn!.instructions.some(i => i.kind === 'return')).toBe(true);
  });

  it('works with CSE-produced copies', () => {
    const result = compile(`
      int getValue() { return 10; }
      int a = getValue();
      int b = getValue();
      int x = a + b;
      int y = a + b;
      print(y);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20']);
    const binaryCount = (result.optimizedTac?.instructions ?? []).filter(i => i.kind === 'binary').length;
    expect(binaryCount).toBe(1);
  });

  it('keeps function calls separate and preserves program behavior', () => {
    const result = compile(`
      int add(int a, int b) { return a + b; }
      int x = add(10, 20);
      int y = add(10, 20);
      print(x);
      print(y);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['30', '30']);
    expect((result.optimizedTac?.instructions ?? []).filter(i => i.kind === 'call')).toHaveLength(2);
  });
});
