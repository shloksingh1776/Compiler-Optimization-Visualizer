/** Execute the straight-line TAC supported by MiniC and collect print output. */
import type { Operand, TACInstruction, TACProgram } from './ir/tac.ts';

export type RuntimeValue = number | boolean;

export interface ExecutionResult {
  readonly output: string[];
  readonly returnValue?: RuntimeValue;
}

function readOperand(operand: Operand, values: Map<string, RuntimeValue>): RuntimeValue {
  if (operand.kind === 'constant') return operand.value;
  const value = values.get(operand.kind === 'variable' ? operand.name : operand.name);
  if (value === undefined) throw new Error(`Runtime value for '${operand.kind === 'variable' ? operand.name : operand.name}' is unavailable`);
  return value;
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
  return typeof value === 'boolean' ? String(value) : String(value);
}

function executeInstructions(program: TACProgram, instructions: readonly TACInstruction[], initialValues: Map<string, RuntimeValue>, depth: number): ExecutionResult {
  if (depth > 100) throw new Error('Maximum function call depth exceeded');
  const values = initialValues;
  const output: string[] = [];
  const labels = new Map<string, number>();
  instructions.forEach((instruction, index) => { if (instruction.kind === 'label') labels.set(instruction.label, index); });
  let pc = 0;
  while (pc < instructions.length) {
    const instruction = instructions[pc]!;
    switch (instruction.kind) {
      case 'label': pc++; break;
      case 'jump': { const target=labels.get(instruction.label); if(target===undefined) throw new Error(`Unknown label '${instruction.label}'`); pc=target; break; }
      case 'jumpIfFalse': { const c=readOperand(instruction.condition,values); if(typeof c!=='boolean') throw new Error('Runtime if condition is not bool'); if(!c){const target=labels.get(instruction.label);if(target===undefined)throw new Error(`Unknown label '${instruction.label}'`);pc=target;}else pc++; break; }
      case 'assign': { let v=readOperand(instruction.value,values); if(instruction.targetType==='float'&&typeof v==='number')v=Number(v); values.set(instruction.target,v); pc++; break; }
      case 'copy': { let v=readOperand(instruction.source,values); if(instruction.targetType==='float'&&typeof v==='number')v=Number(v); values.set(instruction.target,v); pc++; break; }
      case 'binary': { const v=executeBinary(instruction,readOperand(instruction.left,values),readOperand(instruction.right,values)); values.set(instruction.target,v); pc++; break; }
      case 'unary': {
        const v = readOperand(instruction.operand, values);
        if (instruction.operator === '!') {
          if (typeof v !== 'boolean') throw new Error('Runtime logical NOT on non-bool');
          values.set(instruction.target, !v);
        } else {
          if (typeof v !== 'number') throw new Error('Runtime unary minus on bool');
          values.set(instruction.target, -v);
        }
        pc++;
        break;
      }
      case 'print': output.push(formatRuntimeValue(readOperand(instruction.operand,values))); pc++; break;
      case 'call': {
        const fn=program.functions?.[instruction.functionName]; if(!fn) throw new Error(`Undefined function '${instruction.functionName}'`);
        if(instruction.args.length!==fn.parameters.length) throw new Error(`Function '${instruction.functionName}' expects ${fn.parameters.length} argument(s), got ${instruction.args.length}`);
        const frame=new Map<string,RuntimeValue>();
        for(let i=0;i<fn.parameters.length;i++) frame.set(fn.parameters[i]!.name,readOperand(instruction.args[i]!,values));
        const nested=executeInstructions(program,fn.instructions,frame,depth+1);
        output.push(...nested.output);
        if(nested.returnValue===undefined) throw new Error(`Function '${instruction.functionName}' returned no value`);
        values.set(instruction.target,nested.returnValue); pc++; break;
      }
      case 'return': return { output, returnValue: readOperand(instruction.operand,values) };
      case 'param': case 'functionBegin': case 'functionEnd': pc++; break;
    }
  }
  return { output };
}

export function executeTAC(program: TACProgram): ExecutionResult {
  return executeInstructions(program, program.instructions, new Map<string, RuntimeValue>(), 0);
}
