/**
 * TESTS FOR PHASE 6-7: THE OPTIMIZER
 *
 * Phase 6 (constant propagation + constant folding) tests are unchanged
 * below. Phase 7 (algebraic simplification + dead code elimination) tests
 * are appended in their own section further down, using the same two
 * testing styles established here:
 *
 *   1. HAND-BUILT TAC. Most pass-level tests construct a TACProgram directly
 *      with the small `v()`/`t()`/`c()` operand helpers and `assign()`/
 *      `binary()`/`unary()`/`copy()` instruction helpers below, rather than
 *      compiling MiniC source. The brief's own examples are written as raw
 *      TAC pseudocode (some, like "b = t1", are not even expressible as
 *      MiniC source), so testing against hand-built TAC lets every test
 *      match those examples exactly and lets each pass be exercised in
 *      complete isolation from the generator, as instructed.
 *
 *      IMPORTANT for hand-built DCE tests: `program()` defaults
 *      `temporaryCount` to 0. Any hand-built program using `t1`, `t2`, ...
 *      as operand/target names MUST pass the correct `temporaryCount`
 *      explicitly, since `deadCodeElimination` derives its authoritative set
 *      of temporary names from that count (see deadCodeElimination.ts) --
 *      getting it wrong would make the test accidentally exercise the
 *      "declared variable" code path instead of the "temporary" one.
 *
 *   2. REAL COMPILATION. The "Example A-E", "main demo", and sample-derived
 *      tests compile actual MiniC source through `generateTAC`, because
 *      those examples are given as MiniC source and the point is to confirm
 *      the full generator -> optimizer chain produces the exact stated
 *      result.
 *
 * All assertions are made against `formatTAC()`, the exact text the UI will
 * display, wherever practical.
 *
 * Run them with: npm test
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { constantPropagation } from '../src/compiler/optimizer/passes/constantPropagation.ts';
import { constantFolding } from '../src/compiler/optimizer/passes/constantFolding.ts';
import { algebraicSimplification } from '../src/compiler/optimizer/passes/algebraicSimplification.ts';
import { deadCodeElimination } from '../src/compiler/optimizer/passes/deadCodeElimination.ts';
import { optimize } from '../src/compiler/optimizer/optimizer.ts';
import { compareTAC } from '../src/compiler/optimizer/comparison.ts';
import { evaluateBinary, evaluateUnary } from '../src/compiler/optimizer/evaluate.ts';
import { checkDivisionByZero } from '../src/compiler/optimizer/divisionByZeroCheck.ts';
import { SymbolTable } from '../src/compiler/semantic/symbolTable.ts';
import type {
  Operand,
  TACBinaryOperator,
  TACInstruction,
  TACProgram,
} from '../src/compiler/ir/tac.ts';
import type { Program } from '../src/compiler/parser/ast.ts';

/* ------------------------------------------------------------------ */
/* Hand-built TAC helpers                                              */
/* ------------------------------------------------------------------ */

let nextNodeId = 0;
/** A throwaway AST node id, since these instructions are never really tied to source. */
function nodeId(): string {
  nextNodeId += 1;
  return `test-node-${nextNodeId}`;
}

const v = (name: string): Operand => ({ kind: 'variable', name });
const t = (name: string): Operand => ({ kind: 'temporary', name });
const c = (value: number): Operand => ({ kind: 'constant', value });

function assign(target: string, value: Operand): TACInstruction {
  return { kind: 'assign', target, value, sourceNodeId: nodeId() };
}
function copy(target: string, source: Operand): TACInstruction {
  return { kind: 'copy', target, source, sourceNodeId: nodeId() };
}
function binary(target: string, left: Operand, operator: TACBinaryOperator, right: Operand): TACInstruction {
  return { kind: 'binary', target, left, operator, right, sourceNodeId: nodeId() };
}
function unary(target: string, operand: Operand): TACInstruction {
  return { kind: 'unary', target, operator: '-', operand, sourceNodeId: nodeId() };
}

/** Build a TACProgram from a list of instructions, for pass-level tests. */
function program(instructions: TACInstruction[], temporaryCount = 0): TACProgram {
  return { instructions, temporaryCount };
}

/* ------------------------------------------------------------------ */
/* Real-compilation helpers (for the MiniC-source examples)            */
/* ------------------------------------------------------------------ */

function astOf(source: string): Program {
  const { tokens, errors: lexErrors } = tokenize(source);
  if (lexErrors.length > 0) throw new Error(`Unexpected lexical errors: ${JSON.stringify(lexErrors)}`);
  const { program: ast, errors } = parse(tokens);
  if (ast === null) throw new Error(`Unexpected syntax errors: ${JSON.stringify(errors)}`);
  const semantic = analyze(ast);
  if (semantic.errors.length > 0) {
    throw new Error(`Unexpected semantic errors: ${JSON.stringify(semantic.errors)}`);
  }
  return ast;
}

function tacOf(source: string): TACProgram {
  return generateTAC(astOf(source));
}

function optimizedTextOf(source: string): string {
  return formatTAC(optimize(tacOf(source)));
}

/* ------------------------------------------------------------------ */
/* CONSTANT PROPAGATION                                                 */
/* ------------------------------------------------------------------ */

describe('constant propagation', () => {
  it('1. simple propagation: a = 10; t1 = a + 5;', () => {
    const p = program([assign('a', c(10)), binary('t1', v('a'), '+', c(5))]);
    expect(formatTAC(constantPropagation(p))).toBe(['a = 10', 't1 = 10 + 5'].join('\n'));
  });

  it('2. two known constants: a = 10; b = 20; t1 = a + b;', () => {
    const p = program([
      assign('a', c(10)),
      assign('b', c(20)),
      binary('t1', v('a'), '+', v('b')),
    ]);
    expect(formatTAC(constantPropagation(p))).toBe(
      ['a = 10', 'b = 20', 't1 = 10 + 20'].join('\n')
    );
  });

  it('3. only one known operand: a = 10; t1 = a + b;', () => {
    const p = program([assign('a', c(10)), binary('t1', v('a'), '+', v('b'))]);
    // `b` is never declared in this hand-built program, so it is simply
    // never in the environment -- exactly as "not yet known" as any other
    // unassigned name.
    expect(formatTAC(constantPropagation(p))).toBe(['a = 10', 't1 = 10 + b'].join('\n'));
  });

  it('4. assignment propagation: a = 10; b = a;', () => {
    const p = program([assign('a', c(10)), assign('b', v('a'))]);
    expect(formatTAC(constantPropagation(p))).toBe(['a = 10', 'b = 10'].join('\n'));
  });

  it('5. constant invalidation: a = 10; a = b; t1 = a + 5;', () => {
    const p = program([
      assign('a', c(10)),
      assign('a', v('b')), // b is unknown, so this invalidates a's old value
      binary('t1', v('a'), '+', c(5)),
    ]);
    const result = constantPropagation(p);
    // The stale 10 must NOT be propagated into the final expression.
    expect(formatTAC(result)).toBe(['a = 10', 'a = b', 't1 = a + 5'].join('\n'));
  });

  it('5b. invalidation also applies when the new value comes through a copy', () => {
    // a starts constant, then is reassigned from a temporary (unresolved
    // during propagation), which must equally invalidate the old value.
    const p = program([
      assign('a', c(10)),
      binary('t1', v('x'), '+', v('y')),
      copy('a', t('t1')), // a = t1, t1 not known -> a's old constant is stale
      binary('t2', v('a'), '+', c(1)),
    ]);
    const result = constantPropagation(p);
    const lines = formatTAC(result).split('\n');
    expect(lines[3]).toBe('t2 = a + 1'); // NOT "t2 = 10 + 1"
  });

  it('6. temporaries are tracked by the substitution mechanism, but binary/unary never populate the environment', () => {
    // a = 10; t1 = a + 5; b = t1
    const p = program([
      assign('a', c(10)),
      binary('t1', v('a'), '+', c(5)),
      copy('b', t('t1')),
    ]);
    const result = constantPropagation(p);
    expect(formatTAC(result)).toBe(
      ['a = 10', 't1 = 10 + 5', 'b = t1'].join('\n')
    );
    // b = t1 is UNCHANGED: nothing ever taught the environment that t1 is 15,
    // because propagation never evaluates -- see constantFolding for that.
  });

  it('7. is deterministic', () => {
    const p = program([
      assign('a', c(10)),
      assign('b', c(20)),
      binary('t1', v('a'), '+', v('b')),
      copy('c', t('t1')),
    ]);
    expect(constantPropagation(p)).toEqual(constantPropagation(p));
  });

  it('substitutes both operands of a unary expression the same way as binary', () => {
    const p = program([assign('a', c(5)), unary('t1', v('a'))]);
    expect(formatTAC(constantPropagation(p))).toBe(['a = 5', 't1 = -5'].join('\n'));
  });

  it('leaves an unknown identifier operand completely alone', () => {
    const p = program([binary('t1', v('x'), '+', v('y'))]);
    const result = constantPropagation(p);
    expect(formatTAC(result)).toBe('t1 = x + y');
    // And the instruction is the exact same object: nothing to substitute.
    expect(result.instructions[0]).toBe(p.instructions[0]);
  });

  it('never mutates its input', () => {
    const original = program([assign('a', c(10)), binary('t1', v('a'), '+', c(5))]);
    const snapshot = JSON.parse(JSON.stringify(original));
    constantPropagation(original);
    expect(original).toEqual(snapshot);
  });
});

/* ------------------------------------------------------------------ */
/* CONSTANT FOLDING                                                     */
/* ------------------------------------------------------------------ */

describe('constant folding', () => {
  it('8. addition: t1 = 10 + 20;', () => {
    const p = program([binary('t1', c(10), '+', c(20))]);
    expect(formatTAC(constantFolding(p))).toBe('t1 = 30');
  });

  it('9. subtraction: t3 = 20 - 7;', () => {
    const p = program([binary('t3', c(20), '-', c(7))]);
    expect(formatTAC(constantFolding(p))).toBe('t3 = 13');
  });

  it('10. multiplication: t2 = 8 * 3;', () => {
    const p = program([binary('t2', c(8), '*', c(3))]);
    expect(formatTAC(constantFolding(p))).toBe('t2 = 24');
  });

  it('11. division: t4 = 20 / 5;', () => {
    const p = program([binary('t4', c(20), '/', c(5))]);
    expect(formatTAC(constantFolding(p))).toBe('t4 = 4');
  });

  it('12. negative values fold correctly', () => {
    expect(formatTAC(constantFolding(program([binary('t1', c(5), '-', c(20))])))).toBe('t1 = -15');
    expect(formatTAC(constantFolding(program([unary('t2', c(5))])))).toBe('t2 = -5');
  });

  it('unary constant folding: t1 = -5; folds to an assign printing identical text', () => {
    const p = program([unary('t1', c(5))]);
    const result = constantFolding(p);
    expect(formatTAC(result)).toBe('t1 = -5'); // same text as the unfolded form
    expect(result.instructions[0]?.kind).toBe('assign'); // but the KIND changed
  });

  it('13. division by zero is NOT folded, and does not crash', () => {
    const p = program([binary('t1', c(10), '/', c(0))]);
    const result = constantFolding(p);
    expect(formatTAC(result)).toBe('t1 = 10 / 0');
    expect(result.instructions[0]?.kind).toBe('binary'); // left completely untouched
  });

  it('division by zero never produces Infinity, NaN, or 0', () => {
    const result = evaluateBinary('/', 10, 0);
    expect(result).toBe(undefined);
  });

  it('14. a non-constant expression is left unchanged: t1 = a + 20;', () => {
    const p = program([binary('t1', v('a'), '+', c(20))]);
    const result = constantFolding(p);
    expect(formatTAC(result)).toBe('t1 = a + 20');
    expect(result.instructions[0]).toBe(p.instructions[0]); // exact same object
  });

  it('15. algebraic identities are NOT applied: t1 = a * 1; and t1 = a + 0;', () => {
    expect(formatTAC(constantFolding(program([binary('t1', v('a'), '*', c(1))])))).toBe(
      't1 = a * 1'
    );
    expect(formatTAC(constantFolding(program([binary('t1', v('a'), '+', c(0))])))).toBe(
      't1 = a + 0'
    );
  });

  it('16. no dead code elimination: unused instructions remain', () => {
    // t1 is computed but never read anywhere afterward -- folding must not
    // notice or care.
    const p = program([binary('t1', c(2), '+', c(3)), assign('a', c(99))]);
    const result = constantFolding(p);
    expect(result.instructions.length).toBe(2);
    expect(formatTAC(result)).toBe(['t1 = 5', 'a = 99'].join('\n'));
  });

  it('assign and copy instructions are never touched by folding', () => {
    const p = program([assign('a', c(10)), copy('b', t('t1'))]);
    const result = constantFolding(p);
    expect(result.instructions[0]).toBe(p.instructions[0]);
    expect(result.instructions[1]).toBe(p.instructions[1]);
  });

  it('folds all four operators correctly, spot-checked', () => {
    expect(evaluateBinary('+', 3, 4)).toBe(7);
    expect(evaluateBinary('-', 3, 4)).toBe(-1);
    expect(evaluateBinary('*', 3, 4)).toBe(12);
    expect(evaluateBinary('/', 12, 4)).toBe(3);
    expect(evaluateUnary('-', 9)).toBe(-9);
  });

  it('never mutates its input', () => {
    const original = program([binary('t1', c(10), '+', c(20))]);
    const snapshot = JSON.parse(JSON.stringify(original));
    constantFolding(original);
    expect(original).toEqual(snapshot);
  });

  it('is deterministic', () => {
    const p = program([binary('t1', c(10), '+', c(20)), binary('t2', v('a'), '*', c(1))]);
    expect(constantFolding(p)).toEqual(constantFolding(p));
  });
});

/* ------------------------------------------------------------------ */
/* COMBINED OPTIMIZATION (Phase 6: propagation + folding, via optimize()) */
/* NOTE: optimize() now runs all four Phase 6+7 passes; tests in this        */
/* section that predate Phase 7 isolate constantPropagation/constantFolding */
/* directly wherever algebraic simplification or DCE would otherwise also   */
/* fire on the same input. See the "PHASE 7" sections further down for the  */
/* full four-pass behaviour.                                                */
/* ------------------------------------------------------------------ */

describe('combined optimization', () => {
  it('17. propagation followed by folding: a = 10; b = 20; t1 = a + b;', () => {
    const p = program([assign('a', c(10)), assign('b', c(20)), binary('t1', v('a'), '+', v('b'))]);
    expect(formatTAC(optimize(p))).toBe(['a = 10', 'b = 20', 't1 = 30'].join('\n'));
  });

  it('18. main demo: constants propagate and fold, WITHOUT algebraic simplification or DCE', () => {
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n');

    // Original, unoptimized -- exactly Phase 5's output, unaffected.
    expect(formatTAC(tacOf(source))).toBe(
      [
        'a = 10',
        'b = 20',
        't1 = a + b',
        'c = t1',
        't2 = c * 1',
        'd = t2',
        't3 = c + 0',
        'e = t3',
      ].join('\n')
    );

    // This test isolates PROPAGATION AND FOLDING ONLY -- it calls those two
    // passes directly rather than the full `optimize()`, which since Phase 7
    // also runs algebraic simplification and DCE afterward. (Those two DO
    // change this exact program's `t2 = c * 1` / `t3 = c + 0` lines; see
    // "20. Main demo [Phase 7]" in the combined-optimization section below
    // for the full four-pass result.) t1 folds to 30 (a and b were both
    // known constants). c is never resolved to a constant (c = t1 is a copy
    // of an UNFOLDED-at-propagation-time temporary), so t2 = c * 1 and
    // t3 = c + 0 are left completely alone by folding specifically.
    const cpThenCf = constantFolding(constantPropagation(tacOf(source)));
    expect(formatTAC(cpThenCf)).toBe(
      [
        'a = 10',
        'b = 20',
        't1 = 30',
        'c = t1',
        't2 = c * 1',
        'd = t2',
        't3 = c + 0',
        'e = t3',
      ].join('\n')
    );
  });

  it('19. parenthesized expressions optimize correctly through TAC', () => {
    // int x = (a + b) * 2;  with a and b both known constants.
    const source = 'int a = 3;\nint b = 4;\nint x = (a + b) * 2;';
    expect(formatTAC(tacOf(source))).toBe(
      ['a = 3', 'b = 4', 't1 = a + b', 't2 = t1 * 2', 'x = t2'].join('\n')
    );
    // Propagation substitutes a and b into t1; t1 is NOT known during
    // propagation (folding hasn't run yet), so t2 = t1 * 2 is untouched by
    // propagation. Folding then evaluates t1 = 3 + 4 into t1 = 7, but t2's
    // operands (t1, 2) are a temporary and a constant, not two constants, so
    // t2 = t1 * 2 remains a binary instruction -- exactly one level of
    // folding happens, with no second propagation pass to push 7 into t2.
    expect(optimizedTextOf(source)).toBe(
      ['a = 3', 'b = 4', 't1 = 7', 't2 = t1 * 2', 'x = t2'].join('\n')
    );
  });

  it('20. REQUIRED: the original TAC is never mutated by optimize()', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;';
    const originalTac = tacOf(source);
    const snapshot = JSON.parse(JSON.stringify(originalTac));

    const optimizedTac = optimize(originalTac);

    // The original object must still deep-equal what it looked like before
    // optimization ran.
    expect(originalTac).toEqual(snapshot);
    // The two results must be genuinely different objects, not the same
    // program handed back.
    expect(optimizedTac).not.toBe(originalTac);
    expect(optimizedTac.instructions).not.toBe(originalTac.instructions);
    // And their content is actually different, since a real optimization
    // happened (t1 = a + b became t1 = 30).
    expect(formatTAC(optimizedTac)).not.toBe(formatTAC(originalTac));
  });

  it('21. optimize() is deterministic', () => {
    const source = 'int a = 10;\nint b = a + 5;\nint c = b * 2;';
    const tac = tacOf(source);
    expect(optimize(tac)).toEqual(optimize(tac));
  });

  it('Example A: int a=10; int b=20; int c=a+b;', () => {
    expect(optimizedTextOf('int a = 10;\nint b = 20;\nint c = a + b;')).toBe(
      ['a = 10', 'b = 20', 't1 = 30', 'c = t1'].join('\n')
    );
  });

  it('Example B: int a=10; int b=a+5;', () => {
    expect(optimizedTextOf('int a = 10;\nint b = a + 5;')).toBe(
      ['a = 10', 't1 = 15', 'b = t1'].join('\n')
    );
  });

  it('Example C: int a=10; int b=20; int c=a*b;', () => {
    expect(optimizedTextOf('int a = 10;\nint b = 20;\nint c = a * b;')).toBe(
      ['a = 10', 'b = 20', 't1 = 200', 'c = t1'].join('\n')
    );
  });

  it('Example D: int a=10; int b=a*1; folds fully because BOTH operands become constants after propagation', () => {
    // NOTE (see final report): after propagation substitutes a -> 10, the
    // instruction is `t1 = 10 * 1` -- both operands are now literal
    // constants, so constant folding legitimately evaluates it to 10. This
    // is constant folding of a fully-constant expression, NOT the algebraic
    // identity "x * 1 = x": that identity is never implemented anywhere in
    // this codebase, and would still fire even if the operand were NOT a
    // constant (e.g. `n * 1` for an arbitrary variable n), which this
    // optimizer never does -- see "15. algebraic identities are NOT applied"
    // in the folding suite above.
    expect(optimizedTextOf('int a = 10;\nint b = a * 1;')).toBe(
      ['a = 10', 't1 = 10', 'b = t1'].join('\n')
    );
  });

  it('Example E: int a=10; int b=a+0; folds fully, but a plain variable + 0 never does at the FOLDING stage', () => {
    expect(optimizedTextOf('int a = 10;\nint b = a + 0;')).toBe(
      ['a = 10', 't1 = 10', 'b = t1'].join('\n')
    );
    // The critical negative case FOR CONSTANT FOLDING SPECIFICALLY: when the
    // left operand is not a known constant, folding must never turn
    // `x + 0` into `x` -- that would be evaluating an operation that is not
    // fully constant. Tested here against `constantFolding` directly, not
    // the full `optimize()`: since Phase 7, algebraic simplification DOES
    // legitimately rewrite `x + 0 -> x` for a genuinely unknown `x` (see the
    // "algebraic simplification" section below) -- that is a different pass
    // with a different, broader justification, not folding overreaching.
    const p = program([binary('t1', v('x'), '+', c(0))]);
    expect(formatTAC(constantFolding(p))).toBe('t1 = x + 0');
  });

  it('does not over-optimize: a = 10; t1 = a + 20; b = t1; never collapses to b = 30', () => {
    const p = program([assign('a', c(10)), binary('t1', v('a'), '+', c(20)), copy('b', t('t1'))]);
    const result = optimize(p);
    expect(formatTAC(result)).toBe(['a = 10', 't1 = 30', 'b = t1'].join('\n'));
    // The copy instruction must still exist as its own instruction: no
    // instructions are removed, no assignments are merged.
    expect(result.instructions.length).toBe(3);
    expect(result.instructions[2]?.kind).toBe('copy');
  });

  it('does not perform a second propagation pass after folding', () => {
    // int a=10; int b=a+5; int c=b*2;  -- from the brief's "ANOTHER EXAMPLE".
    // b is only known to be 15 AFTER folding; propagation already finished
    // by then, so t2 = b * 2 must NOT become t2 = 15 * 2.
    const source = 'int a = 10;\nint b = a + 5;\nint c = b * 2;';
    expect(optimizedTextOf(source)).toBe(
      ['a = 10', 't1 = 15', 'b = t1', 't2 = b * 2', 'c = t2'].join('\n')
    );
  });
});

/* ==================================================================== */
/* PHASE 7: ALGEBRAIC SIMPLIFICATION                                     */
/* ==================================================================== */

describe('algebraic simplification', () => {
  it('1. x + 0 -> x', () => {
    const p = program([binary('t1', v('x'), '+', c(0))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = x');
  });

  it('2. x - 0 -> x', () => {
    const p = program([binary('t1', v('x'), '-', c(0))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = x');
  });

  it('3. x * 1 -> x', () => {
    const p = program([binary('t1', v('x'), '*', c(1))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = x');
  });

  it('4. x / 1 -> x', () => {
    const p = program([binary('t1', v('x'), '/', c(1))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = x');
  });

  it('5. x * 0 -> 0', () => {
    const p = program([binary('t1', v('x'), '*', c(0))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = 0');
  });

  it('6. 0 * x -> 0', () => {
    const p = program([binary('t1', c(0), '*', v('x'))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = 0');
  });

  it('7. works identically for temporaries: t4 = t3 / 1 -> t4 = t3', () => {
    const p = program([binary('t4', t('t3'), '/', c(1))], 4);
    const result = algebraicSimplification(p);
    expect(formatTAC(result)).toBe('t4 = t3');
    // The result operand is a TEMPORARY, so this must be a `copy`, not an
    // `assign` -- exactly the same choice tacGenerator.ts makes when the
    // right-hand side of a final assignment is a temporary.
    expect(result.instructions[0]?.kind).toBe('copy');
  });

  it('7b. produces `assign` (not `copy`) when the surviving operand is a variable or constant', () => {
    const varCase = algebraicSimplification(program([binary('t3', v('b'), '*', c(1))]));
    expect(varCase.instructions[0]?.kind).toBe('assign');
    const constCase = algebraicSimplification(program([binary('t5', v('c'), '*', c(0))]));
    expect(constCase.instructions[0]?.kind).toBe('assign');
  });

  it('8. an expression matching no rule is left completely unchanged', () => {
    const noConstants = program([binary('t1', v('a'), '+', v('b'))]);
    expect(algebraicSimplification(noConstants).instructions[0]).toBe(noConstants.instructions[0]);

    const wrongConstant = program([binary('t1', v('a'), '*', c(5))]); // *5, not *0 or *1
    expect(formatTAC(algebraicSimplification(wrongConstant))).toBe('t1 = a * 5');

    const leftOne = program([binary('t1', c(1), '*', v('a'))]); // 1 * x is NOT in the approved list
    expect(formatTAC(algebraicSimplification(leftOne))).toBe('t1 = 1 * a');

    const leftZeroPlus = program([binary('t1', c(0), '+', v('a'))]); // 0 + x is NOT in the approved list
    expect(formatTAC(algebraicSimplification(leftZeroPlus))).toBe('t1 = 0 + a');
  });

  it('9. division by zero is never touched by this pass (that is folding\u2019s protection, not this one\u2019s job)', () => {
    const p = program([binary('t1', v('x'), '/', c(0))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = x / 0');
  });

  it('10a. does NOT apply the unsafe identity 0 / x -> 0', () => {
    const p = program([binary('t1', c(0), '/', v('x'))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = 0 / x');
  });

  it('10b. does NOT apply the unsafe identity x / x -> 1', () => {
    const p = program([binary('t1', v('x'), '/', v('x'))]);
    expect(formatTAC(algebraicSimplification(p))).toBe('t1 = x / x');
  });

  it('10c. does NOT apply x - x -> 0, x + x -> 2x, x * x -> x^2, or x * 2 -> x + x', () => {
    expect(formatTAC(algebraicSimplification(program([binary('t1', v('x'), '-', v('x'))])))).toBe(
      't1 = x - x'
    );
    expect(formatTAC(algebraicSimplification(program([binary('t1', v('x'), '+', v('x'))])))).toBe(
      't1 = x + x'
    );
    expect(formatTAC(algebraicSimplification(program([binary('t1', v('x'), '*', v('x'))])))).toBe(
      't1 = x * x'
    );
    expect(formatTAC(algebraicSimplification(program([binary('t1', v('x'), '*', c(2))])))).toBe(
      't1 = x * 2'
    );
  });

  it('leaves unary, assign and copy instructions completely untouched', () => {
    const p = program([
      unary('t1', v('a')),
      assign('b', c(10)),
      copy('d', t('t1')),
    ], 1);
    const result = algebraicSimplification(p);
    expect(result.instructions[0]).toBe(p.instructions[0]);
    expect(result.instructions[1]).toBe(p.instructions[1]);
    expect(result.instructions[2]).toBe(p.instructions[2]);
  });

  it('preserves the copy/assign STRUCTURE: t1 = c * 1; d = t1; becomes t1 = c; d = t1; NOT d = c;', () => {
    const p = program([binary('t1', v('c'), '*', c(1)), copy('d', t('t1'))], 1);
    const result = algebraicSimplification(p);
    expect(formatTAC(result)).toBe(['t1 = c', 'd = t1'].join('\n'));
    // The SECOND instruction is completely untouched: it still reads t1 by
    // name. Merging it into "d = c" would be copy propagation, a different
    // technique this pass does not perform.
    expect(result.instructions[1]).toBe(p.instructions[1]);
  });

  it('is deterministic', () => {
    const p = program([binary('t1', v('c'), '*', c(1)), binary('t2', v('n'), '+', c(0))]);
    expect(algebraicSimplification(p)).toEqual(algebraicSimplification(p));
  });

  it('never mutates its input', () => {
    const original = program([binary('t1', v('x'), '+', c(0))]);
    const snapshot = JSON.parse(JSON.stringify(original));
    algebraicSimplification(original);
    expect(original).toEqual(snapshot);
  });
});

/* ==================================================================== */
/* PHASE 7: DEAD CODE ELIMINATION                                        */
/* ==================================================================== */

describe('dead code elimination', () => {
  it('11. an unused temporary computation is removed', () => {
    // t1 = a + b; result = 5;  -- t1 is never read anywhere.
    const p = program(
      [binary('t1', v('a'), '+', v('b')), assign('result', c(5))],
      1
    );
    expect(formatTAC(deadCodeElimination(p))).toBe('result = 5');
  });

  it('12. a used temporary computation remains', () => {
    const p = program(
      [binary('t1', v('a'), '+', v('b')), copy('c', t('t1'))],
      1
    );
    const result = deadCodeElimination(p);
    expect(formatTAC(result)).toBe(['t1 = a + b', 'c = t1'].join('\n'));
    expect(result.instructions.length).toBe(2);
  });

  it('13. an earlier overwritten variable assignment can be removed', () => {
    // a = 10; a = 20;  -- the first write is dead: it is overwritten before
    // ever being read.
    const p = program([assign('a', c(10)), assign('a', c(20))]);
    expect(formatTAC(deadCodeElimination(p))).toBe('a = 20');
  });

  it('14. an assignment whose value is later used remains', () => {
    // a = 10; t1 = a + 5; c = t1;  -- the read of `a` inside t1's
    // computation, which is itself needed because c is a live declared
    // variable, keeps a = 10 alive too. Nothing here is dead.
    const p = program(
      [assign('a', c(10)), binary('t1', v('a'), '+', c(5)), copy('c', t('t1'))],
      1
    );
    const result = deadCodeElimination(p);
    expect(formatTAC(result)).toBe(['a = 10', 't1 = a + 5', 'c = t1'].join('\n'));
    expect(result.instructions.length).toBe(3);
  });

  it('15. a declared variable\u2019s final (and only) assignment remains even with no later TAC use', () => {
    const p = program([assign('x', c(42))]);
    const result = deadCodeElimination(p);
    expect(formatTAC(result)).toBe('x = 42');
    expect(result.instructions.length).toBe(1);
  });

  it('16. DCE handles a whole chain of temporaries: if the last one is unused, all may be removed', () => {
    // t1 = a + b; t2 = t1 * 2; t3 = t2 + 1; keep = 5;
    // t3 is never used anywhere, so it is dead; once it is gone, t2 is never
    // read either, so it is dead too; once THAT is gone, t1 is never read,
    // so it is dead as well. All three vanish together in one backward pass.
    const p = program(
      [
        binary('t1', v('a'), '+', v('b')),
        binary('t2', t('t1'), '*', c(2)),
        binary('t3', t('t2'), '+', c(1)),
        assign('keep', c(5)),
      ],
      3
    );
    const result = deadCodeElimination(p);
    expect(formatTAC(result)).toBe('keep = 5');
    expect(result.instructions.length).toBe(1);
  });

  it('17. DCE does not remove a computation whose result reaches a declared program variable', () => {
    const p = program(
      [binary('t1', v('a'), '+', v('b')), copy('result', t('t1'))],
      1
    );
    const result = deadCodeElimination(p);
    // `result` is a declared variable's sole (hence final) write, so it is
    // protected -- and because it needs t1, t1's computation survives too.
    expect(result.instructions.length).toBe(2);
    expect(formatTAC(result)).toBe(['t1 = a + b', 'result = t1'].join('\n'));
  });

  it('removes a dead temporary but keeps an unrelated live instruction, in original order', () => {
    const p = program(
      [
        binary('t1', v('a'), '+', v('b')), // dead: never read
        assign('kept1', c(1)),
        assign('kept2', c(2)),
      ],
      1
    );
    const result = deadCodeElimination(p);
    expect(formatTAC(result)).toBe(['kept1 = 1', 'kept2 = 2'].join('\n'));
  });

  it('never mutates its input', () => {
    const original = program(
      [binary('t1', v('a'), '+', v('b')), assign('result', c(5))],
      1
    );
    const snapshot = JSON.parse(JSON.stringify(original));
    deadCodeElimination(original);
    expect(original).toEqual(snapshot);
  });

  it('is deterministic', () => {
    const p = program(
      [binary('t1', v('a'), '+', v('b')), assign('result', c(5))],
      1
    );
    expect(deadCodeElimination(p)).toEqual(deadCodeElimination(p));
  });

  it('preserves original instruction order among survivors', () => {
    const p = program(
      [
        assign('a', c(1)),
        binary('t1', v('x'), '+', v('y')), // dead
        assign('b', c(2)),
      ],
      1
    );
    expect(formatTAC(deadCodeElimination(p))).toBe(['a = 1', 'b = 2'].join('\n'));
  });
});

/* ==================================================================== */
/* PHASE 7: COMBINED OPTIMIZATION (all four passes)                      */
/* ==================================================================== */

describe('Phase 7: combined optimization', () => {
  it('18. constant propagation + folding + algebraic simplification (before DCE)', () => {
    // int n; int p = n * 1;  -- n is never assigned anywhere, so propagation
    // and folding find nothing to do; algebraic simplification is what
    // actually rewrites this line.
    const source = 'int n;\nint p = n * 1;';
    const afterCp = constantPropagation(tacOf(source));
    const afterCf = constantFolding(afterCp);
    const afterAs = algebraicSimplification(afterCf);
    expect(formatTAC(afterAs)).toBe(['t1 = n', 'p = t1'].join('\n'));
  });

  it('19. all four passes together on a program exercising every technique at once', () => {
    // int a = 10; int b = 20;      -- constant propagation fodder
    // int unused; unused = a + b; unused = 99;   -- overwritten: DCE prunes it
    // int n; int c = n * 1;        -- algebraic simplification (n unknown)
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int unused;',
      'unused = a + b;',
      'unused = 99;',
      'int n;',
      'int c = n * 1;',
    ].join('\n');

    expect(optimizedTextOf(source)).toBe(
      ['a = 10', 'b = 20', 'unused = 99', 't2 = n', 'c = t2'].join('\n')
    );
    // Propagation folded a+b to 30 before DCE ever ran, but the WHOLE
    // computation (including that fold) was dead, so it disappears entirely
    // -- confirming folding and DCE compose correctly across passes.
  });

  it('20. Main demo [Phase 7]: algebraic simplification fires; DCE keeps everything because every value is genuinely used', () => {
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n');

    expect(optimizedTextOf(source)).toBe(
      [
        'a = 10',
        'b = 20',
        't1 = 30',
        'c = t1',
        't2 = c', // simplified from c * 1
        'd = t2',
        't3 = c', // simplified from c + 0
        'e = t3',
      ].join('\n')
    );
    // Nothing is removed by DCE here: t2 and t3 are each immediately read by
    // the very next instruction, and every declared variable (a, b, c, d, e)
    // is written exactly once, so each write is protected as that
    // variable's final value. This is the correct, conservative outcome --
    // see the final report for why this specific demo has nothing left for
    // DCE to prune once algebraic simplification has run.
  });

  it('21. algebraic sample: int a=10;int b=a*1;int c=b+0;int d=c-0;int e=d/1;', () => {
    const source = 'int a = 10;\nint b = a * 1;\nint c = b + 0;\nint d = c - 0;\nint e = d / 1;';
    expect(optimizedTextOf(source)).toBe(
      [
        'a = 10',
        't1 = 10', // a * 1: a is a KNOWN CONSTANT, so this is resolved by
        // propagation + folding, not algebraic simplification --
        // see the final report for this exact nuance.
        'b = t1',
        't2 = b', // b + 0: b is never a known constant, so THIS is
        // genuine algebraic simplification.
        'c = t2',
        't3 = c', // c - 0: likewise genuine algebraic simplification.
        'd = t3',
        't4 = d', // d / 1: likewise.
        'e = t4',
      ].join('\n')
    );
  });

  it('22. DCE sample: an overwritten computation is fully removed', () => {
    // A value computed, assigned to a declared variable, and then
    // overwritten before ever being read -- the ONLY pattern in this
    // pipeline that reliably produces removable dead code for a declared
    // variable (see the final report for why a variable's SOLE write is
    // never removable under the conservative policy this project uses).
    const source = 'int b = 1;\nint c = 2;\nint a;\na = b + c;\na = 20;';
    expect(optimizedTextOf(source)).toBe(['b = 1', 'c = 2', 'a = 20'].join('\n'));
  });

  it('23. REQUIRED: the original TAC is never mutated by the full four-pass optimize()', () => {
    const source = 'int b = 1;\nint c = 2;\nint a;\na = b + c;\na = 20;';
    const originalTac = tacOf(source);
    const snapshot = JSON.parse(JSON.stringify(originalTac));

    const optimizedTac = optimize(originalTac);

    expect(originalTac).toEqual(snapshot);
    expect(optimizedTac).not.toBe(originalTac);
    expect(optimizedTac.instructions).not.toBe(originalTac.instructions);
    // A real optimization happened: instructions were actually REMOVED this
    // time, not just rewritten, which is a stronger check than Phase 6's
    // equivalent test could exercise on its own.
    expect(optimizedTac.instructions.length).not.toBe(originalTac.instructions.length);
  });

  it('24. the full four-pass optimize() is deterministic', () => {
    const source = 'int b = 1;\nint c = 2;\nint a;\na = b + c;\na = 20;\nint n;\nint p = n * 1;';
    const tac = tacOf(source);
    expect(optimize(tac)).toEqual(optimize(tac));
  });

  it('25. CRITICAL REGRESSION TEST: exact pattern from the brief -- generate, snapshot, optimize, compare', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;\nint d = c * 1;\nint e = c + 0;';
    const ast = astOf(source);

    const original = generateTAC(ast);
    const snapshot = JSON.parse(JSON.stringify(original));
    const optimized = optimize(original);

    expect(original).toEqual(snapshot);
    expect(optimized).not.toBe(original);
  });

  it('important regression case: folds constants, simplifies c*1 and c+0, never changes program meaning', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;\nint d = c * 1;\nint e = c + 0;';
    const result = optimize(tacOf(source));
    const text = formatTAC(result);

    expect(text).toContain('t1 = 30'); // known constants folded
    expect(text).not.toContain('c * 1'); // c * 1 was simplified away
    expect(text).not.toContain('c + 0'); // c + 0 was simplified away
    // d and e still end up holding c's value (30), just via the simplified
    // copy chain -- the program's OBSERVABLE result is unchanged.
    expect(text).toContain('d = t2');
    expect(text).toContain('e = t3');
  });
});

/* ==================================================================== */
/* PHASE 7: SCOPE SAFETY                                                 */
/* ==================================================================== */

describe('Phase 7: scope safety', () => {
  it('26. the symbol table shape is unchanged: exactly the seven frozen fields', () => {
    const table = new SymbolTable();
    table.declare({
      name: 'x',
      kind: 'variable',
      type: 'int',
      scope: 'global',
      declaredLine: 1,
      declaredColumn: 5,
      initialized: true,
    });
    const symbol = table.lookup('x')!;
    expect(Object.keys(symbol).sort()).toEqual(
      ['declaredColumn', 'declaredLine', 'initialized', 'kind', 'name', 'scope', 'type'].sort()
    );
  });

  it('27. no usageCount field exists on any symbol produced by real compilation', () => {
    const ast = astOf('int a = 10;\nint b = a + 5;');
    const semantic = analyze(ast);
    for (const symbol of semantic.symbols) {
      expect('usageCount' in symbol).toBe(false);
      expect('referenceCount' in symbol).toBe(false);
    }
  });

  it('28. no new fields were added to Symbol beyond the frozen Phase 4.1 set', () => {
    const ast = astOf('int a = 10;');
    const semantic = analyze(ast);
    const symbol = semantic.symbols[0]!;
    const forbidden = [
      'usageCount',
      'referenceCount',
      'value',
      'constantValue',
      'address',
      'offset',
      'register',
      'TACName',
    ];
    for (const field of forbidden) {
      expect(field in symbol).toBe(false);
    }
  });

  it('29. AST node shapes are unchanged: parsing still produces exactly the seven known node types', () => {
    const ast = astOf('int a = 10;\nint b = a + 5;\nb = -a;');
    const seenTypes = new Set<string>();
    const visitExpr = (node: { type: string }): void => {
      seenTypes.add(node.type);
      const n = node as unknown as Record<string, unknown>;
      if (n['left']) visitExpr(n['left'] as { type: string });
      if (n['right']) visitExpr(n['right'] as { type: string });
      if (n['operand']) visitExpr(n['operand'] as { type: string });
    };
    for (const statement of ast.body) {
      seenTypes.add(statement.type);
      const s = statement as unknown as Record<string, unknown>;
      if (s['init']) visitExpr(s['init'] as { type: string });
      if (s['value']) visitExpr(s['value'] as { type: string });
    }
    for (const type of seenTypes) {
      expect(
        ['VarDecl', 'Assignment', 'BinaryExpr', 'UnaryExpr', 'NumberLiteral', 'Identifier'].includes(
          type
        )
      ).toBe(true);
    }
  });

  it('30. lexer and parser behaviour is unaffected: tokens and AST shape for a known program are unchanged', () => {
    const source = 'int a = 10;\nint b = a + 5;';
    const { tokens, errors } = tokenize(source);
    expect(errors.length).toBe(0);
    // 5 tokens for "int a = 10;" + 7 for "int b = a + 5;" + EOF = 13.
    expect(tokens.length).toBe(13);
    const ast = astOf(source);
    expect(ast.body.length).toBe(2);
    expect(ast.body[0]?.type).toBe('VarDecl');
    expect(ast.body[1]?.type).toBe('VarDecl');
    // The full lexer.test.ts and parser.test.ts suites (unmodified since
    // Phase 2) are the authoritative check for this; this is a lightweight
    // in-file confirmation that nothing here has drifted.
  });
});

/* ==================================================================== */
/* PHASE 8: BEFORE/AFTER TAC COMPARISON                                  */
/* ==================================================================== */

describe('Phase 8: compareTAC', () => {
  it('1. comparison of unchanged TAC: changed is false', () => {
    // int a; int b; int c = a + b;  -- a and b are never known constants, so
    // nothing propagates, folds, or simplifies, and c's copy is its final
    // write, so DCE keeps it too. Nothing changes anywhere.
    const source = 'int a;\nint b;\nint c = a + b;';
    const original = tacOf(source);
    const optimized = optimize(original);
    const comparison = compareTAC(original, optimized);

    expect(comparison.changed).toBe(false);
    expect(comparison.originalInstructionCount).toBe(comparison.optimizedInstructionCount);
    expect(comparison.removedInstructionCount).toBe(0);
  });

  it('2. comparison of changed TAC: changed is true', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;';
    const original = tacOf(source);
    const optimized = optimize(original);
    const comparison = compareTAC(original, optimized);

    expect(comparison.changed).toBe(true);
  });

  it('3. reports the correct original instruction count', () => {
    const p = program([assign('a', c(10)), assign('b', c(20)), binary('t1', v('a'), '+', v('b'))]);
    const comparison = compareTAC(p, optimize(p));
    expect(comparison.originalInstructionCount).toBe(3);
  });

  it('4. reports the correct optimized instruction count', () => {
    // The overwrite pattern: 5 original instructions, 2 genuinely removed.
    const source = 'int b = 1;\nint c = 2;\nint a;\na = b + c;\na = 20;';
    const comparison = compareTAC(tacOf(source), optimize(tacOf(source)));
    expect(comparison.optimizedInstructionCount).toBe(3);
  });

  it('5. reports the correct removed instruction count', () => {
    const source = 'int b = 1;\nint c = 2;\nint a;\na = b + c;\na = 20;';
    const comparison = compareTAC(tacOf(source), optimize(tacOf(source)));
    expect(comparison.removedInstructionCount).toBe(2);
  });

  it('6. changed = true when TAC differs, even with the SAME instruction count', () => {
    // The main demo: algebraic simplification rewrites t2 = c*1 -> t2 = c
    // and t3 = c+0 -> t3 = c, but DCE removes nothing (every value is
    // genuinely read). Instruction count is identical; content is not.
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n');
    const original = tacOf(source);
    const optimized = optimize(original);
    const comparison = compareTAC(original, optimized);

    expect(comparison.originalInstructionCount).toBe(comparison.optimizedInstructionCount);
    expect(comparison.removedInstructionCount).toBe(0);
    expect(comparison.changed).toBe(true); // count is unchanged, but content is not
  });

  it('7. changed = false only when every instruction is structurally identical, in order', () => {
    const p = program([assign('a', c(10)), assign('b', c(20))]);
    const comparison = compareTAC(p, optimize(p));
    expect(comparison.changed).toBe(false);
  });

  it('7b. is exactly the brief\u2019s stated example: same count AND identical instructions -> changed = false', () => {
    // An already-fully-optimized program: optimizing it again changes nothing.
    const p = program([assign('a', c(10)), assign('b', c(20))]);
    const alreadyOptimized = optimize(p);
    const comparison = compareTAC(alreadyOptimized, optimize(alreadyOptimized));
    expect(comparison.originalInstructionCount).toBe(comparison.optimizedInstructionCount);
    expect(comparison.changed).toBe(false);
  });

  it('8. does not mutate the original TAC', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;';
    const original = tacOf(source);
    const snapshot = JSON.parse(JSON.stringify(original));

    compareTAC(original, optimize(original));

    expect(original).toEqual(snapshot);
  });

  it('9. does not mutate the optimized TAC', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;';
    const optimized = optimize(tacOf(source));
    const snapshot = JSON.parse(JSON.stringify(optimized));

    compareTAC(tacOf(source), optimized);

    expect(optimized).toEqual(snapshot);
  });

  it('exposes temporary counts before and after, unchanged by optimization', () => {
    // Neither optimization nor comparison ever mints a new temporary, so
    // these should always match for this project's optimizer.
    const source = 'int a = 10;\nint b = a + 5;';
    const original = tacOf(source);
    const comparison = compareTAC(original, optimize(original));
    expect(comparison.originalTemporaryCount).toBe(1);
    expect(comparison.optimizedTemporaryCount).toBe(1);
  });

  it('ignores sourceNodeId when deciding whether TAC changed', () => {
    // Two instructions that compute the same thing but trace back to
    // different AST nodes must still count as "the same" for comparison.
    const a: TACProgram = { instructions: [assign('x', c(1))], temporaryCount: 0 };
    const bInstruction = { ...assign('x', c(1)), sourceNodeId: 'totally-different-node' };
    const b: TACProgram = { instructions: [bInstruction], temporaryCount: 0 };
    expect(compareTAC(a, b).changed).toBe(false);
  });

  it('detects a change in operator alone', () => {
    const a = program([binary('t1', v('x'), '+', v('y'))]);
    const b = program([binary('t1', v('x'), '-', v('y'))]);
    expect(compareTAC(a, b).changed).toBe(true);
  });

  it('detects a change in instruction kind alone (binary becoming assign)', () => {
    const a = program([binary('t1', c(10), '+', c(20))]);
    const b = program([assign('t1', c(30))]);
    expect(compareTAC(a, b).changed).toBe(true);
  });

  it('is deterministic', () => {
    const source = 'int a = 10;\nint b = 20;\nint c = a + b;\nint d = c * 1;';
    const original = tacOf(source);
    const optimized = optimize(original);
    expect(compareTAC(original, optimized)).toEqual(compareTAC(original, optimized));
  });

  it('never mutates either argument even for a program where nothing changes', () => {
    const p = program([assign('a', c(10))]);
    const optimized = optimize(p);
    const snapshotP = JSON.parse(JSON.stringify(p));
    const snapshotOptimized = JSON.parse(JSON.stringify(optimized));
    compareTAC(p, optimized);
    expect(p).toEqual(snapshotP);
    expect(optimized).toEqual(snapshotOptimized);
  });
});

/* ------------------------------------------------------------------ */
/* Evaluate helper                                                      */
/* ------------------------------------------------------------------ */

describe('evaluate helper', () => {
  it('truncates division toward zero, matching C semantics', () => {
    expect(evaluateBinary('/', 7, 2)).toBe(3);
    expect(evaluateBinary('/', -7, 2)).toBe(-3); // NOT -4 (which Math.floor would give)
  });

  it('is a pure function: same inputs always give the same output', () => {
    expect(evaluateBinary('+', 3, 4)).toBe(evaluateBinary('+', 3, 4));
  });
});

/* ------------------------------------------------------------------ */
/* Compile-time division-by-zero detection                             */
/* ------------------------------------------------------------------ */

describe('division-by-zero detection: checkDivisionByZero', () => {
  // These pass-level tests exercise the TAC-scanning logic directly with
  // hand-built TAC, the same style used throughout this file. A minimal
  // placeholder `Program` stands in for the AST: none of these hand-built
  // instructions trace back to a real node id, so `checkDivisionByZero`
  // falls back to this program's own span -- which is exactly the
  // documented, defensive fallback behaviour being exercised here. The
  // *accuracy* of a real source span is covered separately by the
  // real-compilation tests below and by the pipeline integration tests.
  const dummyProgram: Program = { type: 'Program', id: 'p0', line: 1, column: 1, start: 0, end: 0, body: [] };

  it('flags a binary division whose right operand is the literal constant 0', () => {
    const p = program([binary('t1', c(10), '/', c(0))], 1);
    const errors = checkDivisionByZero(p, dummyProgram);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.stage).toBe('optimizer');
    expect(errors[0]?.severity).toBe('error');
    expect(errors[0]?.message.toLowerCase()).toContain('division by zero');
  });

  it('does NOT flag a division by a nonzero constant', () => {
    const p = program([binary('t1', c(10), '/', c(2))], 1);
    expect(checkDivisionByZero(p, dummyProgram)).toHaveLength(0);
  });

  it('does NOT flag a division by an unresolved variable (unknown divisor)', () => {
    const p = program([binary('t1', c(10), '/', v('y'))], 1);
    expect(checkDivisionByZero(p, dummyProgram)).toHaveLength(0);
  });

  it('does NOT flag a division by an unresolved temporary', () => {
    const p = program([binary('t1', c(10), '/', t('t0'))], 1);
    expect(checkDivisionByZero(p, dummyProgram)).toHaveLength(0);
  });

  it('does NOT flag a division whose LEFT operand (not the divisor) is zero', () => {
    // 0 / x is not a division by zero at all -- only the divisor matters.
    const p = program([binary('t1', c(0), '/', v('x'))], 0);
    expect(checkDivisionByZero(p, dummyProgram)).toHaveLength(0);
  });

  it('ignores non-division binary operators, even with a zero right operand', () => {
    const p = program([
      binary('t1', v('x'), '+', c(0)),
      binary('t2', v('x'), '*', c(0)),
      binary('t3', v('x'), '-', c(0)),
    ]);
    expect(checkDivisionByZero(p, dummyProgram)).toHaveLength(0);
  });

  it('reports one error per division-by-zero instruction, in program order', () => {
    const p = program(
      [binary('t1', c(10), '/', c(0)), assign('a', c(1)), binary('t2', v('a'), '/', c(0))],
      2
    );
    expect(checkDivisionByZero(p, dummyProgram)).toHaveLength(2);
  });

  it('never mutates either argument', () => {
    const p = program([binary('t1', c(10), '/', c(0))], 1);
    const snapshot = JSON.parse(JSON.stringify(p));
    checkDivisionByZero(p, dummyProgram);
    expect(p).toEqual(snapshot);
  });

  /* ---- real-compilation cases, using the actual pipeline stages ---- */

  /** Run TAC generation + one constant-propagation pass, exactly as pipeline.ts does before this check. */
  function propagatedTacOf(source: string): TACProgram {
    return constantPropagation(tacOf(source));
  }

  it('Case 1: literal zero divisor -- int x = 10 / 0;', () => {
    const ast = astOf('int x = 10 / 0;');
    const errors = checkDivisionByZero(propagatedTacOf('int x = 10 / 0;'), ast);
    expect(errors).toHaveLength(1);
    // The reported span is the division expression itself, found via the
    // instruction's sourceNodeId -- not a generic line 1 guess.
    expect(errors[0]?.line).toBe(1);
  });

  it('Case 2: divisor proven zero through constant propagation -- int y = 0; int x = 10 / y;', () => {
    const source = 'int y = 0;\nint x = 10 / y;';
    const ast = astOf(source);
    const errors = checkDivisionByZero(propagatedTacOf(source), ast);
    expect(errors).toHaveLength(1);
    // The division is on line 2, not line 1 where `y` was declared.
    expect(errors[0]?.line).toBe(2);
  });

  it('Case 3: divisor is a known NONzero constant -- int y = 2; int x = 10 / y; stays valid', () => {
    const source = 'int y = 2;\nint x = 10 / y;';
    const ast = astOf(source);
    expect(checkDivisionByZero(propagatedTacOf(source), ast)).toHaveLength(0);
    // And it still optimizes exactly as before this feature existed: 10 / 2
    // folds to the literal 5 (no copy propagation, so `x = t1` stays a
    // separate instruction -- that is unrelated, pre-existing behaviour).
    expect(optimizedTextOf(source)).toBe(['y = 2', 't1 = 5', 'x = t1'].join('\n'));
  });

  it('Case 4: divisor is unknown at compile time -- int y; int x = 10 / y; is NOT flagged', () => {
    // `int y;` has no initializer, so it never enters constant propagation's
    // environment: its value is genuinely unknown, not merely un-propagated.
    const source = 'int y;\nint x = 10 / y;';
    const ast = astOf(source);
    expect(checkDivisionByZero(propagatedTacOf(source), ast)).toHaveLength(0);
  });
});

/* ==================================================================== */
/* STAGE 3: TYPE-AWARE OPTIMIZATION                                    */
/* ==================================================================== */

describe('Stage 3: type-aware optimization', () => {
  it('preserves float type during constant propagation', () => {
    const source = 'float a = 10.5; float b = a + 2.5;';
    const result = constantPropagation(tacOf(source));
    const binaryInstruction = result.instructions.find((instruction) => instruction.kind === 'binary');

    expect(binaryInstruction?.kind).toBe('binary');
    if (binaryInstruction?.kind === 'binary') {
      expect(binaryInstruction.left).toEqual({ kind: 'constant', value: 10.5, valueType: 'float' });
      expect(binaryInstruction.right).toEqual({ kind: 'constant', value: 2.5, valueType: 'float' });
      expect(binaryInstruction.targetType).toBe('float');
    }
  });

  it('preserves int-to-float promotion during propagation into a float variable', () => {
    const source = 'int a = 10; float b = a;';
    const result = constantPropagation(tacOf(source));
    const last = result.instructions[result.instructions.length - 1];

    expect(last?.kind).toBe('assign');
    if (last?.kind === 'assign') {
      expect(last.targetType).toBe('float');
      expect(last.value).toEqual({ kind: 'constant', value: 10, valueType: 'float' });
    }
  });

  it('folds float arithmetic using floating-point division semantics', () => {
    const source = 'float x = 7.0 / 2.0;';
    const result = constantFolding(constantPropagation(tacOf(source)));
    const text = formatTAC(result);

    expect(text).toContain('t1 = 3.5');
    const folded = result.instructions.find((instruction) => instruction.target === 't1');
    expect(folded?.kind).toBe('assign');
    if (folded?.kind === 'assign') {
      expect(folded.targetType).toBe('float');
      expect(folded.value).toEqual({ kind: 'constant', value: 3.5, valueType: 'float' });
    }
  });

  it('keeps integer division semantics when the expression itself is integer', () => {
    const source = 'float x = 7 / 2;';
    const result = constantFolding(constantPropagation(tacOf(source)));
    const folded = result.instructions.find((instruction) => instruction.target === 't1');

    expect(folded?.kind).toBe('assign');
    if (folded?.kind === 'assign') {
      expect(folded.targetType).toBe('int');
      expect(folded.value).toEqual({ kind: 'constant', value: 3, valueType: 'int' });
    }
    const final = result.instructions[result.instructions.length - 1];
    expect(final?.target).toBe('x');
    expect(final?.targetType).toBe('float');
  });

  it('preserves float type when algebraic simplification replaces an operation with zero', () => {
    const source = 'float x = 5.5; float y = x * 0;';
    const result = algebraicSimplification(constantFolding(constantPropagation(tacOf(source))));
    const simplified = result.instructions.find((instruction) => instruction.target === 't1');

    expect(simplified?.kind).toBe('assign');
    if (simplified?.kind === 'assign') {
      expect(simplified.targetType).toBe('float');
      expect(simplified.value).toEqual({ kind: 'constant', value: 0, valueType: 'float' });
    }
  });

  it('preserves float type when algebraic simplification keeps the variable value', () => {
    const source = 'float x; float y = x * 1;';
    const result = algebraicSimplification(tacOf(source));
    const simplified = result.instructions.find((instruction) => instruction.target === 't1');

    expect(simplified?.kind).toBe('assign');
    if (simplified?.kind === 'assign') {
      expect(simplified.targetType).toBe('float');
      expect(simplified.value).toEqual({ kind: 'variable', name: 'x', valueType: 'float' });
    }
  });

  it('DCE preserves type metadata on surviving float instructions', () => {
    const source = 'float a = 1.5; float b = 2.5; float c = a + b;';
    const original = tacOf(source);
    const result = deadCodeElimination(original);

    expect(result.instructions.every((instruction) => instruction.targetType !== undefined)).toBe(true);
    expect(result.instructions.some((instruction) => instruction.target === 'c' && instruction.targetType === 'float')).toBe(true);
  });

  it('full optimization preserves numeric types through propagation, folding, simplification and DCE', () => {
    const source = [
      'int a = 10;',
      'float b = a + 2.5;',
      'float c = b * 1;',
      'float d = c / 2.0;',
    ].join('\n');

    const original = tacOf(source);
    const optimized = optimize(original);

    expect(formatTAC(optimized)).toContain('b = t1');
    expect(formatTAC(optimized)).toContain('c = t2');
    expect(optimized.instructions.filter((instruction) => instruction.targetType === 'float').length).toBeGreaterThan(0);
    expect(optimized.instructions.every((instruction) => instruction.targetType !== undefined)).toBe(true);
  });

  it('full optimization keeps float division-by-zero protection intact', () => {
    const source = 'float x = 10.5; float y = 0.0; float z = x / y;';
    const tac = tacOf(source);
    const result = constantFolding(constantPropagation(tac));

    const division = result.instructions.find((instruction) => instruction.kind === 'binary' && instruction.operator === '/');
    expect(division?.kind).toBe('binary');
    expect(formatTAC(result)).not.toContain('Infinity');
    expect(formatTAC(result)).not.toContain('NaN');
  });
});
