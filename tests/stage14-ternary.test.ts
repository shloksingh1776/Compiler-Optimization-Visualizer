import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { compile } from '../src/compiler/pipeline.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { expressionToString } from '../src/compiler/parser/ast.ts';

describe('Stage 14 - ternary operator', () => {
  it('lexes ? and :', () => {
    const { tokens, errors } = tokenize('int x = true ? 1 : 2;');
    expect(errors).toHaveLength(0);
    expect(tokens.map(t => t.type)).toContain('QUESTION');
    expect(tokens.map(t => t.type)).toContain('COLON');
  });

  it('parses a basic ternary expression', () => {
    const lex = tokenize('int x = a < b ? a : b;');
    const parsed = parse(lex.tokens);
    expect(lex.errors).toHaveLength(0);
    expect(parsed.errors).toHaveLength(0);
    const decl = parsed.program!.body[0] as any;
    expect(decl.init.type).toBe('ConditionalExpr');
    expect(expressionToString(decl.init)).toBe('((a < b) ? a : b)');
  });

  it('gives ternary lower precedence than logical OR', () => {
    const parsed = parse(tokenize('bool x = a || b ? true : false;').tokens);
    expect(parsed.errors).toHaveLength(0);
    const decl = parsed.program!.body[0] as any;
    expect(expressionToString(decl.init)).toBe('((a || b) ? true : false)');
  });

  it('supports nested right-associative ternaries', () => {
    const parsed = parse(tokenize('int x = a ? b : c ? d : e;').tokens);
    expect(parsed.errors).toHaveLength(0);
    const decl = parsed.program!.body[0] as any;
    expect(expressionToString(decl.init)).toBe('(a ? b : (c ? d : e))');
  });

  it('requires a boolean condition', () => {
    const result = compile('int a = 1; int x = a ? 10 : 20;');
    expect(result.semanticErrors.some(e => e.message.includes('Ternary condition must be a bool expression'))).toBe(true);
    expect(result.tac).toBeNull();
  });

  it('accepts matching int branches', () => {
    const result = compile('bool c = true; int x = c ? 10 : 20; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
  });

  it('accepts matching float branches', () => {
    const result = compile('bool c = false; float x = c ? 10.5 : 20.5; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20.5']);
  });

  it('accepts bool branches', () => {
    const result = compile('bool c = false; bool x = c ? true : false; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['false']);
  });

  it('accepts int to float numeric promotion across branches', () => {
    const result = compile('bool c = true; float x = c ? 10 : 20.5; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
  });

  it('rejects incompatible bool and numeric branches', () => {
    const result = compile('bool c = true; int x = c ? true : 10;');
    expect(result.semanticErrors.some(e => e.message.includes('Ternary branches must have compatible types'))).toBe(true);
    expect(result.tac).toBeNull();
  });

  it('generates labels and jumps for a ternary', () => {
    const result = compile('bool c = true; int x = c ? 10 : 20;');
    expect(result.errors).toHaveLength(0);
    const text = formatTAC(result.tac!);
    expect(text).toContain('ifFalse c goto');
    expect(text).toContain('goto');
    expect(text).toContain('10');
    expect(text).toContain('20');
  });

  it('evaluates only the selected branch', () => {
    const result = compile(`
      int left() { print(10); return 10; }
      int right() { print(20); return 20; }
      bool c = true;
      int x = c ? left() : right();
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10', '10']);
  });

  it('does not evaluate the false branch when condition is false', () => {
    const result = compile(`
      int left() { print(10); return 10; }
      int right() { print(20); return 20; }
      bool c = false;
      int x = c ? left() : right();
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20', '20']);
  });

  it('works directly inside print', () => {
    const result = compile('print(10 < 20 ? 10 : 20);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['10']);
  });

  it('works inside return expressions', () => {
    const result = compile(`
      int max(int a, int b) {
        return a > b ? a : b;
      }
      return max(10, 20);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(20);
  });

  it('works inside while loops', () => {
    const result = compile(`
      int i = 0;
      while (i < 3) {
        int x = i == 1 ? 100 : 0;
        print(x);
        i = i + 1;
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '100', '0']);
  });

  it('works with logical operators in the condition', () => {
    const result = compile(`
      int a = 10;
      int b = 20;
      bool c = a < b && b > 15;
      int x = c ? 100 : 200;
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['100']);
  });

  it('supports nested ternary expressions at runtime', () => {
    const result = compile(`
      int a = 10;
      int b = 20;
      int c = 30;
      int x = a > b ? a : b > c ? b : c;
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['30']);
  });

  it('preserves the existing compile-time division-by-zero protection in either ternary branch', () => {
    const result = compile('bool c = true; int x = c ? 10 : 10 / 0; print(x);');
    expect(result.errors.some(e => e.message.includes('Division by zero'))).toBe(true);
  });

  it('rejects malformed ternary syntax', () => {
    const result = compile('int x = true ? 10;');
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
  });
});
