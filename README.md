# Compiler Optimization Visualizer

An interactive, browser-only visualizer for the classic compiler pipeline, built for a
Compiler Design course project.

```
Source Code
   -> Lexical Analysis  -> Tokens
   -> Syntax Analysis   -> AST
   -> Semantic Analysis -> Symbol Table
   -> Three Address Code
   -> Optimization      -> Optimized TAC
   -> Before / After Visualization
```

The input language is **MiniC v1**, a deliberately small C-like subset. This is not a
C compiler, does not use LLVM, and does not generate machine code.

---

## Build status

| Phase | Stage | Status |
| --- | --- | --- |
| 1 | Project scaffold + Lexical Analysis | **Complete** |
| 2 | Syntax Analysis (parser + AST) | **Complete** |
| 3 | AST visualization (pipeline wired to the UI) | **Complete** |
| 4 | Semantic Analysis + Symbol Table | **Complete** |
| 5 | Three Address Code generation | **Complete** |
| 6 | Optimization: constant propagation + folding | **Complete** |
| 7 | Optimization: algebraic simplification + DCE | **Complete** |
| 8 | Optimization pipeline + before/after comparison | **Complete** |
| 9 | Polished, demo-ready UI | **Complete** |

**Extension Stage 3:** Type-aware optimization passes for both `int` and `float` are complete in the current project version.

`src/App.tsx` shows the source editor, the token table, the AST, the symbol
table, original vs. optimized three address code (with the ordered list of
optimization passes, what each one does, and before/after statistics), and
diagnostics for every compiler error.

---

## Running the project

```bash
npm install
npm run dev        # start the dev server
npm test           # run the test suite (Vitest)
npm run typecheck  # TypeScript strict-mode check
npm run build      # production build
```

Vitest needs no configuration file: its default discovery pattern already finds
`tests/*.test.ts`, and its default `node` environment suits the compiler tests.

---

## Examples

The **Example** dropdown in the header loads a ready-made program into the source
editor. Each one is chosen to demonstrate a specific part of the pipeline in
isolation:

| Example | Demonstrates |
| --- | --- |
| Main demo | All six optimization passes together |
| Constant folding only | Evaluating expressions whose operands are already literals |
| Constant propagation | Substituting a variable's known compile-time value |
| Algebraic simplification | The six approved identities on a genuinely unknown value |
| Dead code elimination | An overwritten assignment and its arithmetic both removed |
| Dead code: a whole chain removed at once | A chain of temporaries collapsing in one backward pass |
| Fold vs. simplify | Why the same-looking `x * 1` can be resolved by either folding or simplification, depending on whether `x` is a known constant |
| Why a declared variable is never pruned | The conservative dead-code-elimination policy, deliberately demonstrated on a variable named `unused` |
| Lexical error / Syntax error / Semantic error | Each error stage in isolation, showing that later stages are correctly skipped |

Every example's source is real MiniC v1 -- there is nothing hardcoded or
simulated in what the UI shows for it.

---

## MiniC v1 language

```c
// single line comments

int a = 10;        // declaration with initializer
int b;             // declaration without initializer
b = 20;            // assignment
int c = a + b;     // arithmetic over variables
int d = (a + b) * 2;
int e = -5;        // unary minus
int f = 100 / 4;   // integer division
```

**Supported:** `int`, `float`, and `bool` declarations and assignments; integer and floating-point literals; `true`/`false`; arithmetic `+ - * /`; comparisons `< > <= >= == !=`; logical `&& || !`; unary minus; parentheses; `if`/`else`; `while`; functions; `return`; `print`; `//` comments; and semicolon-terminated statements.

**Not in the current scope:** arrays, pointers, strings, classes/structs, `for`, `do-while`, `break`, `continue`, or a full C/C++ language implementation.

The language now includes control flow. The TAC generator uses labels and jumps for `if`/`else`, `while`, and short-circuit logical operators. Optimization remains conservative around control-flow boundaries.

---

## Grammar

LL(1), unambiguous, with no left recursion.

```ebnf
program      -> statement* EOF

statement    -> declaration
              | assignment

declaration  -> "int" IDENTIFIER ( "=" expression )? ";"
assignment   -> IDENTIFIER "=" expression ";"

expression   -> term ( ( "+" | "-" ) term )*
term         -> factor ( ( "*" | "/" ) factor )*
factor       -> "-" factor
              | primary
primary      -> NUMBER
              | IDENTIFIER
              | "(" expression ")"
```

Operator precedence is encoded in the grammar layers: `!` binds tighter than `&&`,
`&&` binds tighter than `||`, and arithmetic/comparison layers bind more tightly
than the logical layers. The `( ... )*` repetition is the standard elimination of
left recursion in the arithmetic grammar.

---

## Semantic rules

The current MiniC subset has function-local scopes. Top-level variables are global,
and each function gets a separate local symbol table for parameters and local variables.
Block statements reuse the surrounding function scope.

1. A declaration (`int a;` or `int a = 10;`) adds `a` to the symbol table.
2. Declaring the same name twice is a semantic error. The original symbol is kept.
3. Every identifier used in a declaration's initializer must already be declared.
4. Assigning to an undeclared variable is a semantic error.
5. Every identifier used anywhere must resolve to a declared symbol.

For a declaration with an initializer, the initializer is checked *before* the new
name is entered into the table. That ordering is what makes `int a = a + 1;` an
error: at the moment the initializer is checked, `a` does not exist yet.

---

## Three address code

TAC is generated only once lexical, syntax and semantic analysis have all
succeeded -- there is no honest TAC for a program that does not mean anything, so
a semantic error withholds it exactly the way a syntax error does.

Four instruction kinds cover everything MiniC v1 needs:

```
assign  target = value            a = 10
binary  target = left OP right    t1 = a + b
unary   target = OP operand       t1 = -a
copy    target = source           c = t1
```

Generation is a direct syntax-directed translation of the AST: a literal or a
bare variable needs no computation and is used as an operand immediately; a
binary or unary expression always gets its own instruction and returns a fresh
temporary (`t1`, `t2`, ... -- numbered from a plain counter, never random,
never reused from AST node ids). Because precedence is already baked into the
AST's shape by the parser, the generator does not need to know anything about
precedence itself -- it simply visits the left child before the right child:

```c
int c = a + b * 2;      int x = (a + b) * 2;

t1 = b * 2               t1 = a + b
t2 = a + t1               t2 = t1 * 2
c = t2                    x = t2
```

No optimization happens at this stage, even when a simplification looks
trivial: `int d = c * 1;` still produces `t1 = c * 1` / `d = t1`, and
`int c = 10 + 20;` still produces `t1 = 10 + 20` / `c = t1`. TAC generation's
only job is to translate the tree mechanically -- this stage exists to give
the optimizer something real to work on.

---

## Optimization

```
TAC -> Constant Propagation -> Constant Folding -> Algebraic Simplification -> Dead Code Elimination -> Optimized TAC
```

Each pass runs **exactly once**, in this fixed order, with no fixpoint iteration.

**Constant propagation** tracks `name -> known constant value` in a single
forward scan (straight-line code has no merge points, so one pass is exact)
and substitutes a known value wherever a variable or temporary is read. It
never evaluates an operation -- `t1 = a + b` with `a` and `b` both known
becomes `t1 = 10 + 20`, not `t1 = 30`.

**Constant folding** evaluates a `binary` or `unary` instruction into an
`assign` exactly when every operand it needs is already a literal constant --
often because propagation just substituted one in. Division by zero is
detected and left completely unevaluated, never producing `Infinity`, `NaN`
or a fabricated `0`.

**Algebraic simplification** rewrites exactly six identities that hold for
*any* value of the non-constant operand, needing only ONE operand to be a
specific constant rather than both: `x + 0 -> x`, `x - 0 -> x`, `x * 1 -> x`,
`x / 1 -> x`, `x * 0 -> 0`, `0 * x -> 0`. It runs after folding so that a
fully-constant expression is evaluated to a number first, rather than
matching an identity meant for the genuinely non-constant case. Unsafe-looking
identities are deliberately absent -- `0 / x -> 0` and `x / x -> 1` are both
wrong when `x` is zero, so neither is implemented.

**Dead code elimination** removes an instruction when its value is never
subsequently needed, using one backward pass over the straight-line TAC (no
CFG, no basic blocks -- MiniC v1 has no branches, so one pass is exact). A
declared variable's FINAL write is always treated as observable, even with no
later TAC read, since MiniC has no `print`/`return` to make anything else
observable; an EARLIER write that is overwritten before use is genuinely dead
and is removed. Temporary names are identified from `TACProgram.temporaryCount`
(exactly `t1..t<count>`), never guessed from spelling, and DCE consults no
symbol-table information at all.

**Type-aware optimization:** `int` and `float` values carry their numeric type through TAC and the optimization passes. Constant propagation preserves the type of propagated values and applies the destination type for `int -> float` assignments. Constant folding uses floating-point division for `float` expressions while retaining integer division for `int` expressions. Algebraic simplification preserves the target type when replacing an operation with a value, and dead code elimination keeps the original typed instructions intact. Division-by-zero protection remains active for both numeric types.

All six passes are pure functions over the structured `TACProgram` type --
never strings -- and none of them mutates its input: `optimize(tac) !== tac`,
and the original `tac` remains valid and displayable as the "before" half of
a before/after comparison.

```c
int a = 10;                  int a = 10;
int b = 20;                  int b = 20;
int c = a + b;      -->      int c = 30;      (folded)
int d = c * 1;                int d = c;       (simplified: c is not constant, but c*1=c regardless)
int e = c + 0;                int e = c;       (simplified likewise)
```

Nothing is removed by DCE in this example: `d`'s and `e`'s temporaries are each
read by the very next instruction, and every variable is written exactly
once, so each write is protected as that variable's final value. DCE's
opportunity in this project mainly shows up when a variable is reassigned
before its earlier value is read -- see the `dead-code` and `dce-chain`
samples, where an entire chain of temporaries collapses in one pass once the
value they fed into is overwritten.

One structural consequence worth knowing: the optimizer is deliberately
conservative around control-flow boundaries. Straight-line programs can use
constant propagation, folding and algebraic simplification normally; programs
containing `if`/`while` or short-circuit logical operators use the control-flow-safe
subset of the optimizer so values are not incorrectly propagated across branches
or loop back-edges.

### Before/after comparison

`compareTAC(original, optimized)` (`src/compiler/optimizer/comparison.ts`) is a
pure, read-only function that reports what optimization actually changed:
original and optimized instruction counts, how many instructions were
removed, and a `changed` flag. `changed` is a structural comparison of the
instructions themselves, not just a length check -- the main demo has the
SAME instruction count before and after (nothing is removed), but `changed`
is still `true`, because `c * 1` really did become `c`. `compile()` computes
this once and exposes it as `result.comparison`, `null` under exactly the
conditions `result.optimizedTac` is `null`.

The UI's `OptimizationPanel` renders this alongside `OPTIMIZATION_PASSES`
(the compiler's own ordered list of the six passes, each with a short
description of what it does, so the UI never invents or hardcodes that
information separately) and a plain "No optimizations changed the TAC."
message when `changed` is `false` -- never a false claim that something was
optimized.

---

## Architecture

The compiler is a **pure TypeScript library with no React dependency**. Every stage is
a pure function, so each one can be tested on its own and the whole pipeline is
deterministic. The UI only renders the record the pipeline produces.

```
src/compiler/   the compiler       (no React imports, ever)
src/components/ the user interface (no compiler logic, ever)
tests/          one test file per stage
```

---

## Project layout

```
src/
  compiler/
    lexer/
      tokens.ts        token types, keyword table
      lexer.ts         the scanner
    parser/
      ast.ts           AST node types
      parser.ts        recursive descent parser
    pipeline.ts        runs the phases in order
    semantic/
      symbolTable.ts   single flat symbol table
      analyzer.ts      walks the AST, builds the table, checks the rules
    ir/
      tac.ts           TAC instruction and operand types
      tacGenerator.ts  syntax-directed translation from AST to TAC
      tacPrinter.ts    TAC -> display text only (no generation logic)
    optimizer/
      evaluate.ts      pure arithmetic evaluation, shared by the passes
      optimizer.ts     orchestrates all six passes, once each
      comparison.ts    before/after TAC comparison
      passes/
        constantPropagation.ts    substitutes known constants, never evaluates
        constantFolding.ts        evaluates fully-constant operations only
        algebraicSimplification.ts  the six approved identities only
        deadCodeElimination.ts    backward liveness, no CFG needed
    errors.ts          shared error record for all stages
    index.ts           public API of the compiler
  components/
    AstView.tsx        renders the syntax tree
    SymbolTableView.tsx renders the declared variables
    TacView.tsx        renders TAC (reused for both original and optimized)
    OptimizationPanel.tsx  pass list + before/after stats
    ErrorPanel.tsx     lexical, syntax and semantic errors, grouped
    astTree.ts         tree layout (pure TypeScript, no React)
  examples/samples.ts  demo programs
  App.tsx  main.tsx  index.css
tests/
  lexer.test.ts
  parser.test.ts
  pipeline.test.ts
  semantic.test.ts
  tac.test.ts
  optimizer.test.ts
```

---

## Dependencies

`react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `tailwindcss`,
`@tailwindcss/vite`, `vitest`. Nothing else. The compiler itself uses no libraries at
all.


### Stage 4
MiniC supports `bool`, `true`/`false`, and `<`, `>`, `<=`, `>=`, `==`, `!=`. Numeric comparisons produce boolean results.


## Stage 5: print()
MiniC supports `print(expression);` for `int`, `float`, and `bool` values. The compiler emits a print TAC instruction, preserves it during optimization, and the visualizer executes the optimized TAC to display the resulting Program Output.

## Stage 6: basic if/else control flow
MiniC now supports basic conditional statements:

```c
if (condition) {
  statement;
}

if (condition) {
  statement;
} else {
  statement;
}
```

The condition must have type `bool`. TAC represents control flow with labels,
conditional jumps (`ifFalse ... goto`) and unconditional jumps (`goto ...`). The
interpreter follows those jumps and executes only the selected branch, so
`print()` inside an `if` produces the actual selected value in Program Output.

The existing straight-line optimization passes are intentionally not applied
across branch boundaries yet: doing so would require control-flow-aware dataflow
analysis. Branch programs therefore retain structurally safe TAC until a later
control-flow optimization stage is introduced. The existing optimizations remain
unchanged for ordinary straight-line programs.


## Stage 7: Return Statements

The MiniC language now supports `return expression;`. Return values may be `int`, `float`, or `bool`, are shown separately from `print()` output, and execution stops when the first reached return executes. Returns also work inside `if/else` branches. Functions and parameters remain outside this stage.


## Stage 8: Basic Functions

MiniC now supports typed user-defined functions with parameters, local variables, function calls, and return values. Function calls are represented in TAC and executed by the interpreter with a separate call frame. Recursive/advanced interprocedural optimization is intentionally out of scope.


## Stage 8 presentation enhancement

The visualizer now exposes the function-level intermediate representations and semantic symbols already produced by the Stage 8 compiler. The TAC section shows the main program TAC plus each function body separately. The symbol-table section keeps the original global symbol list backward-compatible and adds a local-symbol table for each function, including its parameters and local variables. CSE is also applied independently inside each function body. Function calls and control-flow boundaries remain conservative CSE barriers.

## Stage 9 — Common Subexpression Elimination

The optimizer now includes conservative local Common Subexpression Elimination (CSE). Repeated binary arithmetic expressions such as `a + b` are computed once and later uses reuse the earlier result when the operands have not changed. Expression identity is structural and operand order is significant, so `a + b` and `b + a` are not merged. Calls and control-flow boundaries clear the CSE cache. Function bodies are optimized independently with the same local CSE pass.

The optimization order is now: Constant Propagation → Constant Folding → Algebraic Simplification → Common Subexpression Elimination → Dead Code Elimination.

Stage 9 does not implement global CFG CSE, SSA, loop-aware CSE, alias analysis, or interprocedural CSE.


## Stage 12: While Loops

Stage 12 adds basic `while (condition) { ... }` loop support. The loop condition must be a `bool` expression. Three-address code uses a condition label, a conditional exit jump, a backward jump to repeat the loop, and an exit label. Nested loops, `if/else`, `print`, `return`, and function calls are supported inside loop bodies. Optimization remains conservative around control-flow boundaries.

## Stage 13: Logical Operators

Stage 13 adds the boolean logical operators `&&`, `||`, and `!`. The parser gives `!` the highest logical precedence, followed by `&&`, then `||`, so `a || b && c` is parsed as `a || (b && c)`. Semantic analysis requires boolean operands for logical operators.

`&&` and `||` are translated using labels and conditional jumps rather than ordinary eager binary TAC. This preserves short-circuit semantics: the right-hand side of `false && rhs` is not evaluated, and the right-hand side of `true || rhs` is not evaluated. Unary `!` is represented directly as a typed TAC unary operation and can be constant-folded when its operand is known.

Stage 13 does not add another optimization pass. Existing optimization passes remain conservative around the control-flow generated for short-circuit expressions.


## Stage 14 — Ternary Operator

MiniC supports the conditional expression `condition ? thenExpression : elseExpression`. The condition must be `bool`; the two branches must have compatible types under the existing numeric promotion rules. Ternary expressions are lowered to TAC labels and conditional/unconditional jumps so only the selected branch executes at runtime. Nested ternaries are supported.
