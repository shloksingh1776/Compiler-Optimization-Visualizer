/**
 * COMPILATION PIPELINE
 * ====================
 *
 * COMPILER CONCEPT: a compiler is a sequence of phases, each consuming the
 * output of the previous one. This module runs that sequence and collects
 * every intermediate representation into a single record.
 *
 *      source --> [ LEXER ] --> tokens --> [ PARSER ] --> AST
 *                                                          |
 *                                      [ SEMANTIC ANALYSER ]
 *                                                          |
 *                                                    symbol table
 *                                                          |
 *                                       [ TAC GENERATOR ]
 *                                                          |
 *                                                  three address code
 *                                                          |
 *                             [ DIVISION-BY-ZERO CHECK ] (provably-zero divisors only)
 *                                                          |
 *                                          [ OPTIMIZER ]
 *                (constant propagation, folding, algebraic simplification,
 *                             dead code elimination)
 *                                                          |
 *                                                 optimized three address code
 *                                                          |
 *                                          [ COMPARISON ]
 *                                                          |
 *                                              before/after summary
 *
 * WHY THIS FILE EXISTS: the user interface must not know the order of the
 * phases, nor how to feed one into the next. It calls `compile(source)` once
 * and renders whatever comes back. That keeps every line of compiler logic
 * inside `src/compiler/`, with no React anywhere near it, which is what makes
 * the compiler independently testable.
 *
 * FAILURE MODEL: each phase collects all of its own errors, but a phase only
 * runs if the previous one succeeded. Parsing a token stream the scanner
 * already rejected, analysing a tree that does not exist, generating TAC from
 * a program with undeclared variables, or optimizing TAC that was never
 * generated would all bury the real problem under nonsense output. A phase
 * that never ran is reported as `skipped`, which is different from `error`
 * and is shown differently.
 *
 * ONE STATUS VOCABULARY FOR EVERY STAGE: neither TAC generation nor
 * optimization can fail on their own -- TAC generation is a total, mechanical
 * translation of an already-validated AST, and the optimizer is a total,
 * mechanical rewrite of already-generated TAC. Neither has a rule in it that
 * can reject anything. So rather than invent a second status system (e.g.
 * "not-run" / "success") for these two stages, both reuse the same
 * `StageStatus` the earlier stages already use. In practice TAC generation's
 * value is only ever `'ok'` (ran) or `'skipped'` (an earlier phase failed) --
 * `'error'` is never produced for it.
 *
 * The optimization stage has exactly ONE exception to "cannot reject
 * anything": a division whose divisor constant propagation can prove is
 * zero (see `divisionByZeroCheck.ts`) is a genuinely invalid program, the
 * same way an undeclared variable is. When that happens, `optimization`
 * reports `'error'`, `optimizedTac` and `comparison` are withheld exactly
 * as they would be for a semantic error, and the original `tac` is still
 * shown -- TAC generation itself did not fail, only the mechanical rewrite
 * of it into a runnable-looking form did.
 */

import { tokenize } from './lexer/lexer.ts';
import type { Token } from './lexer/tokens.ts';
import { parse } from './parser/parser.ts';
import type { Program } from './parser/ast.ts';
import { analyze } from './semantic/analyzer.ts';
import type { Symbol } from './semantic/symbolTable.ts';
import { generateTAC } from './ir/tacGenerator.ts';
import type { TACProgram } from './ir/tac.ts';
import { optimizeWithTrace } from './optimizer/optimizer.ts';
import type { OptimizationTrace } from './optimizer/trace.ts';
import { constantPropagation } from './optimizer/passes/constantPropagation.ts';
import { checkDivisionByZero } from './optimizer/divisionByZeroCheck.ts';
import { compareTAC, type TACComparison } from './optimizer/comparison.ts';
import type { CompilerError } from './errors.ts';
import { executeTAC } from './interpreter.ts';

/** The phases implemented so far. */
export type PipelineStage = 'lexical' | 'syntax' | 'semantic' | 'tac' | 'optimization';

/**
 * `ok`      - the phase ran and found no errors.
 * `error`   - the phase ran and reported at least one error.
 * `skipped` - the phase never ran, because an earlier phase failed.
 */
export type StageStatus = 'ok' | 'error' | 'skipped';

/**
 * Everything produced by one compilation.
 *
 * Errors are kept split by phase as well as combined, so the UI can label a
 * lexical error differently from a syntax or semantic error without having to
 * inspect each record.
 */
export interface CompilationResult {
  readonly source: string;
  /** Always present: the scanner runs first and always produces something. */
  readonly tokens: Token[];
  /** The syntax tree, or null if lexical or syntax analysis failed. */
  readonly ast: Program | null;
  /**
   * Declared variables, in declaration order. Empty when semantic analysis
   * was skipped, and possibly partial when it reported errors.
   */
  readonly symbols: Symbol[];
  /** Local symbols grouped by function name; global `symbols` remains backward-compatible. */
  readonly functionSymbols: Readonly<Record<string, Symbol[]>>;
  /**
   * The generated three address code, or null if lexical, syntax or semantic
   * analysis failed. Never a partial or misleading program: TAC is only ever
   * generated from source that has already passed every earlier check.
   */
  readonly tac: TACProgram | null;
  /**
   * The result of running constant propagation then constant folding over
   * `tac`, or null if TAC itself was never generated. Always a SEPARATE
   * object from `tac` -- optimizing never mutates or replaces the original,
   * so both can be shown side by side as a genuine before/after.
   */
  readonly optimizedTac: TACProgram | null;
  /** Actual TAC snapshots captured after each optimization pass. */
  readonly optimizationTrace: OptimizationTrace | null;
  /**
   * A before/after summary of what optimization changed -- instruction
   * counts, whether anything changed at all -- or null under exactly the
   * same conditions `optimizedTac` is null. Computed once here so the UI
   * never has to recompute it, and never has to reach past `compile()` to
   * get it.
   */
  readonly comparison: TACComparison | null;
  /** Values produced by executing the optimized TAC's print instructions. */
  readonly output: string[];
  /** Value produced by the first return statement that executes, if any. */
  readonly returnValue?: number | boolean;
  /** Runtime diagnostic produced when a print() needs an unavailable value. */
  readonly runtimeError?: string;
  readonly lexicalErrors: CompilerError[];
  readonly syntaxErrors: CompilerError[];
  readonly semanticErrors: CompilerError[];
  /**
   * Divisions whose divisor constant propagation proved is zero at compile
   * time (see `divisionByZeroCheck.ts`). Empty for a program that either has
   * no such division, or has a divisor that is not known to be zero -- an
   * unknown divisor is never reported here. Never non-empty at the same time
   * as `optimizedTac` is non-null: this check is what withholds it.
   */
  readonly divisionByZeroErrors: CompilerError[];
  /** All errors, in pipeline order. */
  readonly errors: CompilerError[];
  readonly stageStatus: Readonly<Record<PipelineStage, StageStatus>>;
}

/**
 * Run the compiler over a MiniC source program.
 *
 * Pure function: no shared state, no side effects, fully deterministic.
 * Calling it twice with the same source returns two identical results.
 *
 * @example
 *   const result = compile('int a = 10;\nint b = a + 5;');
 *   result.ast           // the syntax tree
 *   result.symbols       // [{ name: 'a', ... }, { name: 'b', ... }]
 *   result.tac           // the generated three address code
 *   result.optimizedTac  // the same program after all six optimizer passes
 *   result.comparison    // instruction counts and whether anything changed
 *   result.errors        // everything that went wrong
 */
export function compile(source: string): CompilationResult {
  // --- Phase 1: Lexical Analysis ---
  const { tokens, errors: lexicalErrors } = tokenize(source);

  if (lexicalErrors.length > 0) {
    // Stop here. The token stream is known to be wrong, so anything the
    // parser said about it would be noise.
    return {
      source,
      tokens,
      ast: null,
      symbols: [],
      functionSymbols: {},
      tac: null,
      optimizedTac: null,
      optimizationTrace: null,
      comparison: null,
      output: [],
      lexicalErrors,
      syntaxErrors: [],
      semanticErrors: [],
      divisionByZeroErrors: [],
      errors: [...lexicalErrors],
      stageStatus: {
        lexical: 'error',
        syntax: 'skipped',
        semantic: 'skipped',
        tac: 'skipped',
        optimization: 'skipped',
      },
    };
  }

  // --- Phase 2: Syntax Analysis ---
  // The parser withholds its tree whenever it reported an error, so `ast` is
  // never a misleading half-built structure.
  const { program, errors: syntaxErrors } = parse(tokens);

  if (program === null) {
    return {
      source,
      tokens,
      ast: null,
      symbols: [],
      functionSymbols: {},
      tac: null,
      optimizedTac: null,
      optimizationTrace: null,
      comparison: null,
      output: [],
      lexicalErrors: [],
      syntaxErrors,
      semanticErrors: [],
      divisionByZeroErrors: [],
      errors: [...syntaxErrors],
      stageStatus: {
        lexical: 'ok',
        syntax: 'error',
        semantic: 'skipped',
        tac: 'skipped',
        optimization: 'skipped',
      },
    };
  }

  // --- Phase 3: Semantic Analysis ---
  // Unlike the earlier phases, this one does NOT withhold its output on
  // error. The tree is still valid and worth showing, and a partial symbol
  // table is genuinely informative: it shows exactly which declarations the
  // analyser accepted before it hit the problem.
  const semantic = analyze(program);

  if (semantic.errors.length > 0) {
    // TAC (and therefore optimization) is withheld here, unlike the AST and
    // symbol table above. Generating TAC from `int a = b + 1;` would have to
    // invent SOMETHING for the undeclared `b` -- there is no honest three
    // address code for a program that does not mean anything, and nothing to
    // optimize until there is.
    return {
      source,
      tokens,
      ast: program,
      symbols: semantic.symbols,
      functionSymbols: Object.fromEntries(semantic.functionSymbols),
      tac: null,
      optimizedTac: null,
      optimizationTrace: null,
      comparison: null,
      output: [],
      lexicalErrors: [],
      syntaxErrors: [],
      semanticErrors: semantic.errors,
      divisionByZeroErrors: [],
      errors: [...semantic.errors],
      stageStatus: {
        lexical: 'ok',
        syntax: 'ok',
        semantic: 'error',
        tac: 'skipped',
        optimization: 'skipped',
      },
    };
  }

  // --- Phase 4: Three Address Code Generation ---
  // Only reached once lexical, syntax and semantic analysis have all
  // succeeded, so every identifier in the tree is known to refer to a
  // declared variable. generateTAC has nothing left to reject.
  const tac = generateTAC(program);

  // --- Compile-time division-by-zero check ---
  // Run constant propagation once, up front, purely to see whether it can
  // prove any division's divisor is zero -- that is exactly the question
  // `checkDivisionByZero` answers (see that file for why a literal `10 / 0`
  // and a propagated `10 / y` with `y` known to be 0 are indistinguishable
  // once propagation has run). `optimize()` below reruns constant
  // propagation as its own first pass regardless: `constantPropagation` is a
  // pure, side-effect-free function, so calling it twice on the same `tac`
  // costs a little repeated work and changes nothing about the result --
  // this keeps `optimize()`'s existing signature and pass order completely
  // untouched rather than threading errors through it.
  const hasControlFlow = tac.instructions.some((instruction) => instruction.kind === 'label' || instruction.kind === 'jump' || instruction.kind === 'jumpIfFalse');
  const divisionByZeroErrors = checkDivisionByZero(hasControlFlow ? tac : constantPropagation(tac), program);

  if (divisionByZeroErrors.length > 0) {
    // A proven division by zero makes the program invalid, the same way an
    // undeclared variable does. The original TAC is still shown -- TAC
    // generation itself is a total, mechanical translation and did not
    // fail -- but optimizing it further would silently paper over an
    // invalid program, so optimizedTac and comparison are withheld.
    return {
      source,
      tokens,
      ast: program,
      symbols: semantic.symbols,
      functionSymbols: Object.fromEntries(semantic.functionSymbols),
      tac,
      optimizedTac: null,
      optimizationTrace: null,
      comparison: null,
      output: [],
      lexicalErrors: [],
      syntaxErrors: [],
      semanticErrors: [],
      divisionByZeroErrors,
      errors: [...divisionByZeroErrors],
      stageStatus: {
        lexical: 'ok',
        syntax: 'ok',
        semantic: 'ok',
        tac: 'ok',
        optimization: 'error',
      },
    };
  }

  // --- Optimization: constant propagation, folding, algebraic simplification, dead code elimination ---
  // `optimize` never mutates `tac`: it returns a brand new TACProgram, so
  // `tac` and `optimizedTac` can both be retained as independent snapshots for the trace and final comparison.
  const optimization = optimizeWithTrace(tac);
  const optimizedTac = optimization.program;

  // Before/after summary for the UI -- see comparison.ts for what "changed"
  // means and why it is not just an instruction-count check.
  const comparison = compareTAC(tac, optimizedTac);

  // Execution is only needed for programs containing print(). Existing
  // compiler tests intentionally use undeclared/uninitialized variables in
  // otherwise valid TAC examples; attempting to execute those programs would
  // introduce a runtime concern that Stage 5 did not intend to add.
  const allInstructions = [
    ...optimizedTac.instructions,
    ...Object.values(optimizedTac.functions ?? {}).flatMap((fn) => fn.instructions),
  ];
  const hasPrint = allInstructions.some((instruction) => instruction.kind === 'print');
  const hasReturn = allInstructions.some((instruction) => instruction.kind === 'return');
  let output: string[] = [];
  let returnValue: number | boolean | undefined;
  let runtimeError: string | undefined;
  if (hasPrint || hasReturn) {
    try {
      const execution = executeTAC(optimizedTac);
      output = execution.output;
      returnValue = execution.returnValue;
    } catch (error) {
      // The language currently permits declarations without initializers.
      // A later print of such a variable is a runtime problem, not a reason
      // for the entire compiler UI to crash or go blank.
      runtimeError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    source,
    tokens,
    ast: program,
    symbols: semantic.symbols,
    functionSymbols: Object.fromEntries(semantic.functionSymbols),
    tac,
    optimizedTac,
    optimizationTrace: optimization.trace,
    comparison,
    output,
    ...(returnValue !== undefined ? { returnValue } : {}),
    ...(runtimeError ? { runtimeError } : {}),
    lexicalErrors: [],
    syntaxErrors: [],
    semanticErrors: [],
    divisionByZeroErrors: [],
    errors: [],
    stageStatus: {
      lexical: 'ok',
      syntax: 'ok',
      semantic: 'ok',
      tac: 'ok',
      optimization: 'ok',
    },
  };
}
