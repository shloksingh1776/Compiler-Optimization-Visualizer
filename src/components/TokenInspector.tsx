import { useEffect, useMemo, useState } from 'react';
import { TokenType, type Token } from '../compiler/index.ts';
import {
  ALL_TOKEN_FILTERS,
  filterTokens,
  getTokenCategoryOptions,
  getTokenDisplayLexeme,
  sameTokenPosition,
  type TokenFilter,
} from './tokenInspectorUtils.ts';

interface TokenInspectorProps {
  tokens: Token[];
  selectedToken: Token | null;
  onSelectToken: (token: Token | null) => void;
}

export default function TokenInspector({ tokens, selectedToken, onSelectToken }: TokenInspectorProps) {
  const [categoryFilter, setCategoryFilter] = useState<TokenFilter>(ALL_TOKEN_FILTERS);
  const [query, setQuery] = useState('');

  // A source edit creates a new real token stream; do not leave a filter
  // selected for a category that no longer appears in that stream.
  useEffect(() => {
    setCategoryFilter(ALL_TOKEN_FILTERS);
    setQuery('');
  }, [tokens]);

  const tokenCategories = useMemo(() => getTokenCategoryOptions(tokens), [tokens]);
  const filteredTokens = useMemo(
    () => filterTokens(tokens, categoryFilter, query),
    [tokens, categoryFilter, query],
  );
  const selectedIsVisible = selectedToken !== null && filteredTokens.some(({ token }) => sameTokenPosition(selectedToken, token));

  return (
    <div className="overflow-hidden rounded border border-slate-700 bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-700 bg-slate-900/90 p-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-slate-300">
          Search tokens
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search lexeme, type, value, line…"
            aria-label="Search tokens"
            className="w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-300 sm:w-64">
          Filter by category
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.currentTarget.value as TokenFilter)}
            aria-label="Filter by token category"
            className="w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          >
            <option value={ALL_TOKEN_FILTERS}>All categories ({tokens.length})</option>
            {tokenCategories.map(({ value, label, count }) => (
              <option value={value} key={value}>
                {label} ({count})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setCategoryFilter(ALL_TOKEN_FILTERS);
          }}
          className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          Clear filters
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-slate-400">
        <span>Showing {filteredTokens.length} of {tokens.length} tokens</span>
        <span>
          {selectedToken
            ? selectedToken.type === TokenType.EOF
              ? `Selected EOF at ${selectedToken.line}:${selectedToken.column}`
              : `Selected ${selectedToken.type} at ${selectedToken.line}:${selectedToken.column}`
            : 'Select a token lexeme to highlight it in the source editor'}
        </span>
      </div>

      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-slate-800 text-slate-300">
            <tr>
              <th scope="col" className="whitespace-nowrap px-3 py-2">#</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Lexeme</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Token type</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Value</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Line</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Column</th>
              <th scope="col" className="whitespace-nowrap px-3 py-2">Offsets</th>
            </tr>
          </thead>
          <tbody>
            {filteredTokens.map(({ token, index }) => {
              const selected = sameTokenPosition(selectedToken, token);
              return (
                <tr
                  key={`${token.start}:${token.end}:${token.type}`}
                  aria-selected={selected}
                  className={`border-t border-slate-800 transition-colors ${
                    selected ? 'bg-sky-950/80' : 'hover:bg-slate-800/80'
                  }`}
                >
                  <td className="px-3 py-1.5 text-slate-500">{index}</td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-label={`Select ${token.type} token ${getTokenDisplayLexeme(token)} at line ${token.line}, column ${token.column}`}
                      title={token.type === TokenType.EOF ? 'Move editor caret to end of input' : 'Highlight this token in the source editor'}
                      onClick={() => onSelectToken(selected ? null : token)}
                      className={`rounded px-1 py-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${
                        selected ? 'font-semibold text-sky-200' : 'text-slate-100 hover:text-sky-200'
                      }`}
                    >
                      {getTokenDisplayLexeme(token)}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-sky-300">{token.type}</td>
                  <td className="px-3 py-1.5 text-amber-300">{token.value ?? '—'}</td>
                  <td className="px-3 py-1.5 text-slate-300">{token.line}</td>
                  <td className="px-3 py-1.5 text-slate-300">{token.column}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{token.start}:{token.end}</td>
                </tr>
              );
            })}
            {filteredTokens.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center font-sans text-slate-500">
                  No tokens match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selectedToken && !selectedIsVisible && (
        <div className="border-t border-slate-700 px-3 py-2 text-xs text-amber-300">
          The selected token is hidden by the current filters. Clear filters to see its row.
        </div>
      )}
      <div className="border-t border-slate-700 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
        Positions and offsets come directly from the compiler lexer. Whitespace and comments are skipped by MiniC tokenization; EOF has an empty lexeme and a zero-length source span.
      </div>
    </div>
  );
}
