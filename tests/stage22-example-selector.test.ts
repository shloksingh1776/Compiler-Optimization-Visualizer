import { describe, expect, it } from 'vitest';
import { DEFAULT_SAMPLE, SAMPLES } from '../src/examples/samples.ts';

describe('Stage 22 - example program selector', () => {
  it('provides unique sample ids and a valid default sample', () => {
    const ids = SAMPLES.map((sample) => sample.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SAMPLES).toContain(DEFAULT_SAMPLE);
  });

  it('assigns every example to a non-empty category and description', () => {
    for (const sample of SAMPLES) {
      expect(sample.category.trim().length, sample.id).toBeGreaterThan(0);
      expect(sample.description.trim().length, sample.id).toBeGreaterThan(0);
    }
  });

  it('keeps every loaded example source free of line and block comments', () => {
    for (const sample of SAMPLES) {
      expect(sample.source, sample.id).not.toMatch(/(^|\n)\s*\/\//);
      expect(sample.source, sample.id).not.toMatch(/\/\*|\*\//);
      expect(sample.source, sample.id).not.toMatch(/\s\/\/.*$/m);
    }
  });
});

it('covers the major implemented language and optimization features', () => {
  expect(SAMPLES.length).toBeGreaterThanOrEqual(40);
  const ids = new Set(SAMPLES.map((sample) => sample.id));
  for (const id of [
    'constant-folding',
    'constant-propagation',
    'algebraic',
    'dead-code',
    'bool-comparisons',
    'logical',
    'ternary',
    'increment-decrement',
    'compound-assignment',
    'while',
    'for-basic',
    'break-continue',
    'switch-fallthrough',
    'void-function',
    'function-control-flow',
    'function-switch',
    'division-zero-error',
    'duplicate-case-error',
    'combined-control-flow',
  ]) {
    expect(ids.has(id), `missing example: ${id}`).toBe(true);
  }
});

it('includes examples in each selector category', () => {
  const categories = new Set(SAMPLES.map((sample) => sample.category));
  for (const category of [
    'Optimization',
    'Types and Expressions',
    'Control Flow',
    'Functions',
    'Diagnostics',
    'Combined Programs',
  ]) {
    expect(categories.has(category), `missing category: ${category}`).toBe(true);
  }
});
