/**
 * SYMBOL TABLE VIEW
 *
 * Shows the global symbol table plus the local symbol table for every
 * user-defined function. The compiler keeps these collections separate so
 * existing global-symbol behaviour remains backward compatible.
 */

import type { FunctionDecl } from '../compiler/index.ts';
import type { Symbol } from '../compiler/index.ts';

interface SymbolTableViewProps {
  symbols: readonly Symbol[];
  functionSymbols?: Readonly<Record<string, Symbol[]>>;
  functionDeclarations?: readonly FunctionDecl[];
  ran: boolean;
}

function SymbolRows({ symbols, functionName, parameters }: { symbols: readonly Symbol[]; functionName?: string; parameters?: FunctionDecl['parameters'] }) {
  const parameterNames = new Set((parameters ?? []).map((p) => p.name));
  return (
    <table className="w-full text-left font-mono text-sm">
      <thead className="sticky top-0 bg-slate-800 text-slate-300">
        <tr>
          <th className="px-3 py-1.5">Name</th>
          <th className="px-3 py-1.5">Kind</th>
          <th className="px-3 py-1.5">Type</th>
          <th className="px-3 py-1.5">Scope</th>
          {functionName !== undefined && <th className="px-3 py-1.5">Function</th>}
          <th className="px-3 py-1.5">Declaration</th>
          <th className="px-3 py-1.5">Initialized</th>
        </tr>
      </thead>
      <tbody>
        {symbols.map((symbol) => {
          const isParameter = functionName !== undefined && parameterNames.has(symbol.name);
          return (
            <tr key={`${functionName ?? 'global'}-${symbol.name}`} className="border-t border-slate-800 hover:bg-slate-800">
              <td className="px-3 py-1.5 text-amber-300">{symbol.name}</td>
              <td className="px-3 py-1.5 text-slate-400">{isParameter ? 'parameter' : symbol.kind}</td>
              <td className="px-3 py-1.5 text-sky-300">{symbol.type}</td>
              <td className="px-3 py-1.5 text-slate-400">{symbol.scope}</td>
              {functionName !== undefined && <td className="px-3 py-1.5 text-slate-400">{functionName}</td>}
              <td className="px-3 py-1.5 text-slate-400">Ln {symbol.declaredLine}, Col {symbol.declaredColumn}</td>
              <td className={symbol.initialized ? 'px-3 py-1.5 text-emerald-400' : 'px-3 py-1.5 text-slate-500'}>
                {symbol.initialized ? 'Yes' : 'No'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function SymbolTableView({ symbols, functionSymbols = {}, functionDeclarations = [], ran }: SymbolTableViewProps) {
  if (!ran) {
    return <div className="rounded border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">Semantic analysis was skipped because an earlier phase failed. See the errors below.</div>;
  }

  const functions = Object.entries(functionSymbols);

  return (
    <div className="space-y-3">
      <div className="overflow-auto rounded border border-slate-700 bg-slate-900">
        {symbols.length === 0 ? (
          <div className="p-4 text-sm text-slate-400">No global variables have been declared.</div>
        ) : (
          <SymbolRows symbols={symbols} />
        )}
      </div>

      {functions.map(([functionName, localSymbols]) => {
        const fn = functionDeclarations.find((candidate) => candidate.name === functionName);
        return (
          <div key={functionName} className="overflow-auto rounded border border-slate-700 bg-slate-900">
            <div className="border-b border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold tracking-wide text-slate-300 uppercase">
              Local Symbols — {fn ? `${fn.returnType} ` : ''}{functionName}
            </div>
            {localSymbols.length === 0 ? (
              <div className="p-4 text-sm text-slate-400">No local variables or parameters.</div>
            ) : (
              <SymbolRows symbols={localSymbols} functionName={functionName} parameters={fn?.parameters} />
            )}
          </div>
        );
      })}
    </div>
  );
}
