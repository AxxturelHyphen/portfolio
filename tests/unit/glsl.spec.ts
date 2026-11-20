import { expect, test } from '@playwright/test';
import { mergeDeclarations, minifyGlsl, packGlsl, shaderRenames, shortenFloat } from '../../scripts/glsl.ts';

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

test('floats lose every digit they do not need', () => {
  expect(['1.0', '0.50', '10.0', '2.0e-3', '.25', '0.0'].map(shortenFloat)).toEqual(['1.', '.5', '10.', '2.e-3', '.25', '0.']);
});

test('one renaming for every chunk: locals and varyings shrink, bound names and swizzles stay', () => {
  const vert = minifyGlsl('uniform vec4 uTint;\nin vec3 position;\nout vec2 vCoord;\nvoid main() { vec3 offset = position; vCoord = offset.xy; }');
  const frag = minifyGlsl('in vec2 vCoord;\nout vec4 outColor;\nfloat shade(float level) { return level * uTint.w; }\nvoid main() { outColor = vec4(shade(vCoord.x)); }');
  const map = shaderRenames([vert, frag]);
  expect([...map.keys()].sort()).toEqual(['level', 'offset', 'shade', 'vCoord']);
  expect(new Set(map.values()).size).toBe(map.size);
  const packed = packGlsl(frag, map);
  expect(packed).toContain('outColor');
  expect(packed).not.toContain('vCoord');
  expect(packed.endsWith('\n')).toBe(true);
});

test('packing joins code lines, keeps directives on their own and signs apart', () => {
  expect(packGlsl('#define K 2\nfloat a=b - -c;\nfloat d=a + 1.0;\n#ifdef K\nfloat e(float x){\nreturn x;\n}\n#endif\n', new Map()))
    .toBe('#define K 2\nfloat a=b- -c,d=a+1.;\n#ifdef K\nfloat e(float x){return x;}\n#endif\n');
});

test('repeated declarations merge, functions and other qualifiers never do', () => {
  expect(mergeDeclarations('uniform vec3 a;uniform vec3 b;in float c;in float d[2];const float E=1.;float f;float g(float x){return x;}float h=g(1.);'))
    .toBe('uniform vec3 a,b;in float c,d[2];const float E=1.;float f;float g(float x){return x;}float h=g(1.);');
});
