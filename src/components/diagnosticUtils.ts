import type { CompilerError } from '../compiler/errors.ts';

export interface DiagnosticSourceRange {
  start: number;
  end: number;
}

/**
 * Return the compiler-reported source span only when it is valid for the
 * current source. In particular, zero-length spans (such as an unexpected
 * EOF) are retained as caret positions rather than expanded into invented
 * character ranges.
 */
export function getDiagnosticSourceRange(
  error: Pick<CompilerError, 'start' | 'end'>,
  sourceLength: number,
): DiagnosticSourceRange | null {
  if (!Number.isInteger(sourceLength) || sourceLength < 0) return null;
  if (!Number.isInteger(error.start) || !Number.isInteger(error.end)) return null;
  if (error.start < 0 || error.end < error.start || error.end > sourceLength) return null;
  return { start: error.start, end: error.end };
}

/** Format the human-readable location stored by the compiler, without guessing. */
export function formatDiagnosticLocation(
  error: Pick<CompilerError, 'line' | 'column'>,
): string {
  if (!Number.isInteger(error.line) || error.line < 1) return 'Source location unavailable';
  if (!Number.isInteger(error.column) || error.column < 1) return `Line ${error.line}`;
  return `Line ${error.line}, column ${error.column}`;
}

/** Friendly phase labels for source-linked compiler diagnostics. */
export function getDiagnosticPhaseLabel(stage: CompilerError['stage']): string {
  switch (stage) {
    case 'lexical': return 'Lexical analysis';
    case 'syntax': return 'Syntax analysis';
    case 'semantic': return 'Semantic analysis';
    case 'tac': return 'Three-address code';
    case 'optimizer': return 'Compile-time optimization check';
    case 'runtime': return 'Runtime execution';
  }
}
