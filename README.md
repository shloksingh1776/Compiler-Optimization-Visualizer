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

The source editor includes MiniC syntax highlighting, line numbers, Tab/Shift+Tab indentation, indentation continuation on Enter, and matching-bracket highlighting. It is implemented locally without adding an editor dependency; compiler tokenization and semantics remain in `src/compiler/`.

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
| Why a variable's final write is preserved | The conservative dead-code-elimination policy, deliberately demonstrated on a variable named `unused` |
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

**Supported:** `int`, `float`, `bool`, and `void` function return types; integer and floating-point literals; `true`/`false`; arithmetic `+ - * / %`; comparisons `< > <= >= == !=`; logical `&& || !`; unary minus; parentheses; `if`/`else`; `while` and `for` loops; loop-local `break` and `continue`; `switch`/`case`/`default`; value-returning and void functions with parameters; `return expression;` and `return;` in void functions; standalone function calls; `print`; `//` comments; compound assignments; increment/decrement; ternary expressions; and semicolon-terminated statements.

**Not in the current scope:** arrays, pointers, strings, classes/structs, `do-while`, and a full C/C++ language implementation.

The language includes control flow and void functions. The TAC generator uses labels and jumps for `if`/`else`, loops, switch dispatch, ternary expressions, and short-circuit logical operators. Void calls execute for their side effects without producing a usable expression value. Optimization remains conservative around control-flow boundaries.

---

## Grammar overview

The grammar below documents the core declaration, assignment, and arithmetic-expression subset. It is not a complete grammar specification for every implemented feature; the recursive-descent parser also supports functions, calls, types, control flow, loops, switch/case, ternary expressions, logical operators, and return statements.

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

MiniC has one global scope for top-level variables and a separate local scope for each function's parameters and local variables. A function resolves a name in this order: its parameters and locals first, then the global scope. Therefore, a local or parameter may shadow a global of the same name. A global read or write from a function refers to the shared global variable, and writes persist after the function returns. Block statements reuse the surrounding function scope; nested blocks do not create separate scopes.

1. A declaration (`int a;` or `int a = 10;`) adds `a` to its current scope.
2. Redeclaring a name in the same scope is a semantic error. A function-local declaration may shadow a global.
3. Initializers are checked before the new declaration enters its scope. If a local has the same name as a global, `int a = a + 1;` reads the visible global in its initializer, then declares the local `a`.
4. Assigning to an undeclared variable is a semantic error.
5. Every identifier used in an expression must resolve to a local/parameter or a global symbol.
6. Function calls can mutate globals, so their side effects are retained by conservative optimization and shared by subsequent calls.

An uninitialized local shadows a same-named global but does not inherit its value. Reading that local before assigning it remains a runtime error.

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
TAC -> Constant Propagation -> Constant Folding -> Algebraic Simplification -> CSE -> Copy Propagation -> Dead Code Elimination -> Optimized TAC
```

Each pass runs **exactly once**, in this fixed order, with no fixpoint iteration.

**Constant propagation** tracks `name -> known constant value` within each
basic block and substitutes a known value wherever a variable or temporary
is read. It resets facts at labels and unconditional jumps, and after calls;
labels therefore do not inherit constants from another branch or loop
iteration. At a conditional branch, the facts remain available only along the
linear fallthrough path; its target label resets them. The pass never evaluates
an operation -- `t1 = a + b` with `a` and `b` both known becomes `t1 = 10 + 20`,
not `t1 = 30`.

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

**Dead code elimination** uses backwards liveness. For control-flow TAC it
builds basic blocks, connects jump/branch/return successors, and iterates
liveness to a fixpoint before removing dead computations. Calls, prints,
returns, parameter bindings, and control-flow instructions are preserved. In
the main program, a declared variable's final write remains observable for
compatibility with the visualizer's variable-state model. Function-local final
assignments are not protected solely because they are last: they may be
removed when no return, print, call, or later computation needs them.
Temporary names are identified from `TACProgram.temporaryCount` (exactly
`t1..t<count>`), never guessed from spelling.

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
      symbolTable.ts   one flat table per global/function scope
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
        deadCodeElimination.ts    basic-block liveness with control-flow edges
    errors.ts          shared error record for all stages
    index.ts           public API of the compiler
  components/
    AstView.tsx        renders the syntax tree
    SymbolTableView.tsx renders global and per-function symbols
    TacView.tsx        renders original and optimized TAC
    OptimizationPanel.tsx  pass list + before/after stats
    OptimizationTraceView.tsx pass-by-pass TAC snapshots
    TokenInspector.tsx interactive tokens with category filters
    ErrorPanel.tsx     categorized diagnostics with source navigation
    CompilerPipeline.tsx selectable compiler-phase pipeline
    CodeEditor.tsx     syntax-highlighted editable source
    pipelineUtils.ts   derives pipeline states from compiler results
    diagnosticUtils.ts source-range validation and navigation helpers
    tokenInspectorUtils.ts token categories, filtering, and selection
    astTree.ts         tree layout (pure TypeScript, no React)
  examples/samples.ts  demo programs
  App.tsx  main.tsx  index.css
tests/
  lexer.test.ts, parser.test.ts, semantic.test.ts, tac.test.ts
  optimizer.test.ts, pipeline.test.ts
  stage23-code-editor.test.ts
  stage24-optimization-coverage.test.ts
  stage25-token-inspector.test.ts
  stage26-source-linked-diagnostics.test.ts
  stage27-interactive-pipeline.test.ts
  stage27-maintenance-corrections.test.ts
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

Optimization passes now run on control-flow programs using conservative
basic-block boundaries and control-flow-aware liveness. Constant propagation
never carries facts into a branch target or through a call; CSE and copy
propagation clear their caches at control-flow boundaries. DCE computes liveness
across branch and jump successors rather than assuming straight-line execution.
See Stage 24 below for the full coverage changes.


Historical note: the original compiler/language milestone numbers in the implementation history below are separate from the later UI-enhancement roadmap. The current enhancement sequence reached Stage 8 with Workspace and UI Polish; Stage 9 is the Optimization Diff View.

## Stage 7: Return Statements

The MiniC language now supports `return expression;`. Return values may be `int`, `float`, or `bool`, are shown separately from `print()` output, and execution stops when the first reached return executes. Returns also work inside `if/else` branches. Functions and parameters remain outside this stage.


## Stage 8: Basic Functions

MiniC now supports typed user-defined functions with parameters, local variables, function calls, and return values. Function calls are represented in TAC and executed by the interpreter with a separate call frame. Recursive/advanced interprocedural optimization is intentionally out of scope.


## Stage 8 presentation enhancement

The visualizer now exposes the function-level intermediate representations and semantic symbols already produced by the Stage 8 compiler. The TAC section shows the main program TAC plus each function body separately. The symbol-table section keeps the original global symbol list backward-compatible and adds a local-symbol table for each function, including its parameters and local variables. Each optimization pass is applied independently to every function body as well as the main program. Function calls and control-flow boundaries remain conservative CSE barriers.

## Stage 9 — Common Subexpression Elimination

The optimizer now includes conservative local Common Subexpression Elimination (CSE). Repeated binary arithmetic expressions such as `a + b` are computed once and later uses reuse the earlier result when the operands have not changed. Expression identity is structural and operand order is significant, so `a + b` and `b + a` are not merged. Calls and control-flow boundaries clear the CSE cache. Function bodies are optimized independently with the same local CSE pass.

The full optimization order is: Constant Propagation → Constant Folding → Algebraic Simplification → Common Subexpression Elimination → Copy Propagation → Dead Code Elimination.

Stage 9 does not implement global CFG CSE, SSA, loop-aware CSE, alias analysis, or interprocedural CSE. The later Stage 24 work adds CFG-aware liveness for DCE but does not introduce global/interprocedural CSE.


## Stage 12: While Loops

Stage 12 adds basic `while (condition) { ... }` loop support. The loop condition must be a `bool` expression. Three-address code uses a condition label, a conditional exit jump, a backward jump to repeat the loop, and an exit label. Nested loops, `if/else`, `print`, `return`, and function calls are supported inside loop bodies. Optimization uses conservative control-flow barriers for local propagation and CFG-aware liveness for DCE.

## Stage 13: Logical Operators

Stage 13 adds the boolean logical operators `&&`, `||`, and `!`. The parser gives `!` the highest logical precedence, followed by `&&`, then `||`, so `a || b && c` is parsed as `a || (b && c)`. Semantic analysis requires boolean operands for logical operators.

`&&` and `||` are translated using labels and conditional jumps rather than ordinary eager binary TAC. This preserves short-circuit semantics: the right-hand side of `false && rhs` is not evaluated, and the right-hand side of `true || rhs` is not evaluated. Unary `!` is represented directly as a typed TAC unary operation and can be constant-folded when its operand is known.

Stage 13 does not add another optimization pass. Constant propagation and local expression/copy caches respect the control-flow generated for short-circuit expressions; DCE accounts for the generated branch edges.


## Stage 14 — Ternary Operator

MiniC supports the conditional expression `condition ? thenExpression : elseExpression`. The condition must be `bool`; the two branches must have compatible types under the existing numeric promotion rules. Ternary expressions are lowered to TAC labels and conditional/unconditional jumps so only the selected branch executes at runtime. Nested ternaries are supported.


## Stage 16 — Compound assignment

The MiniC subset supports `+=`, `-=`, `*=`, `/=` and `%=` as standalone assignment statements. Compound assignments are translated to ordinary arithmetic TAC followed by a copy, so the existing optimizer and interpreter pipeline remains in use. `%` and `%=` require integer operands; the other compound arithmetic operators accept numeric operands and reject `bool`.


## Stage 17: `for` loops

The MiniC subset supports C-style `for (initialization; condition; update) { ... }` loops, including omitted initialization, condition, or update clauses. The loop is lowered to labels and jumps in TAC and works with existing arithmetic, compound assignment, postfix increment/decrement, functions, conditionals, and optimization.

## Stage 21 — Pass-by-Pass Optimization Visualization

The optimization section lets users select the original TAC, each optimization pass, and the final optimized TAC. Every snapshot is generated by the actual optimizer pipeline; the visualization does not synthesize illustrative TAC. The main program and function bodies remain visible in each snapshot. Stage 24 extends all six passes to function bodies and control-flow TAC where safe, and the trace records which passes actually ran.


## Stage 24 — Complete Optimization Coverage

Stage 24 applies all six existing optimization techniques to the main program and to each function body independently: Constant Propagation, Constant Folding, Algebraic Simplification, Common Subexpression Elimination, Copy Propagation, and Dead Code Elimination.

Constant propagation keeps facts local to safe control-flow regions, resetting at labels, unconditional jumps, and calls. Its facts remain available along a conditional branch's fallthrough path, while the target label starts with a clean environment. Constant folding and algebraic simplification run instruction-by-instruction, as each rewrite is safe when its operands meet the pass's requirements. CSE and Copy Propagation retain their existing call and control-flow barriers. Copy Propagation now also tracks same-type variable-to-variable assignments (such as `a = n`, `b = a`, `c = b`) inside each body. It uses parameter and assignment target type metadata to avoid treating type-changing assignments as aliases; DCE removes alias assignments that become unused afterward.

DCE now builds basic blocks and performs liveness analysis across jump, branch, and return edges. It removes unused temporary computations in functions and can remove unused local-variable assignments. Calls, prints, returns, parameter bindings, and control-flow instructions are retained. The main program's final variable writes remain preserved for compatibility with the visualizer's existing state model.

The pass-by-pass trace now shows the actual main TAC and function-body TAC after every pass, and no pass is marked skipped merely because the main program contains a branch or loop. This stage does not add new MiniC language features, global/interprocedural CSE, SSA, register allocation, or a step-by-step execution debugger.

## Enhancement roadmap progress

The current enhancement roadmap is tracked separately from the original compiler phases above:

| Roadmap stage | Enhancement | Status |
| --- | --- | --- |
| 1 | Pass-by-pass optimization visualization | Complete |
| 2 | Example Program Selector | Complete |
| 3 | Professional Source Code Editor | Complete |
| 4 | Complete Optimization Coverage | Complete |
| 5 | Interactive Token Inspector | Complete after local verification |
| 6 | Source-Linked Diagnostics | Complete after local verification |
| 7 | Interactive Compiler Pipeline | Complete after local verification |
| 8 | Workspace and UI Polish | Implemented in Stage 28; verify locally |
| 9 | Optimization Diff View | Implemented in Stage 29; verify locally |

The Interactive Token Inspector displays the actual lexer stream, with search and category-based filters. Related tokens are grouped as arithmetic, relational, logical, and assignment operators, keywords, identifiers, constants, punctuation/delimiters, and end of input; the table still shows each exact lexer token type. Selecting a token's lexeme navigates to its source location and highlights the exact lexer-provided offset range in the editor. The EOF token is shown explicitly; because its true lexeme is empty, selecting it moves the editor caret to the end of input instead of highlighting invented characters. No compiler semantics or tokenization rules are changed.

## Stage 26 — Source-Linked Diagnostics

The Errors / Diagnostics panel groups messages by lexical analysis, syntax analysis, semantic analysis, compile-time optimization checks, and runtime execution. Compiler diagnostics display their phase, severity, reported line and column, and original message. When their source offsets are valid for the current source text, **Go to source** scrolls the page back to the editor, scrolls within the editor to the reported source line, selects that exact compiler-reported range, and marks it with a red diagnostic highlight that is visually distinct from the Token Inspector's blue selection. Repeated clicks on the same diagnostic navigate again.

Editing source or loading a different example clears the old diagnostic selection. A zero-length compiler span (such as an error at end of input) moves the caret to the reported position without highlighting invented characters. Runtime messages are separated from compile-time diagnostics; the current interpreter only supplies a message string for runtime errors, so the UI explicitly does not invent a source location or navigation link for them.

Stage 26 adds a focused test file at `tests/stage26-source-linked-diagnostics.test.ts`. Run `npm run typecheck`, `npm test`, and `npm run build` to verify the change with the project's full toolchain.

## Stage 27 — Interactive Compiler Pipeline

The interactive pipeline shows Source, Lexer, Parser, Semantic Analysis, TAC Generation, Optimization, and Output as connected selectable phases. Each phase's state and summary are derived from the existing `compile(source)` result. Selecting a phase scrolls to its corresponding result already shown in the workspace; it does not rerun compilation or fabricate an intermediate result. Failed phases and stages skipped after an earlier failure are distinguished from successful completion.

## Stage 27.1 — Pre-polish maintenance corrections

Before the final workspace/UI polish, a maintenance revision aligns the implementation and documentation around three behaviors:

- Compile-time division-by-zero checking runs a conservative constant-propagation/folding precheck over the main TAC and each function body. It reports divisors proved to be zero while retaining control-flow barriers to avoid carrying facts across branches or loops.
- The interactive pipeline distinguishes Output that executed from Output that was not needed, and navigates to the Return Value view when a program returns a value without printing output.
- Top-level variables are accessible from function bodies. Function-local variables and parameters take precedence over globals with the same name, global writes persist across calls, and optimizer passes preserve that scope information in TAC. DCE conservatively retains global writes inside function bodies and treats globals as implicit live-ins at calls in the main program, while still removing overwritten global assignments that no read or call can observe.

The maintenance stage does not introduce block-level scope, arrays, pointers, or other new language features. Automated regression coverage for these corrections lives in `tests/stage27-maintenance-corrections.test.ts`.



## Stage 28 — Workspace and UI Polish

The application now presents the source editor and analysis workspace in a resizable two-pane layout on wider screens, with a responsive stacked layout on smaller screens. The separator supports pointer dragging and keyboard controls (`Left`/`Right`, `Home`, `End`) and clamps the editor ratio to keep both panels usable.

The workspace groups Tokens, AST, Symbols, Original TAC, Optimization Trace and Statistics, Output/Return Value, and Diagnostics into keyboard-navigable tabs. Tabs preserve their mounted view state; selecting a compiler pipeline phase activates the corresponding result tab before scrolling to its real result. Failed or skipped phases route to Diagnostics. Switching tabs does not rerun compilation; `compile(source)` remains memoized by source text.

A dark theme remains the default and an optional light theme is available from the header. The preference is stored in local storage when available, and the source editor receives a matching high-contrast light styling while preserving the separate token (blue) and diagnostic (red) highlights. Layout, panel headings, tabs, borders, status chips, and responsive spacing were standardized without adding dependencies or changing compiler semantics.

Tests for the workspace helpers are in `tests/stage28-workspace-ui.test.ts`. Run `npm run typecheck`, `npm test`, and `npm run build` for full verification.


## Stage 9: Optimization Diff View

The Optimization workspace can compare the saved TAC snapshot before and after the currently selected optimization step. The diff uses the optimizer's existing snapshots (it does not rerun optimization), aligns unchanged instructions in order, pairs rewrites, and marks removed and added instructions. Main-program instructions and each function body are displayed separately. The diff recognizes semantic differences in instruction scope metadata even when the formatted TAC line is identical, while ignoring `sourceNodeId` provenance.

The view is opened from the Optimization tab using **Diff from previous step**. The original snapshot has no prior step to compare. The final snapshot is compared with the result after Dead Code Elimination and constant materialization.

Tests for Stage 9 are in `tests/stage29-optimization-diff.test.ts`. Run `npm run typecheck`, `npm test`, and `npm run build` for full verification.
