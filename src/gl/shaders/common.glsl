// Shared GLSL chunk, prepended to every gl program in src/gl (three adds the #version line before it).
precision highp float;
precision highp int;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float sq(float x) { return x * x; }
// Wrapped diffuse: light reaches past the terminator by `w`, as through thin paper.
float wrapLight(float d, float w) { return max((d + w) / (1.0 + w), 0.0); }

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm3(vec2 p) {
  return 0.55 * valueNoise(p) + 0.3 * valueNoise(p * 2.03 + 7.1) + 0.15 * valueNoise(p * 4.1 + 3.7);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
