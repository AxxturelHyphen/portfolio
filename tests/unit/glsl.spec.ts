import { expect, test } from '@playwright/test';
import { minifyGlsl } from '../../scripts/glsl.ts';

// The build-time shader minifier must keep every program token for token.

test('drops comments, indentation and blank lines', () => {
  const source = '// header\nuniform float uA; // trailing\n\n/* block\n spanning */ float f(float x) {\n    return x * 2.0;\n}';
  expect(minifyGlsl(source)).toBe('uniform float uA;\nfloat f(float x){\nreturn x*2.0;\n}\n');
});

test('never fuses signs into increments or decrements', () => {
  expect(minifyGlsl('float a = b - -c + +d;')).toBe('float a=b - -c + +d;\n');
});

test('keeps directive spacing and ends with a newline for concatenation', () => {
  expect(minifyGlsl('  #define F (x)\n#define G(x) ( x )')).toBe('#define F (x)\n#define G(x) ( x )\n');
});

test('a comment opener inside a line comment does not swallow code', () => {
  expect(minifyGlsl('// see a/*b\nfloat k = 1.0;')).toBe('float k=1.0;\n');
});
