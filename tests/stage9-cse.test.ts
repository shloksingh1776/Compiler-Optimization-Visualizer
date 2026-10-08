import { describe, expect, it } from 'vitest';
import { compile, commonSubexpressionElimination } from '../src/compiler/index.ts';
import type { TACProgram } from '../src/compiler/ir/tac.ts';

function simpleProgram(instructions: TACProgram['instructions']): TACProgram {
  return { instructions, temporaryCount: 10 };
}

const sourceId = 'stage9';

describe('Stage 9 - Common Subexpression Elimination', () => {
  it('reuses an identical repeated binary expression', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[1]).toMatchObject({ kind: 'copy', target: 't2' });
    expect(result.instructions[1]).toMatchObject({ source: { kind: 'temporary', name: 't1' } });
  });

  it('reuses an expression multiple times', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '*', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '*', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't3', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '*', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions.map(i => i.kind)).toEqual(['binary', 'copy', 'copy']);
  });

  it('does not reuse an expression after an operand variable changes', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'assign', target: 'a', targetType: 'int', value: { kind: 'constant', value: 7, valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[2]!.kind).toBe('binary');
  });

  it('treats operand order as significant', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'b', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'a', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[1]!.kind).toBe('binary');
  });

  it('does not merge different operators', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '-', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[1]!.kind).toBe('binary');
  });

  it('preserves print and return while reusing their expression results', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'print', operand: { kind: 'temporary', name: 't1', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'return', operand: { kind: 'temporary', name: 't2', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[1]!.kind).toBe('print');
    expect(result.instructions[2]!.kind).toBe('copy');
    expect(result.instructions[3]!.kind).toBe('return');
  });

  it('does not reuse across a control-flow boundary', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'jump', label: 'L1', sourceNodeId: sourceId },
      { kind: 'label', label: 'L1', sourceNodeId: sourceId },
      { kind: 'binary', target: 't2', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[3]!.kind).toBe('binary');
  });

  it('does not reuse across a function call', () => {
    const program = simpleProgram([
      { kind: 'binary', target: 't1', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
      { kind: 'call', target: 't2', targetType: 'int', functionName: 'f', args: [], sourceNodeId: sourceId },
      { kind: 'binary', target: 't3', targetType: 'int', left: { kind: 'variable', name: 'a', valueType: 'int' }, operator: '+', right: { kind: 'variable', name: 'b', valueType: 'int' }, sourceNodeId: sourceId },
    ]);
    const result = commonSubexpressionElimination(program);
    expect(result.instructions[2]!.kind).toBe('binary');
  });

  it('applies CSE inside function bodies and keeps the program return value correct', () => {
    const result = compile(`
      int addTwice(int a, int b) {
        int x = a + b;
        int y = a + b;
        return y;
      }

      return addTwice(10, 20);
    `);
    expect(result.errors).toHaveLength(0);
    const fn = result.optimizedTac?.functions?.addTwice;
    expect(fn).toBeDefined();
    expect(fn!.instructions.filter(i => i.kind === 'binary')).toHaveLength(1);
    expect(fn!.instructions.some(i => i.kind === 'copy')).toBe(true);
    expect(result.returnValue).toBe(30);
  });

  it('keeps repeated expressions in the main program around calls safe', () => {
    const result = compile(`
      int f() { return 10; }
      int a = f();
      int b = f();
      int x = a + b;
      int y = a + b;
      return y;
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(20);
    const optimized = result.optimizedTac?.instructions ?? [];
    expect(optimized.filter(i => i.kind === 'binary')).toHaveLength(1);
    expect(optimized.some(i => i.kind === 'copy')).toBe(true);
  });
});
