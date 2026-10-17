import { describe, expect, it } from 'vitest';
import { tokenize, TokenType } from '../src/compiler/index.ts';
import {
  filterTokens,
  getTokenCategory,
  getTokenCategoryOptions,
  getTokenDisplayLexeme,
  sameTokenPosition,
  TOKEN_CATEGORIES,
} from '../src/components/tokenInspectorUtils.ts';
import {
  getMiniCSyntaxSegments,
  getTokenHighlightedSegments,
} from '../src/components/codeEditorUtils.ts';

const source = 'int count = 12;\nprint(count);';
const tokens = tokenize(source).tokens;

describe('Stage 25 - interactive token inspector', () => {
  it('uses actual lexer tokens whose offsets reproduce each lexeme', () => {
    for (const token of tokens) {
      expect(source.slice(token.start, token.end)).toBe(token.lexeme);
    }

    const countTokens = tokens.filter((token) => token.lexeme === 'count');
    expect(countTokens).toHaveLength(2);
    expect(countTokens.map(({ line, column }) => [line, column])).toEqual([[1, 5], [2, 7]]);
  });

  it('supports exact token-type filtering and preserves original stream indices', () => {
    const identifiers = filterTokens(tokens, TokenType.IDENTIFIER);
    expect(identifiers.map(({ token }) => token.lexeme)).toEqual(['count', 'count']);
    expect(identifiers.map(({ index }) => index)).toEqual(
      tokens.map((token, index) => ({ token, index }))
        .filter(({ token }) => token.type === TokenType.IDENTIFIER)
        .map(({ index }) => index),
    );
  });

  it('searches lexemes and exact token types without case sensitivity', () => {
    expect(filterTokens(tokens, 'ALL', 'COUNT').map(({ token }) => token.lexeme)).toEqual(['count', 'count']);
    expect(filterTokens(tokens, 'ALL', 'semicolon').map(({ token }) => token.type)).toEqual([TokenType.SEMICOLON, TokenType.SEMICOLON]);
  });

  it('groups related operator token types under shared UI categories', () => {
    const operatorSource = 'int x = 1 + 2 * 3 / 4 % 2; x += 1; x++; x--; if (x >= 2 && x != 3) { x = x - 1; } print(!false || true);';
    const operatorTokens = tokenize(operatorSource).tokens;

    expect(filterTokens(operatorTokens, TOKEN_CATEGORIES.ARITHMETIC_OPERATORS).map(({ token }) => token.lexeme))
      .toEqual(['+', '*', '/', '%', '++', '--', '-']);
    expect(filterTokens(operatorTokens, TOKEN_CATEGORIES.RELATIONAL_OPERATORS).map(({ token }) => token.lexeme))
      .toEqual(['>=', '!=']);
    expect(filterTokens(operatorTokens, TOKEN_CATEGORIES.LOGICAL_OPERATORS).map(({ token }) => token.lexeme))
      .toEqual(['&&', '!', '||']);
    expect(filterTokens(operatorTokens, TOKEN_CATEGORIES.ASSIGNMENT_OPERATORS).map(({ token }) => token.lexeme))
      .toEqual(['=', '+=', '=']);

    // The table keeps exact lexer token types even though the dropdown filters by category.
    expect(filterTokens(operatorTokens, TOKEN_CATEGORIES.ARITHMETIC_OPERATORS).map(({ token }) => token.type))
      .toEqual([TokenType.PLUS, TokenType.STAR, TokenType.SLASH, TokenType.PERCENT, TokenType.INCREMENT, TokenType.DECREMENT, TokenType.MINUS]);
  });

  it('provides stable category labels and counts from the real token stream', () => {
    const options = getTokenCategoryOptions(tokens);
    const identifiers = options.find(({ value }) => value === TOKEN_CATEGORIES.IDENTIFIERS);
    const numericConstants = options.find(({ value }) => value === TOKEN_CATEGORIES.NUMERIC_CONSTANTS);

    expect(identifiers).toMatchObject({ label: 'Identifiers', count: 2 });
    expect(numericConstants).toMatchObject({ label: 'Numeric constants', count: 1 });
    expect(getTokenCategory(TokenType.PLUS)).toBe(TOKEN_CATEGORIES.ARITHMETIC_OPERATORS);
    expect(getTokenCategory(TokenType.GE)).toBe(TOKEN_CATEGORIES.RELATIONAL_OPERATORS);
    expect(getTokenCategory(TokenType.AND_AND)).toBe(TOKEN_CATEGORIES.LOGICAL_OPERATORS);
    expect(getTokenCategory(TokenType.PLUS_ASSIGN)).toBe(TOKEN_CATEGORIES.ASSIGNMENT_OPERATORS);
    expect(getTokenCategory(TokenType.EOF)).toBe(TOKEN_CATEGORIES.END_OF_INPUT);
  });

  it('represents EOF without inventing a non-empty lexer lexeme', () => {
    const eof = tokens.find((token) => token.type === TokenType.EOF);
    expect(eof).toMatchObject({ lexeme: '', start: source.length, end: source.length });
    expect(getTokenDisplayLexeme(eof!)).toBe('⟨end of input⟩');
    expect(filterTokens(tokens, TokenType.EOF, 'end of input')).toHaveLength(1);
  });

  it('highlights only the selected token offsets and preserves the complete source text', () => {
    const selected = tokens.find((token) => token.lexeme === 'count')!;
    const segments = getMiniCSyntaxSegments(source);
    const highlighted = getTokenHighlightedSegments(segments, { start: selected.start, end: selected.end });

    expect(highlighted.map((segment) => segment.text).join('')).toBe(source);
    expect(highlighted.filter((segment) => segment.className.includes('syntax-token-selected'))
      .map((segment) => segment.text).join('')).toBe('count');
    expect(highlighted.filter((segment) => segment.className.includes('syntax-token-selected'))
      .every((segment) => segment.start >= selected.start && segment.end <= selected.end)).toBe(true);
  });

  it('does not paint a source range for the zero-length EOF token', () => {
    const eof = tokens.find((token) => token.type === TokenType.EOF)!;
    const highlighted = getTokenHighlightedSegments(getMiniCSyntaxSegments(source), { start: eof.start, end: eof.end });
    expect(highlighted.some((segment) => segment.className.includes('syntax-token-selected'))).toBe(false);
  });

  it('matches selected table rows by real token location and type', () => {
    const first = tokens.find((token) => token.lexeme === 'count')!;
    const second = tokens.filter((token) => token.lexeme === 'count')[1]!;
    expect(sameTokenPosition(first, first)).toBe(true);
    expect(sameTokenPosition(first, second)).toBe(false);
    expect(sameTokenPosition(null, first)).toBe(false);
  });
});
