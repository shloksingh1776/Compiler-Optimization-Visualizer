import { describe, expect, it } from 'vitest';
import { compile, optimize, optimizeWithTrace, generateTAC, parse, tokenize } from '../src/compiler/index.ts';
import { analyze } from '../src/compiler/index.ts';

function compileTAC(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toHaveLength(0);
  const semantic = analyze(parsed.program!);
  expect(semantic.errors).toHaveLength(0);
  return generateTAC(parsed.program!);
}

describe('Enhancement 1: pass-by-pass optimization trace', () => {
  it('captures original, every optimization pass, and final TAC', () => {
    const result = compile('int a = 10; int b = 20; int x = a + b; print(x);');
    expect(result.optimizationTrace).not.toBeNull();

    const steps = result.optimizationTrace!.steps;
    expect(steps.map((step) => step.name)).toEqual([
      'Original TAC',
      'Constant Propagation',
      'Constant Folding',
      'Algebraic Simplification',
      'Common Subexpression Elimination',
      'Copy Propagation',
      'Dead Code Elimination',
      'Final Optimized TAC',
    ]);
    expect(steps[0]!.tac).toBe(result.tac);
    expect(steps.at(-1)!.tac).toBe(result.optimizedTac);
  });

  it('shows actual changes at the pass where they occur', () => {
    const result = compile('int a = 10; int b = 20; int x = a + b;');
    const steps = result.optimizationTrace!.steps;

    expect(steps[1]!.tac.instructions.map((i) => i.kind)).toEqual(['assign', 'assign', 'binary', 'copy']);
    expect(steps[2]!.tac.instructions.map((i) => i.kind)).toEqual(['assign', 'assign', 'assign', 'copy']);
    expect(steps[3]!.tac.instructions).toEqual(steps[2]!.tac.instructions);
  });

  it('includes function-body snapshots at every step', () => {
    const result = compile(`
      int add(int a, int b) {
        int x = a + b;
        int y = a + b;
        return y;
      }
      return add(10, 20);
    `);
    const steps = result.optimizationTrace!.steps;
    expect(steps.every((step) => steps[0]!.tac.functions?.add && step.tac.functions?.add)).toBe(true);

    const original = steps.find((step) => step.name === 'Original TAC')!.tac.functions!.add!;
    const cse = steps.find((step) => step.name === 'Common Subexpression Elimination')!.tac.functions!.add!;
    expect(original.instructions).not.toEqual(cse.instructions);
  });

  it('marks conservative control-flow passes as not applied without changing final behavior', () => {
    const result = compile(`
      int i = 0;
      while (i < 2) {
        print(i);
        i = i + 1;
      }
    `);
    const steps = result.optimizationTrace!.steps;
    expect(steps.find((step) => step.name === 'Constant Propagation')!.applied).toBe(false);
    expect(steps.find((step) => step.name === 'Constant Folding')!.applied).toBe(false);
    expect(steps.find((step) => step.name === 'Algebraic Simplification')!.applied).toBe(false);
    expect(steps.find((step) => step.name === 'Dead Code Elimination')!.applied).toBe(false);
  expect(steps.find((step) => step.name === 'Common Subexpression Elimination')!.applied).toBe(true);
  expect(steps.find((step) => step.name === 'Copy Propagation')!.applied).toBe(true);
    expect(steps.find((step) => step.name === 'Common Subexpression Elimination')!.applied).toBe(true);
    expect(steps.find((step) => step.name === 'Copy Propagation')!.applied).toBe(true);
    expect(steps.at(-1)!.tac).toEqual(result.optimizedTac);
    expect(result.output).toEqual(['0', '1']);
  });

  it('preserves the existing optimize() result exactly', () => {
    const tac = compileTAC('int a = 10; int b = 20; int x = a + b;');
    expect(optimizeWithTrace(tac).program).toEqual(optimize(tac));
  });

  it('keeps ternary/control-flow TAC visible in the trace', () => {
    const result = compile('bool c = true; int x = c ? 10 : 20; print(x);');
    const steps = result.optimizationTrace!.steps;
    expect(steps).toHaveLength(8);
    expect(steps.at(-1)!.tac.instructions.some((i) => i.kind === 'jumpIfFalse')).toBe(true);
  });
});

it('captures switch/case TAC while marking conservative control-flow passes as skipped', () => {
  const result = compile(`
    int n = 2;
    switch (n) {
      case 1: print(10); break;
      case 2: print(20); break;
      default: print(99);
    }
  `);
  expect(result.errors).toHaveLength(0);
  expect(result.output).toEqual(['20']);
  expect(result.optimizationTrace).not.toBeNull();
  const steps = result.optimizationTrace!.steps;
  expect(steps.at(-1)!.tac).toEqual(result.optimizedTac);
  expect(steps.find((step) => step.name === 'Constant Propagation')!.applied).toBe(false);
  expect(steps.find((step) => step.name === 'Dead Code Elimination')!.applied).toBe(false);
  expect(steps.find((step) => step.name === 'Common Subexpression Elimination')!.applied).toBe(true);
  expect(steps.find((step) => step.name === 'Copy Propagation')!.applied).toBe(true);
  expect(steps.find((step) => step.name === 'Original TAC')!.tac.instructions.some((i) => i.kind === 'jumpIfFalse')).toBe(true);
});
