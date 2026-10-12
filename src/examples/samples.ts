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
  readonly category: string;
  /** What this program is meant to demonstrate. */
  readonly description: string;
  readonly source: string;
}

export const SAMPLES: readonly Sample[] = [
  {
    id: 'main-demo',
    title: 'Main demo (all six passes)',
    category: 'Optimization',
    description:
      'Propagation substitutes a and b into t1 = a + b, giving t1 = 10 + 20; folding evaluates that to t1 = 30. Algebraic simplification then reduces c * 1 to c and c + 0 to c, since c is not a known constant but the identity holds regardless. Dead code elimination keeps every remaining line: each temporary is read by the very next instruction, and every variable is written exactly once.',
    source: [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;',
      'int d = c * 1;',
      'int e = c + 0;',
    ].join('\n'),
  },
  {
    id: 'constant-folding',
    title: 'Constant folding only',
    category: 'Optimization',
    description: 'Both operands are already literals, so no analysis is needed to evaluate them.',
    source: ['int a = 10 * 20;', 'int b = 100 / 4;', 'int c = 7 - 12;'].join('\n'),
  },
  {
    id: 'constant-propagation',
    title: 'Constant propagation',
    category: 'Optimization',
    description:
      'The value of x is known at compile time, so every later use of x can be replaced by that value.',
    source: ['int x = 5;', 'int y = x + 3;', 'int z = y * x;'].join('\n'),
  },
  {
    id: 'algebraic',
    title: 'Algebraic simplification',
    category: 'Optimization',
    description:
      'n is declared but never assigned, so it is never a known constant -- constant propagation and folding find nothing to do here. Algebraic simplification is what actually rewrites every line below, since each identity holds regardless of what n happens to be.',
    source: [
      'int n;',
      'int p = n * 1;',
      'int q = n + 0;',
      'int r = n * 0;',
      'int s = n / 1;',
    ].join('\n'),
  },
  {
    id: 'dead-code',
    title: 'Dead code elimination',
    category: 'Optimization',
    description:
      'a is assigned from b + c, then immediately overwritten before that value is ever read. Dead code elimination removes both the overwritten assignment and the arithmetic that fed it, in one backward pass -- the second assignment to a is kept, since it is the variable\u2019s final, observable value.',
    source: ['int b = 1;', 'int c = 2;', 'int a;', 'a = b + c;', 'a = 20;'].join('\n'),
  },
  {
    id: 'dce-chain',
    title: 'Dead code: a whole chain removed at once',
    category: 'Optimization',
    description:
      'x is computed through three chained temporaries, then immediately overwritten. Because none of the chain is read afterward, all three temporaries and the now-pointless copy into x disappear together in a single backward pass -- no repeated scanning needed.',
    source: [
      'int a;',
      'int b;',
      'int x;',
      'x = (a + b) * 2 + 1;',
      'x = 99;',
    ].join('\n'),
  },
  {
    id: 'bool-comparisons',
    title: 'Bool and comparisons',
    category: 'Types and Expressions',
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
    category: 'Types and Expressions',
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
    category: 'Control Flow',
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
    category: 'Control Flow',
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
    category: 'Types and Expressions',
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
    category: 'Types and Expressions',
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
    category: 'Functions',
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
    category: 'Functions',
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
    category: 'Diagnostics',
    description:
      'The scanner rejects the stray character, so syntax analysis is skipped rather than reporting cascading nonsense.',
    source: ['int a = 1 @ 2;', 'int b = 3;'].join('\n'),
  },
  {
    id: 'syntax-error',
    title: 'Syntax error',
    category: 'Diagnostics',
    description:
      'The scanner is happy, but the token stream does not match the grammar. Panic mode recovery finds both broken statements.',
    source: ['int a = ;', 'int b = 2;', 'int = 3;'].join('\n'),
  },
  {
    id: 'semantic-error',
    title: 'Semantic error (undeclared variable)',
    category: 'Diagnostics',
    description:
      'Lexical and syntax analysis both succeed, so the tokens and the AST are shown. Semantic analysis then reports that b was never declared.',
    source: 'int a = b + 1;',
  },
  {
    id: 'algebraic-chain',
    title: 'Fold vs. simplify',
    category: 'Optimization',
    description:
      'One example, two different techniques. The first line (a * 1) is resolved by constant propagation and folding, since a is a known constant. The remaining three lines are never known constants, so those are resolved by genuine algebraic simplification instead.',
    source: [
      'int a = 10;',
      'int b = a * 1;',
      'int c = b + 0;',
      'int d = c - 0;',
      'int e = d / 1;',
    ].join('\n'),
  },
  {
    id: 'dce-unused-variable',
    title: 'Why a declared variable is never pruned',
    category: 'Optimization',
    description:
      "unused's computed value is never read anywhere -- and yet it is kept. This is deliberate: MiniC has no print or return statement, so nothing can prove a declared variable's value is truly unobservable. This optimizer's dead code elimination is conservative on purpose: a declared variable's final write always survives, whatever its name suggests, so the visualizer never appears to erase a result the source program actually computed. Only a value that is provably overwritten before use (see the 'Dead code elimination' sample) is ever removed.",
    source: [
      'int a = 10;',
      'int b = 20;',
      'int unused = a + b;',
      'int result = 5;',
    ].join('\n'),
  },
  {
    id: 'float-promotion',
    title: 'Integer to float promotion',
    category: 'Types and Expressions',
    description: 'Demonstrates an integer value used in a floating-point expression and assignment.',
    source: ['int count = 3;', 'float factor = 2.5;', 'float result = count * factor;', 'print(result);'].join('\n'),
  },
  {
    id: 'compound-assignment',
    title: 'Compound assignments',
    category: 'Types and Expressions',
    description: 'Demonstrates +=, -=, *=, /= and integer remainder assignment.',
    source: ['int n = 20;', 'n += 5;', 'n -= 3;', 'n *= 2;', 'n /= 4;', 'n %= 3;', 'print(n);'].join('\n'),
  },
  {
    id: 'increment-decrement',
    title: 'Increment and decrement',
    category: 'Types and Expressions',
    description: 'Demonstrates postfix increment and decrement in a small sequence.',
    source: ['int n = 4;', 'n++;', 'print(n);', 'n--;', 'print(n);'].join('\n'),
  },
  {
    id: 'operator-precedence',
    title: 'Arithmetic precedence',
    category: 'Types and Expressions',
    description: 'Shows multiplication taking precedence over addition, with parentheses controlling grouping.',
    source: ['int a = 2 + 3 * 4;', 'int b = (2 + 3) * 4;', 'print(a);', 'print(b);'].join('\n'),
  },
  {
    id: 'nested-if',
    title: 'Nested if statements',
    category: 'Control Flow',
    description: 'Demonstrates a conditional nested inside another conditional.',
    source: ['int score = 85;', 'if (score >= 50) {', '  if (score >= 80) {', '    print(2);', '  } else {', '    print(1);', '  }', '} else {', '  print(0);', '}'].join('\n'),
  },
  {
    id: 'for-basic',
    title: 'For loop with compound update',
    category: 'Control Flow',
    description: 'Demonstrates a for loop with initialization, condition, and compound update.',
    source: ['int total = 0;', 'for (int i = 1; i <= 4; i++) {', '  total += i;', '}', 'print(total);'].join('\n'),
  },
  {
    id: 'for-optional-parts',
    title: 'For loop with omitted components',
    category: 'Control Flow',
    description: 'Demonstrates a for loop with an omitted initializer and update expression.',
    source: ['int i = 0;', 'for (; i < 3; ) {', '  print(i);', '  i++;', '}'].join('\n'),
  },
  {
    id: 'nested-loops',
    title: 'Nested loops',
    category: 'Control Flow',
    description: 'Counts the iterations of a loop nested inside another loop.',
    source: ['int i = 0;', 'int count = 0;', 'while (i < 2) {', '  int j = 0;', '  while (j < 3) {', '    count++;', '    j++;', '  }', '  i++;', '}', 'print(count);'].join('\n'),
  },
  {
    id: 'break-continue',
    title: 'Break and continue',
    category: 'Control Flow',
    description: 'Demonstrates skipping one iteration with continue and leaving a loop with break.',
    source: ['int i = 0;', 'while (i < 6) {', '  i++;', '  if (i == 2) {', '    continue;', '  }', '  if (i == 5) {', '    break;', '  }', '  print(i);', '}'].join('\n'),
  },
  {
    id: 'switch-fallthrough',
    title: 'Switch fall-through',
    category: 'Control Flow',
    description: 'Demonstrates C-like fall-through when a matching case has no break.',
    source: ['int n = 1;', 'switch (n) {', '  case 1: print(1);', '  case 2: print(2); break;', '  default: print(3);', '}'].join('\n'),
  },
  {
    id: 'switch-no-match',
    title: 'Switch default and no match',
    category: 'Control Flow',
    description: 'Demonstrates selection of default when no case label matches.',
    source: ['int n = 7;', 'switch (n) {', '  case 1: print(10); break;', '  case 2: print(20); break;', '  default: print(99);', '}'].join('\n'),
  },
  {
    id: 'void-function',
    title: 'Void function',
    category: 'Functions',
    description: 'Demonstrates a void function, a parameter, and a standalone function call.',
    source: ['void display(int value) {', '  print(value);', '  return;', '}', 'display(10);', 'display(25);'].join('\n'),
  },
  {
    id: 'void-nested-calls',
    title: 'Nested void function calls',
    category: 'Functions',
    description: 'Demonstrates one void function calling another void function.',
    source: ['void first() {', '  print(1);', '}', 'void second() {', '  first();', '  print(2);', '}', 'second();'].join('\n'),
  },
  {
    id: 'function-control-flow',
    title: 'Function with loop and early return',
    category: 'Functions',
    description: 'Combines a function parameter, a loop, a conditional, and an early return.',
    source: ['int firstPositive(int limit) {', '  int i = 0;', '  while (i < limit) {', '    if (i > 2) {', '      return i;', '    }', '    i++;', '  }', '  return 0;', '}', 'print(firstPositive(6));'].join('\n'),
  },
  {
    id: 'function-switch',
    title: 'Switch inside a function',
    category: 'Functions',
    description: 'Demonstrates a switch statement whose cases return values from a function.',
    source: ['int choose(int n) {', '  switch (n) {', '    case 1: return 10;', '    case 2: return 20;', '    default: return 0;', '  }', '}', 'print(choose(2));'].join('\n'),
  },
  {
    id: 'duplicate-declaration-error',
    title: 'Duplicate declaration',
    category: 'Diagnostics',
    description: 'Demonstrates a semantic error caused by declaring the same variable twice in one scope.',
    source: ['int value = 1;', 'int value = 2;'].join('\n'),
  },
  {
    id: 'type-mismatch-error',
    title: 'Invalid assignment type',
    category: 'Diagnostics',
    description: 'Demonstrates a semantic error from assigning a boolean value to an integer variable.',
    source: ['int value = true;'].join('\n'),
  },
  {
    id: 'function-argument-error',
    title: 'Incorrect function argument count',
    category: 'Diagnostics',
    description: 'Demonstrates a semantic error when a function is called with too few arguments.',
    source: ['int add(int a, int b) {', '  return a + b;', '}', 'print(add(1));'].join('\n'),
  },
  {
    id: 'division-zero-error',
    title: 'Division by zero',
    category: 'Diagnostics',
    description: 'Demonstrates compile-time detection of division by a literal zero.',
    source: ['int value = 10 / 0;', 'print(value);'].join('\n'),
  },
  {
    id: 'duplicate-case-error',
    title: 'Duplicate switch case',
    category: 'Diagnostics',
    description: 'Demonstrates a semantic error caused by repeating a case value.',
    source: ['int n = 1;', 'switch (n) {', '  case 1: print(1); break;', '  case 1: print(2); break;', '}'].join('\n'),
  },
  {
    id: 'combined-control-flow',
    title: 'Combined control flow and expressions',
    category: 'Combined Programs',
    description: 'Combines a function call, loop, logical expression, ternary expression, and output.',
    source: ['int score(int n) {', '  return n * 2;', '}', 'int i = 0;', 'while (i < 3) {', '  int value = score(i);', '  bool show = value >= 2 && !(i == 0);', '  int output = show ? value * 10 : value;', '  print(output);', '  i++;', '}'].join('\n'),
  },
  {
    id: 'combined-loop-switch',
    title: 'Loop with switch and continue',
    category: 'Combined Programs',
    description: 'Combines a loop, switch dispatch, continue, break, and printed output.',
    source: ['int i = 0;', 'while (i < 4) {', '  i++;', '  switch (i) {', '    case 2: continue;', '    case 4: print(40); break;', '    default: print(i); break;', '  }', '}'].join('\n'),
  },
  {
    id: 'combined-optimization-function',
    title: 'Optimization inside a function',
    category: 'Combined Programs',
    description: 'Combines parameters, repeated expressions, algebraic identities, and a return value to inspect function-body optimization traces.',
    source: ['int calculate(int a, int b) {', '  int x = a + b;', '  int y = a + b;', '  int z = y * 1 + 0;', '  return z;', '}', 'print(calculate(10, 20));'].join('\n'),
  },

];

/** The sample loaded when the application starts. */
export const DEFAULT_SAMPLE: Sample = SAMPLES[0]!;
