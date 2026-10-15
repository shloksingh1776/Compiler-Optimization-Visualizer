import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/pipeline.ts';
import { optimizeWithTrace } from '../src/compiler/optimizer/optimizer.ts';
import type { Operand, TACInstruction, TACProgram } from '../src/compiler/ir/tac.ts';

const node = 'stage24-test-node';
const variable = (name: string): Operand => ({ kind: 'variable', name });
const constant = (value: number): Operand => ({ kind: 'constant', value });

function stage(tac: TACProgram, name: string): TACProgram {
  const step = optimizeWithTrace(tac).trace.steps.find((item) => item.name === name);
  if (!step) throw new Error(`Missing optimization trace step: ${name}`);
  return step.tac;
}

describe('Stage 24 - complete optimization coverage', () => {
  it('applies constant propagation, folding, and algebraic simplification inside functions', () => {
    const result = compile(`
      int calculate(int input) {
        int a = 10;
        int b = 20;
        int total = a + b;
        int scaled = input * 1;
        return total + scaled;
      }
      print(calculate(5));
    `);
    expect(result.errors).toHaveLength(0);

    const propagated = stage(result.tac!, 'Constant Propagation').functions!.calculate!.instructions;
    expect(propagated.some((instruction) => instruction.kind === 'binary' &&
      instruction.left.kind === 'constant' && instruction.left.value === 10 &&
      instruction.right.kind === 'constant' && instruction.right.value === 20)).toBe(true);

    const folded = stage(result.tac!, 'Constant Folding').functions!.calculate!.instructions;
    expect(folded.some((instruction) => instruction.kind === 'assign' && instruction.value.kind === 'constant' &&
      instruction.value.value === 30)).toBe(true);

    const simplified = stage(result.tac!, 'Algebraic Simplification').functions!.calculate!.instructions;
    expect(simplified.some((instruction) => instruction.kind === 'binary' && instruction.operator === '*' &&
      instruction.right.kind === 'constant' && instruction.right.value === 1)).toBe(false);
  });

  it('resets constant facts at branch targets to avoid propagating values across paths', () => {
    const instructions: TACInstruction[] = [
      { kind: 'assign', target: 'a', value: constant(7), sourceNodeId: node },
      { kind: 'binary', target: 't1', left: variable('a'), operator: '+', right: constant(1), sourceNodeId: node },
      { kind: 'jumpIfFalse', condition: variable('condition'), label: 'L1', sourceNodeId: node },
      { kind: 'label', label: 'L1', sourceNodeId: node },
      { kind: 'binary', target: 't2', left: variable('a'), operator: '+', right: constant(1), sourceNodeId: node },
    ];
    const tac: TACProgram = { instructions, temporaryCount: 2, functions: {} };
    const optimized = stage(tac, 'Constant Propagation');
    const beforeLabel = optimized.instructions.find((instruction) => instruction.kind === 'binary' && instruction.target === 't1');
    const afterLabel = optimized.instructions.find((instruction) => instruction.kind === 'binary' && instruction.target === 't2');
    expect(beforeLabel?.kind === 'binary' && beforeLabel.left.kind === 'constant' && beforeLabel.left.value === 7).toBe(true);
    expect(afterLabel?.kind === 'binary' && afterLabel.left.kind === 'variable' && afterLabel.left.name === 'a').toBe(true);
  });

  it('runs DCE inside functions without removing parameter or return instructions', () => {
    const tac: TACProgram = {
      instructions: [],
      temporaryCount: 2,
      functions: {
        f: {
          name: 'f',
          parameters: [{ name: 'x', type: 'int' }],
          returnType: 'int',
          instructions: [
            { kind: 'param', name: 'x', valueType: 'int', sourceNodeId: node },
            { kind: 'binary', target: 't1', left: variable('x'), operator: '+', right: constant(100), sourceNodeId: node },
            { kind: 'binary', target: 't2', left: variable('x'), operator: '*', right: constant(2), sourceNodeId: node },
            { kind: 'return', operand: variable('x'), sourceNodeId: node },
          ],
        },
      },
    };
    const dce = stage(tac, 'Dead Code Elimination').functions!.f!.instructions;
    expect(dce.map((instruction) => instruction.kind)).toEqual(['param', 'return']);
  });

  it('uses control-flow liveness so values used on another branch stay live', () => {
    const instructions: TACInstruction[] = [
      { kind: 'assign', target: 'x', value: constant(1), sourceNodeId: node },
      { kind: 'jumpIfFalse', condition: variable('condition'), label: 'Lelse', sourceNodeId: node },
      { kind: 'binary', target: 't1', left: variable('a'), operator: '+', right: variable('b'), sourceNodeId: node },
      { kind: 'assign', target: 'x', value: constant(2), sourceNodeId: node },
      { kind: 'jump', label: 'Lend', sourceNodeId: node },
      { kind: 'label', label: 'Lelse', sourceNodeId: node },
      { kind: 'print', operand: variable('x'), sourceNodeId: node },
      { kind: 'label', label: 'Lend', sourceNodeId: node },
    ];
    const tac: TACProgram = { instructions, temporaryCount: 1, functions: {} };
    const optimized = stage(tac, 'Dead Code Elimination');
    expect(optimized.instructions.some((instruction) => instruction.kind === 'binary' && instruction.target === 't1')).toBe(false);
    expect(optimized.instructions.some((instruction) => instruction.kind === 'assign' && instruction.target === 'x' &&
      instruction.value.kind === 'constant' && instruction.value.value === 1)).toBe(true);
    expect(optimized.instructions.some((instruction) => instruction.kind === 'print' && instruction.operand.kind === 'variable' &&
      instruction.operand.name === 'x')).toBe(true);
  });

  it('marks each real optimization pass as applied and preserves execution results with loops/switch/functions', () => {
    const result = compile(`
      int twice(int n) {
        int dead = n + 99;
        return n * 2;
      }
      int i = 0;
      int total = 0;
      while (i < 3) {
        total = total + twice(i);
        i = i + 1;
      }
      switch (total) {
        case 6: print(60); break;
        default: print(0);
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['60']);
    expect(result.optimizedTac!.functions!.twice!.instructions.some((instruction) =>
      instruction.kind === 'copy' && instruction.target === 'dead')).toBe(false);
    const trace = result.optimizationTrace!.steps;
    for (const name of [
      'Constant Propagation', 'Constant Folding', 'Algebraic Simplification',
      'Common Subexpression Elimination', 'Copy Propagation', 'Dead Code Elimination',
    ]) {
      expect(trace.find((step) => step.name === name)?.applied).toBe(true);
    }
    expect(trace.at(-1)!.tac).toEqual(result.optimizedTac);
  });
});
