import { useMemo, useState } from 'react';
import type { Sample } from '../examples/samples.ts';

interface ExampleSelectorProps {
  samples: readonly Sample[];
  initialId: string;
  loadedId: string;
  onLoad: (sample: Sample) => void;
}

export default function ExampleSelector({ samples, initialId, loadedId, onLoad }: ExampleSelectorProps) {
  const [selectedId, setSelectedId] = useState(initialId);
  const [showDetails, setShowDetails] = useState(false);

  const selected = useMemo(
    () => samples.find((sample) => sample.id === selectedId) ?? samples[0] ?? null,
    [samples, selectedId],
  );
  const categories = useMemo(() => [...new Set(samples.map((sample) => sample.category))], [samples]);

  if (!selected) return null;

  const loaded = selected.id === loadedId;

  return (
    <div className="w-full rounded border border-slate-700 bg-slate-900 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Example Program</div>
          <p className="mt-0.5 text-xs text-slate-500">Choose a ready-made MiniC program to preview or load into the editor.</p>
        </div>
        <span className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-400">{samples.length} examples</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={selected.id}
          onChange={(event) => setSelectedId(event.target.value)}
          aria-label="Select example program"
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-sky-500"
        >
          {categories.map((category) => (
            <optgroup key={category} label={category}>
              {samples.filter((sample) => sample.category === category).map((sample) => (
                <option key={sample.id} value={sample.id}>{sample.title}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onLoad(selected)}
          className="rounded border border-sky-600 bg-sky-600/10 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-600/20"
        >
          {loaded ? 'Reload Example' : 'Load Example'}
        </button>
        <button
          type="button"
          onClick={() => setShowDetails((value) => !value)}
          aria-expanded={showDetails}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200"
        >
          {showDetails ? 'Hide Details' : 'Details'}
        </button>
      </div>

      <div className="mt-3 rounded border border-slate-800 bg-slate-950/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-100">{selected.title}</h3>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">{selected.category}</span>
          {loaded && <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Loaded</span>}
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-400">{selected.description}</p>
        {showDetails && (
          <div className="mt-3 border-t border-slate-800 pt-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Source preview</div>
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-2 font-mono text-xs text-slate-300">{selected.source}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
