/**
 * Small, dependency-free syntax highlighter helpers for the MiniC editor.
 * These functions affect presentation only; the real lexer remains the source
 * of truth for compiler tokens and diagnostics.
 */

export interface SyntaxSegment {
  text: string;
  className: string;
  start: number;
  end: number;
}

export interface MatchingBracketOffsets {
  active: number;
  matching: number;
}

const TYPE_KEYWORDS = new Set(['int', 'float', 'bool', 'void']);
const LITERAL_KEYWORDS = new Set(['true', 'false']);
const KEYWORDS = new Set([
  'print',
  'if',
  'else',
  'while',
  'for',
  'return',
  'break',
  'continue',
  'switch',
  'case',
  'default',
]);
const OPERATORS = [
  '++', '--', '+=', '-=', '*=', '/=', '%=', '<=', '>=', '==', '!=', '&&', '||',
  '+', '-', '*', '/', '%', '<', '>', '=', '!',
];
const OPEN_TO_CLOSE: Readonly<Record<string, string>> = {
  '(': ')',
  '{': '}',
  '[': ']',
};
const CLOSE_TO_OPEN: Readonly<Record<string, string>> = {
  ')': '(',
  '}': '{',
  ']': '[',
};
const BRACKETS = new Set([...Object.keys(OPEN_TO_CLOSE), ...Object.keys(CLOSE_TO_OPEN)]);

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character);
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && /[0-9]/.test(character);
}

/**
 * Returns the bracket under the caret (or immediately before it) and its
 * matching partner. Brackets inside // comments are ignored. Unmatched or
 * commented brackets do not produce a match.
 */
export function getMatchingBracketOffsets(
  source: string,
  caretIndex: number,
): MatchingBracketOffsets | null {
  const candidate = BRACKETS.has(source[caretIndex] ?? '')
    ? caretIndex
    : BRACKETS.has(source[caretIndex - 1] ?? '')
      ? caretIndex - 1
      : -1;

  if (candidate < 0) return null;

  const matches = new Map<number, number>();
  const stack: Array<{ character: string; index: number }> = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    const character = source[index];
    if (character && OPEN_TO_CLOSE[character]) {
      stack.push({ character, index });
    } else if (character && CLOSE_TO_OPEN[character]) {
      const last = stack[stack.length - 1];
      if (last && last.character === CLOSE_TO_OPEN[character]) {
        stack.pop();
        matches.set(last.index, index);
        matches.set(index, last.index);
      }
    }
    index += 1;
  }

  const matching = matches.get(candidate);
  return matching === undefined ? null : { active: candidate, matching };
}


export interface IndentationEdit {
  source: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Indents the selected lines, or the current line when there is no selection. */
export function adjustSourceIndentation(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  outdent = false,
): IndentationEdit {
  const indent = '  ';
  const firstLineStart = source.lastIndexOf('\n', selectionStart - 1) + 1;

  if (selectionStart === selectionEnd) {
    if (!outdent) {
      return {
        source: source.slice(0, selectionStart) + indent + source.slice(selectionEnd),
        selectionStart: selectionStart + indent.length,
        selectionEnd: selectionStart + indent.length,
      };
    }

    const lineEnd = source.indexOf('\n', firstLineStart);
    const currentLine = source.slice(firstLineStart, lineEnd < 0 ? source.length : lineEnd);
    const removed = currentLine.startsWith('\t') ? 1 : currentLine.startsWith(indent) ? 2 : currentLine.startsWith(' ') ? 1 : 0;
    if (removed === 0) return { source, selectionStart, selectionEnd };
    const nextSource = source.slice(0, firstLineStart) + source.slice(firstLineStart + removed);
    const nextCaret = Math.max(firstLineStart, selectionStart - removed);
    return { source: nextSource, selectionStart: nextCaret, selectionEnd: nextCaret };
  }

  // If a selection ends exactly at the next line's start, do not indent that
  // unselected line as most source editors do.
  const lastSelectedPosition = source[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd;
  const lastLineStart = source.lastIndexOf('\n', Math.max(firstLineStart, lastSelectedPosition - 1)) + 1;
  const blockEndFound = source.indexOf('\n', lastLineStart);
  const blockEnd = blockEndFound < 0 ? source.length : blockEndFound;
  const selectedLines = source.slice(firstLineStart, blockEnd).split('\n');
  const deltas: number[] = [];
  const adjustedLines = selectedLines.map((line) => {
    if (!outdent) {
      deltas.push(indent.length);
      return indent + line;
    }
    const removed = line.startsWith('\t') ? 1 : line.startsWith(indent) ? 2 : line.startsWith(' ') ? 1 : 0;
    deltas.push(-removed);
    return line.slice(removed);
  });
  const replacement = adjustedLines.join('\n');
  const nextSource = source.slice(0, firstLineStart) + replacement + source.slice(blockEnd);
  let endDelta = 0;
  let lineStart = firstLineStart;
  for (let lineIndex = 0; lineIndex < deltas.length; lineIndex += 1) {
    if (lineStart < selectionEnd) endDelta += deltas[lineIndex] ?? 0;
    lineStart += (selectedLines[lineIndex] ?? '').length + 1;
  }

  // Keep a selection starting at the line boundary inclusive of the inserted
  // indentation; move it only when it began within the line's existing text.
  const nextSelectionStart = selectionStart === firstLineStart
    ? firstLineStart
    : Math.max(firstLineStart, selectionStart + (deltas[0] ?? 0));
  const nextSelectionEnd = Math.max(nextSelectionStart, selectionEnd + endDelta);
  return { source: nextSource, selectionStart: nextSelectionStart, selectionEnd: nextSelectionEnd };
}

/**
 * Splits source into presentation-only syntax segments while preserving every
 * character and its absolute source offsets. This does not validate MiniC.
 */
export function getMiniCSyntaxSegments(
  source: string,
  matchingBrackets: MatchingBracketOffsets | null = null,
): SyntaxSegment[] {
  const segments: SyntaxSegment[] = [];
  let index = 0;

  const push = (start: number, end: number, className: string) => {
    if (end > start) segments.push({ text: source.slice(start, end), className, start, end });
  };

  while (index < source.length) {
    const start = index;
    const character = source[index] ?? '';

    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      push(start, index, 'syntax-comment');
      continue;
    }

    if (/\s/.test(character)) {
      index += 1;
      while (index < source.length && /\s/.test(source[index] ?? '')) index += 1;
      push(start, index, 'syntax-whitespace');
      continue;
    }

    if (isIdentifierStart(character)) {
      index += 1;
      while (isIdentifierPart(source[index])) index += 1;
      const identifier = source.slice(start, index);
      let className = 'syntax-identifier';

      if (TYPE_KEYWORDS.has(identifier)) className = 'syntax-type';
      else if (LITERAL_KEYWORDS.has(identifier)) className = 'syntax-literal';
      else if (KEYWORDS.has(identifier)) className = 'syntax-keyword';
      else {
        let next = index;
        while (next < source.length && /\s/.test(source[next] ?? '')) next += 1;
        if (source[next] === '(') className = 'syntax-function';
      }

      push(start, index, className);
      continue;
    }

    if (isDigit(character)) {
      index += 1;
      while (isDigit(source[index])) index += 1;
      if (source[index] === '.' && isDigit(source[index + 1])) {
        index += 1;
        while (isDigit(source[index])) index += 1;
      }
      push(start, index, 'syntax-number');
      continue;
    }

    if (BRACKETS.has(character)) {
      index += 1;
      const isMatch = matchingBrackets !== null &&
        (start === matchingBrackets.active || start === matchingBrackets.matching);
      push(start, index, isMatch ? 'syntax-bracket-match' : 'syntax-punctuation');
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      index += operator.length;
      push(start, index, 'syntax-operator');
      continue;
    }

    if (';,?:'.includes(character)) {
      index += 1;
      push(start, index, 'syntax-punctuation');
      continue;
    }

    index += 1;
    push(start, index, 'syntax-plain');
  }

  return segments;
}

/**
 * Splits syntax segments at a selected token range so the editor's display
 * layer can highlight the exact lexer-provided source span without changing
 * a single source character.
 */
export function getTokenHighlightedSegments(
  segments: readonly SyntaxSegment[],
  selectedRange: { start: number; end: number } | null,
  highlightClassName = 'syntax-token-selected',
): SyntaxSegment[] {
  if (!selectedRange || selectedRange.end <= selectedRange.start) return [...segments];

  const highlighted: SyntaxSegment[] = [];
  for (const segment of segments) {
    const overlapStart = Math.max(segment.start, selectedRange.start);
    const overlapEnd = Math.min(segment.end, selectedRange.end);

    if (overlapStart >= overlapEnd) {
      highlighted.push(segment);
      continue;
    }

    if (segment.start < overlapStart) {
      highlighted.push({
        text: segment.text.slice(0, overlapStart - segment.start),
        className: segment.className,
        start: segment.start,
        end: overlapStart,
      });
    }

    highlighted.push({
      text: segment.text.slice(overlapStart - segment.start, overlapEnd - segment.start),
      className: `${segment.className} ${highlightClassName}`, 
      start: overlapStart,
      end: overlapEnd,
    });

    if (overlapEnd < segment.end) {
      highlighted.push({
        text: segment.text.slice(overlapEnd - segment.start),
        className: segment.className,
        start: overlapEnd,
        end: segment.end,
      });
    }
  }

  return highlighted;
}


export interface SourceNavigationRange {
  start: number;
  end: number;
}

export interface SourceNavigationResult extends SourceNavigationRange {
  scrollTop: number;
  scrollLeft: number;
}

/**
 * Navigate to a genuine source span in the editor.
 *
 * `scrollIntoView` moves the document viewport back to the editor when the
 * user clicked a diagnostic near the bottom of the page. The textarea is then
 * focused without overriding that document scroll, and its own scroll position
 * is adjusted so the reported source line is visible inside the editor.
 */
export function navigateEditorToSourceRange(
  textarea: HTMLTextAreaElement,
  source: string,
  range: SourceNavigationRange,
): SourceNavigationResult {
  const start = Math.max(0, Math.min(range.start, source.length));
  const end = Math.max(start, Math.min(range.end, source.length));

  textarea.closest('.code-editor')?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest',
  });
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);

  const lineIndex = source.slice(0, start).split('\n').length - 1;
  const lineHeight = 24;
  const verticalPadding = 12;
  const lineTop = verticalPadding + lineIndex * lineHeight;
  const currentTop = textarea.scrollTop;
  const visibleBottom = currentTop + textarea.clientHeight;
  let targetTop = currentTop;

  if (lineTop < currentTop + verticalPadding) {
    targetTop = lineTop - verticalPadding;
  } else if (lineTop + lineHeight > visibleBottom - verticalPadding) {
    targetTop = lineTop + lineHeight - textarea.clientHeight + verticalPadding;
  }

  const maxScrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
  textarea.scrollTop = Math.max(0, Math.min(targetTop, maxScrollTop));

  return {
    start,
    end,
    scrollTop: textarea.scrollTop,
    scrollLeft: textarea.scrollLeft,
  };
}
