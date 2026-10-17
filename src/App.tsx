/**
 * APPLICATION SHELL
 *
 * Shows the compiler pipeline as far as it has been built:
 *
 *      Source Code -> Lexical Analysis -> Tokens
 *                  -> Syntax Analysis  -> AST
 *                  -> Semantic Analysis -> Symbol Table
 *                  -> TAC Generation    -> Three Address Code
 *                  -> Optimization      -> Original vs Optimized TAC
 *                     (constant propagation, constant folding,
 *                      algebraic simplification, dead code elimination)
 *                                       -> Passes run + before/after stats
 *
 * This file contains NO compiler logic. It calls `compile(source)` once and
 * renders the record that comes back. Everything about the order of the
 * phases, what happens when one fails, and the before/after comparison
 * arithmetic (instruction counts, changed/unchanged) lives under
 * `src/compiler/` -- `OptimizationPanel` below only displays the
 * `TACComparison` object `compile()` already computed.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { compile, OPTIMIZATION_PASSES, type CompilerError, type FunctionDecl, type Token } from './compiler/index.ts';
import AstView from './components/AstView.tsx';
import SymbolTableView from './components/SymbolTableView.tsx';
import OptimizationTraceView from './components/OptimizationTraceView.tsx';
import OptimizationPanel from './components/OptimizationPanel.tsx';
import ErrorPanel from './components/ErrorPanel.tsx';
import ExampleSelector from './components/ExampleSelector.tsx';
import CodeEditor from './components/CodeEditor.tsx';
import TokenInspector from './components/TokenInspector.tsx';
import { getDiagnosticSourceRange } from './components/diagnosticUtils.ts';
import { SAMPLES, DEFAULT_SAMPLE, type Sample } from './examples/samples.ts';

/** Section wrapper, so every panel is titled and spaced the same way. */
function Section({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-300 uppercase">
        <span className="text-slate-600">{number}.</span> {title}
      </h2>
      {children}
    </section>
  );
}

export default function App() {
  const [source, setSource] = useState<string>(DEFAULT_SAMPLE.source);
  const [loadedSampleId, setLoadedSampleId] = useState<string>(DEFAULT_SAMPLE.id);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [diagnosticHighlight, setDiagnosticHighlight] = useState<{ start: number; end: number } | null>(null);
  const [sourceNavigationRequestId, setSourceNavigationRequestId] = useState(0);
  const handleSourceChange = (nextSource: string) => {
    setSource(nextSource);
    setSelectedToken(null);
    setDiagnosticHighlight(null);
  };
  const handleTokenSelection = (token: Token | null) => {
    setSelectedToken(token);
    setDiagnosticHighlight(null);
    if (token) setSourceNavigationRequestId((requestId) => requestId + 1);
  };
  const handleDiagnosticSelection = (error: CompilerError) => {
    const sourceRange = getDiagnosticSourceRange(error, source.length);
    setDiagnosticHighlight(sourceRange);
    setSelectedToken(null);
    setSourceNavigationRequestId((requestId) => requestId + 1);
  };
  const loadSample = (sample: Sample) => {
    setSource(sample.source);
    setLoadedSampleId(sample.id);
    setSelectedToken(null);
    setDiagnosticHighlight(null);
  };

  // The whole compiler runs here, and only when the source actually changes.
  // It is fast enough (microseconds on these programs) to run on every
  // keystroke without debouncing.
  const result = useMemo(() => compile(source), [source]);

  const {
    tokens,
    ast,
    symbols,
    functionSymbols,
    optimizationTrace,
    comparison,
    lexicalErrors,
    syntaxErrors,
    semanticErrors,
    divisionByZeroErrors,
    stageStatus,
    output,
    runtimeError,
    returnValue,
  } = result;
  const lineCount = source.split('\n').length;
  const localSymbolCount = Object.values(functionSymbols).reduce((total, entries) => total + entries.length, 0);
  const hasErrors =
    lexicalErrors.length + syntaxErrors.length + semanticErrors.length + divisionByZeroErrors.length > 0;

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Compiler Optimization Visualizer</h1>
          <p className="text-sm text-slate-400">
            MiniC v1 &mdash; lexical analysis, syntax analysis, semantic analysis, AST,
            symbol table, three address code, control flow and optimization
          </p>
        </div>
        <div className="w-full sm:max-w-xl">
          <ExampleSelector
            samples={SAMPLES}
            initialId={DEFAULT_SAMPLE.id}
            loadedId={loadedSampleId}
            onLoad={loadSample}
          />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- 1. Source ---------------- */}
        <Section number={1} title="Source Code">
          <CodeEditor
            source={source}
            onChange={handleSourceChange}
            ariaLabel="MiniC v1 source code"
            tokenHighlight={selectedToken ? { start: selectedToken.start, end: selectedToken.end } : null}
            diagnosticHighlight={diagnosticHighlight}
            navigationRequestId={sourceNavigationRequestId}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <p>{lineCount} {lineCount === 1 ? 'line' : 'lines'}, {source.length} characters</p>
            <p>Tab: indent · Enter: continue indentation · Matching brackets highlighted</p>
          </div>
        </Section>

        {/* ---------------- 2. Interactive Token Inspector ---------------- */}
        <Section number={2} title={`Interactive Token Inspector (${tokens.length})`}>
          <TokenInspector
            tokens={tokens}
            selectedToken={selectedToken}
            onSelectToken={handleTokenSelection}
          />
          <p className="mt-2 text-xs text-slate-500">
            Lexemes, token types, values, line/column positions, and source offsets come from the actual compiler lexer. Select a lexeme to navigate to and highlight its exact source span. Status: {stageStatus.lexical}.
          </p>
        </Section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- 3. AST ---------------- */}
        <Section number={3} title="AST — Abstract Syntax Tree">
          <AstView ast={ast} lexicalFailed={stageStatus.lexical === 'error'} />
          <p className="mt-1 text-xs text-slate-500">
            The AST represents the syntactic structure of the program as a tree. Parentheses are
            not nodes; the grouping they expressed is recorded in the shape of the tree itself.
          </p>
        </Section>

        {/* ---------------- 4. Symbol Table ---------------- */}
        <Section number={4} title={`Symbol Table (${symbols.length} global${localSymbolCount > 0 ? ` + ${localSymbolCount} local` : ''})`}>
          <SymbolTableView
            symbols={symbols}
            functionSymbols={functionSymbols}
            functionDeclarations={ast?.body.filter((statement): statement is FunctionDecl => statement.type === 'FunctionDecl')}
            ran={stageStatus.semantic !== 'skipped'}
          />
          <p className="mt-1 text-xs text-slate-500">
            The symbol table records semantic information about declared identifiers. Global variables are
            shown first, followed by a separate local table for each function containing its parameters
            and local variables.
          </p>
        </Section>
      </div>

      {/* ---------------- 5. Three Address Code ---------------- */}
      <Section number={5} title="Three Address Code">
        <div className="mb-3">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden="true" />
            Optimization Steps
          </h3>
          <OptimizationTraceView trace={optimizationTrace} ran={stageStatus.optimization === 'ok'} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Select a step to inspect the actual TAC snapshot after that pass. Original TAC, each
          existing optimization pass, and final optimized TAC are captured. Main-program TAC and
          each function body are shown separately in every snapshot.
        </p>
        <div className="mt-3">
          <OptimizationPanel passes={OPTIMIZATION_PASSES} comparison={comparison} />
        </div>
      </Section>

      {/* ---------------- 6. Program Output ---------------- */}
      <Section number={6} title="Program Output">
        <div className="min-h-24 rounded border border-slate-700 bg-slate-900 p-3 font-mono text-sm">
          {runtimeError ? (
            <span className="text-red-400">Runtime error: {runtimeError}</span>
          ) : output.length === 0 ? (
            <span className="text-slate-500">No output. Add a print(expression); statement to produce program output.</span>
          ) : (
            output.map((line, index) => <div key={index}>{line}</div>)
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">Program output is produced by executing the optimized TAC and collecting each print statement's value.</p>
      </Section>

      {/* ---------------- 7. Return Value ---------------- */}
      <Section number={7} title="Return Value">
        <div className="min-h-16 rounded border border-slate-700 bg-slate-900 p-3 font-mono text-sm">
          {returnValue === undefined ? (
            <span className="text-slate-500">No return value. Add a return expression; statement to produce one.</span>
          ) : (
            String(returnValue)
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">The return value is produced by executing the first return statement reached in the optimized TAC.</p>
      </Section>

      {/* ---------------- 8. Errors / Diagnostics ---------------- */}
      <Section number={8} title="Errors / Diagnostics">
        <ErrorPanel
          lexicalErrors={lexicalErrors}
          syntaxErrors={syntaxErrors}
          semanticErrors={semanticErrors}
          divisionByZeroErrors={divisionByZeroErrors}
          runtimeError={runtimeError}
          sourceLength={source.length}
          onSelectDiagnostic={handleDiagnosticSelection}
        />
        <p className="mt-2 text-xs text-slate-500">
          {hasErrors
            ? 'A compiler error stops later phases. Select Go to source on a located diagnostic to navigate to the reported source span.'
            : runtimeError
              ? 'Compilation and optimization completed, but program execution reported a runtime error.'
              : 'Every compiler stage above ran to completion, from lexical analysis through optimization.'}
        </p>
      </Section>
    </div>
  );
}
