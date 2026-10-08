/**
 * TOKEN DEFINITIONS  --  MiniC v1
 * ================================
 *
 * COMPILER CONCEPT: A *token* is the smallest meaningful unit of a program.
 * The lexical analyser (scanner) turns a flat stream of characters into a
 * flat stream of tokens, so that the parser never has to look at individual
 * characters again.
 *
 *      "int a = 10;"   -->   [INT] [IDENTIFIER a] [ASSIGN] [NUMBER 10] [SEMICOLON]
 *
 * A token is normally described as a pair:
 *      < token-type , attribute-value >
 * The token TYPE is what the parser matches on (it is the terminal symbol of
 * the grammar). The attribute value is extra information the later stages
 * need -- for us, the numeric value of a literal and the name of an
 * identifier.
 */

/**
 * The complete set of terminal symbols in the current MiniC subset.
 *
 * String-valued enum (rather than the default numeric enum) so that a token
 * prints as "NUMBER" instead of "0" in the UI table, in test failures and in
 * the debugger. This costs nothing and makes the project far easier to
 * demonstrate.
 */
export enum TokenType {
  // --- Literals and names ---
  NUMBER = 'NUMBER', // integer literal, e.g. 10
  IDENTIFIER = 'IDENTIFIER', // variable name, e.g. a, count, x1

  // --- Keywords (MiniC v1 has exactly one) ---
  INT = 'INT', // the keyword `int`
  FLOAT = 'FLOAT', // the keyword `float`
  BOOL = 'BOOL', // the keyword `bool`
  TRUE = 'TRUE', // boolean literal `true`
  FALSE = 'FALSE', // boolean literal `false`
  PRINT = 'PRINT', // built-in statement `print`
  IF = 'IF', // keyword `if`
  ELSE = 'ELSE', // keyword `else`
  WHILE = 'WHILE', // keyword `while`
  RETURN = 'RETURN', // keyword `return`

  // --- Logical operators ---
  AND_AND = 'AND_AND', // &&
  OR_OR = 'OR_OR', // ||
  BANG = 'BANG', // !

  // --- Arithmetic operators ---
  PLUS = 'PLUS', // +
  MINUS = 'MINUS', // -   (both binary subtraction and unary negation)
  STAR = 'STAR', // *
  SLASH = 'SLASH', // /

  // --- Relational and equality operators ---
  LT = 'LT', // <
  GT = 'GT', // >
  LE = 'LE', // <=
  GE = 'GE', // >=
  EQ = 'EQ', // ==
  NE = 'NE', // !=

  // --- Assignment ---
  ASSIGN = 'ASSIGN', // =

  // --- Punctuation ---
  LPAREN = 'LPAREN', // (
  RPAREN = 'RPAREN', // )
  SEMICOLON = 'SEMICOLON', // ;
  LBRACE = 'LBRACE', // {
  RBRACE = 'RBRACE', // }
  COMMA = 'COMMA', // ,
  QUESTION = 'QUESTION', // ?
  COLON = 'COLON', // :

  // --- End of input ---
  // COMPILER CONCEPT: the scanner appends an explicit end-of-file token so the
  // parser can test for "end of input" the same way it tests for any other
  // token, instead of special-casing an empty array.
  EOF = 'EOF',
}

/**
 * A single token produced by the scanner.
 *
 * Every token records where it came from in the source text. Two different
 * position formats are kept on purpose:
 *
 *   line / column  - 1-based, human readable, used in error messages
 *                    ("line 3, column 9").
 *   start / end    - 0-based absolute character offsets, used by the UI to
 *                    highlight the exact source span when a token row is
 *                    hovered. `end` is exclusive, so source.slice(start, end)
 *                    is exactly the lexeme.
 */
export interface Token {
  /** Which terminal symbol this is. */
  readonly type: TokenType;
  /** The exact substring of the source that produced this token. */
  readonly lexeme: string;
  /** Attribute value. Present only for NUMBER tokens. */
  readonly value?: number;
  /** 1-based line number of the first character of the lexeme. */
  readonly line: number;
  /** 1-based column number of the first character of the lexeme. */
  readonly column: number;
  /** 0-based absolute offset of the first character (inclusive). */
  readonly start: number;
  /** 0-based absolute offset one past the last character (exclusive). */
  readonly end: number;
}

/**
 * KEYWORD TABLE
 *
 * COMPILER CONCEPT: keywords are *not* recognised by the character scanner
 * directly. The scanner first reads a complete identifier using the
 * "maximal munch" rule (consume the longest run of identifier characters),
 * and only then looks the finished lexeme up in this table.
 *
 * This is why `integer` lexes as ONE identifier and not as `int` followed by
 * `eger`. Doing it the other way round is a classic scanner bug.
 */
export const KEYWORDS: Readonly<Record<string, TokenType>> = {
  int: TokenType.INT,
  float: TokenType.FLOAT,
  bool: TokenType.BOOL,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
  print: TokenType.PRINT,
  if: TokenType.IF,
  else: TokenType.ELSE,
  while: TokenType.WHILE,
  return: TokenType.RETURN,
};

/**
 * Human-readable spelling of each token type, used in parser error messages
 * such as: expected ';' but found '='.
 */
export const TOKEN_DISPLAY: Readonly<Record<TokenType, string>> = {
  [TokenType.NUMBER]: 'number',
  [TokenType.IDENTIFIER]: 'identifier',
  [TokenType.INT]: "'int'",
  [TokenType.FLOAT]: "'float'",
  [TokenType.LT]: "'<'",
  [TokenType.GT]: "'>'",
  [TokenType.LE]: "'<='",
  [TokenType.GE]: "'>='",
  [TokenType.EQ]: "'=='",
  [TokenType.NE]: "'!='",
  [TokenType.BOOL]: "'bool'",
  [TokenType.TRUE]: "'true'",
  [TokenType.FALSE]: "'false'",
  [TokenType.PRINT]: "'print'",
  [TokenType.IF]: "'if'",
  [TokenType.ELSE]: "'else'",
  [TokenType.WHILE]: "'while'",
  [TokenType.RETURN]: "'return'",
  [TokenType.AND_AND]: '&&',
  [TokenType.OR_OR]: '||',
  [TokenType.BANG]: '!',
  [TokenType.PLUS]: "'+'",
  [TokenType.MINUS]: "'-'",
  [TokenType.STAR]: "'*'",
  [TokenType.SLASH]: "'/'",
  [TokenType.ASSIGN]: "'='",
  [TokenType.LPAREN]: "'('",
  [TokenType.RPAREN]: "')'",
  [TokenType.SEMICOLON]: "';'",
  [TokenType.LBRACE]: "'{'",
  [TokenType.RBRACE]: "'}'",
  [TokenType.QUESTION]: '?',
  [TokenType.COLON]: ':',
  [TokenType.COMMA]: "','",
  [TokenType.EOF]: 'end of file',
};

/** True for tokens that represent a binary or unary arithmetic operator. */
export function isOperator(type: TokenType): boolean {
  return (
    type === TokenType.PLUS ||
    type === TokenType.MINUS ||
    type === TokenType.STAR ||
    type === TokenType.SLASH ||
    type === TokenType.LT ||
    type === TokenType.GT ||
    type === TokenType.LE ||
    type === TokenType.GE ||
    type === TokenType.EQ ||
    type === TokenType.NE ||
    type === TokenType.AND_AND ||
    type === TokenType.OR_OR ||
    type === TokenType.BANG
  );
}
