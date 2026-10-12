# Stage 3 — Professional Source Code Editor

## Changes
- Replaced the plain source `<textarea>` presentation with a lightweight `CodeEditor` component, retaining a real editable textarea so normal editing and clipboard behavior continue to work.
- Added syntax highlighting for MiniC types, keywords, boolean literals, numbers, function-like identifiers, operators, punctuation, and `//` comments.
- Added line numbers synchronized with vertical scrolling and a code mirror synchronized with both horizontal and vertical scrolling.
- Added two-space indentation with Tab, dedentation with Shift+Tab, multi-line selection indentation, and indentation continuation on Enter (including an extra indentation level after `{`).
- Added matching-bracket highlighting for parentheses, braces, and brackets, while ignoring brackets inside `//` comments.
- Kept the compiler pipeline and compilation semantics unchanged. No new runtime or editor dependencies were added.
- Added focused utility tests in `tests/stage23-code-editor.test.ts`.

## Files changed
- `src/App.tsx` — wires the new editor into the existing source panel.
- `src/components/CodeEditor.tsx` — editor UI and keyboard/scroll behavior.
- `src/components/codeEditorUtils.ts` — syntax segments, bracket matching, and indentation helpers.
- `src/index.css` — editor layout and syntax colors.
- `tests/stage23-code-editor.test.ts` — tests for source-preserving token highlighting, bracket matching, and indentation.
- `README.md` — documents the editor capabilities.
