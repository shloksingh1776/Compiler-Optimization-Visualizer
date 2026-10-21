import type { PipelineStage, StageStatus } from '../compiler/index.ts';
import type { CompilerPipelineStageId } from './pipelineUtils.ts';

export type WorkspaceTabId =
  | 'tokens'
  | 'ast'
  | 'symbols'
  | 'tac'
  | 'optimization'
  | 'output'
  | 'diagnostics';

export interface WorkspaceTabInfo {
  readonly id: WorkspaceTabId;
  readonly label: string;
  readonly marker: string;
  readonly description: string;
}

export const WORKSPACE_TABS: readonly WorkspaceTabInfo[] = [
  { id: 'tokens', label: 'Tokens', marker: '[]', description: 'Inspect tokens produced by the lexer.' },
  { id: 'ast', label: 'AST', marker: '◇', description: 'Explore the abstract syntax tree.' },
  { id: 'symbols', label: 'Symbols', marker: 'Σ', description: 'Review global and function symbol tables.' },
  { id: 'tac', label: 'TAC', marker: '≡', description: 'Inspect the original three-address code.' },
  { id: 'optimization', label: 'Optimization', marker: '⚙', description: 'Inspect pass-by-pass optimized TAC and statistics.' },
  { id: 'output', label: 'Output', marker: '▶', description: 'Review program output and return value.' },
  { id: 'diagnostics', label: 'Diagnostics', marker: '!', description: 'Review compiler and runtime diagnostics.' },
];

/** Choose the existing workspace result corresponding to a selected pipeline stage. */
export function getWorkspaceTabForPipelineStage(
  stageId: CompilerPipelineStageId,
  status: Readonly<Record<PipelineStage, StageStatus>>,
): WorkspaceTabId | null {
  switch (stageId) {
    case 'source':
      return null;
    case 'lexical':
      return status.lexical === 'ok' ? 'tokens' : 'diagnostics';
    case 'syntax':
      return status.syntax === 'ok' ? 'ast' : 'diagnostics';
    case 'semantic':
      return status.semantic === 'ok' ? 'symbols' : 'diagnostics';
    case 'tac':
      return status.tac === 'ok' ? 'tac' : 'diagnostics';
    case 'optimization':
      return status.optimization === 'ok' ? 'optimization' : 'diagnostics';
    case 'output':
      return 'output';
  }
}

export function clampEditorRatio(value: number): number {
  if (!Number.isFinite(value)) return 45;
  return Math.min(65, Math.max(32, value));
}
