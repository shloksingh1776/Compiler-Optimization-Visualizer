/**
 * THREE ADDRESS CODE  --  TYPES  (MiniC v1)
 * ==========================================
 *
 * COMPILER CONCEPT: three address code (TAC) is a linear intermediate
 * representation in which every instruction does at most one operation and
 * names at most three things: a destination and (up to) two sources --
 * hence "three address". It sits between the AST and any target-specific
 * code:
 *
 *      AST  -->  [ TAC GENERATOR ]  -->  TAC  -->  ( later: optimizer )
 *
 * WHY THIS STAGE EXISTS
 *
 * The AST is a tree; expressing "evaluate this, then that, then combine
 * them" requires walking it recursively every time. TAC flattens that tree
 * into an ordered LIST of simple steps, which is the representation later
 * phases actually want to work on:
 *
 *      a + b * 2     -- as a tree, precedence lives in the SHAPE
 *      t1 = b * 2    -- as TAC, precedence has already been resolved into
 *      t2 = a + t1   -- a sequence; each line reads left to right with no
 *      c  = t2       -- nesting at all.
 *
 * An optimizer wants exactly this flat, sequential form: a pass like
 * constant folding just scans the instruction list for lines whose operands
 * are known and rewrites that one line, with no tree traversal involved.
 * That is the whole reason this phase exists before optimization does.
 *
 * NO OPTIMIZATION HAPPENS HERE. This module only defines the shape of the
 * instructions. `tacGenerator.ts` produces them directly and mechanically
 * from the AST; even a trivial simplification such as `x * 1 -> x` is
 * deliberately withheld until the optimizer phase, so that "before" and
 * "after" have something real to compare later.
 */

/**
 * A value an instruction reads.
 *
 * Structured on purpose, rather than a bare string like `"a"` or `"t1"` --
 * an optimizer needs to ask "is this operand a constant?" or "what variable
 * does this name?" without re-parsing text. `kind` is what it inspects.
 *
 * Exactly three kinds exist, matching what MiniC v1 can produce: a source
 * variable the user named, a literal value, or a compiler-introduced
 * temporary. There is nothing else for an operand to be.
 */
import type { FunctionReturnType, MiniCType } from '../types.ts';

export type TACVariableScope = 'global' | 'local';

export type Operand =
  | { readonly kind: 'variable'; readonly name: string; readonly valueType?: MiniCType; readonly scope?: TACVariableScope }
  | { readonly kind: 'constant'; readonly value: number | boolean; readonly valueType?: MiniCType }
  | { readonly kind: 'temporary'; readonly name: string; readonly valueType?: MiniCType };

/** Arithmetic and comparison operators represented directly in TAC binary instructions. Logical && and || are lowered to control flow for short-circuit semantics. */
export type TACBinaryOperator = '+' | '-' | '*' | '/' | '%' | '<' | '>' | '<=' | '>=' | '==' | '!=';

/** Numeric negation and boolean logical NOT. */
export type TACUnaryOperator = '-' | '!';

/**
 * One TAC instruction.
 *
 * Value operations (`assign`, `binary`, `unary`, and `copy`) are accompanied
 * by control-flow, call, parameter, print, and return instructions as needed
 * by the supported MiniC statements. The union below is the complete TAC
 * instruction vocabulary used by this compiler; it deliberately does not
 * include speculative forms for unsupported language features:
 *
 *   assign  -  target = value            (a value with no operation: a = 10)
 *   binary  -  target = left OP right    (t1 = a + b)
 *   unary   -  target = OP operand       (t1 = -a)
 *   copy    -  target = source           (c = t1 -- moving a computed result
 *                                          into the variable the user named)
 *
 * `assign` and `copy` look similar -- both just move a value -- but they are
 * kept as separate cases because they arise from different places in the
 * AST and, more importantly, an optimizer treats them differently: a `copy`
 * is exactly the kind of instruction constant propagation and dead code
 * elimination look for (Phase 6), while `assign` already holds a literal it
 * has nothing further to fold.
 *
 * Every instruction carries the AST node id it came from, so the UI can
 * highlight "these TAC lines came from this part of the tree" -- the same
 * traceability the AST view already offers for source spans.
 */
export type TACInstruction =
  | {
      readonly kind: 'assign';
      readonly target: string;
      /** Distinguishes a source variable from a compiler temporary. Older hand-built TAC may omit it. */
      readonly targetKind?: 'variable' | 'temporary';
      /** Binding selected by semantic analysis/code generation, where applicable. */
      readonly targetScope?: TACVariableScope;
      readonly targetType?: MiniCType;
      readonly value: Operand;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'binary';
      readonly target: string;
      readonly targetType?: MiniCType;
      readonly left: Operand;
      readonly operator: TACBinaryOperator;
      readonly right: Operand;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'unary';
      readonly target: string;
      readonly targetType?: MiniCType;
      readonly operator: TACUnaryOperator;
      readonly operand: Operand;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'copy';
      readonly target: string;
      /** Distinguishes a source variable from a compiler temporary. Older hand-built TAC may omit it. */
      readonly targetKind?: 'variable' | 'temporary';
      /** Binding selected by semantic analysis/code generation, where applicable. */
      readonly targetScope?: TACVariableScope;
      readonly targetType?: MiniCType;
      readonly source: Operand;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'label';
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly label: string;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'jumpIfFalse';
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly condition: Operand;
      readonly label: string;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'jump';
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly label: string;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'return';
      /** Optional compatibility fields: return has no assignment target. */
      readonly target?: string;
      readonly targetType?: FunctionReturnType;
      readonly operand: Operand;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'call';
      readonly target: string;
      readonly targetType?: FunctionReturnType;
      readonly functionName: string;
      readonly args: Operand[];
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'param';
      readonly name: string;
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly valueType: MiniCType;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'functionBegin';
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly functionName: string;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'functionEnd';
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly functionName: string;
      readonly sourceNodeId: string;
    }
  | {
      readonly kind: 'print';
      /** Optional compatibility fields: print has no assignment target. */
      readonly target?: string;
      readonly targetType?: MiniCType;
      readonly operand: Operand;
      readonly sourceNodeId: string;
    };

/**
 * The complete TAC form of a program: a flat, ordered instruction list.
 *
 * TAC may contain labels and jumps for if/else, while loops and short-circuit
 * logical expressions. `temporaryCount` records how many `tN` names were
 * minted, which is enough for later phases (or the UI) to reason about
 * compiler-generated temporaries without recomputing a scan of the list.
 */
export interface TACFunction {
  readonly name: string;
  readonly parameters: { readonly name: string; readonly type: MiniCType }[];
  readonly returnType: FunctionReturnType;
  readonly instructions: TACInstruction[];
  /** Declared function locals, including uninitialized locals with no TAC write. */
  readonly localVariables?: readonly string[];
}

export interface TACProgram {
  readonly instructions: TACInstruction[];
  readonly temporaryCount: number;
  readonly functions?: Readonly<Record<string, TACFunction>>;
  /** Top-level variables are global and can be read/written by any function. */
  readonly globalVariables?: readonly string[];
}
