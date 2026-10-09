import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/compiler/lexer/lexer.ts';
import { parse } from '../src/compiler/parser/parser.ts';
import { analyze } from '../src/compiler/semantic/analyzer.ts';
import { generateTAC } from '../src/compiler/ir/tacGenerator.ts';
import { formatTAC } from '../src/compiler/ir/tacPrinter.ts';
import { compile } from '../src/compiler/pipeline.ts';

function astOf(source: string) {
  const lex = tokenize(source);
  expect(lex.errors).toHaveLength(0);
  const parsed = parse(lex.tokens);
  expect(parsed.errors).toHaveLength(0);
  expect(parsed.program).not.toBeNull();
  return parsed.program!;
}

describe('Stage 12 - while loops', () => {
  it('lexes while as a keyword', () => {
    const { tokens, errors } = tokenize('while (true) { print(1); }');
    expect(errors).toHaveLength(0);
    expect(tokens.map(t => t.type)).toContain('WHILE');
  });

  it('parses a while statement and body', () => {
    const ast = astOf('while (true) { print(1); }');
    const stmt = ast.body[0] as any;
    expect(stmt.type).toBe('WhileStmt');
    expect(stmt.body).toHaveLength(1);
  });

  it('requires a bool while condition', () => {
    const ast = astOf('int x = 1; while (x) { print(1); }');
    const result = analyze(ast);
    expect(result.errors.some(e => e.message.includes('While condition must be a bool expression'))).toBe(true);
  });

  it('generates a backward jump and exit label', () => {
    const tac = generateTAC(astOf('int i = 0; while (i < 3) { i = i + 1; }'));
    const text = formatTAC(tac);
    expect(text).toContain('L0:');
    expect(text).toContain('ifFalse');
    expect(text).toContain('goto L0');
    expect(text).toContain('L1:');
  });

  it('executes a basic counting loop', () => {
    const result = compile(`
      int i = 0;
      while (i < 3) {
        print(i);
        i = i + 1;
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1', '2']);
  });

  it('executes a loop zero times when the condition is initially false', () => {
    const result = compile('int i = 10; while (i < 5) { print(i); } print(20);');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['20']);
  });

  it('supports arithmetic accumulation in a loop', () => {
    const result = compile(`
      int i = 1;
      int sum = 0;
      while (i <= 5) {
        sum = sum + i;
        i = i + 1;
      }
      print(sum);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['15']);
  });

  it('supports nested while loops', () => {
    const result = compile(`
      int i = 0;
      while (i < 2) {
        int j = 0;
        while (j < 2) {
          print(j);
          j = j + 1;
        }
        i = i + 1;
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '1', '0', '1']);
  });

  it('supports if/else inside a while loop', () => {
    const result = compile(`
      int i = 0;
      while (i < 3) {
        if (i == 1) {
          print(10);
        } else {
          print(i);
        }
        i = i + 1;
      }
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['0', '10', '2']);
  });

  it('supports while loops inside functions', () => {
    const result = compile(`
      int count(int n) {
        int i = 0;
        while (i < n) {
          i = i + 1;
        }
        return i;
      }
      print(count(3));
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['3']);
    expect(result.optimizedTac?.functions?.count?.instructions.some(i => i.kind === 'jump')).toBe(true);
  });

  it('supports return from inside a loop', () => {
    const result = compile(`
      int find() {
        int i = 0;
        while (i < 5) {
          if (i == 3) {
            return i;
          }
          i = i + 1;
        }
        return 0;
      }
      return find();
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.returnValue).toBe(3);
  });

  it('supports float loop arithmetic', () => {
    const result = compile(`
      float x = 0.5;
      while (x < 2.0) {
        x = x + 0.5;
      }
      print(x);
    `);
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['2']);
  });

  it('preserves loop control flow through optimization', () => {
    const result = compile('int i = 0; while (i < 3) { print(i); i = i + 1; }');
    expect(result.optimizedTac).not.toBeNull();
    const text = formatTAC(result.optimizedTac!);
    expect(text).toContain('ifFalse');
    expect(text).toContain('goto L0');
    expect(text).toContain('L1:');
  });

  it('reports division by zero in a loop', () => {
    const result = compile('int i = 0; while (i < 1) { print(10 / 0); i = i + 1; }');
    expect(result.divisionByZeroErrors).toHaveLength(1);
    expect(result.optimizedTac).toBeNull();
  });

  it('reports syntax errors for malformed while statements', () => {
    const result = compile('while i < 3 { print(i); }');
    expect(result.syntaxErrors.length).toBeGreaterThan(0);
    expect(result.tac).toBeNull();
  });

  it('supports while followed by normal statements', () => {
    const result = compile('int i = 0; while (i < 2) { i = i + 1; } print(i); return i;');
    expect(result.errors).toHaveLength(0);
    expect(result.output).toEqual(['2']);
    expect(result.returnValue).toBe(2);
  });
});
