/**
 * COMPILER ERRORS
 * ===============
 *
 * COMPILER CONCEPT: every phase of a compiler can fail, and a good compiler
 * reports *where* the failure is, not just that one happened. We use one
 * uniform error record for all phases so the UI can render lexical, syntax
 * and semantic problems in a single list.
 *
 * ERROR RECOVERY: each stage collects ALL of its own errors before giving up,
 * rather than stopping at the first one. That is why `tokenize` returns an
 * array of errors instead of throwing. The pipeline then refuses to run the
 * *next* stage, because feeding a broken token stream into the parser would
 * only produce meaningless cascading errors.
 */

/** The pipeline stages that can report a problem. */
export type Stage = 'lexical' | 'syntax' | 'semantic' | 'tac' | 'optimizer' | 'runtime';

/**
 * `error`   - the program is invalid, compilation stops after this stage.
 * `warning` - the program is valid but suspicious (e.g. an unused variable).
 */
export type Severity = 'error' | 'warning';

export interface CompilerError {
  /** Which phase detected the problem. */
  readonly stage: Stage;
  readonly severity: Severity;
  /** Message shown to the user, without any position prefix. */
  readonly message: string;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column number. */
  readonly column: number;
  /** 0-based absolute offset of the offending span (inclusive). */
  readonly start: number;
  /** 0-based absolute offset one past the offending span (exclusive). */
  readonly end: number;
}

/** Position information shared by tokens and AST nodes. */
export interface SourceSpan {
  line: number;
  column: number;
  start: number;
  end: number;
}

/** Build an error record for a given stage. */
export function makeError(
  stage: Stage,
  message: string,
  span: SourceSpan,
  severity: Severity = 'error'
): CompilerError {
  return {
    stage,
    severity,
    message,
    line: span.line,
    column: span.column,
    start: span.start,
    end: span.end,
  };
}

/** Convenience helper for the lexical analysis phase. */
export function lexicalError(message: string, span: SourceSpan): CompilerError {
  return makeError('lexical', message, span);
}

/** Format an error the way a command line compiler would print it. */
export function formatError(error: CompilerError): string {
  const label = error.severity === 'error' ? 'error' : 'warning';
  return `${error.stage} ${label} [line ${error.line}, column ${error.column}]: ${error.message}`;
}

/** True if the list contains at least one fatal error (warnings do not count). */
export function hasFatalError(errors: readonly CompilerError[]): boolean {
  return errors.some((e) => e.severity === 'error');
}
