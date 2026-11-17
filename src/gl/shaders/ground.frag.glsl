// Ground (common.glsl and lights.glsl prepended): earth with a value ramp toward the wall, moss at the wall foot and in
// the joints, a flagstone path from the baked distance field, puddles that mirror the sky, the moon glint and the hand
// light with a ripple under the cursor, and an engraver's line screen so the photo stone reads as print. Linear output.
uniform vec4 uBounds;          // x0, z0, x1, z1
uniform sampler2D uPath;       // distance to the path centre, 0..1 = 0..uPathRange metres
uniform float uPathRange;
uniform sampler2D uStone;      // photo stone (plate pass reads its luminance)
uniform sampler2D uStoneN;     // its normal map
uniform float uStoneOn;
uniform vec4 uPuddle[12];      // x, z, radius x, radius z
uniform int uPuddles;
uniform vec3 uCamPos;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uMoonBody;
uniform vec4 uHaze;
uniform float uTime;

in vec3 vWorld;
in float vDepth;
out vec4 outColor;

const vec3 EARTH_NEAR = vec3(0.011, 0.023, 0.019);   // #1c2a26
const vec3 EARTH_MID = vec3(0.028, 0.047, 0.058);    // #2f3d44 at z -3
const vec3 EARTH_WALL = vec3(0.062, 0.066, 0.107);   // #46495c at the wall foot
const vec3 STONE = vec3(0.060, 0.055, 0.052);
const vec3 MOSS_SHADE = vec3(0.016, 0.054, 0.028);   // #21422f
const vec3 MOSS_MID = vec3(0.044, 0.118, 0.073);     // #3b614c
const vec3 GRASS = vec3(0.010, 0.026, 0.014);
const float HALF_WIDTH = 0.55;                        // a 1.1 m path
const float CELL = 0.42;                              // flagstone size
const float PITCH = 0.012;                            // line screen on the ground: 12 mm
const float LINE_CONTRAST = 0.22;
const float GLINT_AZ = 0.1047;                        // 6 degrees
const float HAZE_START = 3.0;
const float GROUND_ALBEDO = 3.2;                     // night ramp to what the warm lights see (keeps the texture)

// Voronoi: x = distance to the nearest centre, y = distance to the border (F2 - F1 style), zw = nearest cell id.
vec4 voronoi(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float d1 = 8.0, d2 = 8.0;
  vec2 id = vec2(0.0), c1 = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = g + 0.15 + 0.7 * hash22(i + g) - f;
      float d = dot(o, o);
      if (d < d1) { d2 = d1; d1 = d; id = i + g; c1 = o; }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec4(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}

float pathDist(vec2 p) {
  vec2 uv = (p - uBounds.xy) / (uBounds.zw - uBounds.xy);
  return texture(uPath, uv).r * uPathRange;
}

vec3 skyColour(float el) { return mix(uSkyHorizon, uSkyTop, pow(sat(el / 0.5), 0.55)); }

// Each set fades by its own footprint: lines running away from the lens survive a grazing view, the others give tone.
float lineScreen(vec2 p, float tone) {
  float ink = 0.0;
  vec3 limits = vec3(0.95, 0.6, 0.3);
  vec3 angles = vec3(0.52, -0.61, 1.45);
  for (int k = 0; k < 3; k++) {
    vec2 d = vec2(cos(angles[k]), sin(angles[k]));
    float u = dot(p, d) / PITCH;
    float fu = length(vec2(dFdx(u), dFdy(u)));
    float vis = sat(0.4 / max(fu, 1e-4) - 0.6);
    float l = abs(fract(u) - 0.5) * 2.0;
    float w = 0.3 + 0.3 * sat((limits[k] - tone) / limits[k]);
    ink = max(ink, smoothstep(w + fu, w - fu, l) * smoothstep(limits[k], limits[k] - 0.15, tone) * vis);
  }
  return ink;
}

void main() {
  vec2 p = vWorld.xz;
  float z = p.y;
  float grain = fbm3(p * 1.7);
  vec3 base = z > -3.0 ? mix(EARTH_NEAR, EARTH_MID, sat((-z) / 3.0)) : mix(EARTH_MID, EARTH_WALL, sat((-z - 3.0) / 3.0));
  vec4 clod = voronoi(p * 9.0);
  float pebble = smoothstep(0.22, 0.1, clod.x + 0.08 * valueNoise(p * 40.0)) * step(0.88, hash12(clod.zw));
  base *= (0.72 + 0.56 * grain) * (0.85 + 0.3 * valueNoise(p * 23.0)) * (1.0 + 0.5 * pebble) * mix(0.85, 0.18, sat((z + 1.0) / 4.5));
  vec3 n = vec3(0.0, 1.0, 0.0);

  // Moss at the wall foot.
  float moss = smoothstep(-4.6, -5.8, z) * smoothstep(0.45, 0.62, fbm3(p * 2.3 + 5.0));
  base = mix(base, mix(MOSS_SHADE, MOSS_MID, grain), moss * 0.85);

  // Flagstones: a stone exists where its centre lies on the path, so the path edge is the stones' own edge.
  vec2 warp = 0.22 * (vec2(valueNoise(p * 3.1), valueNoise(p * 3.1 + 17.0)) - 0.5);
  vec4 v = voronoi(p / CELL + warp);
  vec2 centre = (v.zw + 0.5) * CELL;
  float onPath = step(pathDist(centre), HALF_WIDTH) * step(pathDist(p), HALF_WIDTH + CELL * 0.6);
  float border = v.y * CELL;
  float stoneMask = onPath * smoothstep(0.005, 0.014, border);
  if (onPath > 0.0) {
    float rot = (hash12(v.zw) - 0.5) * 0.28;
    vec2 sp = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * p * 0.45 + hash22(v.zw) * 7.0;
    float photo = uStoneOn > 0.5 ? luma(texture(uStone, sp).rgb) : 0.25 + 0.2 * fbm3(sp * 9.0);
    float tone = 1.0 + (photo - 0.22) * 3.5;
    tone = max(floor(tone * 5.0 + 0.5) / 5.0 * 0.35 + tone * 0.65, 0.25);
    float worn = 1.0 + 0.12 * step(pathDist(centre), 0.35);
    vec3 stone = STONE * tone * worn * (0.7 + 0.6 * hash12(v.zw + 3.0)) * (0.85 + 0.3 * fbm3(p * 6.0));
    vec2 bevel = normalize(vec2(dFdx(border), dFdy(border)) + 1e-5) * (1.0 - smoothstep(0.03, 0.07, border)) * 0.35;
    vec3 nm = uStoneOn > 0.5 ? texture(uStoneN, sp).xyz * 2.0 - 1.0 : vec3(0.0, 0.0, 1.0);
    vec3 sn = normalize(vec3(nm.x * 0.6 + bevel.x, 1.0, nm.y * 0.6 + bevel.y));
    float joint = 1.0 - stoneMask;
    vec3 jointCol = mix(base * 0.45, GRASS * 0.5, smoothstep(0.45, 0.75, grain));
    base = mix(base, mix(stone, jointCol, joint), onPath);
    n = normalize(mix(n, sn, stoneMask));
  }

  // Puddles: dark wet ground that mirrors the sky; the hand rings the water under the cursor.
  float wet = 0.0;
  for (int i = 0; i < 12; i++) {
    if (i >= uPuddles) break;
    vec4 q = uPuddle[i];
    vec2 e = (p - q.xy) / q.zw;
    float r = length(e) * (1.0 + 0.18 * (valueNoise(e * 3.0 + float(i) * 5.0) - 0.5));
    wet = max(wet, smoothstep(1.0, 0.85, r));
  }

  // The ramp colours are the ground as seen under the place's ambient; the key adds relief, the hand its warm pool.
  float key = luma(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.3);
  vec3 hand = handLights(vWorld, n);
  vec3 albedo = base * GROUND_ALBEDO;
  vec3 col = base * (0.5 + 1.6 * key) + albedo * hand;

  if (wet > 0.0) {
    vec2 toC = p - uCursor.xz;
    float rr = length(toC);
    float ring = cos(rr * 26.0 - uTime * 4.0) * exp(-rr * 3.0) * smoothstep(1.0, 0.15, rr);
    vec3 wn = normalize(vec3(normalize(toC + 1e-4) * ring * 0.05 + (vec2(valueNoise(p * 9.0 + uTime * 0.3), valueNoise(p * 9.0 - uTime * 0.3)) - 0.5) * 0.04, 1.0).xzy);
    vec3 view = normalize(vWorld - uCamPos);
    vec3 refl = reflect(view, wn);
    vec3 mirror = skyColour(refl.y) * 0.45;
    // The moon streak: a moon-wide band at the moon's azimuth, broken by the ripples (elevation ignored on purpose).
    float dAz = atan(refl.x, -refl.z) - atan(uMoonBack.x, -uMoonBack.z);
    float near = step(abs(atan(view.x, -view.z) - atan(uMoonBack.x, -uMoonBack.z)), GLINT_AZ);
    float glint = near * exp(-sq(dAz / 0.012)) * (0.35 + 0.65 * valueNoise(vec2(p.x * 6.0, p.y * 55.0 + ring * 6.0)));
    mirror += uMoonBody * glint * 0.9;
    vec3 toLight = normalize(uCursor.xyz - vWorld);
    mirror += uCursorColor * pow(max(dot(refl, toLight), 0.0), 24.0) * handReach(vWorld) * 0.35;
    col = mix(col * 0.55, mirror, wet * 0.85);
  }

  float tone = sat(luma(col) / 0.22);
  col *= 1.0 - LINE_CONTRAST * lineScreen(p, tone) * (1.0 - wet);
  col = mix(col, uHaze.rgb, 1.0 - exp(-max(vDepth - HAZE_START, 0.0) * uHaze.w));
  outColor = vec4(col, 1.0);
}
