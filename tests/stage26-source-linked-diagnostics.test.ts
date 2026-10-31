import { describe, expect, it, vi } from 'vitest';
import { compile, type CompilerError } from '../src/compiler/index.ts';
import { getMiniCSyntaxSegments, getTokenHighlightedSegments, navigateEditorToSourceRange } from '../src/components/codeEditorUtils.ts';
import {
  formatDiagnosticLocation,
  getDiagnosticPhaseLabel,
  getDiagnosticSourceRange,
} from '../src/components/diagnosticUtils.ts';

function diagnostic(overrides: Partial<CompilerError> = {}): CompilerError {
  return {
    stage: 'syntax',
    severity: 'error',
    message: 'Unexpected token',
    line: 2,
    column: 4,
    start: 7,
    end: 8,
    ...overrides,
  };
}

describe('Stage 26 - source-linked diagnostics', () => {
  it('scrolls the document back to the editor and the editor to the selected source line', () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const setSelectionRange = vi.fn();
    const fakeTextarea = {
      closest: vi.fn(() => ({ scrollIntoView })),
      focus,
      setSelectionRange,
      scrollTop: 0,
      scrollLeft: 0,
      clientHeight: 100,
      scrollHeight: 1200,
    } as unknown as HTMLTextAreaElement;
    const source = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
    const start = source.indexOf('line 31');

    const result = navigateEditorToSourceRange(fakeTextarea, source, { start, end: start + 7 });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(setSelectionRange).toHaveBeenCalledWith(start, start + 7);
    expect(fakeTextarea.scrollTop).toBeGreaterThan(0);
    expect(result).toMatchObject({ start, end: start + 7, scrollTop: fakeTextarea.scrollTop });
  });

  it('uses only an in-bounds compiler-reported source range', () => {
    expect(getDiagnosticSourceRange(diagnostic(), 12)).toEqual({ start: 7, end: 8 });
    expect(getDiagnosticSourceRange(diagnostic({ start: -1 }), 12)).toBeNull();
    expect(getDiagnosticSourceRange(diagnostic({ start: 8, end: 7 }), 12)).toBeNull();
    expect(getDiagnosticSourceRange(diagnostic({ end: 13 }), 12)).toBeNull();
    expect(getDiagnosticSourceRange(diagnostic({ start: 1.5 }), 12)).toBeNull();
  });

  it('preserves a zero-length EOF span as a caret location', () => {
    expect(getDiagnosticSourceRange(diagnostic({ start: 12, end: 12 }), 12)).toEqual({ start: 12, end: 12 });
  });

  it('uses a distinct diagnostic highlight class while preserving every source character', () => {
    const source = 'int value = missing;';
    const result = compile(source);
    const error = result.semanticErrors[0]!;
    const range = getDiagnosticSourceRange(error, source.length)!;
    const highlighted = getTokenHighlightedSegments(
      getMiniCSyntaxSegments(source),
      range,
      'syntax-diagnostic-selected',
    );

    expect(highlighted.map((segment) => segment.text).join('')).toBe(source);
    expect(highlighted.filter((segment) => segment.className.includes('syntax-diagnostic-selected'))
      .map((segment) => segment.text).join('')).toBe('missing');
  });

  it('formats existing one-based line and column positions without guessing', () => {
    expect(formatDiagnosticLocation(diagnostic())).toBe('Line 2, column 4');
    expect(formatDiagnosticLocation(diagnostic({ line: 3, column: 0 }))).toBe('Line 3');
    expect(formatDiagnosticLocation(diagnostic({ line: 0, column: 0 }))).toBe('Source location unavailable');
  });

  it('maps compiler phases to human-readable diagnostic labels', () => {
    expect(getDiagnosticPhaseLabel('lexical')).toBe('Lexical analysis');
    expect(getDiagnosticPhaseLabel('syntax')).toBe('Syntax analysis');
    expect(getDiagnosticPhaseLabel('semantic')).toBe('Semantic analysis');
    expect(getDiagnosticPhaseLabel('optimizer')).toBe('Compile-time optimization check');
    expect(getDiagnosticPhaseLabel('runtime')).toBe('Runtime execution');
  });

  it('retains genuine source spans for lexical errors', () => {
    const source = 'int value = @;';
    const result = compile(source);
    expect(result.lexicalErrors.length).toBeGreaterThan(0);
    const error = result.lexicalErrors[0]!;
    expect(getDiagnosticSourceRange(error, source.length)).toEqual({ start: source.indexOf('@'), end: source.indexOf('@') + 1 });
    expect(source.slice(error.start, error.end)).toBe('@');
  });

  it('retains genuine source spans for syntax errors', () => {
    const source = 'int value = ;';
    const result = compile(source);
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
    const error = result.syntaxErrors[0]!;
    expect(getDiagnosticSourceRange(error, source.length)).not.toBeNull();
    expect(source.slice(error.start, error.end)).toBe(';');
  });

  it('retains genuine source spans for semantic errors', () => {
    const source = 'int value = missing;';
    const result = compile(source);
    expect(result.semanticErrors.length).toBeGreaterThan(0);
    const error = result.semanticErrors[0]!;
    expect(getDiagnosticSourceRange(error, source.length)).not.toBeNull();
    expect(source.slice(error.start, error.end)).toBe('missing');
  });

  it('retains genuine source ranges for compile-time division-by-zero diagnostics', () => {
    const source = 'int value = 10 / 0;';
    const result = compile(source);
    expect(result.divisionByZeroErrors).toHaveLength(1);
    const error = result.divisionByZeroErrors[0]!;
    expect(getDiagnosticSourceRange(error, source.length)).not.toBeNull();
    expect(error.line).toBe(1);
    expect(error.column).toBeGreaterThan(0);
  });

  it('links a runtime failure to the actual source statement when TAC provenance is available', () => {
    const source = 'int value;\nprint(value);';
    const result = compile(source);
    expect(result.runtimeError).toContain('Runtime value');
    expect(result.runtimeDiagnostic?.stage).toBe('runtime');
    expect(result.runtimeDiagnostic).toBeDefined();
    const range = getDiagnosticSourceRange(result.runtimeDiagnostic!, source.length);
    expect(range).toEqual({ start: source.indexOf('print(value);'), end: source.indexOf('print(value);') + 'print(value);'.length });
    expect(source.slice(range!.start, range!.end)).toBe('print(value);');
    expect(formatDiagnosticLocation(result.runtimeDiagnostic!)).toBe('Line 2, column 1');
  });

  it('links a runtime error inside a called function to the failing expression, not only the call site', () => {
    const source = 'int divide(int n) { return 10 / n; }\nprint(divide(0));';
    const result = compile(source);
    expect(result.runtimeError).toBe('Runtime division by zero');
    expect(result.runtimeDiagnostic?.stage).toBe('runtime');
    expect(source.slice(result.runtimeDiagnostic!.start, result.runtimeDiagnostic!.end)).toBe('10 / n');
    expect(result.runtimeDiagnostic!.line).toBe(1);
  });

});
