/**
 * ERROR PANEL
 *
 * Shows compiler errors grouped by the phase that reported them, so a
 * lexical error is never confused with a syntax error. Both use the same
 * `CompilerError` record from `src/compiler/errors.ts`.
 */

import type { CompilerError } from '../compiler/index.ts';

interface ErrorPanelProps {
  lexicalErrors: readonly CompilerError[];
  syntaxErrors: readonly CompilerError[];
  semanticErrors: readonly CompilerError[];
  divisionByZeroErrors: readonly CompilerError[];
}

function ErrorGroup({
  title,
  hint,
  errors,
}: {
  title: string;
  hint: string;
  errors: readonly CompilerError[];
}) {
  if (errors.length === 0) return null;

  return (
    <div className="mb-3 last:mb-0">
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-red-300 uppercase">
        {title} ({errors.length})
      </h3>
      <p className="mb-2 text-xs text-slate-500">{hint}</p>
      <ul className="space-y-1 font-mono text-sm">
        {errors.map((error, index) => (
          <li key={index} className="text-red-400">
            <span className="text-slate-500">
              line {error.line}, col {error.column}
            </span>
            {'  '}
            {error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ErrorPanel({
  lexicalErrors,
  syntaxErrors,
  semanticErrors,
  divisionByZeroErrors,
}: ErrorPanelProps) {
  const total =
    lexicalErrors.length + syntaxErrors.length + semanticErrors.length + divisionByZeroErrors.length;

  if (total === 0) {
    return (
      <p className="text-sm text-emerald-400">
        No errors. Lexical, syntax and semantic analysis all succeeded.
      </p>
    );
  }

  return (
    <div className="rounded border border-red-900/60 bg-red-950/20 p-3">
      <ErrorGroup
        title="Lexical errors"
        hint="Found while turning characters into tokens."
        errors={lexicalErrors}
      />
      <ErrorGroup
        title="Syntax errors"
        hint="Found while matching the token stream against the grammar."
        errors={syntaxErrors}
      />
      <ErrorGroup
        title="Semantic errors"
        hint="Found while checking that a grammatically valid program is also meaningful (undeclared variables, redeclarations)."
        errors={semanticErrors}
      />
      <ErrorGroup
        title="Division-by-zero errors"
        hint="Found when constant propagation proves a division's divisor is zero."
        errors={divisionByZeroErrors}
      />
    </div>
  );
}
