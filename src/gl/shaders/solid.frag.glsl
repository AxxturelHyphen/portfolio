// Solid built things (src/gl/solid.material.ts), after common.glsl and lights.glsl: the stone tile laid on every face at
// its real scale in world space, so blocks that meet run on over the same stones, tinted and lit as the stone cutouts
// are (cutout.frag.glsl): the dusk ambient, the moon key and rim, the lanterns with the carried one's shadow, the night
// away from the visitor, the haze, the layer air and the paper floor. Opaque. Each piece carries its paint (vTint, vLook,
// vGlow): which of the TILES it is laid with, at what scale, its top faces' lift, the grotto rock's marks and a light of
// its own (a lantern's warm glass, under the paper's shoulder).
uniform sampler2D uColor[TILES];
uniform sampler2D uNormal[TILES];
uniform float uTileM[TILES];   // metres per tile at its real scale
uniform vec4 uRect[TILES];     // the tile's uv rect on its atlas page
uniform vec4 uTile;            // y: normal map gain, z: the tile's uv inset (its outer texels fade)
uniform vec3 uCamPos;
uniform vec4 uHaze;        // haze rgb, density per metre past ROAM_HAZE_START

in vec3 vWorld;
in vec3 vNormal;
in vec3 vDepth;
flat in vec3 vTint;
flat in vec4 vLook;
flat in vec3 vGlow;
out vec4 outColor;

// A sampler array takes constant indices only: one branch per slot (the gradients are explicit, so any branch is safe).
vec3 tileColor(int s, vec2 uv, vec2 dx, vec2 dy) {
  if (s == 0) return textureGrad(uColor[0], uv, dx, dy).rgb;
  if (s == 1) return textureGrad(uColor[1], uv, dx, dy).rgb;
  if (s == 2) return textureGrad(uColor[2], uv, dx, dy).rgb;
  if (s == 3) return textureGrad(uColor[3], uv, dx, dy).rgb;
  if (s == 4) return textureGrad(uColor[4], uv, dx, dy).rgb;
  if (s == 5) return textureGrad(uColor[5], uv, dx, dy).rgb;
  return textureGrad(uColor[6], uv, dx, dy).rgb;
}
vec2 tileNormal(int s, vec2 uv, vec2 dx, vec2 dy) {
  if (s == 0) return textureGrad(uNormal[0], uv, dx, dy).xy;
  if (s == 1) return textureGrad(uNormal[1], uv, dx, dy).xy;
  if (s == 2) return textureGrad(uNormal[2], uv, dx, dy).xy;
  if (s == 3) return textureGrad(uNormal[3], uv, dx, dy).xy;
  if (s == 4) return textureGrad(uNormal[4], uv, dx, dy).xy;
  if (s == 5) return textureGrad(uNormal[5], uv, dx, dy).xy;
  return textureGrad(uNormal[6], uv, dx, dy).xy;
}
// Every tile is alone on its page: its last mip is its mean.
vec3 tileMean(int s) {
  if (s == 0) return textureLod(uColor[0], vec2(0.5), 10.0).rgb;
  if (s == 1) return textureLod(uColor[1], vec2(0.5), 10.0).rgb;
  if (s == 2) return textureLod(uColor[2], vec2(0.5), 10.0).rgb;
  if (s == 3) return textureLod(uColor[3], vec2(0.5), 10.0).rgb;
  if (s == 4) return textureLod(uColor[4], vec2(0.5), 10.0).rgb;
  if (s == 5) return textureLod(uColor[5], vec2(0.5), 10.0).rgb;
  return textureLod(uColor[6], vec2(0.5), 10.0).rgb;
}

const float ROAM_HAZE_START = 7.0;
const float AMBIENT_GAIN = 1.6;
const float FILL = 0.6;
const float KNEE = 0.22;
const float CEIL = 0.36;
const vec2 FOOT_SHADE = vec2(0.14, 0.4);
const vec2 FOCUS_BACK = vec2(0.35, 1.6);
const float ROAM_FLOOR = 0.014;
const float ROAM_FLOOR_KNEE = 0.035;
// Edges seen edge-on darken toward the pencil, so a block's outline reads drawn, as the iron's bars do.
const vec3 GRAPHITE = vec3(0.011, 0.010, 0.012);
const vec2 GRAZE = vec2(0.05, 0.3);
const float GRAZE_INK = 0.35;
// The grotto's rock, drawn by hand: every facet its own tone of the stone (a cut-paper facet), thin darker strata
// running level through the rock, and pencil hatching laid across the faces where the lantern does not reach.
const float ROCK_DETAIL = 0.5;         // the share of the photo's own contrast kept
const vec2 FACET_TONE = vec2(0.8, 1.16);
const float STRATA_M = 0.42;          // height of one stratum
const float STRATA_INK = 0.55;
const float STRATA_LINE = 0.08;       // the line's share of a stratum
const float HATCH_PER_M = 7.0;
const float HATCH_INK = 0.55;
const vec2 HATCH_DARK = vec2(0.012, 0.07);   // lit luma under which the hatching is full and over which it is gone
// Level faces (the floor) keep one tone: their facets only tilt a little and would flicker as a chequer.
float facetTone(vec3 p) {
  vec3 g = normalize(cross(dFdx(p), dFdy(p)));
  float tone = mix(FACET_TONE.x, FACET_TONE.y, hash12(floor(g.xz * 9.0) + floor(g.y * 9.0) * 17.0));
  return mix(tone, 1.0, smoothstep(0.8, 0.95, abs(g.y)));
}
float strata(vec3 p, float side) {
  float y = p.y / STRATA_M + 0.18 * sin(p.x * 0.9 + p.z * 0.6) + 0.08 * sin(p.x * 2.3 - p.z * 1.7);
  float d = abs(fract(y) - 0.5) * 2.0;
  float w = fwidth(y) * 2.0;
  return 1.0 - STRATA_INK * side * smoothstep(1.0 - STRATA_LINE - w, 1.0 - STRATA_LINE * 0.3, d);
}
vec3 hatch(vec3 lit, vec2 q) {
  float s = (q.x + q.y) * HATCH_PER_M;
  float line = 1.0 - smoothstep(0.18, 0.18 + fwidth(s) * 1.5, abs(fract(s) - 0.5));
  float ink = HATCH_INK * (1.0 - smoothstep(HATCH_DARK.x, HATCH_DARK.y, luma(lit)));
  return mix(lit, GRAPHITE, ink * line);
}

vec3 paperShoulder(vec3 c) {
  float m = max(max(c.r, c.g), max(c.b, 1e-4));
  float rolled = m < KNEE ? m : KNEE + (CEIL - KNEE) * (1.0 - exp(-(m - KNEE) / (CEIL - KNEE)));
  return c * (rolled / m);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 a = abs(n);
  // The face's own plane: tops take x, z; sides take their run and height. t, b: the tile's u and v in world space.
  vec3 t = a.y > max(a.x, a.z) ? vec3(1.0, 0.0, 0.0) : normalize(vec3(n.z, 0.0, -n.x));
  vec3 b = a.y > max(a.x, a.z) ? vec3(0.0, 0.0, 1.0) : vec3(0.0, -1.0, 0.0);
  int slot = int(vLook.x + 0.5);
  float rock = vLook.w;
  float metres = uTileM[slot] * vLook.y;
  vec4 rect = uRect[slot];
  vec2 p = vec2(dot(vWorld, t), dot(vWorld, b)) / metres;
  vec2 span = (rect.zw - rect.xy) * (1.0 - 2.0 * uTile.z);
  vec2 uv = rect.xy + (rect.zw - rect.xy) * uTile.z + fract(p) * span;
  vec2 dx = dFdx(p) * span;
  vec2 dy = dFdy(p) * span;
  vec3 tex = tileColor(slot, uv, dx, dy);
  // The rock's marks are worked out on every piece (their derivatives must be), kept only on the rock: the photo's
  // blotches calmed toward the tile's mean, a tone per facet and the strata.
  float tone = facetTone(vWorld);
  float layered = strata(vWorld, 1.0 - smoothstep(0.6, 0.9, a.y));
  if (rock > 0.5) tex = mix(tileMean(slot), tex, ROCK_DETAIL) * tone * layered;
  vec3 albedo = tex * vTint * (1.0 + vLook.z * smoothstep(0.6, 0.95, n.y));
  vec2 nxy = tileNormal(slot, uv, dx, dy) * 2.0 - 1.0;
  n = normalize(n + (t * nxy.x - b * nxy.y) * uTile.y);

  vec3 night = nightOf(vWorld);
  vec3 ambient = neutralise(uAmbient) * AMBIENT_GAIN * mix(0.8, 1.25, n.y * 0.5 + 0.5) * (1.0 + FILL * fillAt(vDepth.x));
  vec3 key = neutralise(uMoonColor) * wrapLight(dot(n, uMoonDir), 0.4);
  vec3 rim = uRimColor * sq(max(dot(n, uMoonBack), 0.0)) * 2.0;
  vec3 hand = handLights(vWorld, n) + lampLights(vWorld, n) + inviteLights(vWorld, n);
  vec3 lit = paperShoulder(albedo * (ambient + key + rim) * night + keyLit(albedo, hand) + vGlow);
  lit *= 1.0 - FOOT_SHADE.y * uEye.z * (1.0 - smoothstep(0.0, FOOT_SHADE.x, vWorld.y));
  vec3 hatched = hatch(lit, p * metres);
  if (rock > 0.5) lit = hatched;

  vec3 v = normalize(uCamPos - vWorld);
  float hazed = 1.0 - exp(-max(vDepth.x - ROAM_HAZE_START, 0.0) * uHaze.w);
  vec3 haze = neutralise(uHaze.rgb);
  float back = uFocusBack.w * smoothstep(FOCUS_BACK.x, FOCUS_BACK.y, vDepth.x - vDepth.z);
  lit = layerAir(mix(lit, haze, hazed), vDepth.x - vDepth.y, back);
  vec3 hazeHue = mix(vec3(1.0), haze / max(luma(haze), 1e-3), 0.5);
  lit += hazeHue * ROAM_FLOOR * uEye.z * (1.0 - smoothstep(0.0, ROAM_FLOOR_KNEE, luma(lit)));
  lit = mix(lit, GRAPHITE, GRAZE_INK * (1.0 - smoothstep(GRAZE.x, GRAZE.y, abs(dot(normalize(vNormal), v)))) * (1.0 - hazed));
  outColor = vec4(lit, 1.0);
}
