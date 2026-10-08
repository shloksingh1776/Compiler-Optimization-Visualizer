/**
 * DEMO PROGRAMS
 * =============
 *
 * These are chosen so that each optimization technique can be demonstrated
 * *independently*. In particular they are deliberately NOT all trivially
 * constant: several involve expressions over variables, so constant
 * propagation has real work to do before folding can happen.
 *
 * A structural note worth knowing when reading these: MiniC v1 has no
 * `if`/`while` and no external input, so a variable is only ever "unknown"
 * to constant propagation and algebraic simplification by never being
 * assigned a literal (directly or transitively) before it is used. The
 * `algebraic` and `dce-*` samples below are built around that fact.
 */

export interface Sample {
  readonly id: string;
  readonly title: string;
  /** What this program is meant to demonstrate. */
  readonly description: string;
  readonly source: string;
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'main-demo',
    title: 'Main demo (all six passes)',
    description:
      'Propagation substitutes a and b into t1 = a + b, giving t1 = 10 + 20; folding evaluates that to t1 = 30. Algebraic simplification then reduces c * 1 to c and c + 0 to c, since c is not a known constant but the identity holds regardless. Dead code elimination keeps every remaining line: each temporary is read by the very next instruction, and every variable is written exactly once.',
    source: [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;   // constant propagation, then folding',
      'int d = c * 1;   // algebraic simplification: c * 1 -> c',
      'int e = c + 0;   // algebraic simplification: c + 0 -> c',
    ].join('\n'),
  },
  {
    id: 'constant-folding',
    title: 'Constant folding only',
    description: 'Both operands are already literals, so no analysis is needed to evaluate them.',
    source: ['int a = 10 * 20;', 'int b = 100 / 4;', 'int c = 7 - 12;'].join('\n'),
  },
  {
    id: 'constant-propagation',
    title: 'Constant propagation',
    description:
      'The value of x is known at compile time, so every later use of x can be replaced by that value.',
    source: ['int x = 5;', 'int y = x + 3;', 'int z = y * x;'].join('\n'),
  },
  {
    id: 'algebraic',
    title: 'Algebraic simplification',
    description:
      'n is declared but never assigned, so it is never a known constant -- constant propagation and folding find nothing to do here. Algebraic simplification is what actually rewrites every line below, since each identity holds regardless of what n happens to be.',
    source: [
      'int n;',
      'int p = n * 1;   // x * 1 -> x',
      'int q = n + 0;   // x + 0 -> x',
      'int r = n * 0;   // x * 0 -> 0',
      'int s = n / 1;   // x / 1 -> x',
    ].join('\n'),
  },
  {
    id: 'dead-code',
    title: 'Dead code elimination',
    description:
      'a is assigned from b + c, then immediately overwritten before that value is ever read. Dead code elimination removes both the overwritten assignment and the arithmetic that fed it, in one backward pass -- the second assignment to a is kept, since it is the variable\u2019s final, observable value.',
    source: ['int b = 1;', 'int c = 2;', 'int a;', 'a = b + c;   // overwritten before use', 'a = 20;      // this is the value that survives'].join('\n'),
  },
  {
    id: 'dce-chain',
    title: 'Dead code: a whole chain removed at once',
    description:
      'x is computed through three chained temporaries, then immediately overwritten. Because none of the chain is read afterward, all three temporaries and the now-pointless copy into x disappear together in a single backward pass -- no repeated scanning needed.',
    source: [
      'int a;',
      'int b;',
      'int x;',
      'x = (a + b) * 2 + 1;   // three temporaries, all eventually unused',
      'x = 99;                // this is the value that survives',
    ].join('\n'),
  },
  {
    id: 'bool-comparisons',
    title: 'Bool and comparisons',
    description:
      'Stage 4 demonstrates boolean values and numeric comparisons. Constant folding resolves comparisons whose operands are known at compile time, while mixed int/float comparisons produce a bool result.',
    source: [
      'int a = 10;',
      'float b = 10.5;',
      'bool less = a < b;',
      'bool equal = a == 10;',
    ].join('\n'),
  },
  {
    id: 'print',
    title: 'Print values',
    description: 'Stage 5 demonstrates actual program output for int, float and bool values.',
    source: [
      'int x = 10 + 20;',
      'float y = 7.5;',
      'bool ok = x > 20;',
      'print(x);',
      'print(y);',
      'print(ok);',
    ].join('\n'),
  },
  {
    id: 'if-else',
    title: 'If / else control flow',
    description: 'Stage 6 demonstrates conditional execution using bool conditions, labels and jumps. The selected branch is executed and its print value appears in Program Output.',
    source: [
      'int a = 10;',
      'int b = 20;',
      'if (a < b) {',
      '  print(a + b);',
      '} else {',
      '  print(a - b);',
      '}',
    ].join('\n'),
  },
  {
    id: 'while',
    title: 'While loop',
    description: 'Stage 12 demonstrates basic while-loop control flow using a boolean condition, a backward jump to the loop condition, and an exit label.',
    source: [
      'int i = 0;',
      'while (i < 3) {',
      '  print(i);',
      '  i = i + 1;',
      '}',
    ].join('\n'),
  },
  {
    id: 'logical',
    title: 'Logical operators',
    description: 'Stage 13 demonstrates &&, || and ! with boolean operands. && and || use short-circuit control flow, so the right-hand side is evaluated only when necessary.',
    source: [
      'bool a = true;',
      'bool b = false;',
      'bool x = a && !b;',
      'bool y = a || b;',
      'print(x);',
      'print(y);',
    ].join('\n'),
  },
  {
    id: 'ternary',
    title: 'Ternary operator',
    description: 'Stage 14 demonstrates the conditional expression condition ? then : else. Only the selected branch is evaluated, and the expression is lowered to labels and jumps in TAC.',
    source: [
      'int a = 10;',
      'int b = 20;',
      'int result = a < b ? a : b;',
      'print(result);',
    ].join('\n'),
  },
  {
    id: 'return',
    title: 'Return values',
    description: 'Stage 7 demonstrates return statements. Execution stops at the first return reached, and the returned int, float or bool value is displayed separately from print output.',
    source: [
      'int a = 10;',
      'int b = 20;',
      'if (a < b) {',
      '  print(a);',
      '  return a + b;',
      '} else {',
      '  return a - b;',
      '}',
    ].join('\n'),
  },
  {
    id: 'functions',
    title: 'Basic functions',
    description: 'Stage 8 demonstrates typed user-defined functions, parameters, local variables, function calls and returned values.',
    source: [
      'int add(int a, int b) {',
      '  int result = a + b;',
      '  return result;',
      '}',
      'int x = add(10, 20);',
      'print(x);',
      'return x;',
    ].join('\n'),
  },
  {
    id: 'lexical-error',
    title: 'Lexical error',
    description:
      'The scanner rejects the stray character, so syntax analysis is skipped rather than reporting cascading nonsense.',
    source: ['int a = 1 @ 2;', 'int b = 3;'].join('\n'),
  },
  {
    id: 'syntax-error',
    title: 'Syntax error',
    description:
      'The scanner is happy, but the token stream does not match the grammar. Panic mode recovery finds both broken statements.',
    source: ['int a = ;', 'int b = 2;', 'int = 3;'].join('\n'),
  },
  {
    id: 'semantic-error',
    title: 'Semantic error (undeclared variable)',
    description:
      'Lexical and syntax analysis both succeed, so the tokens and the AST are shown. Semantic analysis then reports that b was never declared.',
    source: 'int a = b + 1;',
  },
  {
    id: 'algebraic-chain',
    title: 'Fold vs. simplify',
    description:
      'One example, two different techniques. The first line (a * 1) is resolved by constant propagation and folding, since a is a known constant. The remaining three lines are never known constants, so those are resolved by genuine algebraic simplification instead.',
    source: [
      'int a = 10;',
      'int b = a * 1;   // resolved by folding: a is a known constant',
      'int c = b + 0;   // resolved by algebraic simplification: b is not',
      'int d = c - 0;   // likewise',
      'int e = d / 1;   // likewise',
    ].join('\n'),
  },
  {
    id: 'dce-unused-variable',
    title: 'Why a declared variable is never pruned',
    description:
      "unused's computed value is never read anywhere -- and yet it is kept. This is deliberate: MiniC has no print or return statement, so nothing can prove a declared variable's value is truly unobservable. This optimizer's dead code elimination is conservative on purpose: a declared variable's final write always survives, whatever its name suggests, so the visualizer never appears to erase a result the source program actually computed. Only a value that is provably overwritten before use (see the 'Dead code elimination' sample) is ever removed.",
    source: [
      'int a = 10;',
      'int b = 20;',
      'int unused = a + b;   // computed, never read -- but still kept',
      'int result = 5;',
    ].join('\n'),
  },
];

/** The sample loaded when the application starts. */
export const DEFAULT_SAMPLE: Sample = SAMPLES[0]!;
