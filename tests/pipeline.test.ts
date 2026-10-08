/**
 * TESTS FOR PIPELINE INTEGRATION AND AST RENDERING
 *
 * Five things are covered here:
 *
 *   1. `compile()` -- that the lexer really feeds the parser, that the parser
 *      really feeds the semantic analyser, that the semantic analyser really
 *      feeds the TAC generator, that the TAC generator really feeds the
 *      optimizer, and that the right phase is blamed when something goes
 *      wrong.
 *   2. `formatAstTree()` -- the exact tree the UI draws.
 *   3. Phase 4 additions: that semantic analysis is skipped whenever an
 *      earlier phase failed, and runs and reports correctly when it did not.
 *   4. Phase 5 additions: that TAC generation is skipped whenever ANY earlier
 *      phase failed (lexical, syntax, OR semantic), and produces the correct
 *      instructions when every earlier phase succeeded.
 *   5. Phase 6 additions: that optimization is skipped whenever TAC was never
 *      generated, that the original TAC remains available and unmutated
 *      alongside the optimized result, and that the optimized result is
 *      correct.
 *
 * The second is the important one for a demo. Asserting on the rendered text
 * shows operator precedence and grouping at a glance, in the same form the
 * browser displays, without rendering a single React component.
 *
 * Run them with: npm test
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compiler/pipeline.ts';
import { formatAstTree, buildAstRows } from '../src/components/astTree.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import type { Program } from '../src/compiler/parser/ast.ts';
import type { CompilerError } from '../src/compiler/errors.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Compile source that is expected to be valid, and return the tree. */
function astOf(source: string): Program {
  const result = compile(source);
  if (result.ast === null) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.ast;
}

/** Compile and render the tree exactly as the UI draws it. */
function treeOf(source: string): string {
  return formatAstTree(astOf(source));
}

/** Index helper for the error array. */
function errorAt(errors: readonly CompilerError[], index: number): CompilerError {
  const error = errors[index];
  if (error === undefined) {
    throw new Error(`No error at index ${index} (only ${errors.length})`);
  }
  return error;
}

/* ------------------------------------------------------------------ */
/* Required integration cases 1-7                                      */
/* ------------------------------------------------------------------ */

describe('pipeline: valid programs', () => {
  it('1. compiles a simple declaration: int a = 10;', () => {
    const result = compile('int a = 10;');

    expect(result.errors.length).toBe(0);
    expect(result.stageStatus.lexical).toBe('ok');
    expect(result.stageStatus.syntax).toBe('ok');
    expect(result.stageStatus.semantic).toBe('ok');
    expect(result.stageStatus.tac).toBe('ok');
    expect(result.stageStatus.optimization).toBe('ok');
    // The lexer really ran: INT, IDENTIFIER, ASSIGN, NUMBER, SEMICOLON, EOF
    expect(result.tokens.length).toBe(6);
    expect(result.ast === null).toBe(false);
    // The semantic analyser really ran: the declared variable is recorded.
    expect(result.symbols.length).toBe(1);
    expect(result.symbols[0]?.name).toBe('a');
    // The TAC generator really ran: a single assign instruction, no temp
    // needed for a bare literal.
    expect(result.tac?.instructions.length).toBe(1);
    expect(result.tac?.temporaryCount).toBe(0);
    // The optimizer really ran too. Nothing here is optimizable further (a
    // bare literal assignment has no expression to fold), so the optimized
    // TAC is a SEPARATE object with the same content as the original.
    expect(result.optimizedTac).not.toBe(result.tac);
    expect(result.optimizedTac?.instructions.length).toBe(1);

    expect(treeOf('int a = 10;')).toBe(
      ['Program', '└── VarDecl: a', '    └── NumberLiteral: 10'].join('\n')
    );
  });

  it('2. compiles an expression with precedence: int c = a + 5 * 2;', () => {
    expect(treeOf('int c = a + 5 * 2;')).toBe(
      [
        'Program',
        '└── VarDecl: c',
        '    └── BinaryExpr: +',
        '        ├── Identifier: a',
        '        └── BinaryExpr: *',
        '            ├── NumberLiteral: 5',
        '            └── NumberLiteral: 2',
      ].join('\n')
    );
  });

  it('3. preserves grouping from parentheses: int x = (a + b) * 2;', () => {
    // The parentheses are gone as tokens, but the grouping survives in the
    // SHAPE of the tree: the + node now sits BELOW the * node.
    expect(treeOf('int x = (a + b) * 2;')).toBe(
      [
        'Program',
        '└── VarDecl: x',
        '    └── BinaryExpr: *',
        '        ├── BinaryExpr: +',
        '        │   ├── Identifier: a',
        '        │   └── Identifier: b',
        '        └── NumberLiteral: 2',
      ].join('\n')
    );
  });

  it('4. compiles unary minus: int x = -5;', () => {
    expect(treeOf('int x = -5;')).toBe(
      [
        'Program',
        '└── VarDecl: x',
        '    └── UnaryExpr: -',
        '        └── NumberLiteral: 5',
      ].join('\n')
    );
  });

  it('5. compiles multiple statements', () => {
    const source = 'int a = 10;\nint b;\nb = 20;\nint c = a + b;';
    const ast = astOf(source);
    expect(ast.body.length).toBe(4);

    expect(formatAstTree(ast)).toBe(
      [
        'Program',
        '├── VarDecl: a',
        '│   └── NumberLiteral: 10',
        '├── VarDecl: b',
        '├── Assignment: b',
        '│   └── NumberLiteral: 20',
        '└── VarDecl: c',
        '    └── BinaryExpr: +',
        '        ├── Identifier: a',
        '        └── Identifier: b',
      ].join('\n')
    );
  });

  it('6. reports invalid syntax and produces no tree: int a = ;', () => {
    const result = compile('int a = ;');

    expect(result.ast).toBe(null); // never a misleading partial tree
    expect(result.stageStatus.lexical).toBe('ok'); // the scanner was fine
    expect(result.stageStatus.syntax).toBe('error');
    expect(result.stageStatus.semantic).toBe('skipped'); // never reached
    expect(result.stageStatus.tac).toBe('skipped'); // never reached
    expect(result.stageStatus.optimization).toBe('skipped'); // never reached
    expect(result.symbols.length).toBe(0);
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
    expect(result.lexicalErrors.length).toBe(0);
    expect(result.syntaxErrors.length).toBe(1);
    expect(errorAt(result.syntaxErrors, 0).stage).toBe('syntax');
  });

  it('7. handles empty source gracefully', () => {
    const result = compile('');

    expect(result.errors.length).toBe(0);
    expect(result.stageStatus.syntax).toBe('ok');
    expect(result.ast === null).toBe(false);
    expect(astOf('').body.length).toBe(0);
    // An empty program is still a valid tree: just the root.
    expect(treeOf('')).toBe('Program');
  });

  it('7b. handles whitespace and comments only', () => {
    expect(compile('// nothing\n\n   ').errors.length).toBe(0);
    expect(treeOf('// nothing\n\n   ')).toBe('Program');
  });
});

/* ------------------------------------------------------------------ */
/* Phase attribution                                                   */
/* ------------------------------------------------------------------ */

describe('pipeline: error attribution', () => {
  it('blames the lexer for a bad character and skips the parser', () => {
    const result = compile('int a = 1 @ 2;');

    expect(result.stageStatus.lexical).toBe('error');
    expect(result.stageStatus.syntax).toBe('skipped');
    expect(result.stageStatus.semantic).toBe('skipped');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.lexicalErrors.length).toBe(1);
    expect(result.syntaxErrors.length).toBe(0);
    expect(result.semanticErrors.length).toBe(0);
    expect(result.ast).toBe(null);
    expect(result.symbols.length).toBe(0);
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
    // Tokens are still returned, so the token table can show what was found.
    expect(result.tokens.length > 0).toBe(true);
  });

  it('does not run the parser when the scanner failed', () => {
    // This source is BOTH lexically and syntactically broken. Only the
    // lexical error should be reported, so the real problem is not buried
    // under cascading syntax noise.
    const result = compile('int a = @');
    expect(result.lexicalErrors.length).toBe(1);
    expect(result.syntaxErrors.length).toBe(0);
  });

  it('reports several syntax errors from one compilation', () => {
    const result = compile('int a = ;\nint b = 2;\nint = 3;');
    expect(result.syntaxErrors.length).toBe(2);
    expect(errorAt(result.syntaxErrors, 0).line).toBe(1);
    expect(errorAt(result.syntaxErrors, 1).line).toBe(3);
  });

  it('never throws, whatever the input', () => {
    const nasty = ['', ';', '=', '(', '))))', 'int', 'int a =', '@@@', '- - -', 'a b c'];
    for (const source of nasty) {
      const result = compile(source);
      expect(typeof result.stageStatus.lexical).toBe('string');
    }
  });

  it('is deterministic', () => {
    const source = 'int a = 10;\nint c = a + b * 2;';
    expect(compile(source)).toEqual(compile(source));
  });
});

/* ------------------------------------------------------------------ */
/* Phase 4: semantic analysis integration                              */
/* ------------------------------------------------------------------ */

describe('pipeline: semantic analysis integration', () => {
  it('valid source: lexical, syntax and semantic all succeed', () => {
    const result = compile('int a = 10;\nint b = a + 5;');

    expect(result.stageStatus).toEqual({
      lexical: 'ok',
      syntax: 'ok',
      semantic: 'ok',
      tac: 'ok',
      optimization: 'ok',
    });
    expect(result.errors.length).toBe(0);
    expect(result.semanticErrors.length).toBe(0);
    expect(result.symbols.map((s) => s.name)).toEqual(['a', 'b']);
    // The tree is still returned alongside the symbol table.
    expect(result.ast === null).toBe(false);
    // TAC really was generated, not just left null by accident.
    expect(result.tac !== null).toBe(true);
    // And optimization really ran too, as a separate object from tac.
    expect(result.optimizedTac !== null).toBe(true);
    expect(result.optimizedTac).not.toBe(result.tac);
  });

  it('undeclared variable: lexical and syntax succeed, semantic reports an error', () => {
    const result = compile('int a = b + 1;');

    expect(result.stageStatus).toEqual({
      lexical: 'ok',
      syntax: 'ok',
      semantic: 'error',
      tac: 'skipped',
      optimization: 'skipped',
    });
    expect(result.lexicalErrors.length).toBe(0);
    expect(result.syntaxErrors.length).toBe(0);
    expect(result.semanticErrors.length).toBe(1);
    expect(errorAt(result.semanticErrors, 0).stage).toBe('semantic');
    expect(errorAt(result.semanticErrors, 0).message).toContain("'b'");
    // The AST is still shown: parsing succeeded even though meaning did not.
    expect(result.ast === null).toBe(false);
    // TAC is withheld: there is no honest three address code for a program
    // that references a variable which does not exist. With no TAC, there is
    // nothing to optimize either.
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
  });

  it('syntax error: semantic analysis is skipped, not run and passing', () => {
    const result = compile('int a = ;');
    expect(result.stageStatus.syntax).toBe('error');
    expect(result.stageStatus.semantic).toBe('skipped');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.semanticErrors.length).toBe(0);
    expect(result.symbols.length).toBe(0);
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
  });

  it('lexical error: both the parser and semantic analysis are skipped', () => {
    const result = compile('int a = 1 @ 2;');
    expect(result.stageStatus.lexical).toBe('error');
    expect(result.stageStatus.syntax).toBe('skipped');
    expect(result.stageStatus.semantic).toBe('skipped');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.semanticErrors.length).toBe(0);
    expect(result.symbols.length).toBe(0);
    expect(result.ast).toBe(null);
    expect(result.tac).toBe(null);
  });

  it('never claims semantic success when there are semantic errors', () => {
    // Guard against a status/errors mismatch: an 'ok' status must never
    // coexist with a non-empty semanticErrors array, and vice versa.
    const cases = ['int a = b;', 'int a = 1;\nint a = 2;', 'a = 1;', 'int a = a + 1;'];
    for (const source of cases) {
      const result = compile(source);
      const hasErrors = result.semanticErrors.length > 0;
      expect(result.stageStatus.semantic).toBe(hasErrors ? 'error' : 'ok');
    }
  });

  it('reports a redeclaration through the full pipeline', () => {
    const result = compile('int a = 10;\nint a = 20;');
    expect(result.stageStatus.semantic).toBe('error');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.semanticErrors.length).toBe(1);
    expect(errorAt(result.semanticErrors, 0).message).toContain('already been declared');
    // The tree still shows BOTH declarations: parsing is unaffected by the
    // semantic problem.
    expect(result.ast?.body.length).toBe(2);
    // Exactly the first declaration survives into the symbol table.
    expect(result.symbols.length).toBe(1);
    // No TAC for a program with a semantic error, and therefore nothing to
    // optimize either.
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
  });

  it('shows tokens, AST and a partial symbol table together for int a = b + 1;', () => {
    // This is the exact scenario called out in the brief: everything up to
    // the semantic problem should still be visible.
    const result = compile('int a = b + 1;');
    expect(result.tokens.length > 0).toBe(true); // Tokens: shown
    expect(result.ast !== null).toBe(true); // AST: shown
    expect(result.symbols.length).toBe(0); // Symbol table: empty, honestly
    expect(result.semanticErrors.length).toBe(1); // Errors: shown
    expect(result.tac).toBe(null); // TAC: skipped, never invented
    expect(result.optimizedTac).toBe(null); // Optimization: skipped too
  });

  it('combines the errors array in pipeline order for a semantic failure', () => {
    const result = compile('int a = b;');
    expect(result.errors).toEqual(result.semanticErrors);
  });

  it('is deterministic including the symbol table', () => {
    const source = 'int a = 1;\nint b = a + 1;\nint c = b * 2;';
    expect(compile(source)).toEqual(compile(source));
  });
});

/* ------------------------------------------------------------------ */
/* Phase 5: TAC generation integration                                 */
/* ------------------------------------------------------------------ */

describe('pipeline: TAC generation integration', () => {
  it('valid program: lexical, syntax, semantic and TAC all succeed, TAC exists', () => {
    const result = compile('int a = 10;\nint c = a + 5;');

    expect(result.stageStatus).toEqual({
      lexical: 'ok',
      syntax: 'ok',
      semantic: 'ok',
      tac: 'ok',
      optimization: 'ok',
    });
    expect(result.tac).not.toBe(null);
    expect(result.tac?.instructions.length).toBe(3); // assign, binary, copy
    expect(result.errors.length).toBe(0);
  });

  it('semantic error: TAC is skipped, not generated', () => {
    const result = compile('int a = b + 1;');
    expect(result.stageStatus.semantic).toBe('error');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
  });

  it('syntax error: semantic is skipped, TAC is skipped', () => {
    const result = compile('int a = ;');
    expect(result.stageStatus.syntax).toBe('error');
    expect(result.stageStatus.semantic).toBe('skipped');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
  });

  it('lexical error: parser is skipped, semantic is skipped, TAC is skipped', () => {
    const result = compile('int a = @;');
    expect(result.stageStatus.lexical).toBe('error');
    expect(result.stageStatus.syntax).toBe('skipped');
    expect(result.stageStatus.semantic).toBe('skipped');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
  });

  it('never claims TAC success when tac is null, and vice versa', () => {
    // Guard against a status/value mismatch across every stage outcome.
    const cases = [
      'int a = 10;', // fully valid
      'int a = b;', // semantic error
      'int a = ;', // syntax error
      'int a = @;', // lexical error
      '', // empty, valid
    ];
    for (const source of cases) {
      const result = compile(source);
      if (result.stageStatus.tac === 'ok') {
        expect(result.tac !== null).toBe(true);
      } else {
        expect(result.tac).toBe(null);
      }
      if (result.stageStatus.optimization === 'ok') {
        expect(result.optimizedTac !== null).toBe(true);
      } else {
        expect(result.optimizedTac).toBe(null);
      }
    }
  });

  it('produces the exact TAC from the brief for int c = a + b * 2;', () => {
    const result = compile('int a;\nint b;\nint c = a + b * 2;');
    expect(formatTAC(result.tac!)).toBe(
      ['t1 = b * 2', 't2 = a + t1', 'c = t2'].join('\n')
    );
  });

  it('produces the exact TAC from the brief for int x = (a + b) * 2;', () => {
    const result = compile('int a;\nint b;\nint x = (a + b) * 2;');
    expect(formatTAC(result.tac!)).toBe(
      ['t1 = a + b', 't2 = t1 * 2', 'x = t2'].join('\n')
    );
  });

  it('generates no TAC instructions for an empty program, without error', () => {
    const result = compile('');
    expect(result.stageStatus.tac).toBe('ok');
    expect(result.tac?.instructions.length).toBe(0);
  });

  it('is deterministic including TAC', () => {
    const source = 'int a = 1;\nint b = a + 1;\nint c = b * 2;';
    expect(compile(source)).toEqual(compile(source));
  });
});

/* ------------------------------------------------------------------ */
/* Phase 6: optimization integration                                   */
/* ------------------------------------------------------------------ */

describe('pipeline: optimization integration', () => {
  it('valid source: TAC exists, optimized TAC exists, original TAC remains available', () => {
    const result = compile('int a = 10;\nint b = 20;\nint c = a + b;');

    expect(result.stageStatus.tac).toBe('ok');
    expect(result.stageStatus.optimization).toBe('ok');
    expect(result.tac).not.toBe(null);
    expect(result.optimizedTac).not.toBe(null);

    // Original TAC is untouched: still the unoptimized form.
    expect(formatTAC(result.tac!)).toBe(
      ['a = 10', 'b = 20', 't1 = a + b', 'c = t1'].join('\n')
    );
    // Optimized TAC differs where constants are optimizable: t1 = a + b
    // folded down to t1 = 30.
    expect(formatTAC(result.optimizedTac!)).toBe(
      ['a = 10', 'b = 20', 't1 = 30', 'c = t1'].join('\n')
    );
    // The two are genuinely separate objects, not the same program twice.
    expect(result.optimizedTac).not.toBe(result.tac);
    expect(result.optimizedTac!.instructions).not.toBe(result.tac!.instructions);

    // Phase 8: the comparison is present and correct for a valid program.
    expect(result.comparison).not.toBe(null);
    expect(result.comparison!.originalInstructionCount).toBe(4);
    expect(result.comparison!.optimizedInstructionCount).toBe(4);
    expect(result.comparison!.removedInstructionCount).toBe(0);
    expect(result.comparison!.changed).toBe(true); // t1 = a + b folded to t1 = 30
  });

  it('semantic error: TAC skipped, optimization skipped', () => {
    const result = compile('int a = b + 1;');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
    expect(result.comparison).toBe(null); // Phase 8: no TAC, nothing to compare
  });

  it('syntax error: TAC skipped, optimization skipped', () => {
    const result = compile('int a = ;');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
    expect(result.comparison).toBe(null);
  });

  it('lexical error: parser skipped, semantic skipped, TAC skipped, optimization skipped', () => {
    const result = compile('int a = @;');
    expect(result.stageStatus.lexical).toBe('error');
    expect(result.stageStatus.syntax).toBe('skipped');
    expect(result.stageStatus.semantic).toBe('skipped');
    expect(result.stageStatus.tac).toBe('skipped');
    expect(result.stageStatus.optimization).toBe('skipped');
    expect(result.tac).toBe(null);
    expect(result.optimizedTac).toBe(null);
    expect(result.comparison).toBe(null);
  });

  it('the main demo optimizes through the full Phase 7 pipeline correctly', () => {
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n');
    const result = compile(source);

    // Updated for Phase 7: `compile()` runs the full four-pass optimizer
    // (constant propagation, constant folding, algebraic simplification,
    // dead code elimination), so t2 = c * 1 and t3 = c + 0 are now
    // genuinely simplified -- this is no longer "Phase 6 only" behaviour.
    // See tests/optimizer.test.ts for the isolated two-pass (CP+CF) version
    // of this same demo, and for why DCE keeps every remaining instruction
    // here (every value is genuinely read by the next line).
    expect(formatTAC(result.optimizedTac!)).toBe(
      [
        'a = 10',
        'b = 20',
        't1 = 30',
        'c = t1',
        't2 = c', // algebraic simplification: c * 1 -> c
        'd = t2',
        't3 = c', // algebraic simplification: c + 0 -> c
        'e = t3',
      ].join('\n')
    );
    // Nothing is REMOVED here: every temp is read by the very next
    // instruction, and every declared variable is written exactly once, so
    // DCE protects each write as that variable's final value.
    expect(result.optimizedTac!.instructions.length).toBe(result.tac!.instructions.length);
  });

  it('never mutates the original TAC reachable through the pipeline result', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;';
    const result = compile(source);
    const snapshot = JSON.parse(JSON.stringify(result.tac));
    // Merely having produced optimizedTac must not have disturbed tac.
    expect(result.tac).toEqual(snapshot);
  });

  it('is deterministic including optimizedTac', () => {
    const source = 'int a = 10;\nint b = a + 5;\nint c = b * 2;';
    expect(compile(source)).toEqual(compile(source));
  });
});

/* ------------------------------------------------------------------ */
/* Stage 1: compile-time division-by-zero detection                    */
/* ------------------------------------------------------------------ */

describe('pipeline: division-by-zero detection', () => {
  it('Case 1: literal zero divisor is a compile-time error -- int x = 10 / 0;', () => {
    const result = compile('int x = 10 / 0;');

    expect(result.stageStatus).toEqual({
      lexical: 'ok',
      syntax: 'ok',
      semantic: 'ok',
      tac: 'ok',
      optimization: 'error',
    });
    expect(result.divisionByZeroErrors.length).toBe(1);
    expect(errorAt(result.divisionByZeroErrors, 0).stage).toBe('optimizer');
    expect(errorAt(result.divisionByZeroErrors, 0).message.toLowerCase()).toContain(
      'division by zero'
    );
    expect(result.errors).toEqual(result.divisionByZeroErrors);

    // Original TAC generation is a total, mechanical translation, so it
    // still ran and is still shown -- only optimization was withheld.
    expect(result.tac).not.toBe(null);
    // The compiler must never let this expression reach constant folding
    // and become JavaScript's Infinity (or NaN): optimizedTac is withheld
    // entirely rather than showing a folded/unfolded division instruction.
    expect(result.optimizedTac).toBe(null);
    expect(result.comparison).toBe(null);
  });

  it('Case 2: divisor proven zero through constant propagation -- int y = 0; int x = 10 / y;', () => {
    const result = compile('int y = 0;\nint x = 10 / y;');

    expect(result.stageStatus.optimization).toBe('error');
    expect(result.divisionByZeroErrors.length).toBe(1);
    expect(errorAt(result.divisionByZeroErrors, 0).message.toLowerCase()).toContain(
      'division by zero'
    );
    // The reported error points at the division on line 2, not the
    // declaration of `y` on line 1.
    expect(errorAt(result.divisionByZeroErrors, 0).line).toBe(2);
    expect(result.optimizedTac).toBe(null);
    expect(result.comparison).toBe(null);
  });

  it('Case 3: a known NONzero constant divisor remains valid -- int y = 2; int x = 10 / y;', () => {
    const result = compile('int y = 2;\nint x = 10 / y;');

    expect(result.stageStatus).toEqual({
      lexical: 'ok',
      syntax: 'ok',
      semantic: 'ok',
      tac: 'ok',
      optimization: 'ok',
    });
    expect(result.divisionByZeroErrors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.optimizedTac).not.toBe(null);
    // Existing constant propagation + folding behaviour is unchanged: 10 / 2
    // folds down to the literal 5 (there is no copy propagation in this
    // project, so `x = t1` correctly stays a separate instruction).
    expect(formatTAC(result.optimizedTac!)).toBe(['y = 2', 't1 = 5', 'x = t1'].join('\n'));
  });

  it('Case 4: a divisor that is not known at compile time is NOT flagged -- int y; int x = 10 / y;', () => {
    const result = compile('int y;\nint x = 10 / y;');

    expect(result.stageStatus.optimization).toBe('ok');
    expect(result.divisionByZeroErrors.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.optimizedTac).not.toBe(null);
    // The division is genuinely unresolvable at compile time, so it is
    // neither folded nor flagged -- it passes through unchanged.
    expect(formatTAC(result.optimizedTac!)).toBe(['t1 = 10 / y', 'x = t1'].join('\n'));
  });

  it('does not flag an ordinary nonzero division buried among other statements', () => {
    const source = ['int a = 10;', 'int b = 5;', 'int c = a / b;', 'int d = c + 1;'].join('\n');
    const result = compile(source);

    expect(result.stageStatus.optimization).toBe('ok');
    expect(result.divisionByZeroErrors.length).toBe(0);
  });

  it('a division by zero is reported even when it is not the only statement', () => {
    const source = ['int a = 10;', 'int b = a / 0;', 'int c = a + 1;'].join('\n');
    const result = compile(source);

    expect(result.stageStatus.optimization).toBe('error');
    expect(result.divisionByZeroErrors.length).toBe(1);
  });

  it('every existing integer-arithmetic feature keeps working alongside this check', () => {
    // A broad regression check: unary minus, precedence, parentheses and
    // ordinary (nonzero, non-provable) division all still compile and
    // optimize exactly as before this feature existed.
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = (a + b) * 2;',
      'int d = -c;',
      'int e = c / 5;',
    ].join('\n');
    const result = compile(source);

    expect(result.stageStatus.optimization).toBe('ok');
    expect(result.divisionByZeroErrors.length).toBe(0);
    expect(result.optimizedTac).not.toBe(null);
  });
});

/* ------------------------------------------------------------------ */
/* Phase 8: pipeline-level comparison integration                      */
/* ------------------------------------------------------------------ */

describe('pipeline: Phase 8 comparison integration', () => {
  it('10. a valid compile result contains original TAC, optimized TAC, and a comparison', () => {
    const result = compile('int a = 10;\nint b = 20;\nint c = a + b;');
    expect(result.tac).not.toBe(null);
    expect(result.optimizedTac).not.toBe(null);
    expect(result.comparison).not.toBe(null);
    expect(result.comparison!.originalInstructionCount).toBe(result.tac!.instructions.length);
    expect(result.comparison!.optimizedInstructionCount).toBe(
      result.optimizedTac!.instructions.length
    );
  });

  it('11. invalid compilation (lexical, syntax, or semantic error) never runs optimization or comparison', () => {
    const invalidSources = [
      'int a = @;', // lexical
      'int a = ;', // syntax
      'int a = b + 1;', // semantic
    ];
    for (const source of invalidSources) {
      const result = compile(source);
      expect(result.stageStatus.optimization).toBe('skipped');
      expect(result.optimizedTac).toBe(null);
      expect(result.comparison).toBe(null);
    }
  });

  it('12. the full pipeline still applies exactly CP -> CF -> AS -> DCE, once each', () => {
    // int n; int p = n * 1;  -- n is never a known constant, so CP/CF find
    // nothing; algebraic simplification rewrites n*1 -> n; DCE keeps it,
    // since p's copy is its final write. This exercises all four passes'
    // ORDER through the public pipeline entry point, not the optimizer
    // internals directly.
    const result = compile('int n;\nint p = n * 1;');
    expect(formatTAC(result.optimizedTac!)).toBe(['t1 = n', 'p = t1'].join('\n'));

    // And the overwrite pattern confirms DCE ran LAST, after simplification
    // had already run: the whole dead computation, including its (already
    // fold-eligible) arithmetic, disappears in one pipeline call.
    const dceResult = compile('int b = 1;\nint c = 2;\nint a;\na = b + c;\na = 20;');
    expect(formatTAC(dceResult.optimizedTac!)).toBe(['b = 1', 'c = 2', 'a = 20'].join('\n'));
  });

  it('the no-change case reports changed = false through the full pipeline, with no artificial adjustment', () => {
    // int a; int b; int c = a + b;  -- a genuinely no-change program: a and
    // b are never known constants, so nothing propagates, folds, or
    // simplifies, and DCE keeps c's copy as its final write.
    const result = compile('int a;\nint b;\nint c = a + b;');
    expect(result.comparison!.changed).toBe(false);
    expect(result.comparison!.originalInstructionCount).toBe(
      result.comparison!.optimizedInstructionCount
    );
    expect(result.comparison!.removedInstructionCount).toBe(0);
  });

  it('the error case never fabricates an optimized TAC or comparison for int a = ;', () => {
    const result = compile('int a = ;');
    expect(result.optimizedTac).toBe(null);
    expect(result.comparison).toBe(null);
    // The existing error information is still present and correct.
    expect(result.syntaxErrors.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Tree rendering details                                              */
/* ------------------------------------------------------------------ */

describe('astTree: rendering', () => {
  it('does NOT put the multiplication above the addition', () => {
    // The failure mode this guards against: (a + b) * 2 instead of a + (b * 2).
    const tree = treeOf('int c = a + b * 2;');
    const lines = tree.split('\n');
    expect(lines[2]).toBe('    └── BinaryExpr: +'); // the + is nearer the root
    expect(lines[4]).toBe('        └── BinaryExpr: *'); // the * is deeper
  });

  it('renders a declaration without an initializer as a leaf', () => {
    expect(treeOf('int a;')).toBe(['Program', '└── VarDecl: a'].join('\n'));
  });

  it('renders nested unary minus', () => {
    expect(treeOf('int y = --5;')).toBe(
      [
        'Program',
        '└── VarDecl: y',
        '    └── UnaryExpr: -',
        '        └── UnaryExpr: -',
        '            └── NumberLiteral: 5',
      ].join('\n')
    );
  });

  it('creates no node for redundant parentheses', () => {
    expect(treeOf('int x = ((((7))));')).toBe(
      ['Program', '└── VarDecl: x', '    └── NumberLiteral: 7'].join('\n')
    );
  });

  it('draws a continuation bar for siblings below a non-final child', () => {
    // The "│" characters are what make the sibling relationship readable.
    expect(treeOf('int x = (a + b) * 2;')).toContain('│   ├── Identifier: a');
  });

  it('gives every row the AST node id, depth and source position', () => {
    const rows = buildAstRows(astOf('int c = a + b;'));
    expect(rows.length).toBe(5); // Program, VarDecl, +, a, b

    const root = rows[0];
    if (root === undefined) throw new Error('no root row');
    expect(root.kind).toBe('Program');
    expect(root.value).toBe(null);
    expect(root.depth).toBe(0);
    expect(root.prefix).toBe('');

    for (const row of rows) {
      expect(typeof row.id).toBe('string');
      expect(row.id.length > 0).toBe(true);
      expect(row.line >= 1).toBe(true);
      expect(row.column >= 1).toBe(true);
    }
    // Ids are unique, so they are safe to use as React keys.
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('produces identical output for repeated renders', () => {
    const source = 'int a = 10;\nint d = -(a - 3) * 2;';
    expect(treeOf(source)).toBe(treeOf(source));
  });
});


describe('pipeline: float support', () => {
  it('compiles float declarations and folds float arithmetic', () => {
    const result = compile('float x = 10.5; float y = 2.5; float z = x + y;');
    expect(result.errors).toHaveLength(0);
    expect(result.optimizedTac).not.toBeNull();
    expect(result.optimizedTac?.instructions.some((i) => i.kind === 'assign' && i.target === 't1' && i.value.kind === 'constant' && i.value.value === 13 && i.value.valueType === 'float')).toBe(true);
  });

  it('allows int plus float into a float variable', () => {
    const result = compile('int x = 10; float y = 2.5; float z = x + y;');
    expect(result.errors).toHaveLength(0);
  });

  it('rejects assigning float to int', () => {
    const result = compile('float x = 10.5; int y = x;');
    expect(result.semanticErrors.some((e) => e.message.includes('float expression to int variable'))).toBe(true);
    expect(result.tac).toBeNull();
  });

  it('preserves Stage 1 float division-by-zero protection', () => {
    const result = compile('float x = 10.5; float y = 0.0; float z = x / y;');
    expect(result.divisionByZeroErrors).toHaveLength(1);
    expect(result.optimizedTac).toBeNull();
  });
});
