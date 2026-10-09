/**
 * TESTS FOR PHASE 1: LEXICAL ANALYSIS
 *
 * These tests are written against the public `tokenize` function only, so the
 * internals of the scanner can be refactored without rewriting the tests.
 *
 * Run them with: npm test
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { TokenType, type Token } from '../src/compiler/lexer/tokens.ts';

/** Extract just the token types, which is what most assertions care about. */
function types(source: string): TokenType[] {
  return tokenize(source).tokens.map((t) => t.type);
}

/** Fetch a token by index. Keeps `noUncheckedIndexedAccess` happy in tests. */
function at(tokens: readonly Token[], index: number): Token {
  const token = tokens[index];
  if (token === undefined) {
    throw new Error(`No token at index ${index} (only ${tokens.length} tokens)`);
  }
  return token;
}


describe('lexer: floating-point literals and keyword', () => {
  it('recognizes float keyword and decimal literals', () => {
    const result = tokenize('float x = 10.5;');
    expect(result.errors).toHaveLength(0);
    expect(result.tokens.map((t) => t.type)).toEqual([
      TokenType.FLOAT, TokenType.IDENTIFIER, TokenType.ASSIGN, TokenType.NUMBER, TokenType.SEMICOLON, TokenType.EOF
    ]);
    expect(result.tokens[3]?.value).toBe(10.5);
  });

  it('rejects a floating literal without digits after the decimal point', () => {
    const result = tokenize('float x = 10.;');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('Malformed floating-point number');
  });
});

/* ------------------------------------------------------------------ */

describe('lexer: basic token recognition', () => {
  it('tokenizes a simple declaration', () => {
    expect(types('int a = 10;')).toEqual([
      TokenType.INT,
      TokenType.IDENTIFIER,
      TokenType.ASSIGN,
      TokenType.NUMBER,
      TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('recognizes every operator and punctuation symbol', () => {
    expect(types('+ - * / = ( ) ;')).toEqual([
      TokenType.PLUS,
      TokenType.MINUS,
      TokenType.STAR,
      TokenType.SLASH,
      TokenType.ASSIGN,
      TokenType.LPAREN,
      TokenType.RPAREN,
      TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('does not require whitespace between tokens', () => {
    expect(types('int a=10;')).toEqual([
      TokenType.INT,
      TokenType.IDENTIFIER,
      TokenType.ASSIGN,
      TokenType.NUMBER,
      TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('always appends exactly one EOF token', () => {
    const { tokens } = tokenize('int a;');
    expect(at(tokens, tokens.length - 1).type).toBe(TokenType.EOF);
    expect(tokens.filter((t) => t.type === TokenType.EOF).length).toBe(1);
  });

  it('returns only EOF for an empty program', () => {
    const { tokens, errors } = tokenize('');
    expect(tokens.length).toBe(1);
    expect(at(tokens, 0).type).toBe(TokenType.EOF);
    expect(at(tokens, 0).line).toBe(1);
    expect(at(tokens, 0).column).toBe(1);
    expect(errors.length).toBe(0);
  });

  it('returns only EOF for whitespace and comments alone', () => {
    const { tokens, errors } = tokenize('  \n\t // just a comment\n   ');
    expect(tokens.length).toBe(1);
    expect(at(tokens, 0).type).toBe(TokenType.EOF);
    expect(errors.length).toBe(0);
  });

  it('lexes a minus sign as MINUS regardless of unary or binary use', () => {
    // The scanner reports "a minus sign"; deciding unary vs binary is the
    // parser's job, not the lexer's.
    expect(types('-5')).toEqual([TokenType.MINUS, TokenType.NUMBER, TokenType.EOF]);
    expect(types('a - 5')).toEqual([
      TokenType.IDENTIFIER,
      TokenType.MINUS,
      TokenType.NUMBER,
      TokenType.EOF,
    ]);
  });
});

/* ------------------------------------------------------------------ */

describe('lexer: keywords vs identifiers (maximal munch)', () => {
  it('recognizes the keyword int', () => {
    expect(types('int')).toEqual([TokenType.INT, TokenType.EOF]);
  });

  it('treats integer as one identifier, not int + eger', () => {
    const { tokens } = tokenize('integer');
    expect(tokens.length).toBe(2); // IDENTIFIER + EOF
    expect(at(tokens, 0).type).toBe(TokenType.IDENTIFIER);
    expect(at(tokens, 0).lexeme).toBe('integer');
  });

  it('treats intx and int1 as identifiers', () => {
    expect(at(tokenize('intx').tokens, 0).type).toBe(TokenType.IDENTIFIER);
    expect(at(tokenize('int1').tokens, 0).type).toBe(TokenType.IDENTIFIER);
  });

  it('is case sensitive: INT is an identifier', () => {
    expect(at(tokenize('INT').tokens, 0).type).toBe(TokenType.IDENTIFIER);
  });

  it('accepts underscores and digits inside identifiers', () => {
    const names = ['_a', 'a1', 'x_1', '_', 'total_sum2'];
    for (const name of names) {
      const { tokens, errors } = tokenize(name);
      expect(errors.length).toBe(0);
      expect(at(tokens, 0).type).toBe(TokenType.IDENTIFIER);
      expect(at(tokens, 0).lexeme).toBe(name);
    }
  });

  it('does not let an identifier start with a digit', () => {
    // "1a" is a malformed number, not an identifier.
    const { errors } = tokenize('1a');
    expect(errors.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */

describe('lexer: number literals', () => {
  it('attaches the numeric value to NUMBER tokens', () => {
    const { tokens } = tokenize('0 7 42 100');
    expect(at(tokens, 0).value).toBe(0);
    expect(at(tokens, 1).value).toBe(7);
    expect(at(tokens, 2).value).toBe(42);
    expect(at(tokens, 3).value).toBe(100);
  });

  it('leaves value undefined for non-number tokens', () => {
    const { tokens } = tokenize('int a = 10;');
    expect(at(tokens, 0).value).toBeUndefined(); // int
    expect(at(tokens, 1).value).toBeUndefined(); // a
    expect(at(tokens, 2).value).toBeUndefined(); // =
    expect(at(tokens, 3).value).toBe(10); // 10
  });

  it('keeps leading zeros in the lexeme but parses the value in base 10', () => {
    const { tokens } = tokenize('007');
    expect(at(tokens, 0).lexeme).toBe('007');
    expect(at(tokens, 0).value).toBe(7);
  });

  it('accepts the largest 32-bit signed integer', () => {
    const { tokens, errors } = tokenize('2147483647');
    expect(errors.length).toBe(0);
    expect(at(tokens, 0).value).toBe(2147483647);
  });
});

/* ------------------------------------------------------------------ */

describe('lexer: comments and whitespace', () => {
  it('skips single line comments entirely', () => {
    expect(types('// a comment\nint a;')).toEqual([
      TokenType.INT,
      TokenType.IDENTIFIER,
      TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('skips a trailing comment that has no newline after it', () => {
    expect(types('int a; // trailing')).toEqual([
      TokenType.INT,
      TokenType.IDENTIFIER,
      TokenType.SEMICOLON,
      TokenType.EOF,
    ]);
  });

  it('keeps line numbers correct across comments', () => {
    const source = '// line 1 comment\n// line 2 comment\nint a;';
    const { tokens } = tokenize(source);
    expect(at(tokens, 0).line).toBe(3);
  });

  it('distinguishes division from the start of a comment', () => {
    expect(types('a / b')).toEqual([
      TokenType.IDENTIFIER,
      TokenType.SLASH,
      TokenType.IDENTIFIER,
      TokenType.EOF,
    ]);
    expect(types('a // b')).toEqual([TokenType.IDENTIFIER, TokenType.EOF]);
  });

  it('handles tabs, blank lines and CRLF line endings', () => {
    const { tokens, errors } = tokenize('int\ta;\r\n\r\nint\tb;');
    expect(errors.length).toBe(0);
    expect(at(tokens, 3).line).toBe(3); // the second `int`
  });
});

/* ------------------------------------------------------------------ */

describe('lexer: source positions', () => {
  it('records 1-based line and column for each token', () => {
    const source = 'int a = 10;';
    //              123456789...
    const { tokens } = tokenize(source);
    expect(at(tokens, 0).column).toBe(1); // int
    expect(at(tokens, 1).column).toBe(5); // a
    expect(at(tokens, 2).column).toBe(7); // =
    expect(at(tokens, 3).column).toBe(9); // 10
    expect(at(tokens, 4).column).toBe(11); // ;
    for (const token of tokens) {
      expect(token.line).toBe(1);
    }
  });

  it('tracks line numbers across a multi line program', () => {
    const source = 'int a = 1;\nint b = 2;\nint c = a + b;';
    const { tokens } = tokenize(source);
    expect(at(tokens, 0).line).toBe(1); // int
    expect(at(tokens, 5).line).toBe(2); // second int
    expect(at(tokens, 10).line).toBe(3); // third int
    expect(at(tokens, 5).column).toBe(1); // column resets on a new line
  });

  it('gives start/end offsets that slice back to the exact lexeme', () => {
    const source = 'int total = (a + 42) * b;';
    const { tokens } = tokenize(source);
    for (const token of tokens) {
      if (token.type === TokenType.EOF) continue;
      expect(source.slice(token.start, token.end)).toBe(token.lexeme);
    }
  });

  it('places EOF at the very end of the source', () => {
    const source = 'int a;';
    const { tokens } = tokenize(source);
    const eof = at(tokens, tokens.length - 1);
    expect(eof.start).toBe(source.length);
    expect(eof.end).toBe(source.length);
    expect(eof.lexeme).toBe('');
  });
});

/* ------------------------------------------------------------------ */

describe('lexer: error handling', () => {
  it('reports an unexpected character', () => {
    const { errors } = tokenize('int a = 10 @ 5;');
    expect(errors.length).toBe(1);
    expect(at2(errors, 0).stage).toBe('lexical');
    expect(at2(errors, 0).severity).toBe('error');
    expect(at2(errors, 0).message).toContain('@');
    expect(at2(errors, 0).line).toBe(1);
    expect(at2(errors, 0).column).toBe(12);
  });

  it('recovers and keeps scanning after a bad character', () => {
    // The tokens either side of '@' must still be produced.
    const { tokens, errors } = tokenize('a @ b');
    expect(errors.length).toBe(1);
    expect(types('a @ b')).toEqual([
      TokenType.IDENTIFIER,
      TokenType.IDENTIFIER,
      TokenType.EOF,
    ]);
    expect(at(tokens, 0).lexeme).toBe('a');
    expect(at(tokens, 1).lexeme).toBe('b');
  });

  it('collects every lexical error in one pass', () => {
    const { errors } = tokenize('int a = @;\nint b = #;\nint c = $;');
    expect(errors.length).toBe(3);
    expect(at2(errors, 0).line).toBe(1);
    expect(at2(errors, 1).line).toBe(2);
    expect(at2(errors, 2).line).toBe(3);
  });

  it('reports a malformed number such as 12abc', () => {
    const { errors, tokens } = tokenize('int a = 12abc;');
    expect(errors.length).toBe(1);
    expect(at2(errors, 0).message).toContain('12abc');
    expect(at2(errors, 0).column).toBe(9);
    // The bad lexeme is dropped, not split into NUMBER + IDENTIFIER.
    expect(tokens.some((t) => t.type === TokenType.NUMBER)).toBe(false);
    expect(tokens.some((t) => t.lexeme === 'abc')).toBe(false);
  });

  it('reports an integer literal that overflows 32 bits', () => {
    const { errors } = tokenize('int a = 99999999999;');
    expect(errors.length).toBe(1);
    expect(at2(errors, 0).message).toContain('too large');
  });

  it('reports no errors for a valid program', () => {
    const { errors } = tokenize('int a = 10;\nint b = 20;\nint c = a + b;');
    expect(errors.length).toBe(0);
  });
});

/** Index helper for the error array. */
function at2<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No item at index ${index} (only ${items.length} items)`);
  }
  return item;
}

/* ------------------------------------------------------------------ */

describe('lexer: determinism and the demo program', () => {
  it('produces identical output for repeated runs', () => {
    const source = 'int a = 10;\nint c = a + b * (2 - 1);';
    expect(tokenize(source)).toEqual(tokenize(source));
  });

  it('tokenizes the main demo program correctly', () => {
    const source = [
      'int a = 10;',
      'int b = 20;',
      'int c = a + b;   // constant propagation + folding',
      'int d = c * 1;   // algebraic simplification',
      'int e = c + 0;   // algebraic simplification',
    ].join('\n');

    const { tokens, errors } = tokenize(source);
    expect(errors.length).toBe(0);

    // 5 statements: int NAME = <expr> ;
    // Statements 1 and 2 have 5 tokens, statements 3-5 have 7 tokens each.
    // 5 + 5 + 7 + 7 + 7 = 31, plus EOF = 32.
    expect(tokens.length).toBe(32);
    expect(tokens.filter((t) => t.type === TokenType.INT).length).toBe(5);
    expect(tokens.filter((t) => t.type === TokenType.SEMICOLON).length).toBe(5);
    // The four literals are 10, 20, 1 and 0. Line 3 has no literal at all.
    expect(tokens.filter((t) => t.type === TokenType.NUMBER).length).toBe(4);

    // Last real token before EOF is the final semicolon on line 5.
    const lastReal = at(tokens, tokens.length - 2);
    expect(lastReal.type).toBe(TokenType.SEMICOLON);
    expect(lastReal.line).toBe(5);
  });
});
