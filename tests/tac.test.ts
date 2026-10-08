/**
 * TESTS FOR PHASE 5: THREE ADDRESS CODE GENERATION
 *
 * These tests call `generateTAC()` directly on a parsed AST, so the IR is
 * exercised on its own, with no dependency on the pipeline or on React.
 * Pipeline-level behaviour (which phases run, which get skipped) is covered
 * separately in tests/pipeline.test.ts.
 *
 * Assertions are made against `formatTAC()`, the exact text the UI will
 * display. This is deliberate: comparing readable text such as
 * "t1 = b * 2\nt2 = a + t1\nc = t2" against the expected program shows
 * evaluation order and precedence handling at a glance, in a form that
 * doubles as documentation of what the generator does.
 *
 * NOTE ON TEST SOURCES: every variable used in an expression must be
 * declared first, or semantic analysis (correctly) rejects the program
 * before TAC generation ever runs. Bare declarations with no initializer
 * (`int a;`) are used freely to satisfy this without adding any instructions
 * to the expected output -- `int a;` alone never emits TAC (see the
 * "declarations" tests below), so it is a safe way to introduce a name.
 *
 * Run them with: npm test
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC, formatInstruction } from '../src/compiler/ir/tacPrinter.ts';
import type { Program } from '../src/compiler/parser/ast.ts';
import type { TACProgram } from '../src/compiler/ir/tac.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Lex, parse and semantically check source expected to be fully valid. */
function astOf(source: string): Program {
  const { tokens, errors: lexErrors } = tokenize(source);
  if (lexErrors.length > 0) {
    throw new Error(`Unexpected lexical errors: ${JSON.stringify(lexErrors)}`);
  }
  const { program, errors } = parse(tokens);
  if (program === null) {
    throw new Error(`Unexpected syntax errors: ${JSON.stringify(errors)}`);
  }
  const semantic = analyze(program);
  if (semantic.errors.length > 0) {
    throw new Error(`Unexpected semantic errors: ${JSON.stringify(semantic.errors)}`);
  }
  return program;
}

/** Generate TAC for source expected to be fully valid. */
function tacOf(source: string): TACProgram {
  return generateTAC(astOf(source));
}

/** Generate TAC and render it exactly as the UI will. */
function textOf(source: string): string {
  return formatTAC(tacOf(source));
}

/* ------------------------------------------------------------------ */
/* 1. Empty program                                                    */
/* ------------------------------------------------------------------ */

describe('TAC: empty program', () => {
  it('1. produces no instructions for an empty program', () => {
    const tac = tacOf('');
    expect(tac.instructions.length).toBe(0);
    expect(tac.temporaryCount).toBe(0);
  });

  it('produces no instructions for comments and whitespace only', () => {
    const tac = tacOf('// nothing here\n\n   ');
    expect(tac.instructions.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2-3. Declarations                                                    */
/* ------------------------------------------------------------------ */

describe('TAC: declarations', () => {
  it('2. int a = 10; produces exactly one assign instruction', () => {
    const tac = tacOf('int a = 10;');
    expect(tac.instructions.length).toBe(1);
    expect(textOf('int a = 10;')).toBe('a = 10');
    expect(tac.temporaryCount).toBe(0); // no temp needed for a bare literal
  });

  it('3. int a; (no initializer) produces no TAC instructions', () => {
    const tac = tacOf('int a;');
    expect(tac.instructions.length).toBe(0);
    expect(tac.temporaryCount).toBe(0);
  });

  it('a declaration without an initializer contributes nothing among other statements', () => {
    const tac = tacOf('int a;\nint b = 5;');
    expect(tac.instructions.length).toBe(1);
    expect(textOf('int a;\nint b = 5;')).toBe('b = 5');
  });
});

/* ------------------------------------------------------------------ */
/* 4. Simple binary expression                                         */
/* ------------------------------------------------------------------ */

describe('TAC: simple binary expression', () => {
  it('4. int c = a + b; produces a binary instruction then a copy', () => {
    const source = 'int a;\nint b;\nint c = a + b;';
    const tac = tacOf(source);
    expect(tac.instructions.length).toBe(2);
    expect(textOf(source)).toBe(['t1 = a + b', 'c = t1'].join('\n'));
  });

  it('the binary instruction is followed by a copy, in that order', () => {
    const tac = tacOf('int a;\nint b;\nint c = a + b;');
    expect(tac.instructions[0]?.kind).toBe('binary');
    expect(tac.instructions[1]?.kind).toBe('copy');
  });
});

/* ------------------------------------------------------------------ */
/* 5. Operator precedence                                              */
/* ------------------------------------------------------------------ */

describe('TAC: operator precedence', () => {
  it('5. int c = a + b * 2; evaluates the higher-precedence subtree first', () => {
    // * binds tighter, so the AST nests it deeper, so its temporary is
    // computed FIRST even though `a` (the other operand of +) appears
    // earlier in the source.
    const source = 'int a;\nint b;\nint c = a + b * 2;';
    expect(textOf(source)).toBe(['t1 = b * 2', 't2 = a + t1', 'c = t2'].join('\n'));
  });

  it('does NOT combine a and b first', () => {
    // The failure mode this guards against: treating + as if it bound
    // tighter than *, producing "t1 = a + b" then "t2 = t1 * 2".
    const text = textOf('int a;\nint b;\nint c = a + b * 2;');
    expect(text).not.toBe(['t1 = a + b', 't2 = t1 * 2', 'c = t2'].join('\n'));
  });

  it('handles precedence the other way around: a * b + 2', () => {
    // Here + is the OUTER node and * is still evaluated first because it is
    // the deeper node -- but this time that deeper node is the LEFT child.
    const source = 'int a;\nint b;\nint c = a * b + 2;';
    expect(textOf(source)).toBe(['t1 = a * b', 't2 = t1 + 2', 'c = t2'].join('\n'));
  });
});

/* ------------------------------------------------------------------ */
/* 6. Parentheses                                                       */
/* ------------------------------------------------------------------ */

describe('TAC: parentheses', () => {
  it('6. int x = (a + b) * 2; evaluates the parenthesised group first', () => {
    const source = 'int a;\nint b;\nint x = (a + b) * 2;';
    expect(textOf(source)).toBe(['t1 = a + b', 't2 = t1 * 2', 'x = t2'].join('\n'));
  });

  it('does NOT produce the un-parenthesised precedence order', () => {
    // The failure mode this guards against: mixing up this example with the
    // "operator precedence" one above, which has the opposite grouping.
    const text = textOf('int a;\nint b;\nint x = (a + b) * 2;');
    expect(text).not.toBe(['t1 = b * 2', 't2 = a + t1', 'x = t2'].join('\n'));
  });

  it('produces no extra instruction for the parentheses themselves', () => {
    const tac = tacOf('int a;\nint b;\nint x = (a + b) * 2;');
    expect(tac.instructions.length).toBe(3); // binary, binary, copy -- nothing more
  });

  it('handles redundant parentheses with no extra instructions', () => {
    expect(textOf('int x = ((((7))));')).toBe('x = 7');
  });
});

/* ------------------------------------------------------------------ */
/* 7. Unary minus                                                       */
/* ------------------------------------------------------------------ */

describe('TAC: unary minus', () => {
  it('7. int x = -a; produces a unary instruction then a copy', () => {
    expect(textOf('int a;\nint x = -a;')).toBe(['t1 = -a', 'x = t1'].join('\n'));
  });

  it('int x = -5; treats the literal operand the same as any other operand', () => {
    // Chosen representation: UnaryExpr always emits its own instruction,
    // uniformly, whether its operand is a literal or a variable. This is one
    // of the two forms the brief explicitly allows.
    expect(textOf('int x = -5;')).toBe(['t1 = -5', 'x = t1'].join('\n'));
  });

  it('does NOT rewrite -5 as 0 - 5', () => {
    const tac = tacOf('int x = -5;');
    expect(tac.instructions[0]?.kind).toBe('unary');
  });

  it('handles nested unary minus', () => {
    expect(textOf('int a;\nint x = --a;')).toBe(
      ['t1 = -a', 't2 = -t1', 'x = t2'].join('\n')
    );
  });

  it('applies unary minus to a computed subexpression', () => {
    expect(textOf('int a;\nint b;\nint x = -(a + b);')).toBe(
      ['t1 = a + b', 't2 = -t1', 'x = t2'].join('\n')
    );
  });
});

/* ------------------------------------------------------------------ */
/* 8. Multiple statements                                               */
/* ------------------------------------------------------------------ */

describe('TAC: multiple statements', () => {
  it('8. generates instructions for each statement in source order', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;';
    expect(textOf(source)).toBe(
      ['a = 10', 'b = 20', 't1 = a + b', 'c = t1'].join('\n')
    );
  });

  it('continues temporary numbering across statements rather than resetting', () => {
    const source = 'int a;\nint b;\nint c = a + b;\nint d = a - b;';
    expect(textOf(source)).toBe(
      ['t1 = a + b', 'c = t1', 't2 = a - b', 'd = t2'].join('\n')
    );
  });
});

/* ------------------------------------------------------------------ */
/* 9. Assignment (not declaration)                                      */
/* ------------------------------------------------------------------ */

describe('TAC: assignment', () => {
  it('9. int a; a = b + 5; produces binary then copy for the assignment', () => {
    const source = 'int a;\nint b;\na = b + 5;';
    expect(textOf(source)).toBe(['t1 = b + 5', 'a = t1'].join('\n'));
  });

  it('a plain assignment of a literal produces a single assign instruction', () => {
    const source = 'int a;\na = 42;';
    expect(textOf(source)).toBe('a = 42');
  });
});

/* ------------------------------------------------------------------ */
/* 10. All four binary operators                                        */
/* ------------------------------------------------------------------ */

describe('TAC: all four binary operators', () => {
  it('10. generates the correct operator symbol for +, -, *, /', () => {
    const decls = 'int a;\nint b;\n';
    expect(textOf(decls + 'int c = a + b;')).toBe(['t1 = a + b', 'c = t1'].join('\n'));
    expect(textOf(decls + 'int c = a - b;')).toBe(['t1 = a - b', 'c = t1'].join('\n'));
    expect(textOf(decls + 'int c = a * b;')).toBe(['t1 = a * b', 'c = t1'].join('\n'));
    expect(textOf(decls + 'int c = a / b;')).toBe(['t1 = a / b', 'c = t1'].join('\n'));
  });

  it('records the operator on the instruction itself, not just in the printed text', () => {
    const tac = tacOf('int a;\nint b;\nint c = a + b;');
    const binary = tac.instructions[0];
    if (binary?.kind !== 'binary') throw new Error('expected a binary instruction');
    expect(binary.operator).toBe('+');
  });
});

/* ------------------------------------------------------------------ */
/* 11. Deterministic temporary numbering                                */
/* ------------------------------------------------------------------ */

describe('TAC: determinism', () => {
  it('11. compiling the same source twice produces identical TAC', () => {
    const source = 'int a = 10;\nint b;\nint c = a + b * 2;\nint x = (a + b) * 2;';
    expect(tacOf(source)).toEqual(tacOf(source));
  });

  it('numbers temporaries starting from t1 for every fresh compilation', () => {
    // Two independent compilations, each starting its own counter at 1.
    const source = 'int a;\nint b;\nint c = a + b;';
    const first = tacOf(source);
    const second = tacOf(source);
    expect(first).toEqual(second);
    const firstInstruction = first.instructions[0];
    if (firstInstruction?.kind !== 'binary') throw new Error('expected a binary instruction');
    expect(firstInstruction.target).toBe('t1');
  });

  it('never produces duplicate temporary names within one program', () => {
    const source =
      'int b;\nint c;\nint e;\nint f;\nint h;\nint i;\n' +
      'int a = b + c;\nint d = e - f;\nint g = h * i;';
    const tac = tacOf(source);
    const targets = tac.instructions
      .filter((instr) => instr.kind === 'binary' || instr.kind === 'unary')
      .map((instr) => instr.target);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

/* ------------------------------------------------------------------ */
/* 12-13. No optimization                                               */
/* ------------------------------------------------------------------ */

describe('TAC: no optimization is performed', () => {
  it('12. int d = c * 1; is NOT simplified to d = c', () => {
    expect(textOf('int c;\nint d = c * 1;')).toBe(['t1 = c * 1', 'd = t1'].join('\n'));
  });

  it('int e = c + 0; is NOT simplified to e = c', () => {
    expect(textOf('int c;\nint e = c + 0;')).toBe(['t1 = c + 0', 'e = t1'].join('\n'));
  });

  it('13. int c = 10 + 20; is NOT folded to c = 30', () => {
    const tac = tacOf('int c = 10 + 20;');
    expect(tac.instructions[0]?.kind).toBe('binary');
    expect(textOf('int c = 10 + 20;')).toBe(['t1 = 10 + 20', 'c = t1'].join('\n'));
  });

  it('does not propagate a known constant into a later expression', () => {
    // int a = 10; int b = a + 5; must NOT become b = 15.
    expect(textOf('int a = 10;\nint b = a + 5;')).toBe(
      ['a = 10', 't1 = a + 5', 'b = t1'].join('\n')
    );
  });

  it('does not apply any algebraic identity', () => {
    const identities = [
      ['int n;\nint r = n * 0;', ['t1 = n * 0', 'r = t1'].join('\n')],
      ['int n;\nint s = n / 1;', ['t1 = n / 1', 's = t1'].join('\n')],
      ['int n;\nint t = n - n;', ['t1 = n - n', 't = t1'].join('\n')],
    ] as const;
    for (const [source, expected] of identities) {
      expect(textOf(source)).toBe(expected);
    }
  });
});

/* ------------------------------------------------------------------ */
/* 14-16. Skipped on error (generator-level: never called at all)       */
/* ------------------------------------------------------------------ */

describe('TAC: never invoked on invalid programs (pipeline responsibility)', () => {
  // generateTAC() itself has no error handling -- by design, the pipeline
  // must never call it unless lexical, syntax and semantic analysis all
  // succeeded first. These tests document and enforce that boundary at the
  // unit level: they confirm astOf() (this file's own valid-input helper)
  // refuses to hand back a tree for exactly the three broken inputs the
  // brief calls out, which is what makes it impossible for a test in this
  // file to accidentally call generateTAC on bad input. The pipeline-level
  // guarantee -- that `compile()` itself skips TAC -- is tested in
  // tests/pipeline.test.ts, alongside the other stage-skipping behaviour.

  it('14. refuses to build an AST for a semantic error (int a = b + 1;)', () => {
    expect(() => astOf('int a = b + 1;')).toThrow(/semantic/);
  });

  it('15. refuses to build an AST for a syntax error (int a = ;)', () => {
    expect(() => astOf('int a = ;')).toThrow(/syntax/);
  });

  it('16. refuses to build an AST for a lexical error (int a = @;)', () => {
    expect(() => astOf('int a = @;')).toThrow(/lexical/);
  });
});

/* ------------------------------------------------------------------ */
/* Printer                                                              */
/* ------------------------------------------------------------------ */

describe('TAC: printer', () => {
  it('formats a binary instruction with spaces around the operator', () => {
    const tac = tacOf('int a;\nint b;\nint c = a + b;');
    const binary = tac.instructions[0];
    if (binary === undefined) throw new Error('expected an instruction');
    expect(formatInstruction(binary)).toBe('t1 = a + b');
  });

  it('formats a unary instruction with no space before the operator', () => {
    const tac = tacOf('int a;\nint x = -a;');
    const unary = tac.instructions[0];
    if (unary === undefined) throw new Error('expected an instruction');
    expect(formatInstruction(unary)).toBe('t1 = -a');
  });

  it('joins multiple instructions with one newline each', () => {
    expect(textOf('int a;\nint b;\nint c = a + b;')).toBe('t1 = a + b\nc = t1');
  });

  it('produces an empty string for an empty program', () => {
    expect(textOf('')).toBe('');
  });

  it('never reproduces AST node ids as operand or temporary names', () => {
    // Guards against a wrong implementation that reuses `n0`, `n1`, ... (the
    // AST's own id scheme) as temporary names instead of a fresh t1, t2, ...
    const text = textOf('int a;\nint b;\nint c = a + b;');
    expect(text).not.toContain('n0');
    expect(text).not.toContain('n1');
  });
});
