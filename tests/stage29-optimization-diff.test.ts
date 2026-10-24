import { describe, expect, it } from 'vitest';
import { compareTAC, compile, formatInstruction, type TACFunction, type TACInstruction, type TACProgram } from '../src/compiler/index.ts';
import { buildOptimizationDiff, diffTACInstructions } from '../src/components/optimizationDiffUtils.ts';

function assign(target: string, value: number, sourceNodeId = target): TACInstruction {
  return {
    kind: 'assign',
    target,
    targetKind: 'variable',
    targetScope: 'local',
    targetType: 'int',
    value: { kind: 'constant', value, valueType: 'int' },
    sourceNodeId,
  };
}

function printVariable(name: string, scope: 'global' | 'local' = 'local'): TACInstruction {
  return {
    kind: 'print',
    operand: { kind: 'variable', name, valueType: 'int', scope },
    sourceNodeId: `print-${name}`,
  };
}

function program(instructions: TACInstruction[], extra: Partial<TACProgram> = {}): TACProgram {
  return { instructions, temporaryCount: 0, ...extra };
}

describe('Stage 29 - Optimization Diff View', () => {
  it('shows a rewritten expression as a changed row even when the instruction count is unchanged', () => {
    const result = compile('int simplify(int value) { int answer = value * 1; return answer; } print(simplify(4));');
    expect(result.optimizationTrace).not.toBeNull();
    const steps = result.optimizationTrace!.steps;
    const before = steps.find((step) => step.id === 'constant-folding')!;
    const after = steps.find((step) => step.id === 'algebraic-simplification')!;
    const diff = buildOptimizationDiff(before.tac, after.tac);
    const functionDiff = diff.sections.find((section) => section.id === 'function:simplify');

    expect(functionDiff?.counts.changed).toBeGreaterThan(0);
    expect(functionDiff?.rows.some((row) => row.status === 'changed' && row.before !== row.after)).toBe(true);
  });

  it('reports removed instructions after Dead Code Elimination without fabricating rows', () => {
    const result = compile('int b = 1; int c = 2; int a; a = b + c; a = 20;');
    const steps = result.optimizationTrace!.steps;
    const before = steps.find((step) => step.id === 'copy-propagation')!;
    const after = steps.find((step) => step.id === 'dead-code-elimination')!;
    const diff = buildOptimizationDiff(before.tac, after.tac);

    expect(diff.counts.removed).toBeGreaterThan(0);
    expect(diff.counts.added).toBe(0);
    for (const section of diff.sections) {
      for (const row of section.rows) {
        if (row.status === 'removed') expect(row.after).toBeNull();
        if (row.status === 'added') expect(row.before).toBeNull();
      }
    }
  });

  it('includes actual before-and-after instructions for every function body', () => {
    const result = compile(`
      int calculate(int n) {
        int alias = n;
        int unused = n + 10;
        return alias;
      }
      print(calculate(7));
    `);
    const steps = result.optimizationTrace!.steps;
    const before = steps.find((step) => step.id === 'constant-propagation')!;
    const after = steps.find((step) => step.id === 'copy-propagation')!;
    const diff = buildOptimizationDiff(before.tac, after.tac);
    const functionSection = diff.sections.find((section) => section.id === 'function:calculate');

    expect(functionSection).toBeDefined();
    expect(functionSection!.rows.length).toBeGreaterThan(0);
    expect(functionSection!.counts.changed + functionSection!.counts.removed + functionSection!.counts.added).toBeGreaterThan(0);
    expect(formatInstruction(after.tac.functions!.calculate!.instructions.at(-1)!)).toMatch(/^return/);
  });

  it('aligns repeated identical instructions without treating all later lines as changed', () => {
    const before = [assign('a', 1), assign('x', 2, 'x1'), assign('x', 2, 'x2'), printVariable('a')];
    const after = [assign('a', 1), assign('x', 2, 'x1'), printVariable('a')];
    const rows = diffTACInstructions(before, after);

    expect(rows.filter((row) => row.status === 'unchanged')).toHaveLength(3);
    expect(rows.filter((row) => row.status === 'removed')).toHaveLength(1);
    expect(rows.find((row) => row.status === 'removed')?.before).toBe('x = 2');
  });

  it('reports genuinely new instructions as additions', () => {
    const rows = diffTACInstructions([assign('a', 1)], [assign('a', 1), assign('b', 2)]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: 'added', before: null, after: 'b = 2' });
  });

  it('pairs adjacent removal and addition as an instruction rewrite', () => {
    const rows = diffTACInstructions(
      [assign('value', 1), assign('result', 2), printVariable('value')],
      [assign('value', 1), assign('result', 3), printVariable('value')],
    );
    const rewrite = rows.find((row) => row.status === 'changed');

    expect(rewrite).toMatchObject({ status: 'changed', before: 'result = 2', after: 'result = 3' });
    expect(rows.filter((row) => row.status === 'unchanged')).toHaveLength(2);
  });

  it('marks identical printed lines as metadata changes when global/local scope differs', () => {
    const globalTAC = program([printVariable('counter', 'global')], { globalVariables: ['counter'] });
    const localTAC = program([printVariable('counter', 'local')], { globalVariables: ['counter'] });
    const diff = buildOptimizationDiff(globalTAC, localTAC);
    const row = diff.sections[0]!.rows[0]!;

    expect(row.status).toBe('changed');
    expect(row.before).toBe(row.after);
    expect(row.metadataOnly).toBe(true);
    expect(compareTAC(globalTAC, localTAC).changed).toBe(true);
  });

  it('detects differences in assignment scope metadata in the TAC summary', () => {
    const globalAssignment: Extract<TACInstruction, { kind: 'assign' }> = {
      kind: 'assign', target: 'counter', targetKind: 'variable', targetScope: 'global', targetType: 'int',
      value: { kind: 'constant', value: 1, valueType: 'int' }, sourceNodeId: 'a',
    };
    const localAssignment: TACInstruction = { ...globalAssignment, targetScope: 'local', sourceNodeId: 'b' };

    expect(compareTAC(program([globalAssignment], { globalVariables: ['counter'] }), program([localAssignment], { globalVariables: ['counter'] })).changed).toBe(true);
  });

  it('detects program-scope metadata changes even when printed instruction lines are identical', () => {
    const before = program([printVariable('counter', 'global')], { globalVariables: ['counter'] });
    const after = program([printVariable('counter', 'global')], { globalVariables: ['counter', 'other'] });
    const diff = buildOptimizationDiff(before, after);

    expect(diff.programMetadataChanged).toBe(true);
    expect(compareTAC(before, after).changed).toBe(true);
  });

  it('detects function-signature and local-variable metadata changes', () => {
    const beforeFunction: TACFunction = {
      name: 'readValue',
      parameters: [{ name: 'input', type: 'int' }],
      returnType: 'int',
      instructions: [],
      localVariables: ['first'],
    };
    const afterFunction: TACFunction = { ...beforeFunction, localVariables: ['first', 'second'] };
    const before = program([], { functions: { readValue: beforeFunction } });
    const after = program([], { functions: { readValue: afterFunction } });
    const diff = buildOptimizationDiff(before, after);

    expect(compareTAC(before, after).changed).toBe(true);
    expect(diff.sections.find((section) => section.id === 'function:readValue')?.metadataChanged).toBe(true);
  });

  it('treats sourceNodeId as provenance and not as an optimization change', () => {
    const before = program([assign('a', 1, 'ast-before')]);
    const after = program([assign('a', 1, 'ast-after')]);
    expect(compareTAC(before, after).changed).toBe(false);
    expect(buildOptimizationDiff(before, after).counts.unchanged).toBe(1);
  });

  it('preserves the previous and current optimizer snapshots without mutating either', () => {
    const result = compile('int a = 10; int b = a + 0; print(b);');
    const before = result.optimizationTrace!.steps.find((step) => step.id === 'constant-propagation')!.tac;
    const after = result.optimizationTrace!.steps.find((step) => step.id === 'algebraic-simplification')!.tac;
    const beforeSnapshot = JSON.stringify(before);
    const afterSnapshot = JSON.stringify(after);

    buildOptimizationDiff(before, after);

    expect(JSON.stringify(before)).toBe(beforeSnapshot);
    expect(JSON.stringify(after)).toBe(afterSnapshot);
  });
});
