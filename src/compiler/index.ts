/**
 * PUBLIC API OF THE COMPILER LIBRARY
 * ==================================
 *
 * Everything the UI is allowed to use is re-exported here. The UI must never
 * reach into `src/compiler/...` subfolders directly, and nothing under
 * `src/compiler/` may import React. That separation is what keeps the
 * compiler independently testable.
 *
 * Phases 1-8 expose lexical analysis, syntax analysis, semantic analysis,
 * TAC generation, optimization (constant propagation, constant folding,
 * algebraic simplification, dead code elimination), and a before/after
 * comparison of the original and optimized TAC.
 */

export { type MiniCType, type FunctionReturnType } from './types.ts';

// --- Errors (shared by every stage) ---
export {
  formatError,
  hasFatalError,
  type CompilerError,
  type Severity,
  type SourceSpan,
  type Stage,
} from './errors.ts';

// --- Phase 1: Lexical Analysis ---
export { TokenType, KEYWORDS, TOKEN_DISPLAY, isOperator, type Token } from './lexer/tokens.ts';
export { tokenize, type LexResult } from './lexer/lexer.ts';

// --- Phase 2: Syntax Analysis ---
export { parse, type ParseResult } from './parser/parser.ts';
export {
  expressionToString,
  type AstNode,
  type Assignment,
  type CallExpr,
  type CallStmt,
  type ConditionalExpr,
  type BinaryExpr,
  type BooleanLiteral,
  type BinaryOperator,
  type Expr,
  type Identifier,
  type IfStmt,
  type WhileStmt,
  type ForStmt,
  type SwitchStmt,
  type SwitchCase,
  type FunctionDecl,
  type ReturnStmt,
  type BreakStmt,
  type ContinueStmt,
  type NodeBase,
  type NumberLiteral,
  type Program,
  type Stmt,
  type UnaryExpr,
  type UnaryOperator,
  type VarDecl,
} from './parser/ast.ts';

// --- Phase 3: Semantic Analysis ---
export { analyze, type SemanticResult } from './semantic/analyzer.ts';
export { SymbolTable, type Symbol, type SymbolKind, type SymbolScope } from './semantic/symbolTable.ts';

// --- Phase 4: Three Address Code ---
export {
  type Operand,
  type TACBinaryOperator,
  type TACUnaryOperator,
  type TACInstruction,
  type TACProgram,
  type TACFunction,
} from './ir/tac.ts';
export { generateTAC } from './ir/tacGenerator.ts';
export { formatOperand, formatInstruction, formatTAC } from './ir/tacPrinter.ts';

// --- Phase 6-7: Optimization (constant propagation, folding, algebraic simplification, DCE) ---
export { optimize, optimizeWithTrace, OPTIMIZATION_PASSES, type OptimizationPassInfo, type OptimizationResult } from './optimizer/optimizer.ts';
export { type OptimizationTrace, type OptimizationTraceStep } from './optimizer/trace.ts';
export { constantPropagation } from './optimizer/passes/constantPropagation.ts';
export { constantFolding } from './optimizer/passes/constantFolding.ts';
export { algebraicSimplification } from './optimizer/passes/algebraicSimplification.ts';
export { deadCodeElimination } from './optimizer/passes/deadCodeElimination.ts';
export { commonSubexpressionElimination, commonSubexpressionEliminationInstructions } from './optimizer/passes/commonSubexpressionElimination.ts';
export { copyPropagation, copyPropagationInstructions } from './optimizer/passes/copyPropagation.ts';
export { evaluateBinary, evaluateUnary } from './optimizer/evaluate.ts';

// --- Compile-time division-by-zero detection ---
export { checkDivisionByZero } from './optimizer/divisionByZeroCheck.ts';

// --- Phase 8: Before/After Comparison ---
export { compareTAC, type TACComparison } from './optimizer/comparison.ts';

// --- Pipeline (runs the phases in order) ---
export {
  compile,
  type CompilationResult,
  type PipelineStage,
  type StageStatus,
} from './pipeline.ts';

export { executeTAC, type ExecutionResult, type RuntimeValue } from './interpreter.ts';
