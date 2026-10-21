import { useMemo, useState } from 'react';
import type { CompilationResult } from '../compiler/index.ts';
import {
  getCompilerPipelineSteps,
  type CompilerPipelineStageId,
  type CompilerPipelineStageState,
} from './pipelineUtils.ts';

interface CompilerPipelineProps {
  result: CompilationResult;
  onSelectStage?: (stageId: CompilerPipelineStageId) => void;
}

const stateLabel: Record<CompilerPipelineStageState, string> = {
  complete: 'Completed',
  error: 'Failed',
  skipped: 'Not reached',
  'not-needed': 'Not needed',
};

const stateStyle: Record<CompilerPipelineStageState, string> = {
  complete: 'border-emerald-900/70 bg-emerald-950/25 text-emerald-300',
  error: 'border-red-800 bg-red-950/40 text-red-300',
  skipped: 'border-slate-700 bg-slate-900 text-slate-400',
  'not-needed': 'border-slate-700 bg-slate-900/50 text-slate-400',
};

const stateMark: Record<CompilerPipelineStageState, string> = {
  complete: '✓',
  error: '!',
  skipped: '—',
  'not-needed': '·',
};

export default function CompilerPipeline({ result, onSelectStage }: CompilerPipelineProps) {
  const [selectedStage, setSelectedStage] = useState<CompilerPipelineStageId>('source');
  const steps = useMemo(() => getCompilerPipelineSteps(result), [result]);
  const selected = steps.find((step) => step.id === selectedStage) ?? steps[0]!;
  const failure = steps.find((step) => step.state === 'error');

  const selectStage = (stageId: CompilerPipelineStageId, targetId: string) => {
    setSelectedStage(stageId);
    onSelectStage?.(stageId);
    // The selected result may live in a previously hidden workspace tab. Wait
    // until React commits the tab change before scrolling to its target.
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
    });
  };

  return (
    <section className="mb-6 scroll-mt-4" aria-labelledby="compiler-pipeline-heading">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="compiler-pipeline-heading" className="text-sm font-semibold tracking-wide text-slate-300 uppercase">
            Interactive Compiler Pipeline
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Select a phase to jump to its existing result. Statuses come from this compilation; phases are not rerun when selected.
          </p>
        </div>
        {failure ? (
          <p className="rounded border border-red-900/70 bg-red-950/30 px-2.5 py-1.5 text-xs text-red-200" role="status">
            {failure.label === 'Output' ? 'Execution failed at Output' : `Compilation stopped at ${failure.label}`}
          </p>
        ) : (
          <p className="rounded border border-emerald-900/70 bg-emerald-950/20 px-2.5 py-1.5 text-xs text-emerald-300" role="status">
            {result.optimizedTac ? 'All compiler phases completed' : 'Pipeline results updating'}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded border border-slate-700 bg-slate-900/80 p-3">
        <div className="flex min-w-max items-stretch gap-2" role="group" aria-label="Compiler pipeline phases">
          {steps.map((step, index) => (
            <div className="flex items-center gap-2" key={step.id}>
              <button
                type="button"
                onClick={() => selectStage(step.id, step.targetId)}
                aria-pressed={selectedStage === step.id}
                aria-label={`${step.label}: ${stateLabel[step.state]}. ${step.summary}`}
                className={`w-36 rounded border p-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-sky-500 ${
                  selectedStage === step.id
                    ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/30'
                    : 'border-slate-700 bg-slate-950 hover:border-slate-500'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-100">{step.label}</span>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${stateStyle[step.state]}`}>
                    {stateMark[step.state]}
                  </span>
                </span>
                <span className={`mt-2 inline-flex rounded border px-1.5 py-0.5 text-[10px] ${stateStyle[step.state]}`}>
                  {stateLabel[step.state]}
                </span>
              </button>
              {index < steps.length - 1 ? (
                <span className="text-lg text-slate-600" aria-hidden="true">→</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 rounded border border-slate-800 bg-slate-900/60 p-3" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-100">{selected.label}</h3>
          <span className={`rounded border px-2 py-0.5 text-[11px] ${stateStyle[selected.state]}`}>
            {stateLabel[selected.state]}
          </span>
          <span className="text-xs text-slate-500">Selected phase</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">{selected.description}</p>
        <p className={`mt-2 text-sm ${selected.state === 'error' ? 'text-red-300' : selected.state === 'skipped' ? 'text-slate-400' : 'text-sky-200'}`}>
          {selected.summary}
        </p>
        {selected.state === 'skipped' ? (
          <p className="mt-1 text-xs text-slate-500">This phase did not run because an earlier phase did not complete successfully.</p>
        ) : null}
        {selected.state === 'not-needed' ? (
          <p className="mt-1 text-xs text-slate-500">Compilation succeeded. This valid program does not require interpreter execution to produce a print output or top-level return value.</p>
        ) : null}
      </div>
    </section>
  );
}
