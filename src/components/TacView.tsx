/**
 * TAC VIEW
 *
 * Renders the main program TAC and, for Stage 8, each user-defined function
 * body separately. Function TAC already lives in `TACProgram.functions`; this
 * component now exposes that existing compiler output instead of hiding it.
 */

import { formatInstruction, type TACProgram, type TACFunction } from '../compiler/index.ts';

interface TacViewProps {
  tac: TACProgram | null;
  ran: boolean;
  skippedMessage?: string;
}

function FunctionTacBlock({ fn }: { fn: TACFunction }) {
  return (
    <div className="mt-4 rounded border border-slate-700 bg-slate-950/60 p-3">
      <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Function: <span className="text-sky-300">{fn.returnType} {fn.name}</span>
        <span className="text-slate-500">({fn.parameters.map((p) => `${p.type} ${p.name}`).join(', ')})</span>
      </div>
      <div className="font-mono text-sm leading-6">
        {fn.instructions.length === 0 ? (
          <div className="text-slate-500">No instructions in function body.</div>
        ) : (
          fn.instructions.map((instruction, index) => (
            <div key={index} className="flex gap-3 rounded px-1 hover:bg-slate-800">
              <span className="w-6 shrink-0 text-right text-slate-600">{index + 1}</span>
              <span className="text-slate-100">{formatInstruction(instruction)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TacView({
  tac,
  ran,
  skippedMessage = 'TAC generation was skipped because an earlier phase failed. See the errors below.',
}: TacViewProps) {
  if (!ran || tac === null) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
        {skippedMessage}
      </div>
    );
  }

  const functions = Object.values(tac.functions ?? {});

  return (
    <div>
      <div className="overflow-auto rounded border border-slate-700 bg-slate-900 p-3">
        <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Main Program</div>
        {tac.instructions.length === 0 ? (
          <div className="font-mono text-sm text-slate-500">No main-program instructions were generated.</div>
        ) : (
          <div className="font-mono text-sm leading-6">
            {tac.instructions.map((instruction, index) => (
              <div key={index} className="flex gap-3 rounded px-1 hover:bg-slate-800">
                <span className="w-6 shrink-0 text-right text-slate-600">{index + 1}</span>
                <span className="text-slate-100">{formatInstruction(instruction)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {functions.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">Function Bodies</div>
          {functions.map((fn) => <FunctionTacBlock key={fn.name} fn={fn} />)}
        </div>
      )}
    </div>
  );
}
