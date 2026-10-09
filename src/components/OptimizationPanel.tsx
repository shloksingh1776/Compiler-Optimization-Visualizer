/**
 * OPTIMIZATION PANEL
 *
 * Shows three things, all driven entirely by real compiler output:
 *   1. A one-line explanation of what optimization does to the TAC.
 *   2. The ordered list of optimization passes that ran, each with a short
 *      description of what it does (from `OPTIMIZATION_PASSES`, the
 *      compiler's own single source of truth -- this component never
 *      invents or hardcodes that information itself).
 *   3. The before/after statistics from `TACComparison` -- instruction
 *      counts, how many were removed, and a clear changed/unchanged
 *      indicator that never claims an optimization happened when it did not.
 *
 * All of the actual comparison arithmetic lives in
 * `src/compiler/optimizer/comparison.ts`; this component only renders the
 * `TACComparison` object it is handed.
 */

import type { OptimizationPassInfo, TACComparison } from '../compiler/index.ts';

interface OptimizationPanelProps {
  passes: readonly OptimizationPassInfo[];
  /** Null exactly when optimization did not run (an earlier phase failed). */
  comparison: TACComparison | null;
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 px-3 py-2">
      <div className="text-lg font-semibold text-slate-100">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default function OptimizationPanel({ passes, comparison }: OptimizationPanelProps) {
  return (
    <div className="rounded border border-slate-700 bg-slate-900 p-3">
      <p className="mb-3 text-sm text-slate-400">
        Optimization transforms the generated TAC into an equivalent form that can be simpler or
        contain fewer instructions. The six optimization passes are applied conservatively around
        control-flow constructs such as if/else and while loops.
      </p>

      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Optimization Passes
      </h4>
      <ol className="mb-4 space-y-1.5">
        {passes.map((pass, index) => (
          <li key={pass.name} className="flex gap-2 text-sm">
            <span className="mt-0.5 shrink-0 font-mono text-xs text-slate-600">{index + 1}.</span>
            <span>
              <span className="font-medium text-slate-200">{pass.name}</span>
              <span className="text-slate-400"> &mdash; {pass.description}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Statistics</h4>
        <span className="text-[11px] text-slate-600">Main program + function bodies</span>
      </div>
      {comparison === null ? (
        <p className="text-sm text-slate-400">
          Optimization did not run because an earlier stage failed. See the errors below.
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <StatCard label="Original instructions" value={comparison.originalInstructionCount} />
            <StatCard label="Optimized instructions" value={comparison.optimizedInstructionCount} />
            <StatCard label="Instructions removed" value={comparison.removedInstructionCount} />
          </div>
          {comparison.changed ? (
            <p className="text-sm text-emerald-400">
              Optimization changed the program &mdash; see the panels above for exactly which
              lines.
            </p>
          ) : (
            <p className="text-sm text-slate-400">
              No optimizations changed the TAC. Every instruction was already as simple as this
              optimizer can make it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
