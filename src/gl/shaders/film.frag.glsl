// The combined film pass (cook/ARCH.md 2.7): strip slide, weave, halation, exposure, encode, vignette, grade, iris, grain.
// uScene is the linear scene target; only the lower-left uScale fraction of it is used. uRes is the film grid in px
// (output size times filmScale), so the low tier evaluates grain on a half-resolution grid inside this same pass.
// Colours after the sRGB encode (iris, frame line, lift) are display-referred.
precision highp float;
precision highp int;

uniform sampler2D uScene;
uniform sampler2D uHalation;
uniform vec2 uRes;
uniform float uScale;
uniform float uSeed;
uniform float uGrain;
uniform vec2 uWeave;
uniform float uFlicker;
uniform vec2 uVignette;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec4 uTint[3];
uniform vec4 uIris;
uniform vec3 uIrisColor;
uniform vec4 uStrip;
uniform float uStatic;
uniform float uFilmOn;

in vec2 vUv;
out vec4 fragColor;

const float PI = 3.14159265;
// Halation tint #cc5f45 (linear) and its strength at the source edge (cook/SHOTS.md B).
const vec3 HALATION_TINT = vec3(0.604, 0.114, 0.059);
const float HALATION_GAIN = 0.9;
// Grain cell in film-grid px; 0.2 is the std of the smoothed value noise, so uGrain is the std in display units.
const float GRAIN_PX = 1.5;
const float GRAIN_NORM = 1.0 / 0.2;
// Frame line: warm dark bar (never pure black) with a 1 px warm edge; slight vertical gate jump between frames.
const vec3 BAR_COLOR = vec3(0.090, 0.071, 0.055);
const vec3 BAR_EDGE = vec3(0.545, 0.400, 0.227);
const float GATE_JUMP = 0.004;
// Perforation band at the top and bottom while the strip is pulled (screen-height units).
const float PERF_BAND = 0.03;
const float PERF_PERIOD = 0.06;
const vec2 PERF_HOLE = vec2(0.014, 0.008);
const vec3 PERF_LIGHT = vec3(0.353, 0.290, 0.227);

vec3 encodeSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(uvec3 p) {
  p = p * uvec3(1597334673u, 3812015801u, 2798796415u);
  uint n = (p.x ^ p.y ^ p.z) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0) - 0.5;
}

// Smoothed value noise on the grain grid, zero mean, std about 0.2.
float grain(vec2 grid, uint seed) {
  vec2 i = floor(grid);
  vec2 f = grid - i;
  f = f * f * (3.0 - 2.0 * f);
  uvec2 c = uvec2(ivec2(i) + 4096);
  float a = hash(uvec3(c, seed));
  float b = hash(uvec3(c + uvec2(1u, 0u), seed));
  float d = hash(uvec3(c + uvec2(0u, 1u), seed));
  float e = hash(uvec3(c + uvec2(1u, 1u), seed));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

vec3 hueRotate(vec3 c, float angle) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float s = sin(angle), k = cos(angle);
  yiq.yz = vec2(k * yiq.y - s * yiq.z, s * yiq.y + k * yiq.z);
  return toRGB * yiq;
}

vec3 sampleScene(sampler2D tex, vec2 uv) {
  vec2 half_ = 0.5 / vec2(textureSize(tex, 0));
  return texture(tex, clamp(uv * uScale, half_, uScale - half_)).rgb;
}

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  if (uFilmOn < 0.5) {
    fragColor = vec4(encodeSRGB(sampleScene(uScene, vUv)), 1.0);
    return;
  }
  float aspect = uRes.x / uRes.y;
  vec2 uv = vUv;

  // Film strip: the picture slides by frames of width 1 + bar; the neighbour frame peeks in behind a frame line.
  float barMask = 0.0, barEdge = 0.0, perf = 0.0, perfHole = 0.0;
  if (uStrip.w > 0.5) {
    float period = 1.0 + uStrip.y;
    float xs = uv.x + uStrip.x * 0.5 * period;
    float k = xs / period;
    float frame = floor(k);
    float local = (k - frame) * period;
    barMask = step(1.0, local);
    float edgePx = min(local - 1.0, period - local) * uRes.x;
    barEdge = barMask * clamp(1.5 - edgePx, 0.0, 1.0);
    float jump = uStrip.z * GATE_JUMP * sin(PI * abs(uStrip.x)) * (mod(frame, 2.0) * 2.0 - 1.0);
    uv = vec2(min(local, 1.0), uv.y + jump);
    perf = uStrip.z * smoothstep(0.0, 0.35, abs(uStrip.x)) * step(min(vUv.y, 1.0 - vUv.y), PERF_BAND);
    vec2 hp = vec2(mod(xs * aspect, PERF_PERIOD) - 0.5 * PERF_PERIOD, min(vUv.y, 1.0 - vUv.y) - 0.5 * PERF_BAND);
    perfHole = 1.0 - smoothstep(-1.0 / uRes.y, 1.0 / uRes.y, roundBox(hp, PERF_HOLE, 0.003));
  }
  uv += uWeave;

  vec3 lin = sampleScene(uScene, uv) + HALATION_GAIN * HALATION_TINT * sampleScene(uHalation, uv);
  lin *= 1.0 + uFlicker;
  vec3 col = encodeSRGB(lin);

  vec2 fromCentre = (vUv - 0.5) * 1.41421356;
  col *= 1.0 - uVignette.x * smoothstep(uVignette.y, 1.0, length(fromCentre));

  col = pow(max(col * uGain, 0.0), 1.0 / uGamma);
  float hue = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 t = uTint[i];
    float d = (vUv.x - t.x) / max(t.y, 1e-3);
    hue += t.w * t.z * exp(-d * d);
  }
  if (abs(hue) > 1e-4) col = hueRotate(col, hue);
  col = uLift + col * (1.0 - uLift);

  float irisD = length((vUv - uIris.xy) * vec2(aspect, 1.0));
  col = mix(col, uIrisColor, smoothstep(uIris.z - 2.0 * uIris.w, uIris.z, irisD));

  col = mix(col, BAR_COLOR, barMask);
  col = mix(col, BAR_EDGE, barEdge);
  col = mix(col, mix(BAR_COLOR, PERF_LIGHT, perfHole), perf);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float weight = mix(0.4, 1.0, 4.0 * luma * (1.0 - luma));
  uint seed = uStatic > 0.5 ? 0u : uint(uSeed);
  col += grain(vUv * uRes / GRAIN_PX, seed) * GRAIN_NORM * uGrain * weight;

  fragColor = vec4(col, 1.0);
}
