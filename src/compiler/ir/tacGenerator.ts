/**
 * THREE ADDRESS CODE GENERATION  (Phase 4 of the compiler)
 * ==========================================================
 *
 * COMPILER CONCEPT: this is a classic *syntax-directed translation*. Each
 * kind of AST node has a fixed rule for what TAC it produces, and the
 * generator is nothing more than one recursive function implementing that
 * table:
 *
 *      AST node        TAC produced                          returns
 *      --------------  -------------------------------------  --------------
 *      NumberLiteral   (nothing)                               the literal, as a constant operand
 *      Identifier      (nothing)                               the name, as a variable operand
 *      BinaryExpr      left's code; right's code; t = L op R    a fresh temporary
 *      UnaryExpr       operand's code; t = op operand           a fresh temporary
 *      VarDecl/        initializer's code; target = <result>    (a statement: nothing to return)
 *      Assignment
 *
 * WHY LITERALS AND IDENTIFIERS EMIT NOTHING
 *
 * A literal or a variable name is already a valid TAC operand -- there is
 * nothing to compute. Emitting `t1 = 10` and then using `t1` would be a
 * wasted instruction; the rule above simply hands back `{constant, 10}` (or
 * `{variable, name}`) directly. This is exactly why `int a = 10;` produces
 * one instruction (`a = 10`), not two.
 *
 * WHY PRECEDENCE JUST WORKS
 *
 * Precedence was already resolved when the AST was built (Phase 2): `*`
 * binds tighter than `+` because the parser nested the `*` node deeper. This
 * generator does not know or care about precedence at all -- it walks
 * whatever tree it is given, left child before right child, and the
 * temporary numbers come out in the right order purely because of *when*
 * each node is visited:
 *
 *      a + b * 2   -->   BinaryExpr(+, Identifier(a), BinaryExpr(*, b, 2))
 *
 *      generate(+):
 *        generate(a)        -- Identifier, emits nothing, returns {var a}
 *        generate(* node)   -- BinaryExpr, recurses first:
 *              generate(b)    -- emits nothing, returns {var b}
 *              generate(2)    -- emits nothing, returns {const 2}
 *              emits  t1 = b * 2
 *              returns {temp t1}
 *        emits  t2 = a + t1
 *        returns {temp t2}
 *
 *      t1 = b * 2
 *      t2 = a + t1
 *
 * `a` is visited first (it is the left child) but produces no instruction,
 * so the `*` subtree's instruction is the first line that actually appears.
 * No special-casing for precedence was needed anywhere in this file.
 *
 * ASSIGN vs COPY
 *
 * A declaration or assignment's final instruction is an `assign` when its
 * right-hand side was already a plain value (a literal or a bare variable --
 * nothing had to be computed), and a `copy` when the right-hand side
 * required computation and left a temporary behind:
 *
 *      int a = 10;      ->  assign   a = 10
 *      int c = a + b;   ->  binary   t1 = a + b
 *                           copy     c  = t1
 *
 * This distinction matters to the optimizer that comes later: a `copy` is
 * exactly the shape constant propagation and dead code elimination look
 * for, while an `assign` already holds its final value and needs no
 * propagation.
 *
 * NO OPTIMIZATION HAPPENS HERE
 *
 * Every BinaryExpr and every UnaryExpr becomes its own instruction, with no
 * exceptions: `c * 1` becomes `t1 = c * 1`, never `c`, and `10 + 20` becomes
 * `t1 = 10 + 20`, never `30`. Simplifying either would be constant folding
 * or algebraic simplification, which belong to the optimizer (Phase 6). This
 * generator's only job is to translate the tree mechanically.
 *
 * DETERMINISM: temporary names are assigned by a plain counter starting at 1
 * for every call to `generateTAC`, in the order the recursive walk visits
 * nodes. No randomness, no timestamps, no reuse of AST node ids as names.
 * The same AST always produces byte-identical TAC.
 */

import type { Assignment, Expr, Program, Stmt, VarDecl, PrintStmt, CallStmt, FunctionDecl, IncrementStmt, SwitchStmt } from '../parser/ast.ts';
import type { FunctionReturnType, MiniCType } from '../types.ts';
import type { Operand, TACInstruction, TACProgram, TACFunction } from './tac.ts';

class TACGenerator {
  private instructions: TACInstruction[] = [];
  private tempCount = 0;
  private labelCount = 0;
  private readonly variableTypes = new Map<string, MiniCType>();
  private readonly globalVariableTypes = new Map<string, MiniCType>();
  /** Local names are activated as their declarations are encountered, preserving declaration-before-use lookup. */
  private currentFunctionLocalNames: Set<string> | null = null;
  private readonly functions = new Map<string, TACFunction>();
  private readonly functionReturnTypes = new Map<string, FunctionReturnType>();
  private readonly breakTargets: string[] = [];
  private readonly continueTargets: string[] = [];

  generate(program: Program): TACProgram {
    for (const statement of program.body) {
      if (statement.type === 'FunctionDecl') this.functionReturnTypes.set(statement.name, statement.returnType);
    }
    for (const statement of program.body) {
      if (statement.type !== 'FunctionDecl') this.generateStatement(statement);
    }
    this.globalVariableTypes.clear();
    for (const [name, type] of this.variableTypes) this.globalVariableTypes.set(name, type);
    for (const statement of program.body) {
      if (statement.type === 'FunctionDecl') this.generateFunction(statement);
    }
    return {
      instructions: this.instructions,
      temporaryCount: this.tempCount,
      functions: Object.fromEntries(this.functions),
      globalVariables: [...this.globalVariableTypes.keys()],
    };
  }

  private variableScope(name: string): 'global' | 'local' {
    return this.currentFunctionLocalNames?.has(name) ? 'local' : 'global';
  }

  private variableType(name: string): MiniCType {
    if (this.currentFunctionLocalNames !== null && !this.currentFunctionLocalNames.has(name)) {
      return this.globalVariableTypes.get(name) ?? 'int';
    }
    return this.variableTypes.get(name) ?? this.globalVariableTypes.get(name) ?? 'int';
  }

  /** Mint the next temporary name: t1, t2, t3, ... in visitation order. */
  private freshTemporary(): string {
    this.tempCount += 1;
    return `t${this.tempCount}`;
  }

  private freshLabel(): string {
    return `L${this.labelCount++}`;
  }

  private emit(instruction: TACInstruction): void {
    this.instructions.push(instruction);
  }

  /* ---------------- statements ---------------- */

  private generateStatement(statement: Stmt): void {
    switch (statement.type) {
      case 'VarDecl':
        if (this.currentFunctionLocalNames === null) {
          this.variableTypes.set(statement.name, statement.varType ?? 'int');
          this.generateDeclaration(statement);
        } else {
          const declaredType = statement.varType ?? 'int';
          if (statement.init === null) {
            this.variableTypes.set(statement.name, declaredType);
            this.currentFunctionLocalNames.add(statement.name);
            return;
          }

          // The initializer is generated before this local binding becomes
          // visible. If it shares a name with a global, the initializer reads
          // the global and the final store writes the new local variable.
          const initializer = this.generateExpression(statement.init);
          this.variableTypes.set(statement.name, declaredType);
          this.currentFunctionLocalNames.add(statement.name);
          this.emitFinalValueAssignment(statement.name, initializer, declaredType, statement.id, 'local');
        }
        return;
      case 'Assignment':
        this.generateAssignment(statement);
        return;
      case 'IncrementStmt':
        this.generateIncrement(statement);
        return;
      case 'PrintStmt':
        this.generatePrint(statement);
        return;
      case 'CallStmt':
        this.generateCallStatement(statement);
        return;
      case 'ReturnStmt':
        this.generateReturn(statement);
        return;
      case 'BreakStmt': {
        const target = this.breakTargets[this.breakTargets.length - 1];
        if (target) this.emit({ kind: 'jump', label: target, sourceNodeId: statement.id });
        return;
      }
      case 'ContinueStmt': {
        const target = this.continueTargets[this.continueTargets.length - 1];
        if (target) this.emit({ kind: 'jump', label: target, sourceNodeId: statement.id });
        return;
      }
      case 'IfStmt':
        this.generateIf(statement);
        return;
      case 'WhileStmt':
        this.generateWhile(statement);
        return;
      case 'ForStmt':
        this.generateFor(statement);
        return;
      case 'SwitchStmt':
        this.generateSwitch(statement);
        return;
      case 'FunctionDecl':
        return;
    }
  }

  /**
   *      int a;          -> no instruction at all: nothing to compute or store
   *      int a = expr;   -> code for expr, then target = <result>
   *
   * `int a;` deliberately produces no TAC. Inventing a placeholder
   * instruction (say, `a = 0`) would assert the variable has a value it does
   * not actually have in the source program.
   */
  private generateFunction(fn: FunctionDecl): void {
    const savedInstructions = this.instructions;
    const localInstructions: TACInstruction[] = [];
    this.instructions = localInstructions;
    this.variableTypes.clear();
    this.currentFunctionLocalNames = new Set<string>();
    for (const p of fn.parameters) {
      this.variableTypes.set(p.name, p.type);
      this.currentFunctionLocalNames.add(p.name);
      this.emit({ kind: 'param', name: p.name, valueType: p.type, sourceNodeId: fn.id });
    }
    for (const st of fn.body) this.generateStatement(st);
    const parameterNames = new Set(fn.parameters.map((parameter) => parameter.name));
    this.functions.set(fn.name, {
      name: fn.name,
      parameters: fn.parameters.map(p => ({ name: p.name, type: p.type })),
      returnType: fn.returnType,
      instructions: localInstructions,
      localVariables: [...this.currentFunctionLocalNames].filter((name) => !parameterNames.has(name)),
    });
    this.instructions = savedInstructions;
    this.variableTypes.clear();
    this.currentFunctionLocalNames = null;
  }

  private generateDeclaration(declaration: VarDecl): void {
    if (declaration.init === null) return;
    this.generateFinalAssignment(declaration.name, declaration.init, declaration.id);
  }

  /**
   *      a = expr;   -> code for expr, then target = <result>
   *
   * Identical shape to a declaration's initializer -- from TAC's point of
   * view, "declare with a value" and "assign a value" are the same
   * operation, so both funnel through `generateFinalAssignment`.
   */
  private generateAssignment(assignment: Assignment): void {
    if (!assignment.compoundOperator) {
      this.generateFinalAssignment(assignment.name, assignment.value, assignment.id);
      return;
    }
    const operator = assignment.compoundOperator[0] as '+' | '-' | '*' | '/' | '%';
    const targetType = this.variableType(assignment.name);
    const left = { kind: 'variable' as const, name: assignment.name, valueType: targetType, scope: this.variableScope(assignment.name) };
    const right = this.generateExpression(assignment.value);
    const temp = this.freshTemporary();
    this.emit({ kind: 'binary', target: temp, targetType, left, operator, right, sourceNodeId: assignment.id });
    this.emit({ kind: 'copy', target: assignment.name, targetKind: 'variable', targetScope: this.variableScope(assignment.name), targetType, source: { kind: 'temporary', name: temp, valueType: targetType }, sourceNodeId: assignment.id });
  }

  /**
   * Lower `x++` / `x--` to ordinary arithmetic TAC. Stage 15 deliberately
   * supports postfix increment/decrement only as standalone statements, so
   * there is no old-value result to preserve.
   *
   *      x++  ->  t1 = x + 1
   *              x = t1
   *      x--  ->  t1 = x - 1
   *              x = t1
   *
   * This keeps the TAC vocabulary unchanged: the optimizer and interpreter
   * already know how to execute and optimize binary arithmetic and copies.
   */
  private generateIncrement(statement: IncrementStmt): void {
    const targetType = this.variableType(statement.name);
    const temp = this.freshTemporary();
    this.emit({
      kind: 'binary',
      target: temp,
      targetType,
      left: { kind: 'variable', name: statement.name, valueType: targetType, scope: this.variableScope(statement.name) },
      operator: statement.operator === '++' ? '+' : '-',
      right: { kind: 'constant', value: 1, valueType: 'int' },
      sourceNodeId: statement.id,
    });
    this.emit({
      kind: 'copy',
      target: statement.name,
      targetKind: 'variable',
      targetScope: this.variableScope(statement.name),
      targetType,
      source: { kind: 'temporary', name: temp, valueType: targetType },
      sourceNodeId: statement.id,
    });
  }

  private generateReturn(statement: Extract<Stmt, { type: 'ReturnStmt' }>): void {
    if (statement.expression === null) {
      this.emit({ kind: 'return', operand: { kind: 'constant', value: 0, valueType: 'int' }, targetType: 'void', sourceNodeId: statement.id });
      return;
    }
    const operand = this.generateExpression(statement.expression);
    this.emit({ kind: 'return', operand, targetType: operand.valueType ?? 'int', sourceNodeId: statement.id });
  }

  private generateCallStatement(statement: CallStmt): void {
    const args = statement.arguments.map(arg => this.generateExpression(arg));
    const target = this.freshTemporary();
    this.emit({ kind: 'call', target, targetType: this.functionReturnTypes.get(statement.name) ?? 'void', functionName: statement.name, args, sourceNodeId: statement.id });
  }

  private generatePrint(statement: PrintStmt): void {
    const operand = this.generateExpression(statement.expression);
    this.emit({ kind: 'print', operand, sourceNodeId: statement.id });
  }

  private generateWhile(statement: Extract<Stmt, { type: 'WhileStmt' }>): void {
    const conditionLabel = this.freshLabel();
    const endLabel = this.freshLabel();
    this.breakTargets.push(endLabel);
    this.continueTargets.push(conditionLabel);
    this.emit({ kind: 'label', label: conditionLabel, sourceNodeId: statement.id });
    const condition = this.generateExpression(statement.condition);
    this.emit({ kind: 'jumpIfFalse', condition, label: endLabel, sourceNodeId: statement.id });
    for (const child of statement.body) this.generateStatement(child);
    this.emit({ kind: 'jump', label: conditionLabel, sourceNodeId: statement.id });
    this.emit({ kind: 'label', label: endLabel, sourceNodeId: statement.id });
    this.breakTargets.pop();
    this.continueTargets.pop();
  }

  private generateFor(statement: Extract<Stmt, { type: 'ForStmt' }>): void {
    if (statement.initializer) this.generateStatement(statement.initializer);
    const conditionLabel = this.freshLabel();
    const updateLabel = this.freshLabel();
    const endLabel = this.freshLabel();
    this.breakTargets.push(endLabel);
    this.continueTargets.push(updateLabel);
    this.emit({ kind: 'label', label: conditionLabel, sourceNodeId: statement.id });
    if (statement.condition) {
      const condition = this.generateExpression(statement.condition);
      this.emit({ kind: 'jumpIfFalse', condition, label: endLabel, sourceNodeId: statement.id });
    }
    for (const child of statement.body) this.generateStatement(child);
    this.emit({ kind: 'label', label: updateLabel, sourceNodeId: statement.id });
    if (statement.update) this.generateStatement(statement.update);
    this.emit({ kind: 'jump', label: conditionLabel, sourceNodeId: statement.id });
    this.emit({ kind: 'label', label: endLabel, sourceNodeId: statement.id });
    this.breakTargets.pop();
    this.continueTargets.pop();
  }

  /** Lower switch dispatch to comparisons and jumps; case bodies naturally fall through. */
  private generateSwitch(statement: SwitchStmt): void {
    const selector = this.generateExpression(statement.expression);
    const endLabel = this.freshLabel();
    const caseLabels = statement.cases.map(() => this.freshLabel());
    const defaultIndex = statement.cases.findIndex((entry) => entry.value === null);

    for (let i = 0; i < statement.cases.length; i++) {
      const switchCase = statement.cases[i]!;
      if (switchCase.value === null) continue;
      const nextCheck = this.freshLabel();
      const comparison = this.freshTemporary();
      this.emit({ kind: 'binary', target: comparison, targetType: 'bool', left: selector, operator: '==', right: { kind: 'constant', value: switchCase.value, valueType: 'int' }, sourceNodeId: statement.id });
      this.emit({ kind: 'jumpIfFalse', condition: { kind: 'temporary', name: comparison, valueType: 'bool' }, label: nextCheck, sourceNodeId: statement.id });
      this.emit({ kind: 'jump', label: caseLabels[i]!, sourceNodeId: statement.id });
      this.emit({ kind: 'label', label: nextCheck, sourceNodeId: statement.id });
    }
    this.emit({ kind: 'jump', label: defaultIndex >= 0 ? caseLabels[defaultIndex]! : endLabel, sourceNodeId: statement.id });

    this.breakTargets.push(endLabel);
    for (let i = 0; i < statement.cases.length; i++) {
      this.emit({ kind: 'label', label: caseLabels[i]!, sourceNodeId: statement.id });
      for (const child of statement.cases[i]!.body) this.generateStatement(child);
    }
    this.emit({ kind: 'label', label: endLabel, sourceNodeId: statement.id });
    this.breakTargets.pop();
  }

  private generateIf(statement: Extract<Stmt, { type: 'IfStmt' }>): void {
    const condition = this.generateExpression(statement.condition);
    const elseLabel = this.freshLabel();
    const endLabel = this.freshLabel();
    this.emit({ kind: 'jumpIfFalse', condition, label: statement.elseBranch !== null ? elseLabel : endLabel, sourceNodeId: statement.id });
    for (const child of statement.thenBranch) this.generateStatement(child);
    if (statement.elseBranch !== null) {
      this.emit({ kind: 'jump', label: endLabel, sourceNodeId: statement.id });
      this.emit({ kind: 'label', label: elseLabel, sourceNodeId: statement.id });
      for (const child of statement.elseBranch) this.generateStatement(child);
    }
    this.emit({ kind: 'label', label: endLabel, sourceNodeId: statement.id });
  }

  /**
   * Generate `target = expr`, choosing `assign` or `copy` for the final
   * instruction based on what `expr` turned out to need:
   *
   *   - expr was already a plain value (a literal or a bare variable, no
   *     computation required)  ->  assign   target = value
   *   - expr required computation and left a temporary behind
   *                                          ->  copy     target = tN
   */
  private generateFinalAssignment(target: string, expr: Expr, sourceNodeId: string): void {
    const result = this.generateExpression(expr);
    const targetType = this.variableType(target) ?? result.valueType ?? 'int';
    this.emitFinalValueAssignment(target, result, targetType, sourceNodeId, this.variableScope(target));
  }

  private emitFinalValueAssignment(
    target: string,
    result: Operand,
    targetType: MiniCType,
    sourceNodeId: string,
    targetScope: 'global' | 'local',
  ): void {
    // Assignment to float performs the language's simple numeric promotion:
    // an int value stored in a float variable is represented as a float value
    // from this point onward. Semantic analysis has already rejected float -> int.
    const normalized: Operand = result.valueType === targetType ? result : { ...result, valueType: targetType };
    if (normalized.kind === 'temporary') {
      this.emit({ kind: 'copy', target, targetKind: 'variable', targetScope, targetType, source: normalized, sourceNodeId });
    } else {
      this.emit({ kind: 'assign', target, targetKind: 'variable', targetScope, targetType, value: normalized, sourceNodeId });
    }
  }

  /* ---------------- logical expressions ---------------- */

  /** Generate a boolean value with short-circuit semantics for `left && right`. */
  private generateLogicalAnd(leftExpr: Expr, rightExpr: Expr, sourceNodeId: string): Operand {
    const target = this.freshTemporary();
    const falseLabel = this.freshLabel();
    const endLabel = this.freshLabel();

    const left = this.generateExpression(leftExpr);
    this.emit({ kind: 'jumpIfFalse', condition: left, label: falseLabel, sourceNodeId });

    const right = this.generateExpression(rightExpr);
    this.emit({ kind: 'jumpIfFalse', condition: right, label: falseLabel, sourceNodeId });

    this.emit({
      kind: 'assign', target, targetKind: 'temporary', targetType: 'bool',
      value: { kind: 'constant', value: true, valueType: 'bool' }, sourceNodeId,
    });
    this.emit({ kind: 'jump', label: endLabel, sourceNodeId });
    this.emit({ kind: 'label', label: falseLabel, sourceNodeId });
    this.emit({
      kind: 'assign', target, targetKind: 'temporary', targetType: 'bool',
      value: { kind: 'constant', value: false, valueType: 'bool' }, sourceNodeId,
    });
    this.emit({ kind: 'label', label: endLabel, sourceNodeId });

    return { kind: 'temporary', name: target, valueType: 'bool' };
  }

  /** Generate a boolean value with short-circuit semantics for `left || right`. */
  /** Generate a conditional expression using control flow so only the selected branch is evaluated. */
  private expressionType(expression: Expr): MiniCType {
    switch (expression.type) {
      case 'NumberLiteral': return expression.valueType ?? (expression.value % 1 !== 0 ? 'float' : 'int');
      case 'BooleanLiteral': return 'bool';
      case 'Identifier': return this.variableType(expression.name);
      case 'CallExpr': { const t = this.functionReturnTypes.get(expression.name) ?? 'int'; return t === 'void' ? 'int' : t; }
      case 'UnaryExpr': return expression.operator === '!' ? 'bool' : this.expressionType(expression.operand);
      case 'BinaryExpr': {
        if (expression.operator === '&&' || expression.operator === '||' || ['<','>','<=','>=','==','!='].includes(expression.operator)) return 'bool';
        const left = this.expressionType(expression.left);
        const right = this.expressionType(expression.right);
        return left === 'float' || right === 'float' ? 'float' : 'int';
      }
      case 'ConditionalExpr': {
        const thenType = this.expressionType(expression.thenExpression);
        const elseType = this.expressionType(expression.elseExpression);
        return thenType === 'float' || elseType === 'float' ? 'float' : thenType;
      }
    }
  }

  private emitConditionalValue(target: string, value: Operand, targetType: MiniCType, sourceNodeId: string): void {
    const normalized: Operand = value.valueType === targetType ? value : { ...value, valueType: targetType };
    if (normalized.kind === 'temporary') {
      this.emit({ kind: 'copy', target, targetKind: 'temporary', targetType, source: normalized, sourceNodeId });
    } else {
      this.emit({ kind: 'assign', target, targetKind: 'temporary', targetType, value: normalized, sourceNodeId });
    }
  }

  private generateConditional(conditionExpr: Expr, thenExpr: Expr, elseExpr: Expr, sourceNodeId: string): Operand {
    const target = this.freshTemporary();
    const elseLabel = this.freshLabel();
    const endLabel = this.freshLabel();
    const thenType = this.expressionType(thenExpr);
    const elseType = this.expressionType(elseExpr);
    const resultType: MiniCType = thenType === 'float' || elseType === 'float' ? 'float' : thenType;

    const condition = this.generateExpression(conditionExpr);
    this.emit({ kind: 'jumpIfFalse', condition, label: elseLabel, sourceNodeId });

    const thenValue = this.generateExpression(thenExpr);
    this.emitConditionalValue(target, thenValue, resultType, sourceNodeId);
    this.emit({ kind: 'jump', label: endLabel, sourceNodeId });

    this.emit({ kind: 'label', label: elseLabel, sourceNodeId });
    const elseValue = this.generateExpression(elseExpr);
    this.emitConditionalValue(target, elseValue, resultType, sourceNodeId);
    this.emit({ kind: 'label', label: endLabel, sourceNodeId });

    return { kind: 'temporary', name: target, valueType: resultType };
  }

  private generateLogicalOr(leftExpr: Expr, rightExpr: Expr, sourceNodeId: string): Operand {
    const target = this.freshTemporary();
    const rightLabel = this.freshLabel();
    const falseLabel = this.freshLabel();
    const endLabel = this.freshLabel();

    const left = this.generateExpression(leftExpr);
    this.emit({ kind: 'jumpIfFalse', condition: left, label: rightLabel, sourceNodeId });
    this.emit({
      kind: 'assign', target, targetKind: 'temporary', targetType: 'bool',
      value: { kind: 'constant', value: true, valueType: 'bool' }, sourceNodeId,
    });
    this.emit({ kind: 'jump', label: endLabel, sourceNodeId });

    this.emit({ kind: 'label', label: rightLabel, sourceNodeId });
    const right = this.generateExpression(rightExpr);
    this.emit({ kind: 'jumpIfFalse', condition: right, label: falseLabel, sourceNodeId });
    this.emit({
      kind: 'assign', target, targetKind: 'temporary', targetType: 'bool',
      value: { kind: 'constant', value: true, valueType: 'bool' }, sourceNodeId,
    });
    this.emit({ kind: 'jump', label: endLabel, sourceNodeId });

    this.emit({ kind: 'label', label: falseLabel, sourceNodeId });
    this.emit({
      kind: 'assign', target, targetKind: 'temporary', targetType: 'bool',
      value: { kind: 'constant', value: false, valueType: 'bool' }, sourceNodeId,
    });
    this.emit({ kind: 'label', label: endLabel, sourceNodeId });

    return { kind: 'temporary', name: target, valueType: 'bool' };
  }

  /* ---------------- expressions ---------------- */

  /**
   * Generate whatever instructions are needed to compute `expression`, and
   * return the operand that holds its value.
   *
   * The switch is exhaustive over the Expr union: if a new expression node
   * type is ever added to the AST, this function fails to compile until it
   * is taught how to translate it, rather than silently ignoring it.
   */
  private generateExpression(expression: Expr): Operand {
    switch (expression.type) {
      case 'NumberLiteral':
        // A literal needs no computation: it already IS an operand.
        return { kind: 'constant', value: expression.value, valueType: expression.valueType ?? (expression.value % 1 !== 0 ? 'float' : 'int') };

      case 'BooleanLiteral':
        return { kind: 'constant', value: expression.value, valueType: 'bool' };

      case 'ConditionalExpr':
        return this.generateConditional(expression.condition, expression.thenExpression, expression.elseExpression, expression.id);

      case 'CallExpr': {
        const args = expression.arguments.map((arg) => this.generateExpression(arg));
        const target = this.freshTemporary();
        const returnType = this.functionReturnTypes.get(expression.name) ?? 'int';
        const valueType: MiniCType = returnType === 'void' ? 'int' : returnType;
        this.emit({ kind: 'call', target, targetType: returnType, functionName: expression.name, args, sourceNodeId: expression.id });
        return { kind: 'temporary', name: target, valueType };
      }

      case 'Identifier':
        // Likewise a variable reference needs no computation to "produce" --
        // by the time TAC generation runs, semantic analysis has already
        // guaranteed every identifier here refers to a declared variable.
        return { kind: 'variable', name: expression.name, valueType: this.variableType(expression.name), scope: this.variableScope(expression.name) };

      case 'BinaryExpr': {
        if (expression.operator === '&&') return this.generateLogicalAnd(expression.left, expression.right, expression.id);
        if (expression.operator === '||') return this.generateLogicalOr(expression.left, expression.right, expression.id);

        // Left before right: this is the ONLY reason a chain of operators
        // comes out in the right order. Precedence itself was already baked
        // into the tree's shape back in the parser.
        const left = this.generateExpression(expression.left);
        const right = this.generateExpression(expression.right);
        const target = this.freshTemporary();
        const isComparison = ['<', '>', '<=', '>=', '==', '!='].includes(expression.operator);
        const valueType: MiniCType = isComparison
          ? 'bool'
          : (left.valueType === 'float' || right.valueType === 'float' ? 'float' : 'int');
        this.emit({
          kind: 'binary', target, left, operator: expression.operator, right,
          targetType: valueType, sourceNodeId: expression.id,
        });
        return { kind: 'temporary', name: target, valueType };
      }

      case 'UnaryExpr': {
        const operand = this.generateExpression(expression.operand);
        const target = this.freshTemporary();
        const valueType: MiniCType = expression.operator === '!' ? 'bool' : (operand.valueType ?? 'int');
        this.emit({ kind: 'unary', target, operator: expression.operator, operand, targetType: valueType, sourceNodeId: expression.id });
        return { kind: 'temporary', name: target, valueType };
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Translate a semantically valid AST into three address code.
 *
 * Pure function: no shared state, no side effects, fully deterministic.
 * Calling it twice on the same AST returns two identical TACPrograms, with
 * identical temporary names in identical order.
 *
 * This function does not check for semantic errors itself -- the pipeline is
 * responsible for only calling it once lexical, syntax and semantic analysis
 * have all succeeded. Given an AST built from invalid source, it would still
 * run and produce SOME output (there is nothing left in the tree to reject),
 * which is precisely why it must never be called on one.
 *
 * @example
 *   const tac = generateTAC(ast);
 *   tac.instructions        // [{ kind: 'binary', target: 't1', ... }, ...]
 *   tac.temporaryCount      // how many tN names were minted
 */
export function generateTAC(program: Program): TACProgram {
  return new TACGenerator().generate(program);
}
