/**
 * THREE ADDRESS CODE  --  PRINTING
 * ================================
 *
 * This module's ONLY job is turning structured TAC into readable text. It
 * generates nothing and decides nothing about the program; it is a pure
 * formatter.
 *
 *      TACProgram (typed instructions)  -->  [ PRINTER ]  -->  display text
 *
 * WHY THIS IS A SEPARATE FILE FROM THE GENERATOR
 *
 * `tacGenerator.ts` produces typed `TACInstruction` objects -- the data an
 * optimizer will pattern-match on directly. If TAC only existed as strings,
 * every later pass (constant folding, dead code elimination, ...) would have
 * to re-parse those strings back into structure before it could do anything,
 * which is both wasted work and a source of bugs. Keeping the printer
 * separate means the generator's output stays exactly what Phase 6 needs to
 * consume, and printing is available purely as a display convenience for the
 * UI and for tests that want to assert on readable text.
 *
 * DETERMINISM: formatting an operand or instruction is a pure function of
 * its fields, so printing the same TACProgram twice always yields identical
 * text.
 */

import type { Operand, TACInstruction, TACProgram } from './tac.ts';

/** Render one operand: a bare name for variables and temporaries, the literal value for constants. */
export function formatOperand(operand: Operand): string {
  switch (operand.kind) {
    case 'variable':
      return operand.name;
    case 'temporary':
      return operand.name;
    case 'constant':
      if (operand.valueType === 'bool') return operand.value ? 'true' : 'false';
      return String(operand.value);
  }
}

/**
 * Render one instruction as a single line of text, in the conventional TAC
 * form: `target = ...`.
 */
export function formatInstruction(instruction: TACInstruction): string {
  switch (instruction.kind) {
    case 'assign':
      return `${instruction.target} = ${formatOperand(instruction.value)}`;
    case 'copy':
      return `${instruction.target} = ${formatOperand(instruction.source)}`;
    case 'binary':
      return `${instruction.target} = ${formatOperand(instruction.left)} ${instruction.operator} ${formatOperand(instruction.right)}`;
    case 'unary':
      return `${instruction.target} = ${instruction.operator}${formatOperand(instruction.operand)}`;
    case 'label':
      return `${instruction.label}:`;
    case 'jumpIfFalse':
      return `ifFalse ${formatOperand(instruction.condition)} goto ${instruction.label}`;
    case 'jump':
      return `goto ${instruction.label}`;
    case 'call':
      return `${instruction.target} = call ${instruction.functionName}(${instruction.args.map(formatOperand).join(', ')})`;
    case 'param':
      return `param ${instruction.name}`;
    case 'functionBegin':
      return `function ${instruction.functionName}`;
    case 'functionEnd':
      return `endFunction ${instruction.functionName}`;
    case 'print':
      return `print ${formatOperand(instruction.operand)}`;
    case 'return':
      return `return ${formatOperand(instruction.operand)}`;
  }
}

/**
 * Render a whole TAC program as text, one instruction per line, in the exact
 * order the instructions execute.
 *
 * @example
 *   formatTAC(tac)
 *   // "t1 = b * 2\nt2 = a + t1\nc = t2"
 */
export function formatTAC(program: TACProgram): string {
  const main = program.instructions.map(formatInstruction).join('\n');
  const functions = Object.values(program.functions ?? {}).map(fn => {
    const header = `function ${fn.returnType} ${fn.name}(${fn.parameters.map(p => `${p.type} ${p.name}`).join(', ')})`;
    return [header, ...fn.instructions.map(formatInstruction), `endFunction ${fn.name}`].join('\n');
  });
  return [main, ...functions].filter(Boolean).join('\n\n');
}
