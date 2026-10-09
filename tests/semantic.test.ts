/**
 * TESTS FOR PHASE 4: SEMANTIC ANALYSIS AND THE SYMBOL TABLE
 *
 * These tests call `analyze()` directly on a parsed AST, so the semantic
 * analyser is exercised on its own, with no dependency on the pipeline or on
 * React. Pipeline-level behaviour (which phases run, which get skipped) is
 * covered separately in tests/pipeline.test.ts.
 *
 * Run them with: npm test
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { SymbolTable } from '../src/compiler/semantic/symbolTable.ts';
import type { Program } from '../src/compiler/parser/ast.ts';
import type { CompilerError } from '../src/compiler/errors.ts';
import type { SemanticResult } from '../src/compiler/semantic/analyzer.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Lex and parse source that is expected to be syntactically valid. */
function astOf(source: string): Program {
  const { tokens, errors: lexErrors } = tokenize(source);
  if (lexErrors.length > 0) {
    throw new Error(`Unexpected lexical errors: ${JSON.stringify(lexErrors)}`);
  }
  const { program, errors } = parse(tokens);
  if (program === null) {
    throw new Error(`Unexpected syntax errors: ${JSON.stringify(errors)}`);
  }
  return program;
}

/** Run semantic analysis on source that is expected to parse cleanly. */
function analyzeSource(source: string): SemanticResult {
  return analyze(astOf(source));
}

/** Run semantic analysis and assert there are no errors. */
function analyzeOk(source: string): SemanticResult {
  const result = analyzeSource(source);
  if (result.errors.length > 0) {
    throw new Error(`Unexpected semantic errors: ${JSON.stringify(result.errors)}`);
  }
  return result;
}

/** Index helper for the error array. */
function errorAt(errors: readonly CompilerError[], index: number): CompilerError {
  const error = errors[index];
  if (error === undefined) {
    throw new Error(`No error at index ${index} (only ${errors.length})`);
  }
  return error;
}

/** Find a symbol by name, failing the test if it is missing. */
function symbolNamed(result: SemanticResult, name: string) {
  const symbol = result.symbols.find((s) => s.name === name);
  if (symbol === undefined) {
    throw new Error(`Expected symbol '${name}', found: ${result.symbols.map((s) => s.name)}`);
  }
  return symbol;
}

/**
 * Build a minimal, valid Symbol literal for tests that exercise SymbolTable
 * directly rather than going through the analyser. Keeps those tests focused
 * on the behaviour they are actually checking (declare/lookup/redeclare)
 * instead of repeating every field at every call site.
 */
function makeTestSymbol(
  name: string,
  declaredLine: number,
  declaredColumn: number
): {
  name: string;
  kind: 'variable';
  type: 'int';
  scope: 'global';
  declaredLine: number;
  declaredColumn: number;
  initialized: boolean;
} {
  return {
    name,
    kind: 'variable',
    type: 'int',
    scope: 'global',
    declaredLine,
    declaredColumn,
    initialized: true,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Empty program                                                    */
/* ------------------------------------------------------------------ */

describe('semantic analysis: empty program', () => {
  it('analyses an empty program with no symbols and no errors', () => {
    const result = analyzeOk('');
    expect(result.symbols.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('analyses a program of only comments and whitespace', () => {
    const result = analyzeOk('// nothing here\n\n   ');
    expect(result.symbols.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2-4. Declarations                                                    */
/* ------------------------------------------------------------------ */

describe('semantic analysis: declarations (RULE 1)', () => {
  it('2. declares a variable with no initializer', () => {
    const result = analyzeOk('int a;');
    expect(result.symbols.length).toBe(1);
    const a = symbolNamed(result, 'a');
    expect(a.type).toBe('int');
  });

  it('3. declares a variable with an initializer', () => {
    const result = analyzeOk('int a = 10;');
    expect(result.symbols.length).toBe(1);
    expect(symbolNamed(result, 'a').name).toBe('a');
  });

  it('4. declares multiple variables', () => {
    const result = analyzeOk('int a = 1;\nint b = 2;\nint c;');
    expect(result.symbols.length).toBe(3);
    expect(result.symbols.map((s) => s.name)).toEqual(['a', 'b', 'c']);
  });
});

/* ------------------------------------------------------------------ */
/* 5-6. Valid use and assignment                                        */
/* ------------------------------------------------------------------ */

describe('semantic analysis: valid identifier use and assignment', () => {
  it('5. accepts a declared identifier used in a later initializer', () => {
    const result = analyzeOk('int a = 10;\nint b = a + 5;');
    expect(result.errors.length).toBe(0);
    expect(result.symbols.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('6. accepts assignment to a previously declared variable', () => {
    const result = analyzeOk('int a;\na = 10;');
    expect(result.errors.length).toBe(0);
    expect(result.symbols.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 7-8. Undeclared identifiers                                          */
/* ------------------------------------------------------------------ */

describe('semantic analysis: undeclared identifiers (RULES 3, 4, 5)', () => {
  it('7. reports an undeclared identifier in an initializer', () => {
    const result = analyzeSource('int a = b + 1;');
    expect(result.errors.length).toBe(1);
    const error = errorAt(result.errors, 0);
    expect(error.stage).toBe('semantic');
    expect(error.severity).toBe('error');
    expect(error.message).toContain("'b'");
    // `a` was never entered: its initializer was invalid.
    expect(result.symbols.length).toBe(0);
  });

  it('8. reports assignment to an undeclared variable', () => {
    const result = analyzeSource('a = 10;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'a'");
    expect(errorAt(result.errors, 0).message.toLowerCase()).toContain('undeclared');
  });

  it('reports an undeclared identifier on the right of an assignment', () => {
    const result = analyzeSource('int a;\na = b + 1;');
    // `a` itself is fine; `b` on the right hand side is not.
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'b'");
  });
});

/* ------------------------------------------------------------------ */
/* 9. Redeclaration                                                     */
/* ------------------------------------------------------------------ */

describe('semantic analysis: redeclaration (RULE 2)', () => {
  it('9. reports a redeclaration and keeps the original symbol', () => {
    const result = analyzeSource('int a = 10;\nint a = 20;');
    expect(result.errors.length).toBe(1);
    const error = errorAt(result.errors, 0);
    expect(error.message).toContain('already been declared');
    expect(error.message).toContain('line 1');

    // Exactly one symbol survives, and it is the FIRST declaration.
    expect(result.symbols.length).toBe(1);
    expect(symbolNamed(result, 'a').declaredLine).toBe(1);
  });

  it('positions a redeclaration error at the SECOND declaration', () => {
    const result = analyzeSource('int a = 10;\nint a = 20;');
    // Line 2, column 5 is where the second `a` sits.
    expect(errorAt(result.errors, 0).line).toBe(2);
    expect(errorAt(result.errors, 0).column).toBe(5);
  });

  it('reports a redeclaration even with no initializer on either side', () => {
    const result = analyzeSource('int a;\nint a;');
    expect(result.errors.length).toBe(1);
    expect(result.symbols.length).toBe(1);
  });

  it('does not silently overwrite the symbol table', () => {
    // Directly exercise SymbolTable.declare(), since this guarantee is its
    // job specifically, independent of the analyser that calls it.
    const table = new SymbolTable();
    const first = table.declare(makeTestSymbol('a', 1, 5));
    const second = table.declare(makeTestSymbol('a', 2, 5));
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(table.lookup('a')?.declaredLine).toBe(1);
    expect(table.size).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 10. Self-reference                                                   */
/* ------------------------------------------------------------------ */

describe('semantic analysis: self-reference ordering', () => {
  it('10. treats int a = a + 1; as use of an undeclared a', () => {
    const result = analyzeSource('int a = a + 1;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'a'");
    expect(errorAt(result.errors, 0).message.toLowerCase()).toContain('undeclared');
    // The failed declaration does not enter `a` into the table.
    expect(result.symbols.length).toBe(0);
  });

  it('does not treat a later variable of the same name as self-reference', () => {
    // Once `a` legitimately exists, using it in its OWN initializer a second
    // time around should not be confused with anything else.
    const result = analyzeOk('int a = 1;\nint b = a;');
    expect(result.errors.length).toBe(0);
  });

  it('allows a variable to be re-used validly after a failed self-reference', () => {
    // `a` never enters the table, so a plain `int a = 5;` afterwards is a
    // perfectly ordinary declaration, not a redeclaration.
    const result = analyzeSource('int a = a + 1;\nint b = 5;');
    expect(result.errors.length).toBe(1);
    expect(result.symbols.map((s) => s.name)).toEqual(['b']);
  });
});

/* ------------------------------------------------------------------ */
/* 11. Multiple undeclared identifiers                                  */
/* ------------------------------------------------------------------ */

describe('semantic analysis: multiple errors', () => {
  it('11. reports every undeclared identifier in one expression', () => {
    const result = analyzeSource('int c = a + b;');
    expect(result.errors.length).toBe(2);
    expect(errorAt(result.errors, 0).message).toContain("'a'");
    expect(errorAt(result.errors, 1).message).toContain("'b'");
  });

  it('reports undeclared identifiers across multiple statements', () => {
    const result = analyzeSource('int x = a;\nint y = b;\nc = 1;');
    expect(result.errors.length).toBe(3);
    expect(errorAt(result.errors, 0).line).toBe(1);
    expect(errorAt(result.errors, 1).line).toBe(2);
    expect(errorAt(result.errors, 2).line).toBe(3);
  });

  it('reports both an undeclared use and an unrelated redeclaration', () => {
    const result = analyzeSource('int a = 1;\nint a = b;');
    // Two independent problems on line 2: redeclaring `a`, and `b` does not
    // exist. Both are reported.
    expect(result.errors.length).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* 12-13. Nested and unary expressions                                  */
/* ------------------------------------------------------------------ */

describe('semantic analysis: expression recursion (RULE 6)', () => {
  it('12. recurses into nested binary expressions', () => {
    const result = analyzeOk('int a = 1;\nint b = 2;\nint c = (a + b) * 2;');
    expect(result.errors.length).toBe(0);
    expect(result.symbols.length).toBe(3);
  });

  it('12b. finds an undeclared identifier nested inside parentheses', () => {
    const result = analyzeSource('int a = 1;\nint c = (a + b) * 2;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'b'");
  });

  it('13. accepts a unary expression over a literal', () => {
    const result = analyzeOk('int a = -5;');
    expect(result.errors.length).toBe(0);
  });

  it('recurses through a unary expression to find an undeclared operand', () => {
    const result = analyzeSource('int a = -b;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'b'");
  });

  it('recurses through nested unary expressions', () => {
    const result = analyzeSource('int a = -(-b);');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'b'");
  });

  it('a bare number literal is always valid', () => {
    const result = analyzeOk('int a = 42;');
    expect(result.errors.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 14-15. Symbol table contents and locations                           */
/* ------------------------------------------------------------------ */

describe('semantic analysis: symbol table contents (RULE 1, symbol shape)', () => {
  it('14. records name, kind, type, scope, declaration position and initialized for every symbol', () => {
    const result = analyzeOk('int total = 10;');
    const symbol = symbolNamed(result, 'total');
    expect(symbol).toEqual({
      name: 'total',
      kind: 'variable',
      type: 'int',
      scope: 'global',
      declaredLine: 1,
      declaredColumn: 5,
      initialized: true,
    });
  });

  it('15. records the identifier position, not the int keyword position', () => {
    // "int   total = 1;" -- extra spaces push the name away from column 1.
    const result = analyzeOk('int   total = 1;');
    const symbol = symbolNamed(result, 'total');
    expect(symbol.declaredLine).toBe(1);
    expect(symbol.declaredColumn).toBe(7);
  });

  it('15b. records distinct declaration lines for each variable', () => {
    const result = analyzeOk('int a = 1;\nint b = 2;\nint c = 3;');
    expect(symbolNamed(result, 'a').declaredLine).toBe(1);
    expect(symbolNamed(result, 'b').declaredLine).toBe(2);
    expect(symbolNamed(result, 'c').declaredLine).toBe(3);
  });

  it('lists symbols in declaration order, not alphabetical order', () => {
    const result = analyzeOk('int zebra = 1;\nint apple = 2;');
    expect(result.symbols.map((s) => s.name)).toEqual(['zebra', 'apple']);
  });
});

/* ------------------------------------------------------------------ */
/* 16. Multiple statements, end to end                                  */
/* ------------------------------------------------------------------ */

describe('semantic analysis: multiple statements end to end', () => {
  it('16. analyses a realistic multi statement program with no errors', () => {
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n');
    const result = analyzeOk(source);
    expect(result.symbols.map((s) => s.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.errors.length).toBe(0);
  });

  it('mixes declarations and assignments correctly', () => {
    const result = analyzeOk('int a = 1;\nint b;\nb = a + 1;\nint c = a + b;');
    expect(result.symbols.map((s) => s.name)).toEqual(['a', 'b', 'c']);
    expect(result.errors.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Determinism and the SymbolTable class directly                       */
/* ------------------------------------------------------------------ */

describe('semantic analysis: determinism', () => {
  it('produces identical results for repeated analysis', () => {
    const source = 'int a = 10;\nint b = a + 5;\nint c = a + b;';
    const first = analyzeSource(source);
    const second = analyzeSource(source);
    expect(first.symbols).toEqual(second.symbols);
    expect(first.errors).toEqual(second.errors);
  });

  it('never throws on malformed but syntactically valid programs', () => {
    const sources = [
      'a = a;',
      'int a = a;',
      'int a = a + a + a;',
      'int a;\nint a;\nint a;',
      'a = b;\nb = c;\nc = a;',
    ];
    for (const source of sources) {
      const ast = astOf(source);
      const result = analyze(ast); // must not throw
      expect(Array.isArray(result.errors)).toBe(true);
    }
  });
});

describe('SymbolTable: unit behaviour', () => {
  it('reports has() correctly before and after declaration', () => {
    const table = new SymbolTable();
    expect(table.has('x')).toBe(false);
    table.declare(makeTestSymbol('x', 1, 1));
    expect(table.has('x')).toBe(true);
  });

  it('lookup returns undefined for an unknown name', () => {
    const table = new SymbolTable();
    expect(table.lookup('missing')).toBe(undefined);
  });

  it('all() reflects insertion order and current size', () => {
    const table = new SymbolTable();
    table.declare(makeTestSymbol('first', 1, 1));
    table.declare(makeTestSymbol('second', 2, 1));
    expect(table.all().map((s) => s.name)).toEqual(['first', 'second']);
    expect(table.size).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* PHASE 4.1: symbol metadata enrichment (kind, scope, initialized)     */
/*                                                                       */
/* These tests are ADDITIVE. Every test above this line predates 4.1    */
/* and is unchanged in intent; the only edits made to existing tests    */
/* were to the raw Symbol literals that the new required fields made    */
/* incomplete, and to the one full-shape toEqual() that necessarily     */
/* lists every field (test 14, above). No existing check was weakened   */
/* or removed.                                                          */
/* ------------------------------------------------------------------ */

describe('Phase 4.1: symbol metadata', () => {
  it('1. int a; -> initialized is false, kind/type/scope are correct', () => {
    const result = analyzeOk('int a;');
    const symbol = symbolNamed(result, 'a');
    expect(symbol).toEqual({
      name: 'a',
      kind: 'variable',
      type: 'int',
      scope: 'global',
      declaredLine: 1,
      declaredColumn: 5,
      initialized: false,
    });
  });

  it('2. int a = 10; -> initialized is true', () => {
    const result = analyzeOk('int a = 10;');
    expect(symbolNamed(result, 'a').initialized).toBe(true);
  });

  it('2b. does not store the initializing value anywhere on the symbol', () => {
    // The spec is explicit: initialized is a boolean, never a captured value.
    // This guards against a future edit accidentally adding one back.
    const result = analyzeOk('int a = 10;');
    const symbol = symbolNamed(result, 'a') as unknown as Record<string, unknown>;
    expect('value' in symbol).toBe(false);
    expect(Object.keys(symbol).sort()).toEqual(
      ['declaredColumn', 'declaredLine', 'initialized', 'kind', 'name', 'scope', 'type'].sort()
    );
  });

  it('3. multiple declarations: verifies full metadata for each', () => {
    const result = analyzeOk('int a;\nint b = 10;\nint c = a + b;');
    expect(result.errors.length).toBe(0);

    const a = symbolNamed(result, 'a');
    expect(a.kind).toBe('variable');
    expect(a.type).toBe('int');
    expect(a.scope).toBe('global');
    expect(a.initialized).toBe(false);

    const b = symbolNamed(result, 'b');
    expect(b.initialized).toBe(true);
    expect(b.declaredLine).toBe(2);

    const c = symbolNamed(result, 'c');
    expect(c.initialized).toBe(true);
    expect(c.declaredLine).toBe(3);
  });

  it('4. redeclaration: still an error, original symbol kept, no duplicate', () => {
    const result = analyzeSource('int a = 10;\nint a = 20;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain('already been declared');

    // Exactly one symbol named 'a' exists -- no duplicate was inserted.
    expect(result.symbols.filter((s) => s.name === 'a').length).toBe(1);

    // It is the FIRST declaration's metadata that survives.
    const a = symbolNamed(result, 'a');
    expect(a.declaredLine).toBe(1);
    expect(a.initialized).toBe(true);
  });

  it('5. undeclared variable: error still occurs, b is never inserted', () => {
    const result = analyzeSource('int a = b + 1;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message).toContain("'b'");
    expect(result.symbols.some((s) => s.name === 'b')).toBe(false);
    // `a`'s own initializer was invalid, so `a` is not entered either --
    // unchanged behaviour from Phase 4, re-verified after the 4.1 edit.
    expect(result.symbols.some((s) => s.name === 'a')).toBe(false);
  });

  it('6. self-reference: still rejected, consistent with existing analyzer behaviour', () => {
    const result = analyzeSource('int a = a + 1;');
    expect(result.errors.length).toBe(1);
    expect(errorAt(result.errors, 0).message.toLowerCase()).toContain('undeclared');
    expect(result.symbols.length).toBe(0);
  });

  it('7. empty program: no symbols, no errors, unchanged', () => {
    const result = analyzeOk('');
    expect(result.symbols.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('8. every symbol in a valid program has kind=variable, type=int, scope=global', () => {
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n');
    const result = analyzeOk(source);
    expect(result.symbols.length).toBe(5);
    for (const symbol of result.symbols) {
      expect(symbol.kind).toBe('variable');
      expect(symbol.type).toBe('int');
      expect(symbol.scope).toBe('global');
    }
  });

  it('assigning to an already-declared variable does not change its initialized flag', () => {
    // `a` is declared uninitialized, then assigned later. The DECLARATION's
    // initialized flag reflects the declaration alone, not later assignment
    // -- MiniC v1 has no notion of updating symbol metadata after entry.
    const result = analyzeOk('int a;\na = 10;');
    expect(symbolNamed(result, 'a').initialized).toBe(false);
  });

  it('is deterministic including the new metadata fields', () => {
    const source = 'int a;\nint b = 10;\nint c = a + b;';
    expect(analyzeSource(source)).toEqual(analyzeSource(source));
  });
});


describe('semantic analysis: float types', () => {
  it('stores float declarations in the symbol table', () => {
    const result = analyzeOk('float x = 10.5;');
    expect(symbolNamed(result, 'x').type).toBe('float');
  });

  it('allows int to float assignment', () => {
    expect(analyzeOk('int x = 10; float y = x;').errors).toHaveLength(0);
  });

  it('rejects float to int assignment', () => {
    const result = analyzeSource('float x = 10.5; int y = x;');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('float expression to int variable');
  });

  it('promotes mixed arithmetic to float', () => {
    expect(analyzeOk('int x = 10; float y = 2.5; float z = x + y;').errors).toHaveLength(0);
  });
});
