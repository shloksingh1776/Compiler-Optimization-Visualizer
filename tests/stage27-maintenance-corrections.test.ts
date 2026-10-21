import { describe, expect, it } from 'vitest';
import { compile } from '../src/compiler/pipeline.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { getCompilerPipelineSteps } from '../src/components/pipelineUtils.ts';

describe('Stage 27.1 - maintenance corrections', () => {
  describe('global variables in functions', () => {
    it('allows a function to read a global variable', () => {
      const result = compile('int globalValue = 5; int readGlobal() { return globalValue; } print(readGlobal());');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['5']);
    });

    it('allows a function to update a global variable with compound assignment', () => {
      const result = compile('int counter = 1; void increment() { counter += 1; } increment(); print(counter);');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['2']);
    });

    it('persists global writes across multiple function calls', () => {
      const result = compile('int state = 2; void setState(int value) { state = value; } int getState() { return state; } setState(9); print(getState());');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['9']);
    });

    it('allows functions to refer to globals declared after the function definition', () => {
      const result = compile('int readGlobal() { return later; } int later = 5; print(readGlobal());');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['5']);
    });

    it('keeps a same-named local separate from the global', () => {
      const result = compile('int value = 10; int shadow() { int value = 20; return value; } print(shadow()); print(value);');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['20', '10']);
    });

    it('lets a parameter shadow a global without changing the global', () => {
      const result = compile('int value = 10; int shadow(int value) { value++; return value; } print(shadow(2)); print(value);');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['3', '10']);
    });

    it('resolves a local initializer against the global before declaring the local name', () => {
      const result = compile('int value = 10; int combine() { int previous = value; int value = 20; return previous + value; } print(combine()); print(value);');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['30', '10']);
    });

    it('does not let an uninitialized local silently read a same-named global', () => {
      const result = compile('int value = 10; int readLocal() { int value; return value; } print(readLocal());');
      expect(result.errors).toHaveLength(0);
      expect(result.runtimeError).toContain("Runtime value for 'value' is unavailable");
    });

    it('supports incrementing a global and preserves the change after optimization', () => {
      const result = compile('int count = 3; void increment() { count++; } increment(); increment(); print(count);');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['5']);
    });

    it('preserves a global value observed by a function between two main-program writes', () => {
      const result = compile([
        'int state = 0;',
        'void showState() { print(state); }',
        'state = 5;',
        'showState();',
        'state = 7;',
        'print(state);',
      ].join('\n'));
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['5', '7']);
    });

    it('keeps a global live across a branch when a called function can read it', () => {
      const result = compile([
        'int state = 0;',
        'void showState() { print(state); }',
        'int condition = 1;',
        'state = 5;',
        'if (condition > 0) { showState(); }',
        'state = 7;',
        'print(state);',
      ].join('\n'));
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['5', '7']);
      expect(formatTAC(result.optimizedTac!)).toContain('state = 5');
    });

    it('still removes an overwritten global assignment when no call can observe it', () => {
      const result = compile('int b = 1; int c = 2; int a; a = b + c; a = 20;');
      expect(result.errors).toHaveLength(0);
      expect(result.optimizedTac).not.toBeNull();
      expect(formatTAC(result.optimizedTac!)).toBe('b = 1\nc = 2\na = 20');
    });

    it('keeps global variables distinct from compiler temporaries with the same name', () => {
      const result = compile('int t1 = 5; int calculated = 2 + 3; int readGlobal() { return t1 + 1; } print(calculated); print(readGlobal()); print(t1);');
      expect(result.errors).toHaveLength(0);
      expect(result.output).toEqual(['5', '6', '5']);
    });
  });

  describe('compile-time division-by-zero precheck', () => {
    it('detects a known-zero divisor when the main program also contains control flow', () => {
      const result = compile('int divisor = 0; int quotient = 10 / divisor; if (true) { print(quotient); }');
      expect(result.divisionByZeroErrors.length).toBeGreaterThan(0);
      expect(result.stageStatus.optimization).toBe('error');
      expect(result.optimizedTac).toBeNull();
    });

    it('detects a known-zero divisor in a function body', () => {
      const result = compile('int calculate() { int divisor = 0; return 10 / divisor; } print(calculate());');
      expect(result.divisionByZeroErrors.length).toBeGreaterThan(0);
      expect(result.stageStatus.optimization).toBe('error');
    });

    it('detects a nested constant expression that folds to zero', () => {
      const result = compile('int quotient = 10 / (5 - 5); print(quotient);');
      expect(result.divisionByZeroErrors.length).toBeGreaterThan(0);
      expect(result.stageStatus.optimization).toBe('error');
    });

    it('does not infer constants across a branch boundary', () => {
      const result = compile('int divisor = 1; if (false) { divisor = 0; } print(10 / divisor);');
      expect(result.divisionByZeroErrors).toHaveLength(0);
      expect(result.output).toEqual(['10']);
    });
  });

  describe('pipeline execution status', () => {
    it('labels Output as not needed when no top-level instruction triggers execution', () => {
      const result = compile('int value = 1;');
      const outputStep = getCompilerPipelineSteps(result).find((step) => step.id === 'output');
      expect(result.executionStatus).toBe('not-needed');
      expect(outputStep?.state).toBe('not-needed');
    });

    it('does not execute an uncalled function solely because its body returns', () => {
      const result = compile('int unusedFunction() { return 1; }');
      const outputStep = getCompilerPipelineSteps(result).find((step) => step.id === 'output');
      expect(result.executionStatus).toBe('not-needed');
      expect(outputStep?.state).toBe('not-needed');
    });

    it('navigates the Output pipeline node to the return-value result when there is no print output', () => {
      const result = compile('return 7;');
      const outputStep = getCompilerPipelineSteps(result).find((step) => step.id === 'output');
      expect(result.returnValue).toBe(7);
      expect(outputStep?.targetId).toBe('return-value');
      expect(outputStep?.state).toBe('complete');
    });
  });
});
