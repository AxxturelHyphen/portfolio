// Night sky over the garden (common.glsl prepended): a blue-violet wash with hand-tinted bands and paper tooth, sparse
// printed stars, and the moon: a 2.4 degree engraved disc with a tight cool halo. Linear output.
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonBack;
uniform vec3 uMoonBody;
uniform sampler2D uMoonMap;
uniform float uMoonMapOn;

in vec3 vRay;
out vec4 outColor;

const float MOON_R = 0.0209;          // 1.2 degree radius: a 2.4 degree disc, small and clear of the wall
const float HALO_R = 0.0436;          // 2.5 degrees: a tight halo hugging the disc
const vec3 AFTERGLOW = vec3(0.479, 0.159, 0.085);   // #b86f52
const vec3 HORIZON_ROSE = vec3(0.110, 0.072, 0.085);   // #5e4c52: the faint dusty rose band low over the wall
const float ROSE_HEIGHT = 0.035;      // radians: a thin dusty rose band just above the wall, blue-violet above
const float EDGE_WOBBLE = 0.035;      // the hand-cut paper edge of the moon disc
const vec3 EDGE_TINT = vec3(0.90, 0.88, 0.84);   // the pale tint that overran the edge when the plate was coloured
const float MOON_GAIN = 1.05;         // the core reaches luma 236 to 240 after the film shoulder
const vec3 HALO_WARM = vec3(0.66, 0.68, 0.72);
const vec3 HALO_COOL = vec3(0.17, 0.20, 0.27);
const vec3 INK_STAR = vec3(0.62, 0.55, 0.42);
const float BANDS = 7.0;
const float STAR_CELL = 0.035;        // about 2 degrees per cell

// Engraved moon face from disc coordinates q (|q| < 1): broad irregular maria and many small rim-lit craters, read
// through a curved engraver's line screen (thicker lines where the tone is darker).
float moonFace(vec2 q, float px) {
  vec2 w = q * 1.3 + 0.35 * vec2(valueNoise(q * 2.0 + 4.0), valueNoise(q * 2.0 + 9.0));
  float maria = smoothstep(0.5, 0.68, fbm3(w + vec2(5.3, 2.9)));
  float tone = 1.0 - 0.3 * maria;
  for (int i = 0; i < 14; i++) {
    vec2 c = hash22(vec2(float(i), 11.0)) * 1.7 - 0.85;
    float r = 0.035 + 0.07 * sq(hash12(vec2(float(i), 5.0)));
    float d = length(q - c) / r;
    tone += 0.09 * smoothstep(0.18, 0.0, abs(d - 1.0)) - 0.05 * smoothstep(1.0, 0.6, d);
  }
  if (uMoonMapOn > 0.5) tone = mix(tone, luma(texture(uMoonMap, q * 0.5 + 0.5).rgb) * 1.15, 0.85);
  float pitch = 0.05;
  float line = abs(fract((q.y + 0.18 * q.x * q.x) / pitch) - 0.5) * 2.0;
  float width = sat(1.0 - tone) * 1.4;
  float ink = smoothstep(width + px / pitch, width, line) * sat(pitch / px * 0.5 - 0.6);
  float limb = 1.0 - 0.3 * pow(dot(q, q), 2.0);
  return max(tone - 0.25 * ink, 0.2) * limb;
}

float stars(vec3 dir, float el, float px) {
  float az = atan(dir.x, -dir.z);
  vec2 g = vec2(az * cos(el), el) / STAR_CELL;
  vec2 base = floor(g - 0.5);
  float s = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 cc = base + vec2(float(k & 1), float(k >> 1));
    float pick = hash12(cc + 17.0);
    if (pick > 0.16) continue;
    vec2 p = cc + hash22(cc) * 0.8 + 0.1;
    vec2 d = (g - p) * STAR_CELL;
    float r = px * (0.7 + 1.1 * hash12(cc + 3.0));
    float rough = 1.0 + 0.35 * (valueNoise(d / px * 1.7 + cc) - 0.5);
    s += (0.25 + 0.75 * hash12(cc + 9.0)) * smoothstep(r * rough, r * 0.4, length(d));
  }
  return s;
}

void main() {
  vec3 dir = normalize(vRay);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float px = length(fwidth(dir));
  float h = sat(el / 0.3);
  float hb = (floor(h * BANDS) + smoothstep(0.35, 0.65, fract(h * BANDS))) / BANDS;
  float wash = fbm3(vec2(atan(dir.x, -dir.z) * 3.0, el * 9.0));
  h = mix(h, hb, 0.4) + (wash - 0.5) * 0.06;
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(sat(h), 0.6));
  col = mix(col, HORIZON_ROSE, exp(-max(el, 0.0) / ROSE_HEIGHT) * 0.5);
  col *= 1.0 + (fbm3(vec2(atan(dir.x, -dir.z), el) * 22.0) - 0.5) * 0.14;

  vec2 moonXZ = normalize(uMoonBack.xz);
  float side = 0.5 + 0.5 * dot(normalize(dir.xz + 1e-5), moonXZ);
  col += AFTERGLOW * 0.05 * exp(-max(el, 0.0) / 0.025) * side * side;

  float ang = acos(clamp(dot(dir, uMoonBack), -1.0, 1.0));
  float halo = exp(-max(ang - MOON_R, 0.0) / (HALO_R * 0.45));
  float wide = exp(-max(ang - MOON_R, 0.0) / (HALO_R * 2.2));
  col += mix(HALO_COOL, HALO_WARM, halo) * (0.2 * halo + 0.03 * wide) * uMoonBody.r;

  col += INK_STAR * 0.22 * stars(dir, el, px) * sat(el / 0.08) * smoothstep(MOON_R * 4.0, MOON_R * 9.0, ang);

  vec3 up = normalize(cross(cross(uMoonBack, vec3(0.0, 1.0, 0.0)), uMoonBack));
  vec3 rt = normalize(cross(uMoonBack, up));
  vec2 q = vec2(dot(dir, rt), dot(dir, up)) / MOON_R;
  float rq = length(q) * (1.0 + EDGE_WOBBLE * (valueNoise(vec2(atan(q.y, q.x) * 4.0, 1.7)) - 0.5));
  float disc = smoothstep(1.0, 1.0 - px / MOON_R * 1.5, rq);
  float overrun = smoothstep(1.12, 1.0, rq) * smoothstep(0.86, 1.0, rq);
  col += uMoonBody * EDGE_TINT * overrun * 0.18;
  if (disc > 0.0) col = mix(col, uMoonBody * MOON_GAIN * moonFace(q, px / MOON_R) * mix(vec3(1.0), EDGE_TINT, smoothstep(0.8, 1.0, rq) * 0.35), disc);

  // Paper tooth: a fine fixed fibre under the wash.
  col *= 1.0 + (valueNoise(gl_FragCoord.xy * 0.6) - 0.5) * 0.05;
  outColor = vec4(col, 1.0);
}
