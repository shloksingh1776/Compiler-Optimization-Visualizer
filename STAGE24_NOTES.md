# Stage 24 — Complete Optimization Coverage


## Objective

Apply the six existing optimizations to the main TAC and independently to each function body, including when TAC contains branches, loops, returns, or function calls. Preserve MiniC semantics, retain the fixed pass order, and show the genuine TAC produced after each pass.

## Implementation

### 1. Constant Propagation

- Runs on main TAC and on every function body.
- Propagates constants within a straight-line region.
- Clears facts at labels, unconditional jumps, calls, and function boundaries.
- Preserves facts on the conditional branch's fallthrough path; its target label clears facts before the alternate path is processed.
- Does not attempt global merge-point analysis, so it remains conservative at branch joins and loop boundaries.

### 2. Constant Folding and Algebraic Simplification

- Run instruction-by-instruction on the main program and every function body.
- Keep the existing supported operators, type handling, division-by-zero behavior, and approved algebraic identities.
- Do not invent new language features or rewrite the source language.

### 3. Common Subexpression Elimination and Copy Propagation

- Continue to process the main program and every function body independently.
- Preserve existing invalidation behavior at calls and control-flow boundaries.
- Do not reuse facts across a label/branch edge or across function bodies.

### 4. Dead Code Elimination

- Runs on the main program and every function body.
- Builds basic blocks from labels and control-flow terminators.
- Builds jump/branch successor edges and solves liveness to a fixpoint.
- Keeps calls, prints, returns, parameters, labels, jumps, and conditional jumps.
- Removes dead temporary computations in functions and permits unused function-local assignments to be removed.
- Continues to preserve the main program's final writes to non-temporary variables for compatibility with the visualizer's prior state model.
- Does not attempt interprocedural analysis or unreachable-code removal.

### 5. Pass-by-pass trace

The optimization trace now reflects the real result after each pass for both main TAC and function bodies. A program containing a loop or branch no longer causes Constant Propagation, Constant Folding, Algebraic Simplification, or DCE to be marked as globally skipped. Each pass's note describes the boundaries or safeguards it actually uses.

### 6. Print/return constant materialization

The final materialization step now processes function bodies that contain `print`, in addition to main TAC. It resets its tracking at control-flow boundaries and includes return operands when checking whether temporary assignments remain used.

## Files changed

- `src/compiler/optimizer/optimizer.ts` — run pass-by-pass over main and function instructions; replace broad control-flow skip branch; show actual trace snapshots; safely materialize constants in function bodies that print.
- `src/compiler/optimizer/passes/constantPropagation.ts` — reset facts at safe control-flow/call boundaries.
- `src/compiler/optimizer/passes/deadCodeElimination.ts` — add per-body DCE with basic-block construction and CFG liveness.
- `tests/stage21-optimization-trace.test.ts` — update trace expectations so passes are applied to control-flow TAC.
- `tests/stage24-optimization-coverage.test.ts` — add coverage for function optimization, branch-boundary propagation, function-body DCE, control-flow liveness, and execution behavior.
- `README.md` — refresh optimizer behavior and document this stage.
- `STAGE24_NOTES.md` — this implementation and verification report.

No parser, semantic-analysis, language-feature, TAC-generator, interpreter, or UI/editor architecture changes were made. No dependencies were added.
