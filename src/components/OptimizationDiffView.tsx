import { useMemo } from 'react';
import type { TACFunction, TACProgram } from '../compiler/index.ts';
import { buildOptimizationDiff, type OptimizationDiffRow, type OptimizationDiffRowStatus } from './optimizationDiffUtils.ts';

interface OptimizationDiffViewProps {
  beforeName: string;
  afterName: string;
  before: TACProgram;
  after: TACProgram;
}

const statusLabel: Record<OptimizationDiffRowStatus, string> = {
  unchanged: 'Unchanged',
  changed: 'Changed',
  removed: 'Removed',
  added: 'Added',
};

const statusSymbol: Record<OptimizationDiffRowStatus, string> = {
  unchanged: '=',
  changed: '~',
  removed: '−',
  added: '+',
};

function describeFunctionMetadata(fn: TACFunction | null): string {
  if (!fn) return 'function absent';
  const parameters = fn.parameters.map((parameter) => `${parameter.type} ${parameter.name}`).join(', ');
  const locals = [...(fn.localVariables ?? [])].sort();
  return `${fn.returnType} ${fn.name}(${parameters}); locals: ${locals.length > 0 ? locals.join(', ') : '(none)'}`;
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'red' | 'green' | 'amber' }) {
  const toneClass = {
    neutral: 'border-slate-700 bg-slate-900 text-slate-100',
    red: 'border-red-900/70 bg-red-950/30 text-red-200',
    green: 'border-emerald-900/70 bg-emerald-950/25 text-emerald-200',
    amber: 'border-amber-900/70 bg-amber-950/20 text-amber-200',
  }[tone];
  return (
    <div className={`rounded border px-3 py-2 ${toneClass}`}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}

function DiffRow({ row, index }: { row: OptimizationDiffRow; index: number }) {
  const statusTone = {
    unchanged: 'text-slate-500',
    changed: 'text-amber-300',
    removed: 'text-red-300',
    added: 'text-emerald-300',
  }[row.status];
  const beforeTone = row.status === 'removed' || row.status === 'changed'
    ? 'bg-red-950/30 text-red-200'
    : 'text-slate-300';
  const afterTone = row.status === 'added' || row.status === 'changed'
    ? 'bg-emerald-950/25 text-emerald-200'
    : 'text-slate-300';
  return (
    <tr className="border-t border-slate-800 align-top">
      <td className={`w-7 px-2 py-1.5 text-center font-mono text-xs ${statusTone}`} title={statusLabel[row.status]}>
        {statusSymbol[row.status]}
      </td>
      <td className={`w-1/2 px-2 py-1.5 font-mono text-xs ${beforeTone}`}>
        <span className="mr-2 select-none text-slate-600">{row.beforeIndex === null ? '—' : row.beforeIndex + 1}</span>
        {row.before === null ? <span className="text-slate-600">—</span> : row.before}
        {row.metadataOnly && <span className="mt-1 block font-sans text-[10px] text-amber-300">Instruction metadata changed; printed TAC is identical.</span>}
      </td>
      <td className={`w-1/2 px-2 py-1.5 font-mono text-xs ${afterTone}`}>
        <span className="mr-2 select-none text-slate-600">{row.afterIndex === null ? '—' : row.afterIndex + 1}</span>
        {row.after === null ? <span className="text-slate-600">—</span> : row.after}
      </td>
      <td className="hidden px-2 py-1.5 text-[10px] text-slate-500 md:table-cell">{index + 1}</td>
    </tr>
  );
}

export default function OptimizationDiffView({ beforeName, afterName, before, after }: OptimizationDiffViewProps) {
  const diff = useMemo(() => buildOptimizationDiff(before, after), [before, after]);

  return (
    <div className="space-y-4" aria-label={`Optimization diff: ${beforeName} to ${afterName}`}>
      <div className="rounded border border-slate-700 bg-slate-950/70 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
          <span>{beforeName}</span>
          <span aria-hidden="true" className="text-slate-500">→</span>
          <span>{afterName}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          This compares the actual saved TAC snapshots. Removed instructions are red, added instructions are green, rewrites are paired, and unchanged instructions are neutral. The main program and each function body are compared separately.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCard label="Unchanged" value={diff.counts.unchanged} tone="neutral" />
          <SummaryCard label="Changed / rewritten" value={diff.counts.changed} tone="amber" />
          <SummaryCard label="Removed" value={diff.counts.removed} tone="red" />
          <SummaryCard label="Added" value={diff.counts.added} tone="green" />
        </div>
        {diff.programMetadataChanged && (
          <p className="mt-3 rounded border border-amber-900/70 bg-amber-950/20 p-2 text-xs text-amber-200">
            Program global-variable metadata differs between these snapshots and is not represented by a TAC instruction line.
            <span className="mt-1 block">Before globals: {(before.globalVariables ?? []).join(', ') || '(none)'}</span>
            <span className="block">After globals: {(after.globalVariables ?? []).join(', ') || '(none)'}</span>
          </p>
        )}
      </div>

      {diff.counts.changed === 0 && diff.counts.removed === 0 && diff.counts.added === 0
        && !diff.programMetadataChanged && !diff.sections.some((section) => section.metadataChanged) && (
          <p className="rounded border border-sky-900/60 bg-sky-950/80 p-3 text-xs text-sky-200">
            This step did not change any displayed TAC instructions or tracked scope metadata. The unchanged rows below are the real instructions in both snapshots.
          </p>
        )}

      {diff.sections.map((section) => (
        <section key={section.id} className="overflow-hidden rounded border border-slate-700 bg-slate-950/50">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
            <h5 className="text-xs font-semibold tracking-wide text-slate-200">{section.title}</h5>
            <div className="flex flex-wrap gap-2 text-[10px] text-slate-400">
              <span>{section.counts.changed} changed</span>
              <span>{section.counts.removed} removed</span>
              <span>{section.counts.added} added</span>
              {section.metadataChanged && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Function metadata changed</span>}
            </div>
          </div>
          {section.metadataChanged && (section.beforeFunction || section.afterFunction) && (
            <div className="border-b border-amber-900/50 bg-amber-950/10 px-3 py-2 text-[11px] text-amber-200">
              <div>Before: {describeFunctionMetadata(section.beforeFunction)}</div>
              <div>After: {describeFunctionMetadata(section.afterFunction)}</div>
            </div>
          )}
          {section.rows.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">No TAC instructions in this body before or after this step.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="bg-slate-950 text-[10px] uppercase tracking-wide text-slate-500">
                    <th className="w-7 px-2 py-2" aria-label="Change status">Δ</th>
                    <th className="w-1/2 px-2 py-2">Before · {beforeName}</th>
                    <th className="w-1/2 px-2 py-2">After · {afterName}</th>
                    <th className="hidden px-2 py-2 md:table-cell">Row</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, index) => (
                    <DiffRow key={`${section.id}-${row.beforeIndex ?? 'x'}-${row.afterIndex ?? 'x'}-${index}`} row={row} index={index} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
