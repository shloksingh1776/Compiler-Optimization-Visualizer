import { describe, expect, it } from 'vitest';
import { adjustSourceIndentation, getMatchingBracketOffsets, getMiniCSyntaxSegments } from '../src/components/codeEditorUtils.ts';

describe('Stage 23 - professional source editor helpers', () => {
  it('preserves every source character while creating syntax segments', () => {
    const source = 'int main() {\n  float value = 12.5;\n  print(value + 2);\n}\n';
    const segments = getMiniCSyntaxSegments(source);
    expect(segments.map((segment) => segment.text).join('')).toBe(source);
    expect(segments[0]).toMatchObject({ text: 'int', className: 'syntax-type', start: 0, end: 3 });
    expect(segments.some((segment) => segment.text === 'main' && segment.className === 'syntax-function')).toBe(true);
    expect(segments.some((segment) => segment.text === '12.5' && segment.className === 'syntax-number')).toBe(true);
    expect(segments.some((segment) => segment.text === '+' && segment.className === 'syntax-operator')).toBe(true);
  });

  it('highlights MiniC keywords, literals, operators, and comments separately', () => {
    const segments = getMiniCSyntaxSegments('if (ready && true) return 4; // note');
    expect(segments.some((segment) => segment.text === 'if' && segment.className === 'syntax-keyword')).toBe(true);
    expect(segments.some((segment) => segment.text === 'true' && segment.className === 'syntax-literal')).toBe(true);
    expect(segments.some((segment) => segment.text === '&&' && segment.className === 'syntax-operator')).toBe(true);
    expect(segments.some((segment) => segment.text === '// note' && segment.className === 'syntax-comment')).toBe(true);
  });

  it('finds nested matching brackets when the caret is on or just after a bracket', () => {
    const source = 'int main() { print((2 + 3)); }';
    const opening = source.indexOf('(');
    const match = getMatchingBracketOffsets(source, opening);
    expect(match).toEqual({ active: opening, matching: source.indexOf(')', opening) });

    const innerOpening = source.indexOf('(2');
    const innerMatch = getMatchingBracketOffsets(source, innerOpening);
    expect(innerMatch).toEqual({ active: innerOpening, matching: source.indexOf(')', innerOpening) });

    const closing = source.lastIndexOf('}');
    expect(getMatchingBracketOffsets(source, closing + 1)).toEqual({
      active: closing,
      matching: source.indexOf('{'),
    });
  });

  it('ignores brackets inside line comments and reports no match for unmatched brackets', () => {
    const commented = 'int main() { // } )\n  print(1);\n}';
    const commentBrace = commented.indexOf('}');
    expect(getMatchingBracketOffsets(commented, commentBrace)).toBeNull();

    const incomplete = 'int main() { print(1; }';
    expect(getMatchingBracketOffsets(incomplete, incomplete.indexOf('(', incomplete.indexOf('print')))).toBeNull();
  });

  it('marks both the active bracket and its partner in the highlighted segments', () => {
    const source = 'print(1);';
    const match = getMatchingBracketOffsets(source, source.indexOf('('));
    const segments = getMiniCSyntaxSegments(source, match);
    expect(segments.filter((segment) => segment.className === 'syntax-bracket-match').map((segment) => segment.text))
      .toEqual(['(', ')']);
  });
});


describe('editor indentation', () => {
  it('inserts indentation at the caret and outdents the current line with Shift+Tab', () => {
    expect(adjustSourceIndentation('int main() {}', 11, 11)).toMatchObject({
      source: 'int main()   {}',
      selectionStart: 13,
      selectionEnd: 13,
    });
    expect(adjustSourceIndentation('  print(1);', 5, 5, true)).toMatchObject({
      source: 'print(1);',
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it('indents selected lines without replacing their contents', () => {
    const source = 'int a;\nprint(a);\nreturn a;';
    const edit = adjustSourceIndentation(source, 0, source.length);
    expect(edit.source).toBe('  int a;\n  print(a);\n  return a;');
    expect(edit.source.slice(edit.selectionStart, edit.selectionEnd)).toBe(edit.source);
  });
});
