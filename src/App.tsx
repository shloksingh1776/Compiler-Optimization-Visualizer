import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { compile, OPTIMIZATION_PASSES, type CompilerError, type FunctionDecl, type Token } from './compiler/index.ts';
import AstView from './components/AstView.tsx';
import SymbolTableView from './components/SymbolTableView.tsx';
import OptimizationTraceView from './components/OptimizationTraceView.tsx';
import OptimizationPanel from './components/OptimizationPanel.tsx';
import ErrorPanel from './components/ErrorPanel.tsx';
import ExampleSelector from './components/ExampleSelector.tsx';
import CodeEditor from './components/CodeEditor.tsx';
import TokenInspector from './components/TokenInspector.tsx';
import CompilerPipeline from './components/CompilerPipeline.tsx';
import TacView from './components/TacView.tsx';
import type { CompilerPipelineStageId } from './components/pipelineUtils.ts';
import { getDiagnosticSourceRange } from './components/diagnosticUtils.ts';
import { clampEditorRatio, getWorkspaceTabForPipelineStage, WORKSPACE_TABS, type WorkspaceTabId } from './components/workspaceUtils.ts';
import { SAMPLES, DEFAULT_SAMPLE, type Sample } from './examples/samples.ts';

type ThemeMode = 'dark' | 'light';

/** Consistent section heading used across the source pane and workspace tabs. */
function Section({
  number,
  title,
  children,
  id,
}: {
  number: number;
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mb-4 scroll-mt-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-wide text-slate-300">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-800 text-xs text-sky-300">
          {String(number).padStart(2, '0')}
        </span>
        <span>{title}</span>
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
  const [pipelineTraceFocus, setPipelineTraceFocus] = useState<'original' | 'final'>('original');
  const [pipelineTraceFocusRequestId, setPipelineTraceFocusRequestId] = useState(0);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTabId>('tokens');
  const [editorRatio, setEditorRatio] = useState(45);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem('compiler-visualizer-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const workspaceRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    try {
      window.localStorage.setItem('compiler-visualizer-theme', theme);
    } catch {
      // Theme preference is optional; the current session still works if storage is unavailable.
    }
  }, [theme]);

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

  // Compile exactly once per source value. Workspace tabs only select already-produced results.
  const result = useMemo(() => compile(source), [source]);

  const handlePipelineStageSelect = (stageId: CompilerPipelineStageId) => {
    const nextTab = getWorkspaceTabForPipelineStage(stageId, result.stageStatus);
    if (nextTab) setActiveWorkspaceTab(nextTab);
    if (stageId === 'tac' || stageId === 'optimization') {
      setPipelineTraceFocus(stageId === 'tac' ? 'original' : 'final');
      setPipelineTraceFocusRequestId((requestId) => requestId + 1);
    }
  };

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current || !workspaceRef.current) return;
    const bounds = workspaceRef.current.getBoundingClientRect();
    if (bounds.width <= 0) return;
    setEditorRatio(clampEditorRatio(((event.clientX - bounds.left) / bounds.width) * 100));
  };

  const stopResizing = () => {
    resizingRef.current = false;
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setEditorRatio((current) => clampEditorRatio(current - 2));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setEditorRatio((current) => clampEditorRatio(current + 2));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setEditorRatio(32);
    } else if (event.key === 'End') {
      event.preventDefault();
      setEditorRatio(65);
    }
  };

  const {
    tokens,
    ast,
    symbols,
    functionSymbols,
    tac,
    optimizedTac,
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
  const hasCompilerErrors =
    lexicalErrors.length + syntaxErrors.length + semanticErrors.length + divisionByZeroErrors.length > 0;
  const statusLabel = hasCompilerErrors
    ? 'Compilation needs attention'
    : runtimeError
      ? 'Execution error'
      : optimizedTac
        ? 'Compilation successful'
        : 'Compiler results updating';
  const statusClass = hasCompilerErrors || runtimeError
    ? 'border-red-800 bg-red-950/30 text-red-200'
    : optimizedTac
      ? 'border-emerald-800 bg-emerald-950/25 text-emerald-200'
      : 'border-slate-700 bg-slate-900 text-slate-300';

  const tabContent: Record<WorkspaceTabId, ReactNode> = {
    tokens: (
      <Section number={2} id="token-inspector" title={`Interactive Token Inspector (${tokens.length})`}>
        <TokenInspector tokens={tokens} selectedToken={selectedToken} onSelectToken={handleTokenSelection} />
        <p className="mt-3 text-xs text-slate-500">
          Lexemes, token types, values, source positions and offsets come from the actual lexer. Select a lexeme to navigate to and highlight its source span. Lexer status: {stageStatus.lexical}.
        </p>
      </Section>
    ),
    ast: (
      <Section number={3} id="ast-view" title="AST — Abstract Syntax Tree">
        <AstView ast={ast} lexicalFailed={stageStatus.lexical === 'error'} />
        <p className="mt-3 text-xs text-slate-500">
          The AST shows the program's parsed structure. Parentheses are represented through tree shape rather than separate nodes.
        </p>
      </Section>
    ),
    symbols: (
      <Section number={4} id="symbol-table" title={`Symbol Table (${symbols.length} global${localSymbolCount > 0 ? ` + ${localSymbolCount} local` : ''})`}>
        <SymbolTableView
          symbols={symbols}
          functionSymbols={functionSymbols}
          functionDeclarations={ast?.body.filter((statement): statement is FunctionDecl => statement.type === 'FunctionDecl')}
          ran={stageStatus.semantic !== 'skipped'}
        />
        <p className="mt-3 text-xs text-slate-500">
          Global symbols appear first, followed by each function's parameter and local-symbol table. Function-visible globals remain listed in the global scope.
        </p>
      </Section>
    ),
    tac: (
      <Section number={5} id="tac-view" title="Original Three Address Code">
        <TacView tac={tac} ran={stageStatus.tac === 'ok'} />
        <p className="mt-3 text-xs text-slate-500">
          This view displays the TAC produced by the generator before optimization. Function bodies are shown separately from main-program instructions.
        </p>
      </Section>
    ),
    optimization: (
      <>
        <Section number={6} id="optimization-trace" title="Pass-by-Pass Optimization">
          <OptimizationTraceView
            trace={optimizationTrace}
            ran={stageStatus.optimization === 'ok'}
            focusRequest={{ stepId: pipelineTraceFocus, requestId: pipelineTraceFocusRequestId }}
          />
          <p className="mt-3 text-xs text-slate-500">
            Every snapshot comes from the actual optimizer. The main program and function bodies are shown independently at each step.
          </p>
        </Section>
        <div className="mt-5">
          <OptimizationPanel passes={OPTIMIZATION_PASSES} comparison={comparison} />
        </div>
      </>
    ),
    output: (
      <div className="grid gap-4 xl:grid-cols-2">
        <Section number={7} id="program-output" title="Program Output">
          <div className={`min-h-28 rounded-lg border p-4 font-mono text-sm ${runtimeError ? 'border-red-900/60 bg-red-950/20' : 'border-slate-700 bg-slate-950/60'}`}>
            {runtimeError ? (
              <span className="text-red-300">Runtime error: {runtimeError}</span>
            ) : output.length === 0 ? (
              <span className="text-slate-500">No output. Add a print(expression); statement to produce program output.</span>
            ) : (
              output.map((line, index) => <div key={index}>{line}</div>)
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">Output is collected by executing the optimized TAC; no output is fabricated for programs that were not executed.</p>
        </Section>
        <Section number={8} id="return-value" title="Return Value">
          <div className="min-h-28 rounded-lg border border-slate-700 bg-slate-950/60 p-4 font-mono text-sm">
            {returnValue === undefined ? (
              <span className="text-slate-500">No top-level return value is available.</span>
            ) : (
              <span className="text-emerald-300">{String(returnValue)}</span>
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">Shows the value reported by the existing interpreter result, when one is available.</p>
        </Section>
      </div>
    ),
    diagnostics: (
      <Section number={9} id="diagnostics" title="Errors / Diagnostics">
        <ErrorPanel
          lexicalErrors={lexicalErrors}
          syntaxErrors={syntaxErrors}
          semanticErrors={semanticErrors}
          divisionByZeroErrors={divisionByZeroErrors}
          runtimeError={runtimeError}
          sourceLength={source.length}
          onSelectDiagnostic={handleDiagnosticSelection}
        />
        <p className="mt-3 text-xs text-slate-500">
          {hasCompilerErrors
            ? 'A compiler error prevents later phases from running. Located diagnostics can navigate to the reported source span.'
            : runtimeError
              ? 'Compilation completed, but execution reported a runtime error.'
              : 'No diagnostic is currently reported by the compiler or interpreter.'}
        </p>
      </Section>
    ),
  };

  const handleWorkspaceTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = WORKSPACE_TABS.findIndex((tab) => tab.id === activeWorkspaceTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % WORKSPACE_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = WORKSPACE_TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = WORKSPACE_TABS[nextIndex]!;
    setActiveWorkspaceTab(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`workspace-tab-${nextTab.id}`)?.focus());
  };

  return (
    <main className="app-shell min-h-screen bg-slate-950 p-3 text-slate-100 sm:p-5 xl:p-7" data-theme={theme}>
      <header className="mb-5 flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-700/60 bg-sky-500/10 font-mono text-sm font-bold text-sky-300">C</span>
            <p className="text-xs font-semibold tracking-[0.2em] text-sky-300 uppercase">MiniC Lab · Compiler Design</p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Compiler Optimization Visualizer</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Explore lexical analysis, syntax trees, symbol tables, three-address code and six real optimization passes in one workspace.
          </p>
          <span className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${statusClass}`} role="status">
            <span className={`h-2 w-2 rounded-full ${hasCompilerErrors || runtimeError ? 'bg-red-400' : optimizedTac ? 'bg-emerald-400' : 'bg-slate-400'}`} />
            {statusLabel}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end 2xl:w-[min(54rem,52%)]">
          <div className="min-w-0 flex-1">
            <p className="mb-1 block text-xs font-medium text-slate-400">Load example program</p>
            <div>
              <ExampleSelector samples={SAMPLES} initialId={DEFAULT_SAMPLE.id} loadedId={loadedSampleId} onLoad={loadSample} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-pressed={theme === 'light'}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <span aria-hidden="true">{theme === 'dark' ? '☼' : '◐'}</span>
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
        </div>
      </header>

      <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:p-4">
        <CompilerPipeline result={result} onSelectStage={handlePipelineStageSelect} />
      </div>

      <section aria-label="Compiler workspace" className="workspace-shell">
        <div
          className="workspace-split"
          ref={workspaceRef}
          style={{ gridTemplateColumns: `minmax(0, ${editorRatio}fr) 12px minmax(0, ${100 - editorRatio}fr)` }}
        >
          <div className="workspace-pane workspace-pane--source">
            <div className="workspace-pane-heading">
              <div>
                <p className="workspace-eyebrow">01 / Source</p>
                <h2 className="text-base font-semibold text-slate-100">Source editor</h2>
              </div>
              <span className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 font-mono text-[11px] text-slate-400">MiniC v1</span>
            </div>
            <CodeEditor
              source={source}
              onChange={handleSourceChange}
              ariaLabel="MiniC v1 source code"
              tokenHighlight={selectedToken ? { start: selectedToken.start, end: selectedToken.end } : null}
              diagnosticHighlight={diagnosticHighlight}
              navigationRequestId={sourceNavigationRequestId}
              theme={theme}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <p>{lineCount} {lineCount === 1 ? 'line' : 'lines'} · {source.length} characters</p>
              <p>Tab: indent · Enter: continue indentation</p>
            </div>
          </div>

          <div
            className="workspace-resizer"
            role="separator"
            aria-label="Resize editor and workspace panels"
            aria-orientation="vertical"
            aria-valuemin={32}
            aria-valuemax={65}
            aria-valuenow={Math.round(editorRatio)}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={stopResizing}
            onPointerCancel={stopResizing}
            onLostPointerCapture={stopResizing}
            onKeyDown={handleResizeKeyDown}
            title="Drag to resize, or use the left and right arrow keys"
          >
            <span aria-hidden="true" />
          </div>

          <div className="workspace-pane workspace-pane--results">
            <div className="workspace-pane-heading workspace-pane-heading--results">
              <div>
                <p className="workspace-eyebrow">02 / Analysis</p>
                <h2 className="text-base font-semibold text-slate-100">Compiler workspace</h2>
              </div>
              <span className="text-xs text-slate-500">Results update with source</span>
            </div>
            <div className="workspace-tabs-wrap">
              <div className="workspace-tabs" role="tablist" aria-label="Compiler result views" onKeyDown={handleWorkspaceTabKeyDown}>
                {WORKSPACE_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    id={`workspace-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeWorkspaceTab === tab.id}
                    aria-controls={`workspace-panel-${tab.id}`}
                    tabIndex={activeWorkspaceTab === tab.id ? 0 : -1}
                    title={tab.description}
                    onClick={() => setActiveWorkspaceTab(tab.id)}
                    className={`workspace-tab ${activeWorkspaceTab === tab.id ? 'workspace-tab--active' : ''}`}
                  >
                    <span className="workspace-tab-marker" aria-hidden="true">{tab.marker}</span>
                    {tab.label}
                    {tab.id === 'diagnostics' && (hasCompilerErrors || runtimeError) ? <span className="workspace-tab-alert" aria-label="Diagnostics present" /> : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="workspace-panel-content">
              {WORKSPACE_TABS.map((tab) => (
                <div
                  key={tab.id}
                  id={`workspace-panel-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={`workspace-tab-${tab.id}`}
                  hidden={activeWorkspaceTab !== tab.id}
                  className="workspace-tabpanel"
                >
                  {tabContent[tab.id]}
                </div>
              ))}
            </div>
            <footer className="workspace-footer">
              <span>{WORKSPACE_TABS.find((tab) => tab.id === activeWorkspaceTab)?.description}</span>
              <span>{stageStatus.optimization === 'ok' ? 'Optimization trace ready' : 'Optimization trace unavailable'}</span>
            </footer>
          </div>
        </div>
      </section>

      <footer className="app-footer">
        <span>Compiler phases run once per source update; switching tabs does not rerun compilation.</span>
        <span>Stage 8 · Workspace and UI Polish</span>
      </footer>
    </main>
  );
}
