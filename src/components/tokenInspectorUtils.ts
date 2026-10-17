import { TokenType, type Token } from '../compiler/index.ts';

export const ALL_TOKEN_FILTERS = 'ALL' as const;

/** Stable filter identifiers for groups of lexer token types. */
export const TOKEN_CATEGORIES = {
  KEYWORDS: 'CATEGORY:KEYWORDS',
  IDENTIFIERS: 'CATEGORY:IDENTIFIERS',
  NUMERIC_CONSTANTS: 'CATEGORY:NUMERIC_CONSTANTS',
  BOOLEAN_LITERALS: 'CATEGORY:BOOLEAN_LITERALS',
  ARITHMETIC_OPERATORS: 'CATEGORY:ARITHMETIC_OPERATORS',
  RELATIONAL_OPERATORS: 'CATEGORY:RELATIONAL_OPERATORS',
  LOGICAL_OPERATORS: 'CATEGORY:LOGICAL_OPERATORS',
  ASSIGNMENT_OPERATORS: 'CATEGORY:ASSIGNMENT_OPERATORS',
  PUNCTUATION: 'CATEGORY:PUNCTUATION',
  END_OF_INPUT: 'CATEGORY:END_OF_INPUT',
  OTHER: 'CATEGORY:OTHER',
} as const;

export type TokenCategory = (typeof TOKEN_CATEGORIES)[keyof typeof TOKEN_CATEGORIES];
export type TokenFilter = TokenType | TokenCategory | typeof ALL_TOKEN_FILTERS;

export interface TokenCategoryOption {
  value: TokenCategory;
  label: string;
  count: number;
}

export interface IndexedToken {
  token: Token;
  /** Zero-based position in the complete lexer stream, before filtering. */
  index: number;
}

const CATEGORY_LABELS: Readonly<Record<TokenCategory, string>> = {
  [TOKEN_CATEGORIES.KEYWORDS]: 'Keywords',
  [TOKEN_CATEGORIES.IDENTIFIERS]: 'Identifiers',
  [TOKEN_CATEGORIES.NUMERIC_CONSTANTS]: 'Numeric constants',
  [TOKEN_CATEGORIES.BOOLEAN_LITERALS]: 'Boolean literals',
  [TOKEN_CATEGORIES.ARITHMETIC_OPERATORS]: 'Arithmetic operators',
  [TOKEN_CATEGORIES.RELATIONAL_OPERATORS]: 'Relational operators',
  [TOKEN_CATEGORIES.LOGICAL_OPERATORS]: 'Logical operators',
  [TOKEN_CATEGORIES.ASSIGNMENT_OPERATORS]: 'Assignment operators',
  [TOKEN_CATEGORIES.PUNCTUATION]: 'Punctuation and delimiters',
  [TOKEN_CATEGORIES.END_OF_INPUT]: 'End of input',
  [TOKEN_CATEGORIES.OTHER]: 'Other tokens',
};

const CATEGORY_ORDER: readonly TokenCategory[] = [
  TOKEN_CATEGORIES.KEYWORDS,
  TOKEN_CATEGORIES.IDENTIFIERS,
  TOKEN_CATEGORIES.NUMERIC_CONSTANTS,
  TOKEN_CATEGORIES.BOOLEAN_LITERALS,
  TOKEN_CATEGORIES.ARITHMETIC_OPERATORS,
  TOKEN_CATEGORIES.RELATIONAL_OPERATORS,
  TOKEN_CATEGORIES.LOGICAL_OPERATORS,
  TOKEN_CATEGORIES.ASSIGNMENT_OPERATORS,
  TOKEN_CATEGORIES.PUNCTUATION,
  TOKEN_CATEGORIES.END_OF_INPUT,
  TOKEN_CATEGORIES.OTHER,
];

const KEYWORD_TYPES = new Set<TokenType>([
  TokenType.INT,
  TokenType.FLOAT,
  TokenType.BOOL,
  TokenType.VOID,
  TokenType.PRINT,
  TokenType.IF,
  TokenType.ELSE,
  TokenType.WHILE,
  TokenType.FOR,
  TokenType.RETURN,
  TokenType.BREAK,
  TokenType.CONTINUE,
  TokenType.SWITCH,
  TokenType.CASE,
  TokenType.DEFAULT,
]);

const ARITHMETIC_OPERATOR_TYPES = new Set<TokenType>([
  TokenType.PLUS,
  TokenType.MINUS,
  TokenType.STAR,
  TokenType.SLASH,
  TokenType.PERCENT,
  TokenType.INCREMENT,
  TokenType.DECREMENT,
]);

const RELATIONAL_OPERATOR_TYPES = new Set<TokenType>([
  TokenType.LT,
  TokenType.GT,
  TokenType.LE,
  TokenType.GE,
  TokenType.EQ,
  TokenType.NE,
]);

const LOGICAL_OPERATOR_TYPES = new Set<TokenType>([
  TokenType.AND_AND,
  TokenType.OR_OR,
  TokenType.BANG,
]);

const ASSIGNMENT_OPERATOR_TYPES = new Set<TokenType>([
  TokenType.ASSIGN,
  TokenType.PLUS_ASSIGN,
  TokenType.MINUS_ASSIGN,
  TokenType.STAR_ASSIGN,
  TokenType.SLASH_ASSIGN,
  TokenType.PERCENT_ASSIGN,
]);

const PUNCTUATION_TYPES = new Set<TokenType>([
  TokenType.LPAREN,
  TokenType.RPAREN,
  TokenType.SEMICOLON,
  TokenType.LBRACE,
  TokenType.RBRACE,
  TokenType.COMMA,
  TokenType.QUESTION,
  TokenType.COLON,
]);

const CATEGORY_VALUES = new Set<string>(Object.values(TOKEN_CATEGORIES));

export function getTokenCategory(type: TokenType): TokenCategory {
  if (KEYWORD_TYPES.has(type)) return TOKEN_CATEGORIES.KEYWORDS;
  if (type === TokenType.IDENTIFIER) return TOKEN_CATEGORIES.IDENTIFIERS;
  if (type === TokenType.NUMBER) return TOKEN_CATEGORIES.NUMERIC_CONSTANTS;
  if (type === TokenType.TRUE || type === TokenType.FALSE) return TOKEN_CATEGORIES.BOOLEAN_LITERALS;
  if (ARITHMETIC_OPERATOR_TYPES.has(type)) return TOKEN_CATEGORIES.ARITHMETIC_OPERATORS;
  if (RELATIONAL_OPERATOR_TYPES.has(type)) return TOKEN_CATEGORIES.RELATIONAL_OPERATORS;
  if (LOGICAL_OPERATOR_TYPES.has(type)) return TOKEN_CATEGORIES.LOGICAL_OPERATORS;
  if (ASSIGNMENT_OPERATOR_TYPES.has(type)) return TOKEN_CATEGORIES.ASSIGNMENT_OPERATORS;
  if (PUNCTUATION_TYPES.has(type)) return TOKEN_CATEGORIES.PUNCTUATION;
  if (type === TokenType.EOF) return TOKEN_CATEGORIES.END_OF_INPUT;

  // Keep future lexer additions visible without mislabelling them as punctuation.
  return TOKEN_CATEGORIES.OTHER;
}

export function getTokenCategoryLabel(category: TokenCategory): string {
  return CATEGORY_LABELS[category];
}

/** Returns categories in a stable teaching-friendly order, with counts from the actual lexer stream. */
export function getTokenCategoryOptions(tokens: readonly Token[]): TokenCategoryOption[] {
  const counts = new Map<TokenCategory, number>();
  for (const token of tokens) {
    const category = getTokenCategory(token.type);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return CATEGORY_ORDER
    .filter((category) => counts.has(category))
    .map((category) => ({
      value: category,
      label: CATEGORY_LABELS[category],
      count: counts.get(category) ?? 0,
    }));
}

/**
 * Filters the compiler's actual token stream without changing token positions
 * or re-tokenizing source. Search is case-insensitive and checks lexeme,
 * exact token type, category, numeric value, and source position. A raw
 * TokenType remains accepted for callers that need exact-type filtering.
 */
export function filterTokens(
  tokens: readonly Token[],
  filter: TokenFilter = ALL_TOKEN_FILTERS,
  query = '',
): IndexedToken[] {
  const normalizedQuery = query.trim().toLowerCase();
  const results: IndexedToken[] = [];
  const categoryFilter = CATEGORY_VALUES.has(filter) ? filter as TokenCategory : null;

  tokens.forEach((token, index) => {
    if (filter !== ALL_TOKEN_FILTERS) {
      if (categoryFilter !== null) {
        if (getTokenCategory(token.type) !== categoryFilter) return;
      } else if (token.type !== filter) {
        return;
      }
    }

    if (normalizedQuery) {
      const searchable = [
        token.lexeme,
        token.type,
        getTokenCategoryLabel(getTokenCategory(token.type)),
        token.value === undefined ? '' : String(token.value),
        String(token.line),
        String(token.column),
        token.type === TokenType.EOF ? 'end of input' : '',
      ].join(' ').toLowerCase();
      if (!searchable.includes(normalizedQuery)) return;
    }

    results.push({ token, index });
  });

  return results;
}

/** Text shown for an EOF token, whose true lexeme is intentionally empty. */
export function getTokenDisplayLexeme(token: Token): string {
  return token.type === TokenType.EOF ? '⟨end of input⟩' : token.lexeme;
}

/** Stable identity for matching a selected token against a current token row. */
export function sameTokenPosition(left: Token | null, right: Token): boolean {
  return left !== null && left.start === right.start && left.end === right.end && left.type === right.type;
}
