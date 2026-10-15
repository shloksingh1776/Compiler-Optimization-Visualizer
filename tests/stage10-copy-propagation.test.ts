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

  it('propagates same-type source-level assignment chains inside a function', () => {
    const result = compile(`
      int copyChain(int n) {
        int a = n;
        int b = a;
        int c = b;
        int dead1 = n + 100;
        int dead2 = dead1 * 2;
        return c;
      }
      print(copyChain(7));
    `);

    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['7']);

    const copied = result.optimizationTrace?.steps.find((step) => step.name === 'Copy Propagation')
      ?.tac.functions?.copyChain?.instructions;
    expect(copied).toBeDefined();
    expect(copied?.find((instruction) => instruction.kind === 'assign' && instruction.target === 'b'))
      .toMatchObject({ kind: 'assign', value: { kind: 'variable', name: 'n' } });
    expect(copied?.find((instruction) => instruction.kind === 'assign' && instruction.target === 'c'))
      .toMatchObject({ kind: 'assign', value: { kind: 'variable', name: 'n' } });
    expect(copied?.find((instruction) => instruction.kind === 'return'))
      .toMatchObject({ kind: 'return', operand: { kind: 'variable', name: 'n' } });

    // DCE should remove the alias assignments and unrelated dead calculations
    // after Copy Propagation has rewritten the return to the original parameter.
    expect(result.optimizedTac?.functions?.copyChain?.instructions).toEqual([
      expect.objectContaining({ kind: 'param', name: 'n' }),
      expect.objectContaining({
        kind: 'return',
        operand: expect.objectContaining({ kind: 'variable', name: 'n' }),
      }),
    ]);
  });

  it('invalidates propagated aliases when their source is overwritten', () => {
    const result = copyPropagationInstructions([
      { kind: 'param', name: 'source', valueType: 'int', sourceNodeId: sourceId },
      { kind: 'assign', target: 'alias', targetType: 'int', value: v('source'), sourceNodeId: sourceId },
      { kind: 'assign', target: 'source', targetType: 'int', value: { kind: 'constant', value: 12, valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'print', operand: v('alias'), sourceNodeId: sourceId },
    ]);
    expect(result[3]).toMatchObject({ kind: 'print', operand: { kind: 'variable', name: 'alias' } });
  });

  it('does not erase an int-to-float conversion by treating it as a same-type alias', () => {
    const result = copyPropagationInstructions([
      { kind: 'param', name: 'x', valueType: 'int', sourceNodeId: sourceId },
      { kind: 'assign', target: 'alias', targetType: 'int', value: v('x'), sourceNodeId: sourceId },
      // The source is declared int, but this use is normalized to float to
      // represent the assignment conversion into asFloat.
      { kind: 'assign', target: 'asFloat', targetType: 'float', value: { kind: 'variable', name: 'alias', valueType: 'float' }, sourceNodeId: sourceId },
      { kind: 'assign', target: 'result', targetType: 'float', value: { kind: 'variable', name: 'asFloat', valueType: 'float' }, sourceNodeId: sourceId },
      { kind: 'return', operand: { kind: 'variable', name: 'result', valueType: 'float' }, sourceNodeId: sourceId },
    ]);
    expect(result[2]).toMatchObject({ kind: 'assign', target: 'asFloat', value: { kind: 'variable', name: 'x', valueType: 'float' } });
    expect(result[4]).toMatchObject({ kind: 'return', operand: { kind: 'variable', name: 'asFloat', valueType: 'float' } });
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
