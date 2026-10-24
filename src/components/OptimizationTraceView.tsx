import { useEffect, useMemo, useState } from 'react';
import { compareTAC, type OptimizationTrace } from '../compiler/index.ts';
import TacView from './TacView.tsx';
import OptimizationDiffView from './OptimizationDiffView.tsx';

interface OptimizationTraceViewProps {
  trace: OptimizationTrace | null;
  ran: boolean;
  focusRequest?: { stepId: string; requestId: number } | null;
}

export default function OptimizationTraceView({ trace, ran, focusRequest }: OptimizationTraceViewProps) {
  const [selectedId, setSelectedId] = useState('original');
  const [displayMode, setDisplayMode] = useState<'snapshot' | 'diff'>('snapshot');

  useEffect(() => {
    if (focusRequest) {
      setSelectedId(focusRequest.stepId);
      // Pipeline navigation has historically opened the requested TAC snapshot.
      setDisplayMode('snapshot');
    }
  }, [focusRequest?.requestId, focusRequest?.stepId]);

  const selectedIndex = trace?.steps.findIndex((step) => step.id === selectedId) ?? -1;
  const selected = useMemo(
    () => trace?.steps.find((step) => step.id === selectedId) ?? trace?.steps[0] ?? null,
    [trace, selectedId],
  );
  const previousStep = selectedIndex > 0 ? trace?.steps[selectedIndex - 1] ?? null : null;
  const tacUnchanged = Boolean(
    selected && previousStep && !compareTAC(previousStep.tac, selected.tac).changed,
  );
  const isOptimizationPass = Boolean(selected && selected.id !== 'original' && selected.id !== 'final');
  const statusLabel = !selected?.applied
    ? 'Not applied'
    : tacUnchanged
      ? 'Executed — no changes'
      : 'Changed TAC';

  if (!ran || trace === null) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
        Optimization steps are unavailable because optimization did not run.
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-3">
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Optimization steps">
        {trace.steps.map((step, index) => {
          const active = step.id === selected?.id;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => {
                setSelectedId(step.id);
                if (step.id === 'original') setDisplayMode('snapshot');
              }}
              className={`rounded border px-2.5 py-1.5 text-xs transition ${
                active
                  ? 'border-sky-500 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
              role="tab"
              aria-selected={active}
            >
              {index + 1}. {step.name}
            </button>
          );
        })}
      </div>

      {selected && (
        <div>
          <div className="mb-3 rounded border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-100">{selected.name}</h4>
              {isOptimizationPass && (
                <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${!selected.applied ? 'bg-amber-500/10 text-amber-300' : tacUnchanged ? 'bg-sky-500/10 text-sky-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                  {statusLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">{selected.description}</p>
            {selected.note && (
              <p className={`mt-2 text-xs ${selected.applied ? 'text-slate-400' : 'text-amber-300'}`}>{selected.note}</p>
            )}
            {isOptimizationPass && selected.applied && tacUnchanged && (
              <p className="mt-2 text-xs text-sky-300">This pass executed successfully, but the TAC is unchanged from the previous step.</p>
            )}
            {isOptimizationPass && selected.applied && !tacUnchanged && (
              <p className="mt-2 text-xs text-emerald-300">This pass executed and changed the TAC compared with the previous step.</p>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Optimization result view">
            <button
              type="button"
              role="tab"
              aria-selected={displayMode === 'snapshot'}
              onClick={() => setDisplayMode('snapshot')}
              className={`rounded border px-3 py-1.5 text-xs font-medium ${displayMode === 'snapshot' ? 'border-sky-500 bg-sky-500/15 text-sky-200' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
            >
              TAC Snapshot
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={displayMode === 'diff'}
              disabled={selectedIndex <= 0 || previousStep === null}
              onClick={() => setDisplayMode('diff')}
              className={`rounded border px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${displayMode === 'diff' ? 'border-amber-500 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200'}`}
              title={selectedIndex <= 0 ? 'Original TAC has no previous snapshot to compare' : `Compare ${previousStep?.name ?? 'previous step'} with ${selected.name}`}
            >
              Diff from previous step
            </button>
          </div>
          {displayMode === 'diff' && previousStep ? (
            <OptimizationDiffView
              beforeName={previousStep.name}
              afterName={selected.name}
              before={previousStep.tac}
              after={selected.tac}
            />
          ) : (
            <TacView tac={selected.tac} ran />
          )}
        </div>
      )}
    </div>
  );
}
