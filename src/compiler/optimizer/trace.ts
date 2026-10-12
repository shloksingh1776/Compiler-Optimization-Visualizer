import type { TACProgram } from '../ir/tac.ts';

export interface OptimizationTraceStep {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tac: TACProgram;
  /** False when the existing optimizer deliberately skipped this pass for the current program. */
  readonly applied: boolean;
  readonly note?: string;
}

export interface OptimizationTrace {
  readonly steps: readonly OptimizationTraceStep[];
}

export function createOptimizationTraceStep(
  id: string,
  name: string,
  description: string,
  tac: TACProgram,
  applied = true,
  note?: string,
): OptimizationTraceStep {
  return { id, name, description, tac, applied, ...(note ? { note } : {}) };
}
