// The combined film pass (cook/ARCH.md 2.7; common.glsl prepended): strip slide, weave, lens softness and edge fringe,
// halation, flicker, encode, vignette, grade (gain, shoulder, hand-tint regions, warm highlights, lifted black), iris,
// frame line, dust, hairline scratch, grain. uScene is the linear scene target; only its lower-left uScale fraction is
// used. uRes is the film grid in px (output size times filmScale): on the low tier grain and dust are evaluated on a
// half-resolution grid inside this same pass. Colours after the encode are display-referred.
uniform sampler2D uScene;
uniform sampler2D uHalation;
uniform vec2 uRes;
uniform float uScale;
uniform float uSeed;
uniform float uGrain;
uniform vec2 uWeave;
uniform float uDust;
uniform float uFlicker;
uniform vec2 uVignette;
uniform float uSoft;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec4 uTint[3];
uniform vec4 uIris;
uniform vec3 uIrisColor;
uniform vec4 uStrip;
uniform vec3 uProtect;
uniform float uStatic;
uniform float uFilmOn;
uniform vec3 uScratch;     // x (0..1), opacity, wobble phase
uniform float uHalGain;    // halation strength, trailing the flicker by 100 ms
uniform vec3 uHighlight;   // warm highlight tint (#f3e6cf), display

in vec2 vUv;
out vec4 fragColor;

const float PI = 3.14159265;
const vec3 HALATION_TINT = vec3(0.604, 0.114, 0.059);   // #cc5f45, linear
const float GRAIN_PX_1080 = 1.5;
const float GRAIN_NORM = 1.0 / 0.2;
const float MOTTLE_PX_1080 = 14.0;
const float MOTTLE_LEVELS = 1.1 / 255.0;
const float FRINGE_PX_1080 = 0.8;
const float SOFT_PX_1080 = 1.6;
const float SHOULDER = 0.80;          // display value where highlights start to roll off
const float WHITE = 0.94;             // luma 240: only the moon core gets here
const float TOE = 0.045;              // deepens the darks toward the lifted black, mids almost untouched
const vec3 BAR_COLOR = vec3(0.090, 0.071, 0.055);
const vec3 BAR_EDGE = vec3(0.545, 0.400, 0.227);
const float GATE_JUMP = 0.004;
const float PERF_BAND = 0.03;
const float PERF_PERIOD = 0.06;
const vec2 PERF_HOLE = vec2(0.014, 0.008);
const vec3 PERF_LIGHT = vec3(0.353, 0.290, 0.227);
const vec2 DUST_CELLS = vec2(8.0, 5.0);
const vec3 DUST_DARK = vec3(0.16, 0.12, 0.10);
const vec3 DUST_LIGHT = vec3(0.86, 0.80, 0.68);
const vec3 SCRATCH = vec3(0.84, 0.78, 0.66);

vec3 encodeSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hashU(uvec3 p) {
  p = p * uvec3(1597334673u, 3812015801u, 2798796415u);
  uint n = (p.x ^ p.y ^ p.z) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0) - 0.5;
}

// Smoothed value noise on a grid, zero mean, std about 0.2.
float grainNoise(vec2 grid, uint seed) {
  vec2 i = floor(grid);
  vec2 f = grid - i;
  f = f * f * (3.0 - 2.0 * f);
  uvec2 c = uvec2(ivec2(i) + 8192);
  float a = hashU(uvec3(c, seed));
  float b = hashU(uvec3(c + uvec2(1u, 0u), seed));
  float d = hashU(uvec3(c + uvec2(0u, 1u), seed));
  float e = hashU(uvec3(c + uvec2(1u, 1u), seed));
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

vec2 clampUV(sampler2D tex, vec2 uv) {
  vec2 half_ = 0.5 / vec2(textureSize(tex, 0));
  return clamp(uv * uScale, half_, uScale - half_);
}
vec3 tap(vec2 uv) { return texture(uScene, clampUV(uScene, uv)).rgb; }

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Lens: softer and with a red/blue fringe toward the edges, untouched in the centre.
vec3 lens(vec2 uv, float k1080) {
  vec2 fromC = uv - 0.5;
  float edge = dot(fromC, fromC) * 2.0;
  vec2 px = 1.0 / uRes;
  vec2 fringe = normalize(fromC + 1e-5) * px * FRINGE_PX_1080 * k1080 * edge;
  vec3 c = vec3(tap(uv + fringe).r, tap(uv).g, tap(uv - fringe).b);
  float soft = uSoft * edge;
  if (soft > 0.02) {
    vec2 o = px * SOFT_PX_1080 * k1080;
    vec3 blur = 0.25 * (tap(uv + vec2(o.x, o.y)) + tap(uv + vec2(-o.x, o.y)) + tap(uv + vec2(o.x, -o.y)) + tap(uv - o));
    c = mix(c, blur, min(soft, 1.0));
  }
  return c;
}

// Dust: at most one speck per screen cell, new set every second film frame, 60 % dark with a light rim, never inside
// the protected circle around the focal flower.
vec3 dust(vec3 col, vec2 film, float k1080, float aspect, uint seed) {
  vec2 cellSize = uRes / DUST_CELLS;
  vec2 cell = floor(film / cellSize);
  uvec3 key = uvec3(uvec2(cell), seed);
  if (hashU(key) + 0.5 > uDust / (DUST_CELLS.x * DUST_CELLS.y)) return col;
  vec2 centre = (cell + 0.5 + 0.5 * vec2(hashU(key + uvec3(1u, 0u, 0u)), hashU(key + uvec3(0u, 1u, 0u)))) * cellSize;
  vec2 cuv = centre / uRes;
  if (uProtect.z > 0.0 && length((cuv - uProtect.xy) * vec2(aspect, 1.0)) < uProtect.z) return col;
  float r = (2.0 + 4.0 * (hashU(key + uvec3(0u, 0u, 7u)) + 0.5)) * k1080;
  vec2 d = film - centre;
  float rough = r * (0.75 + 0.5 * valueNoise(d / max(r, 1.0) * 1.6 + cell * 3.1));
  float body = smoothstep(rough, rough - 1.0, length(d));
  float rim = smoothstep(rough + 1.2, rough, length(d)) - body;
  bool dark = hashU(key + uvec3(5u, 5u, 0u)) + 0.5 < 0.6;
  col = mix(col, dark ? DUST_DARK : DUST_LIGHT, body * (dark ? 0.7 : 0.3));
  return dark ? col + rim * 0.12 : col;
}

void main() {
  vec2 film = (floor(vUv * uRes) + 0.5);
  if (uFilmOn < 0.5) {
    fragColor = vec4(encodeSRGB(tap(vUv)), 1.0);
    return;
  }
  float aspect = uRes.x / uRes.y;
  float k1080 = uRes.y / 1080.0;
  vec2 uv = vUv;

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

  vec3 lin = lens(uv, k1080) + uHalGain * HALATION_TINT * texture(uHalation, clampUV(uHalation, uv)).rgb;
  lin *= 1.0 + uFlicker;
  vec3 col = encodeSRGB(lin);

  vec2 fromCentre = (vUv - 0.5) * 1.41421356;
  col *= 1.0 - uVignette.x * smoothstep(uVignette.y, 1.0, length(fromCentre));

  col = pow(max(col * uGain, 0.0), 1.0 / uGamma);
  col = col * col / (col + TOE) * (1.0 + TOE);
  float y = luma(col);
  float rolled = y < SHOULDER ? y : SHOULDER + (WHITE - SHOULDER) * (1.0 - exp(-(y - SHOULDER) / (WHITE - SHOULDER)));
  col *= rolled / max(y, 1e-4);
  col = mix(col, col * uHighlight / luma(uHighlight), smoothstep(0.45, 0.9, rolled) * 0.35);
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

  uint seed = uStatic > 0.5 ? 0u : uint(uSeed);
  if (uDust > 0.0) col = dust(col, film, k1080, aspect, seed / 2u);
  if (uScratch.y > 0.0) {
    float sx = (uScratch.x + 0.0012 * sin(vUv.y * 17.0 + uScratch.z)) * uRes.x;
    col = mix(col, SCRATCH, uScratch.y * smoothstep(1.0, 0.0, abs(film.x - sx)));
  }

  float l = luma(col);
  float weight = mix(0.3, 1.0, 4.0 * l * (1.0 - l));
  float g = grainNoise(film / (GRAIN_PX_1080 * k1080), seed) * GRAIN_NORM * uGrain;
  g += grainNoise(film / (MOTTLE_PX_1080 * k1080), seed / 4u + 977u) * GRAIN_NORM * MOTTLE_LEVELS;
  g *= weight;
  fragColor = vec4(col + g, 1.0);
}
