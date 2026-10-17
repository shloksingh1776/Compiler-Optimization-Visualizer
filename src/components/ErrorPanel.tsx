/**
 * SOURCE-LINKED DIAGNOSTICS
 *
 * Diagnostics stay grouped by the compiler phase that reported them. When a
 * compiler error has a valid source span, its action navigates to that exact
 * span in the editor. Runtime messages currently do not carry source offsets,
 * so they are shown separately without inventing a location or jump target.
 */

import type { CompilerError } from '../compiler/index.ts';
import {
  formatDiagnosticLocation,
  getDiagnosticPhaseLabel,
  getDiagnosticSourceRange,
} from './diagnosticUtils.ts';

interface ErrorPanelProps {
  lexicalErrors: readonly CompilerError[];
  syntaxErrors: readonly CompilerError[];
  semanticErrors: readonly CompilerError[];
  divisionByZeroErrors: readonly CompilerError[];
  runtimeError?: string;
  sourceLength: number;
  onSelectDiagnostic: (error: CompilerError) => void;
}

function ErrorGroup({
  title,
  hint,
  errors,
  sourceLength,
  onSelectDiagnostic,
}: {
  title: string;
  hint: string;
  errors: readonly CompilerError[];
  sourceLength: number;
  onSelectDiagnostic: (error: CompilerError) => void;
}) {
  if (errors.length === 0) return null;

  return (
    <section className="mb-4 last:mb-0" aria-label={title}>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-red-200 uppercase">
        {title} ({errors.length})
      </h3>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <ul className="space-y-2">
        {errors.map((error, index) => {
          const sourceRange = getDiagnosticSourceRange(error, sourceLength);
          const location = formatDiagnosticLocation(error);
          return (
            <li
              key={`${error.stage}:${error.start}:${error.end}:${index}`}
              className="rounded border border-red-900/50 bg-slate-950/70 p-3"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-2 py-0.5 font-semibold uppercase ${error.severity === 'warning' ? 'bg-amber-950 text-amber-300' : 'bg-red-950 text-red-300'}`}>
                  {error.severity}
                </span>
                <span className="text-slate-400">{getDiagnosticPhaseLabel(error.stage)}</span>
                <span className="font-mono text-slate-300">{location}</span>
              </div>
              <p className="break-words text-sm text-slate-100">{error.message}</p>
              {sourceRange ? (
                <button
                  type="button"
                  className="mt-2 rounded border border-sky-800 bg-sky-950/60 px-2.5 py-1 text-xs font-medium text-sky-200 transition hover:border-sky-500 hover:bg-sky-900/70 focus:outline-none focus:ring-2 focus:ring-sky-500"
                  onClick={() => onSelectDiagnostic(error)}
                  aria-label={`Go to source for ${error.severity} at ${location}`}
                >
                  Go to source <span aria-hidden="true">→</span>
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  A reliable source span is not available for navigation.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ErrorPanel({
  lexicalErrors,
  syntaxErrors,
  semanticErrors,
  divisionByZeroErrors,
  runtimeError,
  sourceLength,
  onSelectDiagnostic,
}: ErrorPanelProps) {
  const compilerDiagnosticCount =
    lexicalErrors.length + syntaxErrors.length + semanticErrors.length + divisionByZeroErrors.length;
  const total = compilerDiagnosticCount + (runtimeError ? 1 : 0);

  if (total === 0) {
    return (
      <div className="rounded border border-emerald-900/60 bg-emerald-950/15 p-3">
        <p className="text-sm text-emerald-300">No diagnostics reported. The compiler's available analysis and optimization checks succeeded.</p>
      </div>
    );
  }

  return (
    <div className="rounded border border-red-900/60 bg-red-950/10 p-3" aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">Diagnostic summary</h3>
        <span className="rounded bg-red-950 px-2 py-1 text-xs font-semibold text-red-200">
          {total} {total === 1 ? 'diagnostic' : 'diagnostics'}
        </span>
      </div>
      <ErrorGroup
        title="Lexical errors"
        hint="Invalid characters or token forms found while scanning source characters."
        errors={lexicalErrors}
        sourceLength={sourceLength}
        onSelectDiagnostic={onSelectDiagnostic}
      />
      <ErrorGroup
        title="Syntax errors"
        hint="The token stream does not match the language grammar. End-of-input errors navigate to the reported caret position."
        errors={syntaxErrors}
        sourceLength={sourceLength}
        onSelectDiagnostic={onSelectDiagnostic}
      />
      <ErrorGroup
        title="Semantic errors"
        hint="The parsed program contains a meaning or type error, such as an undeclared identifier or incompatible operands."
        errors={semanticErrors}
        sourceLength={sourceLength}
        onSelectDiagnostic={onSelectDiagnostic}
      />
      <ErrorGroup
        title="Compile-time optimization checks"
        hint="The optimizer checks report divisions whose divisor is proven to be zero."
        errors={divisionByZeroErrors}
        sourceLength={sourceLength}
        onSelectDiagnostic={onSelectDiagnostic}
      />
      {runtimeError ? (
        <section aria-label="Runtime errors" className="rounded border border-amber-900/60 bg-amber-950/20 p-3">
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-amber-200 uppercase">Runtime errors (1)</h3>
          <p className="mb-2 text-xs text-slate-500">Reported while executing the program after compilation. The interpreter does not currently provide a source span for this message.</p>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 rounded bg-amber-950 px-2 py-0.5 text-xs font-semibold uppercase text-amber-300">error</span>
            <p className="break-words text-sm text-amber-100">{runtimeError}</p>
          </div>
          <p className="mt-2 text-xs text-slate-500">Source navigation is unavailable for this runtime message because no source location was reported.</p>
        </section>
      ) : null}
    </div>
  );
}
