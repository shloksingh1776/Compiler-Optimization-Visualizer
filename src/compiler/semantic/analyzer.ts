/**
 * SEMANTIC ANALYSIS  (Phase 3 of the compiler)
 * ============================================
 *
 * COMPILER CONCEPT: the parser proves a program is grammatically well formed.
 * It cannot prove the program is *meaningful*. Both of these parse perfectly:
 *
 *      int a = 10;        <- meaningful
 *      int a = b + 1;     <- grammatical, but `b` does not exist
 *
 * Semantic analysis is the phase that catches the second kind of problem. It
 * walks the AST, builds the symbol table, and checks the rules that the
 * grammar cannot express.
 *
 *      AST  -->  [ SEMANTIC ANALYSER ]  -->  symbol table + errors
 *
 * RULES CHECKED IN MiniC v1
 *
 *   1. A declaration introduces a name.
 *   2. A name may not be declared twice.
 *   3. Every identifier in an initializer must already be declared.
 *   4. Assignment requires the target to be declared.
 *   5. Every identifier used anywhere must be in the symbol table.
 *   6. Expressions are analysed recursively.
 *
 * There is no type checking to do: MiniC v1 has exactly one type, so every
 * expression is an int and no operator can be misapplied. In a language with
 * more than one type this same walk would also compute and check the type of
 * every expression.
 *
 * DECLARE-AFTER-USE ORDERING
 *
 * For a declaration with an initializer, the initializer is analysed BEFORE
 * the new name is added to the table. That ordering is what makes
 *
 *      int a = a + 1;
 *
 * an error: at the moment the initializer is checked, `a` does not yet exist.
 * Adding the name first would silently accept a variable initialised from
 * itself.
 *
 * DETERMINISM: a single left-to-right, top-to-bottom walk with no shared
 * state. The same AST always yields the same symbols and the same errors in
 * the same order.
 */

import { makeError, type CompilerError } from '../errors.ts';
import type { Assignment, Expr, Program, Stmt, VarDecl } from '../parser/ast.ts';
import type { FunctionReturnType, MiniCType } from '../types.ts';
import { SymbolTable, type Symbol } from './symbolTable.ts';

/** Result of analysing one program. */
export interface SemanticResult {
  /** Declared variables, in declaration order. */
  readonly symbols: Symbol[];
  /** The populated table, for later phases that need lookups. */
  readonly symbolTable: SymbolTable;
  /** All semantic errors found. Empty means the program is well formed. */
  readonly errors: CompilerError[];
  readonly functions: ReadonlyMap<string, { returnType: FunctionReturnType; parameters: { name: string; type: MiniCType }[] }>;
  /** Local symbols collected per function, kept separate from the legacy global symbols array. */
  readonly functionSymbols: ReadonlyMap<string, Symbol[]>;
}

class Analyzer {
  private readonly table = new SymbolTable();
  private readonly errors: CompilerError[] = [];
  private readonly functions = new Map<string, { returnType: FunctionReturnType; parameters: { name: string; type: MiniCType }[] }>();
  private readonly functionSymbols = new Map<string, Symbol[]>();

  analyze(program: Program): SemanticResult {
    // Collect signatures first so calls can refer to functions declared later.
    for (const statement of program.body) {
      if (statement.type !== 'FunctionDecl') continue;
      if (this.functions.has(statement.name)) {
        this.report(`Function '${statement.name}' has already been declared`, statement.line, statement.column, statement.start, statement.end);
      } else {
        this.functions.set(statement.name, { returnType: statement.returnType, parameters: statement.parameters.map(p => ({ name: p.name, type: p.type })) });
      }
    }
    for (const statement of program.body) {
      if (statement.type !== 'FunctionDecl') this.analyzeStatement(statement, this.table, null);
    }
    for (const statement of program.body) {
      if (statement.type === 'FunctionDecl') this.analyzeFunction(statement);
    }
    return { symbols: this.table.all(), symbolTable: this.table, errors: this.errors, functions: this.functions, functionSymbols: this.functionSymbols };
  }

  private analyzeFunction(fn: Extract<Stmt, { type: 'FunctionDecl' }>): void {
    const local = new SymbolTable();
    for (const p of fn.parameters) {
      if (!local.declare({ name: p.name, kind: 'variable', type: p.type, scope: 'local', declaredLine: p.line, declaredColumn: p.column, initialized: true })) {
        this.report(`Parameter '${p.name}' has already been declared`, p.line, p.column, fn.start, fn.end);
      }
    }
    for (const statement of fn.body) this.analyzeStatement(statement, local, fn.returnType);
    this.functionSymbols.set(fn.name, local.all());
  }

  private analyzeStatement(statement: Stmt, table: SymbolTable, returnType: FunctionReturnType | null, loopDepth = 0, switchDepth = 0): void {
    switch (statement.type) {
      case 'VarDecl': this.analyzeDeclaration(statement, table); return;
      case 'Assignment': this.analyzeAssignment(statement, table); return;
      case 'IncrementStmt': {
        const target = table.lookup(statement.name);
        if (!target) {
          this.report(`Cannot increment/decrement undeclared variable '${statement.name}'`, statement.nameLine, statement.nameColumn, statement.start, statement.end);
        } else if (target.type === 'bool') {
          this.report(`Operator '${statement.operator}' requires a numeric variable, not bool`, statement.line, statement.column, statement.start, statement.end);
        }
        return;
      }
      case 'PrintStmt': this.analyzeExpression(statement.expression, table); return;
      case 'CallStmt': {
        const fn = this.functions.get(statement.name);
        if (!fn) this.report(`Undefined function '${statement.name}'`, statement.line, statement.column, statement.start, statement.end);
        if (fn && statement.arguments.length !== fn.parameters.length) this.report(`Function '${statement.name}' expects ${fn.parameters.length} argument(s), but got ${statement.arguments.length}`, statement.line, statement.column, statement.start, statement.end);
        statement.arguments.forEach((arg, i) => { const at = this.analyzeExpression(arg, table); const expected = fn?.parameters[i]; if (expected && at && !this.isAssignable(expected.type, at)) this.report(`Argument ${i + 1} of '${statement.name}' expects ${expected.type}, got ${at}`, arg.line, arg.column, arg.start, arg.end); });
        return;
      }
      case 'BreakStmt':
        if (loopDepth === 0 && switchDepth === 0) this.report("'break' can only be used inside a loop or switch", statement.line, statement.column, statement.start, statement.end);
        return;
      case 'ContinueStmt':
        if (loopDepth === 0) this.report("'continue' can only be used inside a loop", statement.line, statement.column, statement.start, statement.end);
        return;
      case 'ReturnStmt': {
        if (statement.expression === null) {
          if (returnType !== null && returnType !== 'void') this.report(`Non-void function must return a ${returnType} value`, statement.line, statement.column, statement.start, statement.end);
          return;
        }
        const t = this.analyzeExpression(statement.expression, table);
        if (returnType === 'void') this.report('Void function cannot return a value', statement.line, statement.column, statement.start, statement.end);
        else if (returnType !== null && t !== null && !this.isAssignable(returnType, t)) this.report(`Cannot return ${t} expression from ${returnType} function`, statement.line, statement.column, statement.start, statement.end);
        return;
      }
      case 'IfStmt':
        const ct = this.analyzeExpression(statement.condition, table);
        if (ct !== null && ct !== 'bool') this.report('If condition must be a bool expression', statement.condition.line, statement.condition.column, statement.condition.start, statement.condition.end);
        for (const child of statement.thenBranch) this.analyzeStatement(child, table, returnType, loopDepth, switchDepth);
        if (statement.elseBranch) for (const child of statement.elseBranch) this.analyzeStatement(child, table, returnType, loopDepth, switchDepth);
        return;
      case 'WhileStmt': {
        const wt = this.analyzeExpression(statement.condition, table);
        if (wt !== null && wt !== 'bool') this.report('While condition must be a bool expression', statement.condition.line, statement.condition.column, statement.condition.start, statement.condition.end);
        for (const child of statement.body) this.analyzeStatement(child, table, returnType, loopDepth + 1, switchDepth);
        return;
      }
      case 'ForStmt': {
        if (statement.initializer) this.analyzeStatement(statement.initializer, table, returnType, loopDepth);
        if (statement.condition) {
          const ft = this.analyzeExpression(statement.condition, table);
          if (ft !== null && ft !== 'bool') this.report('For condition must be a bool expression', statement.condition.line, statement.condition.column, statement.condition.start, statement.condition.end);
        }
        for (const child of statement.body) this.analyzeStatement(child, table, returnType, loopDepth + 1, switchDepth);
        if (statement.update) this.analyzeStatement(statement.update, table, returnType, loopDepth, switchDepth);
        return;
      }
      case 'SwitchStmt': {
        const selectorType = this.analyzeExpression(statement.expression, table);
        if (selectorType !== null && selectorType !== 'int') {
          this.report('Switch expression must have type int', statement.expression.line, statement.expression.column, statement.expression.start, statement.expression.end);
        }
        const seenValues = new Set<number>();
        let seenDefault = false;
        for (const switchCase of statement.cases) {
          if (switchCase.value === null) {
            if (seenDefault) this.report("A switch statement may contain only one 'default' label", switchCase.line, switchCase.column, switchCase.start, switchCase.end);
            seenDefault = true;
          } else {
            if (seenValues.has(switchCase.value)) this.report(`Duplicate case value '${switchCase.value}'`, switchCase.line, switchCase.column, switchCase.start, switchCase.end);
            seenValues.add(switchCase.value);
          }
          for (const child of switchCase.body) this.analyzeStatement(child, table, returnType, loopDepth, switchDepth + 1);
        }
        return;
      }
      case 'FunctionDecl':
        // Function declarations are supported only at program scope. Still
        // analyze a misplaced declaration's body in a fresh function context
        // so an enclosing loop cannot incorrectly authorize break/continue.
        this.report('Function declarations are only allowed at the top level', statement.line, statement.column, statement.start, statement.end);
        this.analyzeFunction(statement);
        return;
    }
  }

  private analyzeDeclaration(declaration: VarDecl, table: SymbolTable): void {
    const declaredType = declaration.varType ?? 'int';
    let valid = true;
    if (declaration.init !== null) {
      const t = this.analyzeExpression(declaration.init, table);
      if (t === null) {
        // The initializer is semantically invalid (for example, it uses an
        // undeclared identifier). Do not enter the failed declaration into
        // the symbol table; this preserves declaration-before-use ordering
        // and the established partial-symbol-table behaviour.
        valid = false;
      } else if (!this.isAssignable(declaredType, t)) {
        this.report(`Cannot assign ${t} expression to ${declaredType} variable '${declaration.name}'`, declaration.line, declaration.column, declaration.start, declaration.end);
        valid = false;
      }
    }
    const existing = table.lookup(declaration.name);
    if (existing) { this.report(`Variable '${declaration.name}' has already been declared at line ${existing.declaredLine}, column ${existing.declaredColumn}`, declaration.nameLine, declaration.nameColumn, declaration.start, declaration.end); return; }
    if (valid) table.declare({ name: declaration.name, kind: 'variable', type: declaredType, scope: table === this.table ? 'global' : 'local', declaredLine: declaration.nameLine, declaredColumn: declaration.nameColumn, initialized: declaration.init !== null });
  }

  private analyzeAssignment(a: Assignment, table: SymbolTable): void {
    const target = table.lookup(a.name);
    if (!target) this.report(`Cannot assign to undeclared variable '${a.name}'`, a.nameLine, a.nameColumn, a.start, a.end);
    const t = this.analyzeExpression(a.value, table);
    if (!a.compoundOperator) {
      if (target && t !== null && !this.isAssignable(target.type, t)) this.report(`Cannot assign ${t} expression to ${target.type} variable '${a.name}'`, a.line, a.column, a.start, a.end);
      return;
    }
    if (target && target.type === 'bool') this.report(`Compound operator '${a.compoundOperator}' requires a numeric target, not bool`, a.line, a.column, a.start, a.end);
    if (t !== null && t === 'bool') this.report(`Compound operator '${a.compoundOperator}' requires a numeric right-hand expression, not bool`, a.value.line, a.value.column, a.value.start, a.value.end);
    if (a.compoundOperator === '%=' && target && target.type !== 'int') this.report("Compound operator '%=' requires an int target", a.line, a.column, a.start, a.end);
    if (a.compoundOperator === '%=' && t && t !== 'int') this.report("Compound operator '%=' requires an int right-hand expression", a.value.line, a.value.column, a.value.start, a.value.end);
  }

  private analyzeExpression(expression: Expr, table: SymbolTable): MiniCType | null {
    switch (expression.type) {
      case 'NumberLiteral': return expression.valueType ?? (expression.value % 1 !== 0 ? 'float' : 'int');
      case 'BooleanLiteral': return 'bool';
      case 'Identifier': { const s = table.lookup(expression.name); if (!s) { this.report(`Undeclared variable '${expression.name}'`, expression.line, expression.column, expression.start, expression.end); return null; } return s.type; }
      case 'ConditionalExpr': {
        const conditionType = this.analyzeExpression(expression.condition, table);
        if (conditionType !== null && conditionType !== 'bool') {
          this.report('Ternary condition must be a bool expression', expression.condition.line, expression.condition.column, expression.condition.start, expression.condition.end);
        }
        const thenType = this.analyzeExpression(expression.thenExpression, table);
        const elseType = this.analyzeExpression(expression.elseExpression, table);
        if (thenType === null || elseType === null) return null;
        if (!this.isAssignable(thenType, elseType) && !this.isAssignable(elseType, thenType)) {
          this.report(`Ternary branches must have compatible types, got ${thenType} and ${elseType}`, expression.line, expression.column, expression.start, expression.end);
          return null;
        }
        if (thenType === 'float' || elseType === 'float') return 'float';
        return thenType;
      }
      case 'CallExpr': {
        const fn = this.functions.get(expression.name);
        if (!fn) { this.report(`Undefined function '${expression.name}'`, expression.line, expression.column, expression.start, expression.end); expression.arguments.forEach(a => this.analyzeExpression(a, table)); return null; }
        if (expression.arguments.length !== fn.parameters.length) this.report(`Function '${expression.name}' expects ${fn.parameters.length} argument(s), but got ${expression.arguments.length}`, expression.line, expression.column, expression.start, expression.end);
        expression.arguments.forEach((arg, i) => { const at = this.analyzeExpression(arg, table); const expected = fn.parameters[i]; if (expected && at && !this.isAssignable(expected.type, at)) this.report(`Argument ${i + 1} of '${expression.name}' expects ${expected.type}, got ${at}`, arg.line, arg.column, arg.start, arg.end); });
        if (fn.returnType === 'void') { this.report(`Void function '${expression.name}' cannot be used as an expression`, expression.line, expression.column, expression.start, expression.end); return null; }
        return fn.returnType;
      }
      case 'UnaryExpr': {
        const t = this.analyzeExpression(expression.operand, table);
        if (expression.operator === '!') {
          if (t !== null && t !== 'bool') {
            this.report('Logical NOT requires a bool expression', expression.line, expression.column, expression.start, expression.end);
            return null;
          }
          return t === null ? null : 'bool';
        }
        if (t === 'bool') {
          this.report('Unary minus requires a numeric expression, not bool', expression.line, expression.column, expression.start, expression.end);
          return null;
        }
        return t;
      }
      case 'BinaryExpr': {
        const l = this.analyzeExpression(expression.left, table);
        const r = this.analyzeExpression(expression.right, table);
        if (!l || !r) return null;
        if (expression.operator === '&&' || expression.operator === '||') {
          if (l !== 'bool' || r !== 'bool') {
            this.report(`Logical operator '${expression.operator}' requires bool operands`, expression.line, expression.column, expression.start, expression.end);
            return null;
          }
          return 'bool';
        }
        const cmp = ['<','>','<=','>=','==','!='].includes(expression.operator);
        if (cmp) {
          const nums = ['int','float'].includes(l) && ['int','float'].includes(r);
          const be = (expression.operator === '==' || expression.operator === '!=') && l === 'bool' && r === 'bool';
          if (!nums && !be) {
            this.report(`Operator '${expression.operator}' requires two compatible operands (both numeric, or both bool for equality)`, expression.line, expression.column, expression.start, expression.end);
            return null;
          }
          return 'bool';
        }
        if (l === 'bool' || r === 'bool') {
          this.report(`Arithmetic operator '${expression.operator}' requires numeric operands, not bool`, expression.line, expression.column, expression.start, expression.end);
          return null;
        }
        if (expression.operator === '%' && (l !== 'int' || r !== 'int')) {
          this.report("Operator '%' requires int operands", expression.line, expression.column, expression.start, expression.end);
          return null;
        }
        return l === 'float' || r === 'float' ? 'float' : 'int';
      }
    }
  }
  private isAssignable(target: MiniCType, source: MiniCType): boolean { return target === source || (target === 'float' && source === 'int'); }
  private report(message:string,line:number,column:number,start:number,end:number):void { this.errors.push(makeError('semantic',message,{line,column,start,end})); }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Run semantic analysis over a parsed program.
 *
 * Pure function: no shared state, no side effects, fully deterministic.
 *
 * @example
 *   const result = analyze(ast);
 *   result.symbols  // [{ name: 'a', type: 'int', ... }]
 *   result.errors   // [] when the program is well formed
 */
export function analyze(program: Program): SemanticResult {
  return new Analyzer().analyze(program);
}
