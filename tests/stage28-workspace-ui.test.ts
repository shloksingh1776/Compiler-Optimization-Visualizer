import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/index.ts';
import { getCompilerPipelineSteps } from '../src/components/pipelineUtils.ts';
import { clampEditorRatio, getWorkspaceTabForPipelineStage, WORKSPACE_TABS } from '../src/components/workspaceUtils.ts';

describe('Stage 28 - workspace and UI polish helpers', () => {
  it('provides all planned workspace views exactly once', () => {
    expect(WORKSPACE_TABS.map((tab) => tab.id)).toEqual([
      'tokens', 'ast', 'symbols', 'tac', 'optimization', 'output', 'diagnostics',
    ]);
    expect(new Set(WORKSPACE_TABS.map((tab) => tab.id)).size).toBe(WORKSPACE_TABS.length);
  });

  it('maps successful compiler pipeline phases to their visible workspace tabs', () => {
    const result = compile('int value = 2 + 3; print(value);');
    expect(getWorkspaceTabForPipelineStage('source', result.stageStatus)).toBeNull();
    expect(getWorkspaceTabForPipelineStage('lexical', result.stageStatus)).toBe('tokens');
    expect(getWorkspaceTabForPipelineStage('syntax', result.stageStatus)).toBe('ast');
    expect(getWorkspaceTabForPipelineStage('semantic', result.stageStatus)).toBe('symbols');
    expect(getWorkspaceTabForPipelineStage('tac', result.stageStatus)).toBe('tac');
    expect(getWorkspaceTabForPipelineStage('optimization', result.stageStatus)).toBe('optimization');
    expect(getWorkspaceTabForPipelineStage('output', result.stageStatus)).toBe('output');
  });

  it('routes failed compiler phases to diagnostics instead of a missing result view', () => {
    const lexicalFailure = compile('int value = @;');
    expect(getWorkspaceTabForPipelineStage('lexical', lexicalFailure.stageStatus)).toBe('diagnostics');
    expect(getWorkspaceTabForPipelineStage('syntax', lexicalFailure.stageStatus)).toBe('diagnostics');
    expect(getWorkspaceTabForPipelineStage('semantic', lexicalFailure.stageStatus)).toBe('diagnostics');
    expect(getWorkspaceTabForPipelineStage('tac', lexicalFailure.stageStatus)).toBe('diagnostics');
    expect(getWorkspaceTabForPipelineStage('optimization', lexicalFailure.stageStatus)).toBe('diagnostics');
  });

  it('clamps drag/keyboard resize ratios to usable panel bounds', () => {
    expect(clampEditorRatio(5)).toBe(32);
    expect(clampEditorRatio(99)).toBe(65);
    expect(clampEditorRatio(45)).toBe(45);
    expect(clampEditorRatio(Number.NaN)).toBe(45);
    expect(clampEditorRatio(Number.POSITIVE_INFINITY)).toBe(45);
  });

  it('keeps the pipeline targets compatible with the tabbed workspace', () => {
    const valid = getCompilerPipelineSteps(compile('int value = 1; print(value);'));
    expect(valid.map((step) => step.targetId)).toEqual([
      'source-code', 'token-inspector', 'ast-view', 'symbol-table', 'tac-view', 'optimization-trace', 'program-output',
    ]);
    const invalid = getCompilerPipelineSteps(compile('int value = @;'));
    expect(invalid.find((step) => step.id === 'lexical')?.targetId).toBe('diagnostics');
  });
});
