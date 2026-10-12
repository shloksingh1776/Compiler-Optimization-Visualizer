import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react';
import { adjustSourceIndentation, getMatchingBracketOffsets, getMiniCSyntaxSegments } from './codeEditorUtils.ts';

interface CodeEditorProps {
  source: string;
  onChange: (source: string) => void;
  ariaLabel?: string;
}

/** A lightweight, dependency-free MiniC editor with a highlighted mirror. */
export default function CodeEditor({
  source,
  onChange,
  ariaLabel = 'MiniC source code editor',
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previousSourceRef = useRef(source);
  const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });
  const [caretIndex, setCaretIndex] = useState(0);

  // Example selection updates the controlled source from outside the editor.
  // Reset the caret and scroll when that happens outside a typing interaction.
  useEffect(() => {
    if (previousSourceRef.current === source) return;
    previousSourceRef.current = source;
    const textarea = textareaRef.current;
    if (textarea && !textarea.matches(':focus')) {
      setCaretIndex(0);
      textarea.setSelectionRange(0, 0);
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
      setScrollOffset({ top: 0, left: 0 });
      return;
    }
    setCaretIndex((current) => Math.min(current, source.length));
  }, [source]);
  const matchingBrackets = useMemo(
    () => getMatchingBracketOffsets(source, caretIndex),
    [source, caretIndex],
  );
  const syntaxSegments = useMemo(
    () => getMiniCSyntaxSegments(source, matchingBrackets),
    [source, matchingBrackets],
  );
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(1, source.split('\n').length) }, (_, index) => index + 1),
    [source],
  );

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget;
    setScrollOffset((previous) =>
      previous.top === scrollTop && previous.left === scrollLeft
        ? previous
        : { top: scrollTop, left: scrollLeft },
    );
  };

  const updateCaret = () => {
    const textarea = textareaRef.current;
    if (textarea) setCaretIndex(textarea.selectionStart);
  };

  const updateSourceAndSelection = (nextSource: string, selectionStart: number, selectionEnd: number) => {
    setCaretIndex(selectionEnd);
    onChange(nextSource);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const updateSourceAndCaret = (nextSource: string, nextCaret: number) => {
    updateSourceAndSelection(nextSource, nextCaret, nextCaret);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (event.key === 'Tab') {
      event.preventDefault();
      const edit = adjustSourceIndentation(source, start, end, event.shiftKey);
      updateSourceAndSelection(edit.source, edit.selectionStart, edit.selectionEnd);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      const textBeforeCaret = source.slice(lineStart, start);
      const indentation = textBeforeCaret.match(/^[\t ]*/)?.[0] ?? '';
      const addIndent = textBeforeCaret.trimEnd().endsWith('{') ? '  ' : '';
      const insertion = `\n${indentation}${addIndent}`;
      const nextSource = source.slice(0, start) + insertion + source.slice(end);
      updateSourceAndCaret(nextSource, start + insertion.length);
    }
  };

  return (
    <div className="code-editor" data-testid="code-editor">
      <div className="code-editor__gutter" aria-hidden="true">
        <div
          className="code-editor__gutter-inner"
          style={{ transform: `translateY(${-scrollOffset.top}px)` }}
        >
          {lineNumbers.map((line) => (
            <span className="code-editor__line-number" key={line}>{line}</span>
          ))}
        </div>
      </div>
      <div className="code-editor__viewport">
        <pre
          className="code-editor__highlight"
          aria-hidden="true"
          style={{ transform: `translate(${-scrollOffset.left}px, ${-scrollOffset.top}px)` }}
        >
          {syntaxSegments.map((segment) => (
            <span className={segment.className} key={`${segment.start}:${segment.end}`}>
              {segment.text}
            </span>
          ))}
        </pre>
        <textarea
          ref={textareaRef}
          value={source}
          onChange={(event) => {
            setCaretIndex(event.currentTarget.selectionStart);
            onChange(event.currentTarget.value);
          }}
          onClick={updateCaret}
          onKeyUp={updateCaret}
          onSelect={updateCaret}
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          aria-label={ariaLabel}
          aria-multiline="true"
          className="code-editor__input"
        />
      </div>
    </div>
  );
}
