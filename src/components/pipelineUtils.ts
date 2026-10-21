import type { CompilationResult, StageStatus } from '../compiler/index.ts';

export type CompilerPipelineStageId =
  | 'source'
  | 'lexical'
  | 'syntax'
  | 'semantic'
  | 'tac'
  | 'optimization'
  | 'output';

export type CompilerPipelineStageState = 'complete' | 'error' | 'skipped' | 'not-needed';

export interface CompilerPipelineStep {
  readonly id: CompilerPipelineStageId;
  readonly label: string;
  readonly description: string;
  readonly targetId: string;
  readonly state: CompilerPipelineStageState;
  readonly summary: string;
}

function toPipelineState(status: StageStatus): CompilerPipelineStageState {
  if (status === 'ok') return 'complete';
  if (status === 'error') return 'error';
  return 'skipped';
}

function instructionSummary(instructionCount: number, functionCount: number): string {
  return `${instructionCount} main-program instruction${instructionCount === 1 ? '' : 's'} · ${functionCount} function${functionCount === 1 ? '' : 's'}`;
}

/**
 * Builds UI summaries from the exact CompilationResult already produced by
 * compile(). This helper never calls a compiler phase or reconstructs data.
 */
export function getCompilerPipelineSteps(result: CompilationResult): CompilerPipelineStep[] {
  const sourceLines = result.source.split('\n').length;
  const functions = Object.keys(result.tac?.functions ?? {});
  const functionSymbolCount = Object.values(result.functionSymbols).reduce(
    (total, symbols) => total + symbols.length,
    0,
  );
  const originalInstructionCount = result.tac?.instructions.length ?? 0;
  const optimizedInstructionCount = result.optimizedTac?.instructions.length ?? 0;
  const traceStepCount = result.optimizationTrace?.steps.length ?? 0;

  const lexicalSummary = result.stageStatus.lexical === 'error'
    ? `${result.lexicalErrors.length} lexical error${result.lexicalErrors.length === 1 ? '' : 's'}`
    : `${result.tokens.length} token${result.tokens.length === 1 ? '' : 's'} generated`;
  const syntaxSummary = result.stageStatus.syntax === 'error'
    ? `${result.syntaxErrors.length} syntax error${result.syntaxErrors.length === 1 ? '' : 's'}`
    : result.ast
      ? `${result.ast.body.length} top-level AST node${result.ast.body.length === 1 ? '' : 's'}`
      : 'AST not available';
  const semanticSummary = result.stageStatus.semantic === 'error'
    ? `${result.semanticErrors.length} semantic error${result.semanticErrors.length === 1 ? '' : 's'}`
    : result.stageStatus.semantic === 'ok'
      ? `${result.symbols.length} global symbol${result.symbols.length === 1 ? '' : 's'} · ${functionSymbolCount} local/function symbol${functionSymbolCount === 1 ? '' : 's'}`
      : 'Semantic analysis did not run';
  const tacSummary = result.tac
    ? instructionSummary(originalInstructionCount, functions.length)
    : 'TAC was not generated';
  const optimizationSummary = result.stageStatus.optimization === 'error'
    ? `${result.divisionByZeroErrors.length} compile-time optimization error${result.divisionByZeroErrors.length === 1 ? '' : 's'}`
    : result.optimizedTac
      ? `${traceStepCount} captured snapshots · ${instructionSummary(optimizedInstructionCount, functions.length)}`
      : 'Optimization did not run';
  const outputSummary = result.runtimeError
    ? `Execution error: ${result.runtimeError}`
    : result.executionStatus === 'not-needed'
      ? 'Not needed — no top-level print, return, or function call requires execution'
      : result.executionStatus === 'not-run'
        ? 'Execution did not run because compilation did not complete'
        : result.optimizedTac
      ? [
          `${result.output.length} output line${result.output.length === 1 ? '' : 's'}`,
          result.returnValue !== undefined ? `return value ${String(result.returnValue)}` : null,
          result.output.length === 0 && result.returnValue === undefined ? 'no printed output or return value' : null,
        ].filter((part): part is string => part !== null).join(' · ')
      : 'Execution result is unavailable';

  return [
    {
      id: 'source',
      label: 'Source',
      description: 'Editable MiniC source code provided to the compiler.',
      targetId: 'source-code',
      state: 'complete',
      summary: `${result.source.length} character${result.source.length === 1 ? '' : 's'} · ${sourceLines} line${sourceLines === 1 ? '' : 's'}`,
    },
    {
      id: 'lexical',
      label: 'Lexer',
      description: 'Scans source characters and produces the real token stream.',
      targetId: result.stageStatus.lexical === 'error' ? 'diagnostics' : 'token-inspector',
      state: toPipelineState(result.stageStatus.lexical),
      summary: lexicalSummary,
    },
    {
      id: 'syntax',
      label: 'Parser',
      description: 'Checks grammar and constructs the abstract syntax tree.',
      targetId: result.stageStatus.syntax === 'error' ? 'diagnostics' : 'ast-view',
      state: toPipelineState(result.stageStatus.syntax),
      summary: syntaxSummary,
    },
    {
      id: 'semantic',
      label: 'Semantic analysis',
      description: 'Checks meaning and types, and builds the symbol tables.',
      targetId: result.stageStatus.semantic === 'error' ? 'diagnostics' : 'symbol-table',
      state: toPipelineState(result.stageStatus.semantic),
      summary: semanticSummary,
    },
    {
      id: 'tac',
      label: 'TAC generation',
      description: 'Translates the validated AST to original three-address code.',
      targetId: result.stageStatus.tac === 'ok' ? 'tac-view' : 'diagnostics',
      state: toPipelineState(result.stageStatus.tac),
      summary: tacSummary,
    },
    {
      id: 'optimization',
      label: 'Optimization',
      description: 'Runs the existing optimization passes and records their actual TAC snapshots.',
      targetId: result.stageStatus.optimization === 'ok' ? 'optimization-trace' : 'diagnostics',
      state: toPipelineState(result.stageStatus.optimization),
      summary: optimizationSummary,
    },
    {
      id: 'output',
      label: 'Output',
      description: 'Shows output and return data produced by the existing execution result.',
      targetId: result.output.length === 0 && result.returnValue !== undefined ? 'return-value' : 'program-output',
      state: result.runtimeError || result.executionStatus === 'error'
        ? 'error'
        : result.executionStatus === 'executed'
          ? 'complete'
          : result.executionStatus === 'not-needed'
            ? 'not-needed'
            : 'skipped',
      summary: outputSummary,
    },
  ];
}
