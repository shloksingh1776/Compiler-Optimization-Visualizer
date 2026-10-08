/**
 * AST VIEW
 *
 * Renders the syntax tree produced by the parser. All of the layout work is
 * done by `astTree.ts`, which is plain TypeScript; this component only styles
 * the rows it returns. That split is deliberate: the tree structure is the
 * part worth testing, and it is testable without rendering anything.
 */

import { buildAstRows } from './astTree.ts';
import type { Program } from '../compiler/index.ts';

interface AstViewProps {
  /** The tree, or null when an earlier phase failed. */
  ast: Program | null;
  /** True when the failure was in the scanner rather than the parser. */
  lexicalFailed: boolean;
}

export default function AstView({ ast, lexicalFailed }: AstViewProps) {
  // No tree: say which phase stopped, and never show a partial structure.
  if (ast === null) {
    return (
      <div className="rounded border border-slate-700 bg-slate-900 p-4 text-sm text-slate-400">
        {lexicalFailed
          ? 'Syntax analysis was skipped because lexical analysis failed. Fix the lexical errors below.'
          : 'No tree to display: the source has syntax errors. See the errors below.'}
      </div>
    );
  }

  const rows = buildAstRows(ast);

  return (
    <div className="overflow-auto rounded border border-slate-700 bg-slate-900 p-3">
      <div className="font-mono text-sm leading-6 whitespace-pre">
        {rows.map((row) => (
          <div key={row.id} className="rounded px-1 hover:bg-slate-800">
            {/* Box drawing connectors, kept muted so the node names lead. */}
            <span className="text-slate-600">{row.prefix}</span>
            <span className="text-sky-300">{row.kind}</span>
            {row.value !== null && (
              <>
                <span className="text-slate-500">: </span>
                <span className="text-amber-300">{row.value}</span>
              </>
            )}
            {/* Source position, subtle so the tree stays readable. */}
            <span className="ml-3 text-xs text-slate-600">
              [Ln {row.line}, Col {row.column}]
            </span>
          </div>
        ))}
      </div>

      {/* An empty program is valid: `Program` with no statements. */}
      {ast.body.length === 0 && (
        <p className="mt-2 border-t border-slate-800 pt-2 text-xs text-slate-500">
          The program is empty, so the tree is just the root node.
        </p>
      )}
    </div>
  );
}
