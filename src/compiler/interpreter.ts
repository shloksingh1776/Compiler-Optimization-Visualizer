/** Execute optimized MiniC TAC and collect print output. */
import type { Operand, TACInstruction, TACProgram } from './ir/tac.ts';

export type RuntimeValue = number | boolean;

/** Runtime failure enriched with the TAC instruction's AST provenance when available. */
export class RuntimeExecutionError extends Error {
  constructor(message: string, readonly sourceNodeId?: string) {
    super(message);
    this.name = 'RuntimeExecutionError';
  }
}

export interface ExecutionResult {
  readonly output: string[];
  readonly returnValue?: RuntimeValue;
}

interface ExecutionFrame {
  /** Function parameters and locals. The top-level program uses the global map instead. */
  readonly variables: Map<string, RuntimeValue>;
  /** Compiler temporaries are isolated from user variables in every call frame. */
  readonly temporaries: Map<string, RuntimeValue>;
  readonly isMain: boolean;
}

function runtimeName(operand: Exclude<Operand, { kind: 'constant' }>): string {
  return operand.name;
}

function readOperand(
  operand: Operand,
  frame: ExecutionFrame,
  globals: Map<string, RuntimeValue>,
  legacyTemporaryNames: ReadonlySet<string>,
): RuntimeValue {
  if (operand.kind === 'constant') return operand.value;

  if (operand.kind === 'temporary') {
    const value = frame.temporaries.get(operand.name);
    if (value !== undefined) return value;
    // Compatibility with hand-built TAC from earlier versions, which shared
    // one map for variables and temporaries.
    if (legacyTemporaryNames.has(operand.name) && frame.variables.has(operand.name)) {
      return frame.variables.get(operand.name)!;
    }
    throw new Error(`Runtime value for '${runtimeName(operand)}' is unavailable`);
  }

  if (operand.scope === 'global') {
    const value = globals.get(operand.name);
    if (value !== undefined) return value;
  } else if (operand.scope === 'local') {
    const value = frame.variables.get(operand.name);
    if (value !== undefined) return value;
  } else {
    // Older TAC does not carry binding annotations. Prefer the active local
    // frame, then fall back to globals; generated TAC always specifies scope.
    const local = frame.variables.get(operand.name);
    if (local !== undefined) return local;
    const global = globals.get(operand.name);
    if (global !== undefined) return global;
  }

  throw new Error(`Runtime value for '${runtimeName(operand)}' is unavailable`);
}

function isTemporaryTarget(
  instruction: Extract<TACInstruction, { kind: 'assign' | 'copy' }>,
  legacyTemporaryNames: ReadonlySet<string>,
): boolean {
  return instruction.targetKind === 'temporary' ||
    (instruction.targetKind === undefined && legacyTemporaryNames.has(instruction.target));
}

function writeAssignmentTarget(
  instruction: Extract<TACInstruction, { kind: 'assign' | 'copy' }>,
  value: RuntimeValue,
  frame: ExecutionFrame,
  globals: Map<string, RuntimeValue>,
  legacyTemporaryNames: ReadonlySet<string>,
): void {
  if (isTemporaryTarget(instruction, legacyTemporaryNames)) {
    frame.temporaries.set(instruction.target, value);
    return;
  }

  if (instruction.targetScope === 'global' || (instruction.targetScope === undefined && frame.isMain)) {
    globals.set(instruction.target, value);
  } else {
    frame.variables.set(instruction.target, value);
  }
}

function executeBinary(operator: TACInstruction & { kind: 'binary' }, left: RuntimeValue, right: RuntimeValue): RuntimeValue {
  switch (operator.operator) {
    case '+': return (left as number) + (right as number);
    case '-': return (left as number) - (right as number);
    case '*': return (left as number) * (right as number);
    case '%': {
      if ((right as number) === 0) throw new Error('Runtime modulo by zero');
      return (left as number) % (right as number);
    }
    case '/': {
      if ((right as number) === 0) throw new Error('Runtime division by zero');
      return operator.targetType === 'float' ? (left as number) / (right as number) : Math.trunc((left as number) / (right as number));
    }
    case '<': return (left as number) < (right as number);
    case '>': return (left as number) > (right as number);
    case '<=': return (left as number) <= (right as number);
    case '>=': return (left as number) >= (right as number);
    case '==': return left === right;
    case '!=': return left !== right;
  }
}

function formatRuntimeValue(value: RuntimeValue): string {
  return String(value);
}

function collectLegacyTemporaryNames(program: TACProgram): Set<string> {
  const result = new Set<string>();
  const instructions = [
    ...program.instructions,
    ...Object.values(program.functions ?? {}).flatMap((fn) => fn.instructions),
  ];
  for (let index = 1; index <= program.temporaryCount; index++) result.add(`t${index}`);
  for (const instruction of instructions) {
    if (instruction.kind === 'binary' || instruction.kind === 'unary' || instruction.kind === 'call') {
      result.add(instruction.target);
    }
    const operands: Operand[] = instruction.kind === 'assign' ? [instruction.value]
      : instruction.kind === 'copy' ? [instruction.source]
      : instruction.kind === 'binary' ? [instruction.left, instruction.right]
      : instruction.kind === 'unary' ? [instruction.operand]
      : instruction.kind === 'print' || instruction.kind === 'return' ? [instruction.operand]
      : instruction.kind === 'jumpIfFalse' ? [instruction.condition]
      : instruction.kind === 'call' ? instruction.args
      : [];
    for (const operand of operands) if (operand.kind === 'temporary') result.add(operand.name);
  }
  return result;
}

function executeInstructions(
  program: TACProgram,
  instructions: readonly TACInstruction[],
  frame: ExecutionFrame,
  globals: Map<string, RuntimeValue>,
  legacyTemporaryNames: ReadonlySet<string>,
  depth: number,
): ExecutionResult {
  if (depth > 100) throw new Error('Maximum function call depth exceeded');
  const output: string[] = [];
  const labels = new Map<string, number>();
  instructions.forEach((instruction, index) => { if (instruction.kind === 'label') labels.set(instruction.label, index); });
  let pc = 0;
  while (pc < instructions.length) {
    const instruction = instructions[pc]!;
    try {
      switch (instruction.kind) {
      case 'label': pc++; break;
      case 'jump': {
        const target = labels.get(instruction.label);
        if (target === undefined) throw new Error(`Unknown label '${instruction.label}'`);
        pc = target;
        break;
      }
      case 'jumpIfFalse': {
        const condition = readOperand(instruction.condition, frame, globals, legacyTemporaryNames);
        if (typeof condition !== 'boolean') throw new Error('Runtime if condition is not bool');
        if (!condition) {
          const target = labels.get(instruction.label);
          if (target === undefined) throw new Error(`Unknown label '${instruction.label}'`);
          pc = target;
        } else pc++;
        break;
      }
      case 'assign': {
        let value = readOperand(instruction.value, frame, globals, legacyTemporaryNames);
        if (instruction.targetType === 'float' && typeof value === 'number') value = Number(value);
        writeAssignmentTarget(instruction, value, frame, globals, legacyTemporaryNames);
        pc++;
        break;
      }
      case 'copy': {
        let value = readOperand(instruction.source, frame, globals, legacyTemporaryNames);
        if (instruction.targetType === 'float' && typeof value === 'number') value = Number(value);
        writeAssignmentTarget(instruction, value, frame, globals, legacyTemporaryNames);
        pc++;
        break;
      }
      case 'binary': {
        const value = executeBinary(
          instruction,
          readOperand(instruction.left, frame, globals, legacyTemporaryNames),
          readOperand(instruction.right, frame, globals, legacyTemporaryNames),
        );
        frame.temporaries.set(instruction.target, value);
        pc++;
        break;
      }
      case 'unary': {
        const value = readOperand(instruction.operand, frame, globals, legacyTemporaryNames);
        if (instruction.operator === '!') {
          if (typeof value !== 'boolean') throw new Error('Runtime logical NOT on non-bool');
          frame.temporaries.set(instruction.target, !value);
        } else {
          if (typeof value !== 'number') throw new Error('Runtime unary minus on bool');
          frame.temporaries.set(instruction.target, -value);
        }
        pc++;
        break;
      }
      case 'print':
        output.push(formatRuntimeValue(readOperand(instruction.operand, frame, globals, legacyTemporaryNames)));
        pc++;
        break;
      case 'call': {
        const fn = program.functions?.[instruction.functionName];
        if (!fn) throw new Error(`Undefined function '${instruction.functionName}'`);
        if (instruction.args.length !== fn.parameters.length) throw new Error(`Function '${instruction.functionName}' expects ${fn.parameters.length} argument(s), got ${instruction.args.length}`);
        const localValues = new Map<string, RuntimeValue>();
        for (let index = 0; index < fn.parameters.length; index++) {
          localValues.set(fn.parameters[index]!.name, readOperand(instruction.args[index]!, frame, globals, legacyTemporaryNames));
        }
        const nested = executeInstructions(
          program,
          fn.instructions,
          { variables: localValues, temporaries: new Map<string, RuntimeValue>(), isMain: false },
          globals,
          legacyTemporaryNames,
          depth + 1,
        );
        output.push(...nested.output);
        if (fn.returnType === 'void' || instruction.targetType === 'void') { pc++; break; }
        if (nested.returnValue === undefined) throw new Error(`Function '${instruction.functionName}' returned no value`);
        frame.temporaries.set(instruction.target, nested.returnValue);
        pc++;
        break;
      }
      case 'return':
        return instruction.targetType === 'void'
          ? { output }
          : { output, returnValue: readOperand(instruction.operand, frame, globals, legacyTemporaryNames) };
      case 'param': case 'functionBegin': case 'functionEnd': pc++; break;
      }
    } catch (error) {
      // Preserve the deepest failing instruction when a function call propagates
      // a runtime error. Otherwise, attach this instruction's source provenance.
      if (error instanceof RuntimeExecutionError && error.sourceNodeId) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new RuntimeExecutionError(message, instruction.sourceNodeId);
    }
  }
  return { output };
}

export function executeTAC(program: TACProgram): ExecutionResult {
  const globals = new Map<string, RuntimeValue>();
  const legacyTemporaryNames = collectLegacyTemporaryNames(program);
  return executeInstructions(
    program,
    program.instructions,
    { variables: new Map<string, RuntimeValue>(), temporaries: new Map<string, RuntimeValue>(), isMain: true },
    globals,
    legacyTemporaryNames,
    0,
  );
}
