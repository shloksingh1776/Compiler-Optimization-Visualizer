import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { compile } from '../src/compiler/pipeline.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { expressionToString } from '../src/compiler/parser/ast.ts';

describe('Stage 13 - logical operators', () => {
  it('lexes &&, || and !', () => {
    const { tokens, errors } = tokenize('bool x = !true && false || true;');
    expect(errors).toHaveLength(0);
    expect(tokens.map(t => t.type)).toContain('AND_AND');
    expect(tokens.map(t => t.type)).toContain('OR_OR');
    expect(tokens.map(t => t.type)).toContain('BANG');
  });

  it('parses logical precedence as ! > && > ||', () => {
    const lex = tokenize('bool x = !true || false && true;');
    expect(lex.errors).toHaveLength(0);
    const parsed = parse(lex.tokens);
    expect(parsed.errors).toHaveLength(0);
    const decl = parsed.program!.body[0] as any;
    expect(expressionToString(decl.init)).toBe('((!true) || (false && true))');
  });

  it('requires bool operands for logical binary operators', () => {
    const result = compile('int a = 1; bool x = a && true;');
    expect(result.semanticErrors.some(e => e.message.includes("Logical operator '&&' requires bool operands"))).toBe(true);
    expect(result.tac).toBeNull();
  });

  it('requires a bool operand for logical NOT', () => {
    const result = compile('int a = 1; bool x = !a;');
    expect(result.semanticErrors.some(e => e.message.includes('Logical NOT requires a bool expression'))).toBe(true);
    expect(result.tac).toBeNull();
  });

  it('evaluates logical AND and OR correctly', () => {
    const result = compile(`
      bool a = true;
      bool b = false;
      print(a && b);
      print(a || b);
      print(!b);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['false', 'true', 'true']);
  });

  it('short-circuits AND and does not call the right side when left is false', () => {
    const result = compile(`
      bool side() {
        print(99);
        return true;
      }
      bool a = false;
      bool x = a && side();
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['false']);
  });

  it('short-circuits OR and does not call the right side when left is true', () => {
    const result = compile(`
      bool side() {
        print(99);
        return false;
      }
      bool a = true;
      bool x = a || side();
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['true']);
  });

  it('evaluates the right side when short-circuiting does not apply', () => {
    const result = compile(`
      bool side() {
        print(99);
        return true;
      }
      bool a = true;
      bool x = a && side();
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['99', 'true']);
  });

  it('generates control flow for short-circuit AND', () => {
    const result = compile('bool a = false; bool b = true; bool x = a && b;');
    expect(result.errors).toHaveLength(0);
    const text = formatTAC(result.tac!);
    expect(text).toContain('ifFalse a goto');
    expect(text).toContain('ifFalse b goto');
    expect(text).toContain('goto');
    expect(text).toContain('true');
    expect(text).toContain('false');
  });

  it('generates control flow for short-circuit OR', () => {
    const result = compile('bool a = true; bool b = false; bool x = a || b;');
    expect(result.errors).toHaveLength(0);
    const text = formatTAC(result.tac!);
    expect(text).toContain('ifFalse a goto');
    expect(text).toContain('ifFalse b goto');
  });

  it('works in if conditions', () => {
    const result = compile(`
      bool a = true;
      bool b = false;
      if (a && !b) {
        print(1);
      } else {
        print(0);
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['1']);
  });

  it('works in while conditions', () => {
    const result = compile(`
      int i = 0;
      while (i < 3 && i != 2) {
        print(i);
        i = i + 1;
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1']);
  });

  it('works inside functions and preserves function-body control flow', () => {
    const result = compile(`
      bool allTrue(bool a, bool b) {
        return a && b;
      }
      return allTrue(true, false);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(false);
    expect(formatTAC(result.optimizedTac!).includes('ifFalse')).toBe(true);
    const functionTac = result.optimizedTac!.functions?.allTrue;
    expect(functionTac).toBeDefined();
    expect(formatTAC({ ...result.optimizedTac!, instructions: functionTac!.instructions })).toContain('ifFalse');
  });

  it('folds standalone logical NOT when its operand is constant', () => {
    const result = compile('bool x = !true; print(x);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['false']);
    expect(formatTAC(result.optimizedTac!)).toContain('x = false');
  });

  it('rejects a single & or | lexically', () => {
    const andResult = tokenize('bool x = true & false;');
    const orResult = tokenize('bool x = true | false;');
    expect(andResult.errors.length).toBeGreaterThan(0);
    expect(orResult.errors.length).toBeGreaterThan(0);
  });
});
