/**
 * SYMBOL TABLE  --  MiniC v1
 * ==========================
 *
 * COMPILER CONCEPT: the symbol table is the compiler's record of every name
 * the program declares, and what is known about it. Semantic analysis fills
 * it in; later phases read it.
 *
 *      int a = 10;   -->   | name | kind     | type | scope  | declared at | init |
 *      int b;              |------|----------|------|--------|-------------|------|
 *                          | a    | variable | int  | global | Ln 1, Col 5 | yes  |
 *                          | b    | variable | int  | global | Ln 2, Col 5 | no   |
 *
 * ONE FLAT TABLE PER SCOPE
 *
 * A real C compiler often keeps a *stack* of symbol tables, pushing one on
 * entry to each block and popping it on exit. This MiniC subset has one global
 * table plus a separate flat local table per function. Semantic name resolution
 * checks the function table first and falls back to the global table, allowing
 * parameters and locals to shadow globals. Block statements reuse their
 * function's table; block-level shadowing is not implemented.
 *
 * INSERTION ORDER: a JavaScript Map iterates in insertion order, so `all()`
 * lists variables in the order they were declared, which is what the user
 * expects to see in the table.
 */

export type { MiniCType } from '../types.ts';
import type { MiniCType } from '../types.ts';

/**
 * What kind of thing a symbol names.
 *
 * MiniC v1 has only variables, so this union has exactly one member today.
 * It is still a named union, rather than a bare `'variable'` literal inlined
 * into `Symbol`, so that a later phase adding e.g. `'function'` or
 * `'parameter'` extends one place instead of every call site that builds a
 * Symbol.
 */
export type SymbolKind = 'variable';

/**
 * Where a symbol is visible.
 *
 * Top-level symbols are global and function parameters/local variables are
 * local to their function. Block statements reuse the surrounding function
 * scope; this project does not implement block-level shadowing.
 */
export type SymbolScope = 'global' | 'local';

/**
 * One entry in the symbol table.
 *
 * Note this shadows the global `Symbol` type inside any module that imports
 * it. That is harmless -- `Symbol` here is an interface, so it exists only in
 * type position and the built-in `Symbol` value is untouched -- and "symbol"
 * is the standard compiler-design term for exactly this record.
 */
export interface Symbol {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly type: MiniCType;
  readonly scope: SymbolScope;
  /** 1-based line of the identifier in its declaration. */
  readonly declaredLine: number;
  /** 1-based column of the identifier in its declaration. */
  readonly declaredColumn: number;
  /**
   * Whether the declaration that introduced this symbol had a valid
   * initializer -- `int a = 10;` is true, `int a;` is false. This records
   * only whether initialization happened, never the initializing value: the
   * symbol table is not the place constant values are tracked, and no
   * constant evaluation happens here.
   */
  readonly initialized: boolean;
}

export class SymbolTable {
  private readonly symbols = new Map<string, Symbol>();

  /**
   * Insert a new symbol.
   *
   * Returns false and changes nothing if the name is already declared, so a
   * redeclaration can never silently overwrite the original. The caller
   * reports the error; the table just refuses the write.
   */
  declare(symbol: Symbol): boolean {
    if (this.symbols.has(symbol.name)) return false;
    this.symbols.set(symbol.name, symbol);
    return true;
  }

  /** Find a symbol by name, or undefined if it was never declared. */
  lookup(name: string): Symbol | undefined {
    return this.symbols.get(name);
  }

  /** True if the name is declared. */
  has(name: string): boolean {
    return this.symbols.has(name);
  }

  /** Every symbol, in declaration order. */
  all(): Symbol[] {
    return [...this.symbols.values()];
  }

  get size(): number {
    return this.symbols.size;
  }
}
