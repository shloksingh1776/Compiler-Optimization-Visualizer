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
import { compile, OPTIMIZATION_PASSES, type FunctionDecl } from './compiler/index.ts';
import AstView from './components/AstView.tsx';
import SymbolTableView from './components/SymbolTableView.tsx';
import TacView from './components/TacView.tsx';
import OptimizationPanel from './components/OptimizationPanel.tsx';
import ErrorPanel from './components/ErrorPanel.tsx';
import { SAMPLES, DEFAULT_SAMPLE } from './examples/samples.ts';

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

  // The whole compiler runs here, and only when the source actually changes.
  // It is fast enough (microseconds on these programs) to run on every
  // keystroke without debouncing.
  const result = useMemo(() => compile(source), [source]);

  const {
    tokens,
    ast,
    symbols,
    functionSymbols,
    tac,
    optimizedTac,
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
  const functionCount = Object.keys(functionSymbols).length;
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
        <label className="text-sm text-slate-400">
          <span className="mr-2">Example:</span>
          <select
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
            onChange={(event) => {
              const sample = SAMPLES.find((s) => s.id === event.target.value);
              if (sample) setSource(sample.source);
            }}
            defaultValue={DEFAULT_SAMPLE.id}
          >
            {SAMPLES.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- 1. Source ---------------- */}
        <Section number={1} title="Source Code">
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            aria-label="MiniC v1 source code"
            className="h-72 w-full resize-none rounded border border-slate-700 bg-slate-900 p-3 font-mono text-sm outline-none focus:border-slate-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}, {source.length} characters
          </p>
        </Section>

        {/* ---------------- 2. Tokens ---------------- */}
        <Section number={2} title={`Tokens (${tokens.length})`}>
          <div className="h-72 overflow-auto rounded border border-slate-700 bg-slate-900">
            <table className="w-full text-left font-mono text-xs">
              <thead className="sticky top-0 bg-slate-800 text-slate-300">
                <tr>
                  <th className="px-2 py-1">#</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Lexeme</th>
                  <th className="px-2 py-1">Value</th>
                  <th className="px-2 py-1">Ln:Col</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token, index) => (
                  <tr key={index} className="border-t border-slate-800 hover:bg-slate-800">
                    <td className="px-2 py-1 text-slate-500">{index}</td>
                    <td className="px-2 py-1 text-sky-300">{token.type}</td>
                    <td className="px-2 py-1">{token.lexeme}</td>
                    <td className="px-2 py-1 text-amber-300">{token.value ?? ''}</td>
                    <td className="px-2 py-1 text-slate-500">
                      {token.line}:{token.column}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Lexical analysis breaks the source into tokens &mdash; the smallest meaningful pieces
            of the program. Status: {stageStatus.lexical}.
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
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              <span className="h-2 w-2 rounded-full bg-sky-500" aria-hidden="true" />
              Original TAC{tac !== null ? ` (main ${tac.instructions.length}${functionCount > 0 ? ` + ${functionCount} function${functionCount === 1 ? '' : 's'}` : ''})` : ''}
            </h3>
            <div className="border-l-2 border-sky-500/40 pl-3">
              <TacView tac={tac} ran={stageStatus.tac === 'ok'} />
            </div>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              Optimized TAC{optimizedTac !== null ? ` (main ${optimizedTac.instructions.length}${functionCount > 0 ? ` + ${functionCount} function${functionCount === 1 ? '' : 's'}` : ''})` : ''}
            </h3>
            <div className="border-l-2 border-emerald-500/40 pl-3">
              <TacView
                tac={optimizedTac}
                ran={stageStatus.optimization === 'ok'}
                skippedMessage="Optimization did not run: either there was no TAC to optimize, or a compile-time error (such as division by zero) was found. See the errors below."
              />
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Original TAC is generated before optimization. The main program TAC and each function body
          are shown separately. CSE is also applied independently inside each function body;
          calls and control-flow boundaries are handled conservatively.
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
        />
        <p className="mt-2 text-xs text-slate-500">
          {hasErrors
            ? 'A compiler error stops every later stage: generating TAC or optimizing a program that is not valid would only produce misleading results, so nothing after the failing stage runs.'
            : 'Every stage above ran to completion, from lexical analysis through optimization.'}
        </p>
      </Section>
    </div>
  );
}
