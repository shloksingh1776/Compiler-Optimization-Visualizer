import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index.ts';
import { getCompilerPipelineSteps } from '../src/components/pipelineUtils.ts';

describe('Stage 27 - interactive compiler pipeline', () => {
  it('shows all real stages as completed for a valid program', () => {
    const result = compile('int value = 2 + 3;\nprint(value);');
    const steps = getCompilerPipelineSteps(result);

    expect(steps.map((step) => step.id)).toEqual([
      'source', 'lexical', 'syntax', 'semantic', 'tac', 'optimization', 'output',
    ]);
    expect(steps.map((step) => step.state)).toEqual([
      'complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'complete',
    ]);
    expect(steps[1]?.summary).toContain(`${result.tokens.length} tokens`);
    expect(steps[4]?.summary).toContain(`${result.tac?.instructions.length} main-program instructions`);
    expect(steps[5]?.summary).toContain(`${result.optimizationTrace?.steps.length} captured snapshots`);
    expect(steps[6]?.summary).toContain('1 output line');
  });

  it('marks the parser as failed and later stages as not reached after a lexical error', () => {
    const result = compile('int value = @;');
    const steps = getCompilerPipelineSteps(result);

    expect(steps.find((step) => step.id === 'lexical')).toMatchObject({ state: 'error' });
    expect(steps.find((step) => step.id === 'syntax')).toMatchObject({ state: 'skipped' });
    expect(steps.find((step) => step.id === 'semantic')).toMatchObject({ state: 'skipped' });
    expect(steps.find((step) => step.id === 'tac')).toMatchObject({ state: 'skipped' });
    expect(steps.find((step) => step.id === 'optimization')).toMatchObject({ state: 'skipped' });
    expect(steps.find((step) => step.id === 'output')).toMatchObject({ state: 'skipped' });
    expect(steps.find((step) => step.id === 'lexical')?.summary).toContain('lexical error');
  });

  it('marks semantic failure accurately without claiming TAC or optimization ran', () => {
    const result = compile('int value = undeclared;');
    const steps = getCompilerPipelineSteps(result);

    expect(steps.find((step) => step.id === 'lexical')?.state).toBe('complete');
    expect(steps.find((step) => step.id === 'syntax')?.state).toBe('complete');
    expect(steps.find((step) => step.id === 'semantic')?.state).toBe('error');
    expect(steps.find((step) => step.id === 'tac')?.state).toBe('skipped');
    expect(steps.find((step) => step.id === 'optimization')?.state).toBe('skipped');
  });

  it('marks a compile-time division-by-zero failure at optimization', () => {
    const result = compile('int value = 10 / 0;');
    const steps = getCompilerPipelineSteps(result);

    expect(steps.find((step) => step.id === 'tac')?.state).toBe('complete');
    expect(steps.find((step) => step.id === 'optimization')?.state).toBe('error');
    expect(steps.find((step) => step.id === 'optimization')?.summary).toContain('compile-time optimization error');
    expect(steps.find((step) => step.id === 'output')?.state).toBe('skipped');
  });

  it('marks runtime failure at Output while preserving successful compile phases', () => {
    const result = compile('int value;\nprint(value);');
    const steps = getCompilerPipelineSteps(result);

    expect(result.runtimeError).toBeTruthy();
    expect(steps.slice(1, 6).every((step) => step.state === 'complete')).toBe(true);
    expect(steps.find((step) => step.id === 'output')?.state).toBe('error');
    expect(steps.find((step) => step.id === 'output')?.summary).toContain('Execution error');
  });

  it('points each selectable phase to the existing result section instead of creating compiler data', () => {
    const steps = getCompilerPipelineSteps(compile('int value = 2; print(value);'));

    expect(steps.map((step) => step.targetId)).toEqual([
      'source-code',
      'token-inspector',
      'ast-view',
      'symbol-table',
      'tac-view',
      'optimization-trace',
      'program-output',
    ]);
  });

  it('routes failed pipeline phases to the diagnostics tab', () => {
    const lexicalFailure = getCompilerPipelineSteps(compile('int value = @;'));
    expect(lexicalFailure.find((step) => step.id === 'lexical')?.targetId).toBe('diagnostics');

    const semanticFailure = getCompilerPipelineSteps(compile('int value = undeclared;'));
    expect(semanticFailure.find((step) => step.id === 'semantic')?.targetId).toBe('diagnostics');

    const optimizationFailure = getCompilerPipelineSteps(compile('int value = 10 / 0;'));
    expect(optimizationFailure.find((step) => step.id === 'optimization')?.targetId).toBe('diagnostics');
  });

});
